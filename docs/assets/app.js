/* Building Codes CBA — explorer. Map views (hazard / exposure / growth / risk
   metrics) on hex tiles with baked bins, plain-language scenario, icon tiles
   with relatable context stats, SSP fans, dividends and retrofit panels. */

(function () {
  "use strict";

  const fmtInt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const fmtUsd = (v) => {
    if (v == null || !isFinite(v)) return "–";
    const a = Math.abs(v);
    if (a >= 1e9) return "$" + (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + "B";
    if (a >= 1e6) return "$" + (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
    if (a >= 1e3) return "$" + (v / 1e3).toFixed(0) + "k";
    return "$" + v.toFixed(0);
  };
  const fmtArea = (v) => {
    if (v == null || !isFinite(v)) return "–";
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(1) + " km²";
    if (a >= 1e3) return (v / 1e3).toFixed(0) + "k m²";
    return v.toFixed(0) + " m²";
  };

  // plain-language names for the GEM code levels (per-audience request)
  const CD_PLAIN = {
    CDN: "no seismic code",
    CDL: "a basic seismic code",
    CDM: "a moderate seismic code",
    CDH: "a modern, high-standard seismic code",
  };

  const RAMP_SEQ = ["#ffffcc", "#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#f03b20", "#bd0026"];
  const RAMP_GNBU = ["#f7fcf0", "#e0f3db", "#ccebc5", "#a8ddb5", "#7bccc4", "#4eb3d3", "#0868ac"];
  const RAMP_BLUE = ["#f0f7fb", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#17406d"];
  const RAMP_PURP = ["#fcfbfd", "#efedf5", "#dadaeb", "#bcbddc", "#9e9ac8", "#807dba", "#6a51a3"];
  const BCR_REDS = ["#a50026", "#d73027", "#f46d43", "#fdae61"];
  const BCR_GREENS = ["#d9f0d3", "#a6dba0", "#7fbc41", "#4d9221", "#276419"];
  const NODATA = "#e1e0d9";

  // BCR ramp adapts to the exported bins: classes below the 1.0 edge get red
  // shades, classes at/above it get greens spread across the actual range
  function bcrRamp(bins) {
    const j = bins.findIndex((b) => Math.abs(b - 1.0) < 1e-9);
    const nClasses = bins.length + 1;
    if (j < 0) {   // no 1.0 edge: assume all >= 1 -> all greens
      return Array.from({ length: nClasses }, (_, i) =>
        BCR_GREENS[Math.round((i / Math.max(nClasses - 1, 1)) * (BCR_GREENS.length - 1))]);
    }
    const nRed = j + 1, nGreen = nClasses - nRed;
    const reds = BCR_REDS.slice(-nRed);
    const greens = Array.from({ length: nGreen }, (_, i) =>
      BCR_GREENS[Math.round((i / Math.max(nGreen - 1, 1)) * (BCR_GREENS.length - 1))]);
    return reds.concat(greens);
  }

  // risk metrics (the "Risk metrics" view)
  const METRICS = {
    bcr: { label: "Benefit-cost ratio (all 3 dividends, SSP2) — green ≥ 1",
           short: "BCR", ramp: null /* dynamic */, fmt: (v) => (v == null ? "–" : v.toFixed(2)) },
    npv_benefits: { label: "Total benefits — all 3 dividends (NPV, SSP2)",
                    short: "Benefits", ramp: RAMP_GNBU, fmt: fmtUsd },
    aal_2025: { label: "Average annual earthquake loss, 2025 (USD/yr)",
                short: "Annual loss", ramp: RAMP_SEQ, fmt: (v) => fmtUsd(v) + "/yr" },
    aal_ratio: { label: "Average annual earthquake loss as a share of building value",
                 short: "Loss rate", ramp: RAMP_SEQ,
                 fmt: (v) => (v == null ? "–" : (100 * v).toFixed(2) + "% of value/yr") },
  };

  // top-level map views (hazard renders as a continuous country-wide surface)
  const VIEWS = {
    hazard: { key: "pga_475", label: "Seismic hazard — peak ground acceleration, 475-yr return period (g)",
              ramp: null, fmt: (v) => (v == null ? "–" : v.toFixed(2) + " g"), image: true },
    exposure: { key: "repl_value", label: "Exposure 2025 — building replacement value per hex (USD)",
                ramp: RAMP_BLUE, fmt: fmtUsd },
    growth: { key: "fa_growth", label: "New floor area added 2025→2075 (m², SSP2)",
              ramp: RAMP_PURP, fmt: fmtArea },
    risk: null,   // uses METRICS
  };

  // small inline icons for the stat tiles (stroke = currentColor)
  const I = (d) => '<svg class="ticon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>";
  const ICONS = {
    aal: I('<path d="M3 21h18M5 21V10l4-3v14M9 21V7l6-4v18M15 21v-8l4-2v10"/>'),
    gdp: I('<path d="M3 17l5-5 4 3 6-7"/><path d="M21 21H3V3"/>'),
    fatalities: I('<path d="M12 3l9 16H3z"/><path d="M12 10v4m0 3h.01"/>'),
    bcr: I('<path d="M12 3v18M7 7h10M5 7l-2 5a3 3 0 006 0zM19 7l-2 5a3 3 0 006 0z"/>'),
    lives: I('<path d="M12 21s-7-4.6-9.3-9A5.4 5.4 0 0112 6a5.4 5.4 0 019.3 6c-2.3 4.4-9.3 9-9.3 9z"/>'),
    dalys: I('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
    jobs: I('<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V6a2 2 0 012-2h2a2 2 0 012 2v2"/>'),
    breakeven: I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  };

  async function json(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ": HTTP " + r.status);
    return r.json();
  }

  function hashState() {
    const out = {};
    for (const part of location.hash.replace(/^#/, "").split("&")) {
      const [k, v] = part.split("=");
      if (k && v) out[k] = decodeURIComponent(v);
    }
    return out;
  }
  function setHash() {
    location.hash = "iso=" + state.iso + "&view=" + state.view + "&metric=" + state.metric;
  }

  async function fillMetaLine() {
    try {
      const meta = await json("data/meta.json");
      document.querySelectorAll("[data-meta-line]").forEach((el) => {
        el.textContent = "Generated " + (meta.generated || "") +
          " · discount rate " + Math.round(100 * (meta.discount_rate || 0.05)) + "%";
      });
    } catch (e) { /* optional */ }
  }

  if (document.currentScript && document.currentScript.dataset.page === "about") {
    fillMetaLine();
    return;
  }

  // ---------------- explorer ----------------
  const state = { iso: null, view: "risk", metric: "bcr" };
  const h = hashState();
  if (h.view && VIEWS.hasOwnProperty(h.view)) state.view = h.view;
  if (h.metric && METRICS[h.metric]) state.metric = h.metric;

  const tooltip = document.getElementById("tooltip");
  const select = document.getElementById("country-select");
  let index = [], country = null;

  const map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      sources: {
        basemap: {
          type: "raster",
          tiles: ["https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#f9f9f7" } },
        { id: "basemap", type: "raster", source: "basemap", paint: { "raster-opacity": 0.85 } },
      ],
    },
    center: [20, 10], zoom: 1.5, minZoom: 0.6, maxZoom: 10,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  function activeLayer() {
    if (state.view === "risk") {
      const m = METRICS[state.metric];
      return { key: state.metric, label: m.label, ramp: m.ramp, fmt: m.fmt };
    }
    return VIEWS[state.view];
  }

  function fillExpr(key, ramp, bins) {
    const edges = (bins && bins.length ? bins : [0]).slice(0, ramp.length - 1);
    const step = ["step", ["get", key], ramp[0]];
    edges.forEach((e, i) => step.push(e, ramp[Math.min(i + 1, ramp.length - 1)]));
    return ["case", ["==", ["typeof", ["get", key]], "number"], step, NODATA];
  }

  function drawLegend(lay, bins) {
    const el = document.getElementById("legend");
    const edges = (bins && bins.length ? bins : []).slice(0, lay.ramp.length - 1);
    let htmlStr = "<strong>" + lay.label + "</strong>";
    for (let i = 0; i <= edges.length; i++) {
      let lbl;
      if (!edges.length) lbl = "";
      else if (i === 0) lbl = "< " + lay.fmt(edges[0]);
      else if (i === edges.length) lbl = "≥ " + lay.fmt(edges[edges.length - 1]);
      else lbl = lay.fmt(edges[i - 1]) + "–" + lay.fmt(edges[i]);
      htmlStr += '<span><span class="swatch" style="background:' +
        lay.ramp[Math.min(i, lay.ramp.length - 1)] + '"></span>' + lbl + "</span>";
    }
    el.innerHTML = htmlStr;
  }

  function styleHexLayer() {
    if (!country || !map.getLayer("hex-fill")) return;
    const mp = country.metrics_payload;
    const isHaz = state.view === "hazard" && mp.hazard_image;
    // hazard view swaps the hex mosaic for the continuous surface
    ["hex-fill", "hex-line"].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", isHaz ? "none" : "visible");
    });
    if (map.getLayer("haz-img")) {
      map.setLayoutProperty("haz-img", "visibility", isHaz ? "visible" : "none");
    }
    const lay = activeLayer();
    if (isHaz) {
      const hz = mp.hazard_image;
      drawLegend({ label: lay.label, ramp: hz.colors, fmt: lay.fmt },
                 hz.bins.slice(0, hz.colors.length - 1));
    } else {
      const bins = (mp.hex.bins || {})[lay.key] || [];
      const ramp = lay.ramp || (lay.key === "bcr" ? bcrRamp(bins) : RAMP_SEQ);
      map.setPaintProperty("hex-fill", "fill-color", fillExpr(lay.key, ramp, bins));
      drawLegend({ label: lay.label, ramp: ramp, fmt: lay.fmt }, bins);
    }
    document.querySelectorAll("#metric-toggle button").forEach((b) =>
      b.setAttribute("aria-pressed", String(state.view === "risk" && b.dataset.metric === state.metric)));
    document.getElementById("metric-group").style.display =
      state.view === "risk" ? "" : "none";
    document.querySelectorAll("#view-toggle button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
  }

  function renderScenario(mp) {
    const el = document.getElementById("scenario");
    if (!el) return;
    const it = (mp.metrics || {}).intervention || {};
    const dr = (mp.metrics || {}).discount_rate;
    let head;
    if (it.kind === "code_upgrade") {
      const prem = it.premium_mode === "pct_of_ucc" && it.premium_pct
        ? ", adding about " + (100 * it.premium_pct).toFixed(1) + "% to construction costs"
        : "";
      head = "<strong>Scenario:</strong> new buildings are designed to " +
        (CD_PLAIN[it.target] || it.target) + " (" + it.target +
        ") instead of today's " + (CD_PLAIN[it.in_force] || it.in_force) +
        " (" + it.in_force + ")" + prem + ".";
    } else if (it.kind === "enforcement") {
      head = "<strong>Scenario:</strong> stronger enforcement of " +
        (CD_PLAIN[it.in_force] || it.in_force) + " (" + it.in_force + ") already in force.";
    } else {
      head = "<strong>Scenario</strong>";
    }
    el.innerHTML = head +
      (dr != null ? " Benefits and costs 2025–2075, discounted at " +
        Math.round(100 * dr) + "%." : "");
  }

  function renderTiles(mp) {
    const m = mp.metrics;
    const ssp2 = mp.ssp_table.find((r) => r.ssp === "SSP2") || mp.ssp_table[0];
    const bcrs = mp.ssp_table.map((r) => r.bcr).filter((v) => v != null);
    const bcrRange = bcrs.length > 1
      ? Math.min(...bcrs).toFixed(2) + "–" + Math.max(...bcrs).toFixed(2)
      : null;
    const tiles = [
      [ICONS.aal, fmtUsd(m.baseline_aal_2025_usd) + "/yr", "Average annual loss (2025)"],
      [ICONS.gdp, (100 * m.aal_pct_gdp_2025).toFixed(1) + "%", "Annual loss as % of GDP"],
      [ICONS.fatalities, fmtInt.format(m.baseline_fatalities_2025_per_yr), "Expected fatalities /yr"],
      [ICONS.bcr, ssp2.bcr.toFixed(2) + (bcrRange ? ' <span style="font-size:0.65em;color:var(--muted)">' + bcrRange + "</span>" : ""),
       "Benefit-cost ratio — SSP2 · range"],
      [ICONS.lives, fmtInt.format(ssp2.lives_saved), "Lives saved to 2075"],
      [ICONS.dalys, ssp2.dalys_averted != null ? fmtInt.format(ssp2.dalys_averted) : "–",
       "Healthy life-years protected (DALYs)"],
      [ICONS.jobs, fmtInt.format(ssp2.job_years), "Job-years preserved"],
    ];
    document.getElementById("tiles").innerHTML = tiles
      .map(([ic, v, k]) => '<div class="tile">' + ic +
        '<div><div class="v">' + v + '</div><div class="k">' + k + "</div></div></div>")
      .join("");

    // relatable context under the tiles
    const ctx = mp.context || {};
    const name = mp.name || mp.iso3;
    const items = [];
    if (ctx.emdat_deaths) {
      items.push("<strong>Lives:</strong> for scale, " +
        fmtInt.format(ctx.emdat_deaths) + " " +
        (ctx.emdat_note || "earthquake deaths (EM-DAT)") + ".");
    }
    if (ssp2.dalys_averted) {
      items.push("<strong>DALYs:</strong> a DALY is one lost year of healthy life. " +
        "For scale, proven health programmes such as childhood immunisation or " +
        "insecticide-treated bednets avert one DALY for roughly $25–100 " +
        "(Disease Control Priorities, 3rd ed., 2018) — so " +
        fmtInt.format(ssp2.dalys_averted) + " DALYs is the burden relieved by a " +
        fmtUsd(ssp2.dalys_averted * 50) + " high-impact health programme.");
    }
    if (ctx.labor_force && ssp2.job_years) {
      const pct = (100 * ssp2.job_years / 50 / ctx.labor_force);
      items.push("<strong>Jobs:</strong> " + fmtInt.format(ssp2.job_years) +
        " job-years over 50 years ≈ keeping " +
        (pct < 0.1 ? pct.toFixed(2) : pct.toFixed(1)) + "% of " + name +
        "'s labour force (" + fmtInt.format(ctx.labor_force) + " people, World Bank " +
        (ctx.labor_force_year || "") + ") employed every year.");
    }
    document.getElementById("tile-context").innerHTML =
      items.map((t) => "<li>" + t + "</li>").join("");
  }

  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    const cols = lines[0].split(",");
    return lines.slice(1).map((ln) => {
      const parts = ln.split(",");
      const row = {};
      cols.forEach((c, i) => (row[c] = parts[i] === "" ? null : isNaN(+parts[i]) ? parts[i] : +parts[i]));
      return row;
    });
  }

  function renderChart(rows, mp) {
    const ssps = [...new Set(rows.map((r) => r.ssp))].sort();
    if (!ssps.length) return;
    const bySsp = Object.fromEntries(ssps.map((s) => [s, rows.filter((r) => r.ssp === s)]));
    const base = bySsp["SSP2"] || bySsp[ssps[0]];
    const years = base.map((r) => r.year);
    const cost = base.map((r) => r.cum_disc_costs);
    const allBen = ssps.map((s) => bySsp[s].map((r) => r.cum_disc_benefits));
    const W = 420, H = 190, PAD = { l: 46, r: 8, t: 8, b: 22 };
    const xmin = Math.min(...years), xmax = Math.max(...years);
    const ymax = Math.max(...cost, ...allBen.flat()) || 1;
    const X = (x) => PAD.l + ((x - xmin) / (xmax - xmin || 1)) * (W - PAD.l - PAD.r);
    const Y = (y) => H - PAD.b - (y / ymax) * (H - PAD.t - PAD.b);
    const path = (v) => v.map((y, i) => (i ? "L" : "M") + X(years[i]).toFixed(1) + "," + Y(y).toFixed(1)).join(" ");
    let s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img">';
    [0, 0.5, 1].forEach((f) => {
      const t = f * ymax;
      s += '<line x1="' + PAD.l + '" x2="' + (W - PAD.r) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" stroke="#e1e0d9"/>' +
        '<text x="' + (PAD.l - 4) + '" y="' + (Y(t) + 3) + '" font-size="9" fill="#898781" text-anchor="end">' + fmtUsd(t) + "</text>";
    });
    [xmin, Math.round((xmin + xmax) / 2), xmax].forEach((t) => {
      s += '<text x="' + X(t) + '" y="' + (H - 6) + '" font-size="9" fill="#898781" text-anchor="middle">' + t + "</text>";
    });
    const bandTop = years.map((_, i) => Math.max(...allBen.map((v) => v[i])));
    const bandBot = years.map((_, i) => Math.min(...allBen.map((v) => v[i])));
    s += '<path d="' + path(bandTop) + " " +
      bandBot.map((y, i) => "L" + X(years[bandBot.length - 1 - i]).toFixed(1) + "," +
        Y(bandBot[bandBot.length - 1 - i]).toFixed(1)).join(" ") +
      ' Z" fill="#1a9850" opacity="0.12" stroke="none"/>';
    ssps.forEach((sp) => {
      const bold = sp === "SSP2";
      s += '<path d="' + path(bySsp[sp].map((r) => r.cum_disc_benefits)) +
        '" fill="none" stroke="#1a9850" stroke-width="' + (bold ? 2.6 : 0.9) +
        '" opacity="' + (bold ? 1 : 0.55) + '"/>';
    });
    s += '<path d="' + path(cost) + '" fill="none" stroke="#c0392b" stroke-width="2" stroke-dasharray="5 3"/>';
    const benEnd = (bySsp["SSP2"] || bySsp[ssps[0]]).map((r) => r.cum_disc_benefits);
    s += '<text x="' + (W - PAD.r) + '" y="' + (Y(benEnd[benEnd.length - 1]) - 5) + '" font-size="10" fill="#1a9850" text-anchor="end">benefits — all 3 dividends (SSP2 bold)</text>';
    s += '<text x="' + (W - PAD.r) + '" y="' + (Y(cost[cost.length - 1]) - 5) + '" font-size="10" fill="#c0392b" text-anchor="end">costs (SSP2)</text>';
    s += "</svg>";
    document.getElementById("streams-chart").innerHTML = s;
    const ssp2row = mp.ssp_table.find((r) => r.ssp === "SSP2") || mp.ssp_table[0];
    const bcrs = mp.ssp_table.map((r) => r.bcr);
    document.getElementById("chart-note").textContent =
      "Benefits sum all three resilience dividends (avoided losses + carbon, GDP stimulus, " +
      "durability) — the same basis as the BCR tile and the map. NPV benefits " +
      fmtUsd(ssp2row.npv_benefits_usd) + " vs costs " + fmtUsd(ssp2row.npv_costs_usd) +
      " (SSP2). BCR across SSPs: " + Math.min(...bcrs).toFixed(2) + "–" +
      Math.max(...bcrs).toFixed(2) + ". Lives and DALYs are never monetised.";
  }

  const DIV_COLORS = { D1: "#1a9850", D2: "#2a78d6", D3: "#9467bd" };
  const DIV_LABELS = {
    D1: "1st — avoided losses when disasters strike",
    D2: "2nd — unlocked economic potential (incl. jobs)",
    D3: "3rd — co-benefits of the investment itself",
  };

  function renderDividends(dv) {
    const el = document.getElementById("dividends");
    const note = document.getElementById("dividends-note");
    if (!dv) { el.innerHTML = "<p class='note'>No dividends data.</p>"; note.textContent = ""; return; }
    const total = dv.total_npv || 1;
    const W = 420, H = 26;
    let x = 0, bar = "";
    for (const d of ["D1", "D2", "D3"]) {
      const v = dv[d.toLowerCase() + "_npv"] || 0;
      const w = Math.max(0, (v / total) * W);
      bar += '<rect x="' + x.toFixed(1) + '" y="0" width="' + Math.max(w, 0).toFixed(1) +
        '" height="' + H + '" fill="' + DIV_COLORS[d] + '"><title>' + DIV_LABELS[d] +
        ": " + fmtUsd(v) + "</title></rect>";
      x += w;
    }
    let rows = "";
    for (const d of ["D1", "D2", "D3"]) {
      const v = dv[d.toLowerCase() + "_npv"] || 0;
      rows += '<tr><td><span class="swatch" style="background:' + DIV_COLORS[d] +
        '"></span>' + DIV_LABELS[d] + '</td><td class="num">' + fmtUsd(v) + "</td></tr>";
    }
    rows += '<tr><td><strong>Total benefits (= BCR numerator)</strong></td><td class="num"><strong>' +
      fmtUsd(dv.total_npv) + "</strong></td></tr>" +
      '<tr><td>Program costs</td><td class="num">' + fmtUsd(dv.npv_costs) + "</td></tr>" +
      '<tr><td>Benefit-cost ratio (same everywhere on this page)</td>' +
      '<td class="num"><strong>' + dv.bcr_headline.toFixed(2) + "</strong></td></tr>";
    const c = dv.counts || {};
    el.innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" style="width:100%;height:auto;display:block;margin-bottom:0.5rem">' +
      bar + "</svg><table>" + rows + "</table>";
    note.innerHTML =
      "Counts (not $): lives saved " + fmtInt.format(c.lives_saved || 0) +
      " · DALYs " + fmtInt.format(c.dalys_averted || 0) +
      " · job-years preserved " + fmtInt.format(c.job_years_preserved || 0) +
      " + created " + fmtInt.format(c.job_years_created || 0) + ". " +
      'Framework: <a href="' + dv.url + '">Triple Dividend of Resilience</a> ' +
      "(Tanner et al., ODI/GFDRR/World Bank).";
  }

  function renderRetrofit(rj) {
    const tbl = document.getElementById("retrofit-table");
    if (!rj) { tbl.innerHTML = "<tr><td>No retrofit data.</td></tr>"; return; }
    const idx = Object.fromEntries(rj.columns.map((c, i) => [c, i]));
    const rows = rj.rows.slice(0, 10);
    const nameOf = (r) =>
      idx["class_label"] != null && r[idx["class_label"]] ? r[idx["class_label"]] : r[idx["class"]];
    tbl.innerHTML =
      "<tr><th>Building class</th><th>Level</th><th class=num>Avoided AAL</th><th class=num>Lives/yr</th><th class=num>BCR</th></tr>" +
      rows.map((r) =>
        '<tr><td title="' + r[idx["class"]] + '">' + nameOf(r) + "</td><td>" + r[idx["current_level"]] +
        '</td><td class=num>' + fmtUsd(r[idx["avoided_aal_usd"]]) + "/yr</td><td class=num>" +
        (+r[idx["avoided_fatalities_yr"]]).toFixed(1) + "</td><td class=num>" +
        (+r[idx["bcr_retrofit"]]).toFixed(2) + "</td></tr>").join("");
    const a = rj.assumptions || {};
    document.getElementById("retrofit-note").textContent =
      "Screening assumptions: engineered classes +1 code level; non-engineered −" +
      Math.round(100 * (a.non_engineered_mdr_reduction || 0.35)) +
      "% damage (heuristic); cost as % of replacement value by material.";
  }

  async function loadCountry(iso) {
    state.iso = iso;
    setHash();
    const base = "data/countries/" + iso + "/";
    const [mp, hex, streamsText, rj, bnd] = await Promise.all([
      json(base + "metrics.json"),
      json(base + "hex.geojson"),
      fetch(base + "streams.csv").then((r) => (r.ok ? r.text() : "")),
      json(base + "retrofit.json").catch(() => null),
      json(base + "boundaries.geojson").catch(() => null),
    ]);
    country = { metrics_payload: mp };

    if (map.getSource("hex")) {
      map.getSource("hex").setData(hex);
    } else {
      map.addSource("hex", { type: "geojson", data: hex });
      map.addLayer({ id: "hex-fill", type: "fill", source: "hex",
                     paint: { "fill-opacity": 0.78 } });
      map.addLayer({ id: "hex-line", type: "line", source: "hex",
                     paint: { "line-color": "#555", "line-width": 0.3, "line-opacity": 0.4 } });
    }
    const emptyFc = { type: "FeatureCollection", features: [] };
    if (map.getSource("bnd")) {
      map.getSource("bnd").setData(bnd || emptyFc);
    } else {
      map.addSource("bnd", { type: "geojson", data: bnd || emptyFc });
      map.addLayer({ id: "adm1-line", type: "line", source: "bnd",
                     filter: ["==", ["get", "level"], 1],
                     paint: { "line-color": "#666", "line-width": 0.8, "line-opacity": 0.8 } });
      map.addLayer({ id: "adm0-line", type: "line", source: "bnd",
                     filter: ["==", ["get", "level"], 0],
                     paint: { "line-color": "#333", "line-width": 1.8 } });
    }
    // continuous hazard surface (image overlay; shown in the hazard view)
    const hz = mp.hazard_image;
    if (hz && hz.bounds) {
      const [w, s, e, n] = hz.bounds;
      const coords = [[w, n], [e, n], [e, s], [w, s]];
      const url = base + hz.file;
      if (map.getSource("hazimg")) {
        map.getSource("hazimg").updateImage({ url: url, coordinates: coords });
      } else {
        map.addSource("hazimg", { type: "image", url: url, coordinates: coords });
        map.addLayer({ id: "haz-img", type: "raster", source: "hazimg",
                       layout: { visibility: "none" },
                       paint: { "raster-opacity": 0.85, "raster-resampling": "linear" } },
                     "adm1-line");
      }
    } else if (map.getLayer("haz-img")) {
      map.setLayoutProperty("haz-img", "visibility", "none");
    }
    styleHexLayer();
    const e = index.find((c) => c.iso3 === iso);
    if (e && e.bounds) {
      map.fitBounds([[e.bounds[0], e.bounds[1]], [e.bounds[2], e.bounds[3]]],
                    { padding: 30, duration: 600 });
    }
    renderScenario(mp);
    renderTiles(mp);
    if (streamsText) renderChart(parseCsv(streamsText), mp);
    renderDividends(mp.dividends);
    renderRetrofit(rj);
  }

  map.on("mousemove", "hex-fill", (ev) => {
    const f = ev.features && ev.features[0];
    if (!f) return;
    const p = f.properties;
    const lay = activeLayer();
    tooltip.style.display = "block";
    tooltip.style.left = ev.point.x + 14 + "px";
    tooltip.style.top = ev.point.y + 14 + "px";
    tooltip.innerHTML =
      "<strong>" + lay.label + ": " + lay.fmt(p[lay.key]) + "</strong><br>" +
      "hazard " + (p.pga_475 != null ? p.pga_475.toFixed(2) + " g" : "–") +
      " · value " + fmtUsd(p.repl_value) +
      "<br>annual loss " + fmtUsd(p.aal_2025) + "/yr · BCR " +
      (p.bcr != null ? (+p.bcr).toFixed(2) : "–");
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "hex-fill", () => {
    tooltip.style.display = "none";
    map.getCanvas().style.cursor = "";
  });

  document.getElementById("view-toggle").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-view]");
    if (!btn) return;
    state.view = btn.dataset.view;
    setHash();
    styleHexLayer();
  });
  document.getElementById("metric-toggle").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-metric]");
    if (!btn) return;
    state.view = "risk";
    state.metric = btn.dataset.metric;
    setHash();
    styleHexLayer();
  });

  select.addEventListener("change", () => loadCountry(select.value));

  (async function init() {
    fillMetaLine();
    index = await json("data/countries_index.json");
    select.innerHTML = index.map((c) =>
      '<option value="' + c.iso3 + '">' + c.name + "</option>").join("");
    const wanted = h.iso && index.some((c) => c.iso3 === h.iso) ? h.iso : (index[0] && index[0].iso3);
    if (wanted) {
      select.value = wanted;
      map.on("load", () => loadCountry(wanted));
    }
  })();
})();
