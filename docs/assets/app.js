/* Building Codes CBA — explorer. Hex-tile map (per-country GeoJSON with baked
   quantile bins), summary tiles, SSP2 cumulative benefit/cost SVG chart,
   retrofit table. Pattern: UCC Database site. */

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
  const fmtMetric = {
    bcr: (v) => (v == null ? "–" : v.toFixed(2)),
    npv_benefits: fmtUsd,
    aal_2025: (v) => fmtUsd(v) + "/yr",
    aal_ratio: (v) => (v == null ? "–" : (100 * v).toFixed(2) + "%"),
  };
  const METRIC_LABEL = {
    bcr: "Benefit-cost ratio (SSP2)",
    npv_benefits: "NPV avoided losses (SSP2)",
    aal_2025: "Baseline AAL 2025 (USD/yr)",
    aal_ratio: "AAL / replacement value",
  };
  const RAMP_SEQ = ["#ffffcc", "#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#f03b20", "#bd0026"];
  const RAMP_DIV = ["#d73027", "#f46d43", "#fdae61", "#fee08b", "#d9ef8b", "#66bd63", "#1a9850"];
  const NODATA = "#e1e0d9";

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
  function setHash(state) {
    location.hash = "iso=" + state.iso + "&metric=" + state.metric;
  }

  async function fillMetaLine() {
    try {
      const meta = await json("data/meta.json");
      document.querySelectorAll("[data-meta-line]").forEach((el) => {
        el.textContent = "Generated " + (meta.generated || "") +
          " · discount rate " + Math.round(100 * (meta.discount_rate || 0.05)) + "%";
      });
    } catch (e) { /* footer line is optional */ }
  }

  if (document.currentScript && document.currentScript.dataset.page === "about") {
    fillMetaLine();
    return;
  }

  // ---------------- explorer ----------------
  const state = { iso: null, metric: "bcr" };
  const h = hashState();
  if (h.metric && METRIC_LABEL[h.metric]) state.metric = h.metric;

  const tooltip = document.getElementById("tooltip");
  const select = document.getElementById("country-select");
  let index = [], country = null, hexData = null;

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

  function ramp(metric) { return metric === "bcr" ? RAMP_DIV : RAMP_SEQ; }

  function fillExpr(metric, bins) {
    const colors = ramp(metric);
    const edges = (bins && bins.length ? bins : [0]).slice(0, colors.length - 1);
    const step = ["step", ["get", metric], colors[0]];
    edges.forEach((e, i) => step.push(e, colors[Math.min(i + 1, colors.length - 1)]));
    return ["case", ["==", ["typeof", ["get", metric]], "number"], step, NODATA];
  }

  function drawLegend(metric, bins) {
    const el = document.getElementById("legend");
    const colors = ramp(metric);
    const edges = (bins && bins.length ? bins : []).slice(0, colors.length - 1);
    const fmt = fmtMetric[metric];
    let htmlStr = "<strong>" + METRIC_LABEL[metric] + "</strong>";
    for (let i = 0; i <= edges.length; i++) {
      let lbl;
      if (!edges.length) lbl = "";
      else if (i === 0) lbl = "< " + fmt(edges[0]);
      else if (i === edges.length) lbl = "≥ " + fmt(edges[edges.length - 1]);
      else lbl = fmt(edges[i - 1]) + "–" + fmt(edges[i]);
      htmlStr += '<span><span class="swatch" style="background:' +
        colors[Math.min(i, colors.length - 1)] + '"></span>' + lbl + "</span>";
    }
    el.innerHTML = htmlStr;
  }

  function styleHexLayer() {
    if (!country || !map.getLayer("hex-fill")) return;
    const bins = (country.metrics_payload.hex.bins || {})[state.metric] || [];
    map.setPaintProperty("hex-fill", "fill-color", fillExpr(state.metric, bins));
    drawLegend(state.metric, bins);
  }

  function renderScenario(mp) {
    const el = document.getElementById("scenario");
    if (!el) return;
    const it = (mp.metrics || {}).intervention || {};
    const p = (mp.metrics || {}).practice_p_national;
    const dr = (mp.metrics || {}).discount_rate;
    let head;
    if (it.kind === "code_upgrade") {
      head = "<strong>Scenario:</strong> new construction raised from <strong>" +
        (it.in_force || "?") + "</strong> (in force) to <strong>" + (it.target || "?") +
        "</strong>.";
    } else if (it.kind === "enforcement") {
      head = "<strong>Scenario:</strong> stronger enforcement of the <strong>" +
        (it.in_force || "?") + "</strong> code already in force.";
    } else {
      head = "<strong>Scenario</strong>";
    }
    el.innerHTML = head +
      (p != null ? " Practice factor " + p.toFixed(2) + "." : "") +
      (dr != null ? " 2025–2075 at " + Math.round(100 * dr) + "% discount." : "") +
      (it.note ? '<br><span class="note">' + it.note + "</span>" : "");
  }

  function renderTiles(mp) {
    const m = mp.metrics;
    const ssp2 = mp.ssp_table.find((r) => r.ssp === "SSP2") || mp.ssp_table[0];
    const bcrs = mp.ssp_table.map((r) => r.bcr).filter((v) => v != null);
    const bcrRange = bcrs.length > 1
      ? Math.min(...bcrs).toFixed(2) + "–" + Math.max(...bcrs).toFixed(2)
      : null;
    const tiles = [
      [fmtUsd(m.baseline_aal_2025_usd) + "/yr", "Baseline AAL (2025)"],
      [(100 * m.aal_pct_gdp_2025).toFixed(1) + "%", "AAL as % of GDP"],
      [fmtInt.format(m.baseline_fatalities_2025_per_yr), "Expected fatalities /yr"],
      [ssp2.bcr.toFixed(2) + (bcrRange ? ' <span style="font-size:0.65em;color:var(--muted)">' + bcrRange + "</span>" : ""),
       "BCR — SSP2 · all-SSP range"],
      [ssp2.bcr_with_lives != null ? ssp2.bcr_with_lives.toFixed(2) : "—",
       "BCR incl. lives (side)"],
      [fmtInt.format(ssp2.lives_saved), "Lives saved to 2075"],
      [ssp2.dalys_averted != null ? fmtInt.format(ssp2.dalys_averted) : "—",
       "DALYs averted"],
      [fmtInt.format(ssp2.job_years), "Job-years preserved"],
      [ssp2.break_even_year || "—", "Break-even year"],
    ];
    document.getElementById("tiles").innerHTML = tiles
      .map(([v, k]) => '<div class="tile"><div class="v">' + v + '</div><div class="k">' + k + "</div></div>")
      .join("");
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
    // min-max benefits band across SSPs + thin lines, SSP2 bold
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
    const benEnd = bySsp["SSP2"] ? bySsp["SSP2"].map((r) => r.cum_disc_benefits) : allBen[0];
    s += '<text x="' + (W - PAD.r) + '" y="' + (Y(benEnd[benEnd.length - 1]) - 5) + '" font-size="10" fill="#1a9850" text-anchor="end">benefits (5 SSPs, SSP2 bold)</text>';
    s += '<text x="' + (W - PAD.r) + '" y="' + (Y(cost[cost.length - 1]) - 5) + '" font-size="10" fill="#c0392b" text-anchor="end">costs (SSP2)</text>';
    s += "</svg>";
    document.getElementById("streams-chart").innerHTML = s;
    const ssp2row = mp.ssp_table.find((r) => r.ssp === "SSP2") || mp.ssp_table[0];
    const bcrs = mp.ssp_table.map((r) => r.bcr);
    document.getElementById("chart-note").textContent =
      "NPV benefits " + fmtUsd(ssp2row.npv_benefits_usd) + " vs costs " +
      fmtUsd(ssp2row.npv_costs_usd) + " (SSP2, 5% discount). BCR across SSPs: " +
      Math.min(...bcrs).toFixed(2) + "–" + Math.max(...bcrs).toFixed(2) +
      ". Lives saved are not monetised.";
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
    rows += '<tr><td><strong>Total dividends</strong></td><td class="num"><strong>' +
      fmtUsd(dv.total_npv) + "</strong></td></tr>" +
      '<tr><td>Program costs</td><td class="num">' + fmtUsd(dv.npv_costs) + "</td></tr>" +
      '<tr><td>Benefit-cost ratio (the one BCR — same as chart &amp; map)</td>' +
      '<td class="num"><strong>' + dv.bcr_headline.toFixed(2) + "</strong></td></tr>";
    const c = dv.counts || {};
    el.innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" style="width:100%;height:auto;display:block;margin-bottom:0.5rem">' +
      bar + "</svg><table>" + rows + "</table>";
    note.innerHTML =
      "Counts (not $): D1 lives saved " + fmtInt.format(c.lives_saved || 0) +
      " · D2 job-years preserved " + fmtInt.format(c.job_years_preserved || 0) +
      " + created " + fmtInt.format(c.job_years_created || 0) + ". " +
      'Framework: <a href="' + dv.url + '">Triple Dividend of Resilience</a> ' +
      "(Tanner et al., ODI/GFDRR/World Bank). " + dv.note;
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
    setHash(state);
    const base = "data/countries/" + iso + "/";
    const [mp, hex, streamsText, rj, bnd] = await Promise.all([
      json(base + "metrics.json"),
      json(base + "hex.geojson"),
      fetch(base + "streams.csv").then((r) => (r.ok ? r.text() : "")),
      json(base + "retrofit.json").catch(() => null),
      json(base + "boundaries.geojson").catch(() => null),
    ]);
    country = { metrics_payload: mp };
    hexData = hex;

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
    tooltip.style.display = "block";
    tooltip.style.left = ev.point.x + 14 + "px";
    tooltip.style.top = ev.point.y + 14 + "px";
    tooltip.innerHTML =
      "<strong>" + METRIC_LABEL[state.metric] + ": " + fmtMetric[state.metric](p[state.metric]) + "</strong><br>" +
      "AAL " + fmtUsd(p.aal_2025) + "/yr · avoided " + fmtUsd(p.npv_benefits) +
      "<br>replacement value " + fmtUsd(p.repl_value);
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "hex-fill", () => {
    tooltip.style.display = "none";
    map.getCanvas().style.cursor = "";
  });

  document.getElementById("metric-toggle").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-metric]");
    if (!btn) return;
    state.metric = btn.dataset.metric;
    document.querySelectorAll("#metric-toggle button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b === btn)));
    setHash(state);
    styleHexLayer();
  });

  select.addEventListener("change", () => loadCountry(select.value));

  (async function init() {
    fillMetaLine();
    index = await json("data/countries_index.json");
    select.innerHTML = index.map((c) =>
      '<option value="' + c.iso3 + '">' + c.name + "</option>").join("");
    const wanted = h.iso && index.some((c) => c.iso3 === h.iso) ? h.iso : (index[0] && index[0].iso3);
    document.querySelectorAll("#metric-toggle button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.metric === state.metric)));
    if (wanted) {
      select.value = wanted;
      map.on("load", () => loadCountry(wanted));
    }
  })();
})();
