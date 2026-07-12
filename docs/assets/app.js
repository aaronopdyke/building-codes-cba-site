/* Building Codes CBA — explorer. Map views (hazard / exposure / growth / risk
   metrics) on hex tiles with baked per-horizon bins, plain-language scenario,
   icon tiles with relatable context stats, client-side scenario explorer
   (horizon / discount / premium toggles recompute the chart from exported
   undiscounted flows), triple-dividend + investment breakdown, sortable
   Admin-1 ranking, retrofit panel. */

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
  // ColorBrewer RdBu: colorblind-safe diverging ramp for the BCR (red keeps
  // its "below 1" meaning; BLUES mean the program pays for itself)
  const BCR_REDS = ["#67001f", "#b2182b", "#d6604d", "#f4a582"];
  const BCR_BLUES = ["#d1e5f0", "#92c5de", "#4393c3", "#2166ac", "#053061"];
  const NODATA = "#e1e0d9";

  // BCR ramp adapts to the exported bins: classes below the 1.0 edge get red
  // shades, classes at/above it get blues spread across the actual range
  function bcrRamp(bins) {
    const j = bins.findIndex((b) => Math.abs(b - 1.0) < 1e-9);
    const nClasses = bins.length + 1;
    if (j < 0) {   // no 1.0 edge: assume all >= 1 -> all blues
      return Array.from({ length: nClasses }, (_, i) =>
        BCR_BLUES[Math.round((i / Math.max(nClasses - 1, 1)) * (BCR_BLUES.length - 1))]);
    }
    const nRed = j + 1, nBlue = nClasses - nRed;
    const reds = BCR_REDS.slice(-nRed);
    const blues = Array.from({ length: nBlue }, (_, i) =>
      BCR_BLUES[Math.round((i / Math.max(nBlue - 1, 1)) * (BCR_BLUES.length - 1))]);
    return reds.concat(blues);
  }

  // metrics stored per horizon in the hex/adm1 payloads (suffixed _h25/_h50/_h75)
  const PER_H = new Set(["bcr", "npv_benefits", "npv_costs", "fa_growth", "lives"]);

  // risk metrics (the "Risk metrics" view); labels get the horizon injected
  const METRICS = {
    bcr: { label: (y) => "Benefit-cost ratio over " + y + " years (all 3 dividends, SSP2) — blue ≥ 1",
           short: "BCR", ramp: null /* dynamic */, fmt: (v) => (v == null ? "–" : v.toFixed(2)) },
    npv_benefits: { label: (y) => "Total benefits over " + y + " years — all 3 dividends (NPV, SSP2)",
                    short: "Benefits", ramp: RAMP_GNBU, fmt: fmtUsd },
    aal_2025: { label: () => "Average annual earthquake loss, 2025 (USD/yr)",
                short: "Annual loss", ramp: RAMP_SEQ, fmt: (v) => fmtUsd(v) + "/yr" },
    aal_ratio: { label: () => "Average annual earthquake loss as a share of building value",
                 short: "Loss rate", ramp: RAMP_SEQ,
                 fmt: (v) => (v == null ? "–" : (100 * v).toFixed(2) + "% of value/yr") },
  };

  // top-level map views (hazard renders as a continuous country-wide surface)
  const VIEWS = {
    hazard: { key: "pga_475", label: () => "Seismic hazard — peak ground acceleration, 475-yr return period (g)",
              ramp: null, fmt: (v) => (v == null ? "–" : v.toFixed(2) + " g"), image: true },
    exposure: { key: "repl_value", label: () => "Exposure 2025 — building replacement value per hex (USD)",
                ramp: RAMP_BLUE, fmt: fmtUsd },
    growth: { key: "fa_growth", label: (y, end) => "New floor area added 2025→" + end + " (m², SSP2)",
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
    location.hash = "iso=" + state.iso + "&view=" + state.view +
      "&metric=" + state.metric + "&h=" + state.horizon;
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
  const state = { iso: null, view: "risk", metric: "bcr", horizon: 50,
                  mode: "bc", disc: 0.05, prem: null };
  const h = hashState();
  if (h.view && VIEWS.hasOwnProperty(h.view)) state.view = h.view;
  if (h.metric && METRICS[h.metric]) state.metric = h.metric;
  if (h.h && [25, 50, 75].includes(+h.h)) state.horizon = +h.h;

  const tooltip = document.getElementById("tooltip");
  const select = document.getElementById("country-select");
  const horizonSelect = document.getElementById("horizon-select");
  horizonSelect.value = String(state.horizon);
  let index = [], country = null;

  const endYear = () => 2025 + state.horizon;
  const suffix = (key) => (PER_H.has(key) ? key + "_h" + state.horizon : key);

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
    const src = state.view === "risk" ? METRICS[state.metric] : VIEWS[state.view];
    const key = state.view === "risk" ? state.metric : src.key;
    return { key: key, label: src.label(state.horizon, endYear()),
             ramp: src.ramp, fmt: src.fmt, image: src.image };
  }

  function binsFor(key) {
    const mp = country.metrics_payload;
    if (PER_H.has(key)) {
      const blk = (mp.horizons || {})[String(state.horizon)] || {};
      return (blk.bins || {})[key] || [];
    }
    return (mp.hex.bins || {})[key] || [];
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
      const bins = binsFor(lay.key);
      const ramp = lay.ramp || (lay.key === "bcr" ? bcrRamp(bins) : RAMP_SEQ);
      map.setPaintProperty("hex-fill", "fill-color", fillExpr(suffix(lay.key), ramp, bins));
      drawLegend({ label: lay.label, ramp: ramp, fmt: lay.fmt }, bins);
    }
    document.querySelectorAll("#metric-toggle button").forEach((b) =>
      b.setAttribute("aria-pressed", String(state.view === "risk" && b.dataset.metric === state.metric)));
    document.getElementById("metric-group").style.display =
      state.view === "risk" ? "" : "none";
    document.querySelectorAll("#view-toggle button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
  }

  // ---------------- client-side scenario recompute ----------------
  // scenarios.json holds UNDISCOUNTED per-epoch flows; costs and benefits are
  // linear in the premium %, so any (premium, discount, horizon) combination
  // is exact: costs_t = gov_up + gov_on + pct*premium_base_t;
  // benefits_t = d1_direct + d1_carbon + d3 + m_ref*ramp_t*costs_t.
  function computeSeries(sc, ssp, pct, rate) {
    const s = sc.ssp[ssp];
    if (!s) return null;
    const years = sc.years, t0 = sc.t0, step = sc.epoch_step;
    const cumB = [], cumC = [];
    let cb = 0, cc = 0;
    for (let i = 0; i < years.length; i++) {
      let d = 0;
      for (let y = 0; y < step; y++) d += Math.pow(1 + rate, -(years[i] - t0 + y));
      const cost = s.gov_upfront[i] + s.gov_ongoing[i] + pct * s.premium_base[i];
      const ben = s.d1_direct[i] + s.d1_carbon[i] + s.d3_durability[i] +
        sc.m_ref * sc.ramp[i] * cost;
      cb += ben * d; cc += cost * d;
      cumB.push(cb); cumC.push(cc);
    }
    return { years: years, cumB: cumB, cumC: cumC };
  }

  function bcrAt(sc, ssp, pct, rate, hYear) {
    const r = computeSeries(sc, ssp, pct, rate);
    if (!r) return null;
    let j = -1;
    for (let i = 0; i < r.years.length; i++) if (r.years[i] <= hYear) j = i;
    return j >= 0 && r.cumC[j] > 0 ? r.cumB[j] / r.cumC[j] : null;
  }

  function renderScenario(mp) {
    const el = document.getElementById("scenario");
    if (!el) return;
    const it = (mp.metrics || {}).intervention || {};
    const dr = (mp.metrics || {}).discount_rate;
    let head;
    if (it.kind === "code_upgrade") {
      const prem = it.premium_mode === "pct_of_ucc" && it.premium_pct
        ? ", adding about " + (100 * it.premium_pct).toFixed(1) +
          "% to the structural share of construction costs"
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
      (dr != null ? " Benefits and costs 2025–" + endYear() + ", discounted at " +
        Math.round(100 * dr) + "%." : "");
  }

  function horizonBlock(mp) {
    return (mp.horizons || {})[String(state.horizon)] || {};
  }
  function sspTable(mp) {
    return horizonBlock(mp).ssp_table || mp.ssp_table || [];
  }

  function renderTiles(mp) {
    const m = mp.metrics;
    const tbl = sspTable(mp);
    const ssp2 = tbl.find((r) => r.ssp === "SSP2") || tbl[0];
    if (!ssp2) return;
    const tiles = [
      [ICONS.aal, fmtUsd(m.baseline_aal_2025_usd) + "/yr", "Average annual loss (2025)", ""],
      [ICONS.gdp, (100 * m.aal_pct_gdp_2025).toFixed(1) + "%", "Annual loss as % of GDP", ""],
      [ICONS.fatalities, fmtInt.format(m.baseline_fatalities_2025_per_yr), "Expected fatalities /yr", ""],
      [ICONS.bcr, ssp2.bcr.toFixed(2), "Benefit-cost ratio — SSP2, " + state.horizon + " yrs", ""],
      [ICONS.lives, fmtInt.format(ssp2.lives_saved), "Lives saved to " + endYear(), ""],
      [ICONS.dalys, ssp2.dalys_averted != null ? fmtInt.format(ssp2.dalys_averted) : "–",
       "Healthy life-years protected (DALYs)", ""],
      [ICONS.jobs, fmtInt.format(ssp2.job_years), "Job-years preserved", ""],
    ];
    document.getElementById("tiles").innerHTML = tiles
      .map(([ic, v, k, sub]) => '<div class="tile">' + ic +
        '<div><div class="v">' + v + '</div><div class="k">' + k + "</div>" + sub + "</div></div>")
      .join("");

    // relatable context under the tiles
    const ctx = mp.context || {};
    const name = mp.name || mp.iso3;
    const items = [];
    if (ctx.counterfactual && ctx.counterfactual.loss_reduction_pct != null) {
      const cf = ctx.counterfactual;
      items.push("<strong>The codes already on the books matter:</strong> " +
        "re-running the " + cf.event_name + " through today's building stock, " +
        "modelled losses are ~" + cf.loss_reduction_pct.toFixed(0) +
        "% lower" + (cf.fatality_reduction_pct != null
          ? " (fatalities ~" + cf.fatality_reduction_pct.toFixed(0) + "% lower)"
          : "") +
        " than if no code had ever been adopted. This validates the existing " +
        "code's effect — not the proposed upgrade.");
    }
    if (ctx.emdat_deaths) {
      items.push("<strong>Lives:</strong> for scale, " +
        fmtInt.format(ctx.emdat_deaths) + " " +
        (ctx.emdat_note || "earthquake deaths (EM-DAT)") + ".");
    }
    if (ssp2.dalys_averted && ctx.life_expectancy) {
      const n = ssp2.dalys_averted / ctx.life_expectancy;
      items.push("<strong>DALYs:</strong> a DALY is one lost year of healthy life. " +
        fmtInt.format(ssp2.dalys_averted) + " DALYs averted is equivalent to the " +
        "full lifetimes of about " + fmtInt.format(n) + " people, at " + name +
        "'s life expectancy of " + ctx.life_expectancy + " years (World Bank" +
        (ctx.life_expectancy_year ? " " + ctx.life_expectancy_year : "") + ").");
    }
    if (ssp2.job_years) {
      const wl = ctx.working_life_years || 40;
      const careers = ssp2.job_years / wl;
      items.push("<strong>Jobs:</strong> " + fmtInt.format(ssp2.job_years) +
        " job-years preserved is the equivalent of about " + fmtInt.format(careers) +
        " entire working careers (assuming a " + Math.round(wl) + "-year career).");
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

  function buildChartToggles(sc) {
    const disc = document.getElementById("disc-toggle");
    const prem = document.getElementById("prem-toggle");
    const rates = (sc && sc.discount_rates) || [0.03, 0.05, 0.07, 0.10];
    const pcts = (sc && sc.premium_pcts) || [];
    if (state.prem == null || !pcts.includes(state.prem)) {
      state.prem = sc ? sc.default_premium_pct : null;
    }
    if (!rates.includes(state.disc)) state.disc = sc ? sc.default_discount : 0.05;
    disc.innerHTML = rates.map((r) =>
      '<button type="button" data-rate="' + r + '" aria-pressed="' + (r === state.disc) + '">' +
      Math.round(100 * r) + "%</button>").join("");
    // the actual scenario premium may not be one of the sensitivity steps —
    // include it so the default state is always selectable
    const allP = [...new Set([sc ? sc.default_premium_pct : null, ...pcts]
      .filter((v) => v != null))].sort((a, b) => a - b);
    prem.innerHTML = allP.map((p) =>
      '<button type="button" data-pct="' + p + '" aria-pressed="' + (p === state.prem) + '">' +
      (100 * p).toFixed(p < 0.02 ? 0 : 1).replace(/\.0$/, "") + "%</button>").join("");
    document.querySelectorAll("#chart-mode button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
  }

  function svgFrame(W, H, PAD, xmin, xmax, ymax, yfmt) {
    const X = (x) => PAD.l + ((x - xmin) / (xmax - xmin || 1)) * (W - PAD.l - PAD.r);
    const Y = (y) => H - PAD.b - (y / ymax) * (H - PAD.t - PAD.b);
    let s = "";
    [0, 0.5, 1].forEach((f) => {
      const t = f * ymax;
      s += '<line x1="' + PAD.l + '" x2="' + (W - PAD.r) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" stroke="#e1e0d9"/>' +
        '<text x="' + (PAD.l - 4) + '" y="' + (Y(t) + 3) + '" font-size="9" fill="#898781" text-anchor="end">' + yfmt(t) + "</text>";
    });
    [xmin, Math.round((xmin + xmax) / 2), xmax].forEach((t) => {
      s += '<text x="' + X(t) + '" y="' + (H - 6) + '" font-size="9" fill="#898781" text-anchor="middle">' + t + "</text>";
    });
    return { X: X, Y: Y, grid: s };
  }

  function renderChart() {
    const mp = country.metrics_payload;
    const sc = country.scenarios;
    const box = document.getElementById("streams-chart");
    const note = document.getElementById("chart-note");
    const title = document.getElementById("chart-title");
    const W = 420, H = 190, PAD = { l: 46, r: 8, t: 8, b: 22 };
    if (!sc) {   // legacy payloads: no client recompute
      box.innerHTML = "<p class='note'>No scenario data.</p>";
      note.textContent = "";
      return;
    }
    const hEnd = endYear();
    const ssps = Object.keys(sc.ssp).sort();
    const series = {};
    ssps.forEach((s) => {
      const r = computeSeries(sc, s, state.prem, state.disc);
      const cut = r.years.filter((t) => t <= hEnd).length;
      series[s] = { years: r.years.slice(0, cut),
                    cumB: r.cumB.slice(0, cut), cumC: r.cumC.slice(0, cut) };
    });
    const base = series["SSP2"] || series[ssps[0]];
    const years = base.years;
    const xmin = years[0], xmax = years[years.length - 1];
    let s;
    if (state.mode === "bcr") {
      title.textContent = "Cumulative benefit-cost ratio";
      const ratios = {};
      ssps.forEach((sp) => {
        ratios[sp] = series[sp].cumB.map((b, i) =>
          series[sp].cumC[i] > 0 ? b / series[sp].cumC[i] : null);
      });
      const ymax = Math.max(1.2, ...ssps.flatMap((sp) => ratios[sp].filter((v) => v != null)));
      const f = svgFrame(W, H, PAD, xmin, xmax, ymax, (v) => v.toFixed(1));
      s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img">' + f.grid;
      // 1.0 refline: above it the program pays for itself
      s += '<line x1="' + PAD.l + '" x2="' + (W - PAD.r) + '" y1="' + f.Y(1) + '" y2="' + f.Y(1) +
        '" stroke="#c0392b" stroke-dasharray="4 3" stroke-width="1.2"/>' +
        '<text x="' + (PAD.l + 4) + '" y="' + (f.Y(1) - 4) + '" font-size="9" fill="#c0392b">BCR = 1</text>';
      ssps.forEach((sp) => {
        const bold = sp === "SSP2";
        const pts = ratios[sp].map((v, i) => (v == null ? null :
          [f.X(series[sp].years[i]), f.Y(Math.min(v, ymax))]));
        const d = pts.filter(Boolean).map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
        s += '<path d="' + d + '" fill="none" stroke="#1a9850" stroke-width="' +
          (bold ? 2.6 : 0.9) + '" opacity="' + (bold ? 1 : 0.55) + '"/>';
      });
      const last = ratios["SSP2"] || ratios[ssps[0]];
      s += '<text x="' + (W - PAD.r) + '" y="' + (f.Y(last[last.length - 1]) - 5) +
        '" font-size="10" fill="#1a9850" text-anchor="end">cumulative BCR (SSP2 bold)</text>';
      s += "</svg>";
    } else {
      title.textContent = "Cumulative discounted benefits vs costs";
      const ymax = Math.max(...ssps.flatMap((sp) => series[sp].cumB),
                            ...ssps.flatMap((sp) => series[sp].cumC)) || 1;
      const f = svgFrame(W, H, PAD, xmin, xmax, ymax, fmtUsd);
      const path = (yrs, v) => v.map((y, i) => (i ? "L" : "M") + f.X(yrs[i]).toFixed(1) + "," + f.Y(y).toFixed(1)).join(" ");
      s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img">' + f.grid;
      const bandTop = years.map((_, i) => Math.max(...ssps.map((sp) => series[sp].cumB[i])));
      const bandBot = years.map((_, i) => Math.min(...ssps.map((sp) => series[sp].cumB[i])));
      s += '<path d="' + path(years, bandTop) + " " +
        bandBot.map((y, i) => "L" + f.X(years[bandBot.length - 1 - i]).toFixed(1) + "," +
          f.Y(bandBot[bandBot.length - 1 - i]).toFixed(1)).join(" ") +
        ' Z" fill="#1a9850" opacity="0.12" stroke="none"/>';
      ssps.forEach((sp) => {
        const bold = sp === "SSP2";
        s += '<path d="' + path(series[sp].years, series[sp].cumB) +
          '" fill="none" stroke="#1a9850" stroke-width="' + (bold ? 2.6 : 0.9) +
          '" opacity="' + (bold ? 1 : 0.55) + '"/>';
        s += '<path d="' + path(series[sp].years, series[sp].cumC) +
          '" fill="none" stroke="#c0392b" stroke-width="' + (bold ? 2 : 0.8) +
          '" opacity="' + (bold ? 1 : 0.5) + '"' + (bold ? ' stroke-dasharray="5 3"' : "") + "/>";
      });
      const benEnd = base.cumB, costEnd = base.cumC;
      s += '<text x="' + (W - PAD.r) + '" y="' + (f.Y(benEnd[benEnd.length - 1]) - 5) +
        '" font-size="10" fill="#1a9850" text-anchor="end">benefits — all 3 dividends (SSP2 bold)</text>';
      s += '<text x="' + (W - PAD.r) + '" y="' + (f.Y(costEnd[costEnd.length - 1]) - 5) +
        '" font-size="10" fill="#c0392b" text-anchor="end">costs, all SSPs (SSP2 bold)</text>';
      s += "</svg>";
    }
    box.innerHTML = s;

    const bcrs = ssps.map((sp) => {
      const r = series[sp];
      return r.cumC[r.cumC.length - 1] > 0 ? r.cumB[r.cumB.length - 1] / r.cumC[r.cumC.length - 1] : null;
    }).filter((v) => v != null);
    const b2 = series["SSP2"] || series[ssps[0]];
    const bcr2 = b2.cumC[b2.cumC.length - 1] > 0 ? b2.cumB[b2.cumB.length - 1] / b2.cumC[b2.cumC.length - 1] : null;
    const isDefault = sc && Math.abs(state.disc - sc.default_discount) < 1e-9 &&
      Math.abs((state.prem || 0) - sc.default_premium_pct) < 1e-9;
    note.textContent =
      "Benefits sum all three resilience dividends (avoided losses + carbon, GDP stimulus, " +
      "durability) — the same basis as the BCR tile and the map. Over " + state.horizon +
      " years at " + Math.round(100 * state.disc) + "% discount and a " +
      (100 * (state.prem || 0)).toFixed(1) + "% construction premium: NPV benefits " +
      fmtUsd(b2.cumB[b2.cumB.length - 1]) + " vs costs " + fmtUsd(b2.cumC[b2.cumC.length - 1]) +
      ", BCR " + (bcr2 != null ? bcr2.toFixed(2) : "–") + " (SSP2); across SSPs " +
      Math.min(...bcrs).toFixed(2) + "–" + Math.max(...bcrs).toFixed(2) + "." +
      (isDefault ? "" : " Custom setting — the tiles, map and dividends keep the headline assumptions.") +
      " Lives and DALYs are never monetised.";
  }

  const DIV_COLORS = { D1: "#1a9850", D2: "#2a78d6", D3: "#9467bd" };
  const DIV_LABELS = {
    D1: "1st — avoided losses when disasters strike",
    D2: "2nd — unlocked economic potential (incl. jobs)",
    D3: "3rd — co-benefits of the investment itself",
  };
  const INV_LABELS = [
    ["gov_upfront", "Government — developing the policy (upfront)"],
    ["gov_ongoing", "Government — enforcement &amp; permitting (ongoing)"],
    ["public_premium", "Public — higher construction costs (premium)"],
  ];

  function renderDividends(mp) {
    const dv = horizonBlock(mp).dividends || mp.dividends;
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
      fmtUsd(dv.total_npv) + "</strong></td></tr>";
    rows += '<tr><td><strong>Investment costs</strong></td><td class="num"><strong>' +
      fmtUsd(dv.npv_costs) + "</strong></td></tr>";
    const inv = dv.investment || {};
    for (const [k, lbl] of INV_LABELS) {
      if (inv[k] != null) {
        rows += '<tr><td style="padding-left:1.4rem">' + lbl +
          '</td><td class="num">' + fmtUsd(inv[k]) + "</td></tr>";
      }
    }
    rows += '<tr><td>Benefit-cost ratio (' + state.horizon + ' years)</td>' +
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

  // ---------------- Admin-1 ranking (sortable) ----------------
  const adm1Sort = { key: "npv_benefits", dir: -1 };
  const ADM1_COLS = [
    { k: "admin_name", label: "Admin-1", num: false },
    { k: "npv_benefits", label: "Benefits (NPV)", perH: true, fmt: fmtUsd },
    { k: "npv_costs", label: "Costs (NPV)", perH: true, fmt: fmtUsd },
    { k: "bcr", label: "BCR", perH: true, fmt: (v) => (v == null ? "–" : (+v).toFixed(2)) },
    { k: "lives", label: "Lives", perH: true, fmt: (v) => fmtInt.format(v) },
    { k: "aal_2025", label: "Annual loss", fmt: (v) => fmtUsd(v) + "/yr" },
    { k: "aal_ratio", label: "Loss rate", fmt: (v) => (v == null ? "–" : (100 * v).toFixed(2) + "%") },
  ];

  function renderAdm1() {
    const tbl = document.getElementById("adm1-table");
    const a = country.adm1;
    if (!a) { tbl.innerHTML = "<tr><td>No Admin-1 data.</td></tr>"; return; }
    const idx = Object.fromEntries(a.columns.map((c, i) => [c, i]));
    const col = (c) => (c.perH ? c.k + "_h" + state.horizon : c.k);
    const rows = a.rows.slice();
    const sc = ADM1_COLS.find((c) => c.k === adm1Sort.key) || ADM1_COLS[1];
    const j = idx[col(sc)];
    rows.sort((r1, r2) => {
      const v1 = r1[j], v2 = r2[j];
      if (sc.num === false) return adm1Sort.dir * String(v1).localeCompare(String(v2));
      return adm1Sort.dir * ((v1 == null ? -Infinity : +v1) - (v2 == null ? -Infinity : +v2));
    });
    let html = "<tr><th class=rank>#</th>" + ADM1_COLS.map((c) => {
      const active = c.k === adm1Sort.key;
      return '<th class="sortable' + (c.num === false ? "" : " num") + '" data-key="' + c.k + '">' +
        c.label + (active ? ' <span class="arrow">' + (adm1Sort.dir < 0 ? "▼" : "▲") + "</span>" : "") + "</th>";
    }).join("") + "</tr>";
    const jName = idx["admin_name"];
    html += rows.map((r, i) =>
      '<tr class="adm1-row' + (r[jName] === selectedAdm1 ? " selected" : "") +
      '" data-name="' + String(r[jName]).replace(/"/g, "&quot;") + '">' +
      "<td class=rank>" + (i + 1) + "</td>" + ADM1_COLS.map((c) => {
        const v = r[idx[col(c)]];
        if (c.num === false) return "<td>" + v + "</td>";
        return '<td class="num">' + (v == null ? "–" : c.fmt(v)) + "</td>";
      }).join("") + "</tr>").join("");
    tbl.innerHTML = html;
  }

  // ---------------- Regulatory profile & compliance ----------------
  function renderCompliance(mp) {
    const el = document.getElementById("compliance");
    const note = document.getElementById("compliance-note");
    if (!el) return;
    const cp = mp.compliance;
    if (!cp) {
      el.innerHTML = "<p class='note'>No Atlas data for this country.</p>";
      if (note) note.textContent = "";
      return;
    }
    let html = "";
    if (cp.atlas && cp.atlas.url) {
      html += '<p style="margin:0 0 0.5rem;font-size:0.84rem">Regulatory profile: ' +
        '<a href="' + cp.atlas.url + '" target="_blank" rel="noopener">' +
        (cp.atlas.label || "GFDRR Building Regulations Atlas") + " ↗</a></p>";
    }
    // the practice factor IS the modeled compliance share - headline it;
    // the Atlas score is one input to it, never the ratio itself
    const p = (mp.metrics || {}).practice_p_national;
    if (p != null) {
      html += '<div style="font-size:0.86rem"><strong>Estimated share of new construction ' +
        "built to code: ~" + Math.round(100 * p) + "%</strong> " +
        '<span class="note">(building practice factor)</span></div>';
    }
    if (cp.score) {
      html += '<div class="score-bar"><div class="fill" style="width:' +
        Math.round(100 * cp.score.score) + '%"></div></div>' +
        '<div class="note" style="font-size:0.76rem">Atlas compliance-mechanisms score ' +
        cp.score.score.toFixed(2) + " (" +
        Math.round(100 * cp.score.percentile) + "th percentile of " +
        cp.score.n_countries + " countries) — one input to the estimate above, " +
        "alongside governance, education and corruption measures. A proxy for " +
        "compliance, not the compliance rate itself.</div>";
    }
    if (cp.structural) {
      const items = cp.structural.items || [];
      const missing = items.filter((i) => i.status === "no" || i.status === "partial");
      const present = items.filter((i) => i.status === "yes");
      html += '<div style="font-size:0.84rem;margin-top:0.5rem"><strong>Suggested provision package → ' +
        cp.structural.target + "</strong> <span class='note'>(" +
        (cp.structural.label || "") + ")</span></div><ul class='pkg-list'>";
      present.forEach((i) => { html += '<li class="pkg-ok">✓ ' + i.name + "</li>"; });
      missing.forEach((i) => {
        html += '<li class="pkg-gap">✗ ' + i.name +
          (i.status === "partial" ? " (partial)" : "") + "</li>";
      });
      items.filter((i) => !i.status).forEach((i) => {
        html += '<li class="note">? ' + i.name + " (not assessed)</li>";
      });
      html += "</ul>" +
        '<div class="note" style="font-size:0.76rem">✓ provision found in the ' +
        "country's regulations (per the Atlas) · ✗ not identified · " +
        "? not assessed for this country.</div>";
    }
    const pkgs = cp.packages || [];
    if (pkgs.length) {
      html += '<div style="font-size:0.84rem;margin-top:0.6rem"><strong>Compliance-improvement packages</strong></div>' +
        '<div class="table-wrap"><table><tr><th>Package</th>' +
        "<th class=num>Missing mechanisms</th></tr>";
      pkgs.forEach((p2) => {
        html += "<tr><td>" + p2.label + '</td><td class="num">' + p2.n_gaps +
          "</td></tr>";
      });
      html += "</table></div>" +
        '<div class="note" style="font-size:0.76rem">Ordered by expected effect ' +
        "on compliance. Closing a package's gaps raises the share of buildings " +
        "actually built to code.</div>";
    }
    el.innerHTML = html || "<p class='note'>No Atlas data for this country.</p>";
    if (note) {
      note.textContent = (cp.structural && cp.structural.note ? cp.structural.note : "");
    }
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
      "% damage (heuristic); cost as % of replacement value by material; " +
      "benefits use the same triple-dividend accounting as the headline BCR " +
      "(avoided losses + carbon, stimulus of the retrofit spend, no durability claim).";
  }

  function renderAll() {
    const mp = country.metrics_payload;
    styleHexLayer();
    renderScenario(mp);
    renderTiles(mp);
    renderChart();
    renderDividends(mp);
    renderAdm1();
    renderCompliance(mp);
  }

  async function loadCountry(iso) {
    state.iso = iso;
    setHash();
    const base = "data/countries/" + iso + "/";
    const [mp, hex, sc, adm1, rj, bnd] = await Promise.all([
      json(base + "metrics.json"),
      json(base + "hex.geojson"),
      json(base + "scenarios.json").catch(() => null),
      json(base + "adm1.json").catch(() => null),
      json(base + "retrofit.json").catch(() => null),
      json(base + "boundaries.geojson").catch(() => null),
    ]);
    country = { metrics_payload: mp, scenarios: sc, adm1: adm1 };
    if (mp.horizon_years && !mp.horizon_years.includes(state.horizon)) {
      state.horizon = mp.default_horizon || mp.horizon_years[0];
      horizonSelect.value = String(state.horizon);
    }

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
    country.boundaries = bnd || emptyFc;
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
      map.addLayer({ id: "adm1-highlight", type: "line", source: "bnd",
                     filter: ["==", ["get", "name"], "__none__"],
                     paint: { "line-color": "#e8a33d", "line-width": 3 } });
    }
    selectedAdm1 = null;
    pinned = null;
    tooltip.style.display = "none";
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
    const e = index.find((c) => c.iso3 === iso);
    if (e && e.bounds) {
      map.fitBounds([[e.bounds[0], e.bounds[1]], [e.bounds[2], e.bounds[3]]],
                    { padding: 30, duration: 600 });
    }
    buildChartToggles(sc);
    renderAll();
    renderRetrofit(rj);
  }

  // hover shows the tooltip; CLICK pins it (hover stops updating until unpinned)
  let pinned = null;   // JSON of the pinned hex's properties

  function showHexTooltip(p, point, isPinned) {
    const lay = activeLayer();
    const bcr = p[suffix("bcr")];
    tooltip.style.display = "block";
    tooltip.style.left = point.x + 14 + "px";
    tooltip.style.top = point.y + 14 + "px";
    tooltip.innerHTML =
      (isPinned ? "📌 " : "") +
      "<strong>" + lay.label + ": " + lay.fmt(p[suffix(lay.key)]) + "</strong><br>" +
      "hazard " + (p.pga_475 != null ? p.pga_475.toFixed(2) + " g" : "–") +
      " · value " + fmtUsd(p.repl_value) +
      "<br>annual loss " + fmtUsd(p.aal_2025) + "/yr · BCR " +
      (bcr != null ? (+bcr).toFixed(2) : "–") +
      (isPinned ? '<br><span style="color:var(--muted)">click again or press Esc to unpin</span>' : "");
  }

  map.on("mousemove", "hex-fill", (ev) => {
    map.getCanvas().style.cursor = "pointer";
    if (pinned) return;
    const f = ev.features && ev.features[0];
    if (!f) return;
    showHexTooltip(f.properties, ev.point, false);
  });
  map.on("mouseleave", "hex-fill", () => {
    if (!pinned) tooltip.style.display = "none";
    map.getCanvas().style.cursor = "";
  });
  map.on("click", "hex-fill", (ev) => {
    const f = ev.features && ev.features[0];
    if (!f) return;
    const key = JSON.stringify(f.properties);
    if (pinned === key) {
      pinned = null;
      tooltip.style.display = "none";
      return;
    }
    pinned = key;
    showHexTooltip(f.properties, ev.point, true);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && pinned) {
      pinned = null;
      tooltip.style.display = "none";
    }
  });

  // ADM1 ranking row -> highlight + zoom the province on the map
  let selectedAdm1 = null;

  function featureBbox(geom) {
    let w = 180, s = 90, e = -180, n = -90;
    (function walk(c) {
      if (typeof c[0] === "number") {
        w = Math.min(w, c[0]); e = Math.max(e, c[0]);
        s = Math.min(s, c[1]); n = Math.max(n, c[1]);
      } else c.forEach(walk);
    })(geom.coordinates);
    return [[w, s], [e, n]];
  }

  function selectAdm1(name) {
    const bnd = country && country.boundaries;
    if (!bnd || !map.getLayer("adm1-highlight")) return;
    if (selectedAdm1 === name) {   // toggle off: back to the country view
      selectedAdm1 = null;
      map.setFilter("adm1-highlight", ["==", ["get", "name"], " "]);
      const e0 = index.find((c) => c.iso3 === state.iso);
      if (e0 && e0.bounds) {
        map.fitBounds([[e0.bounds[0], e0.bounds[1]], [e0.bounds[2], e0.bounds[3]]],
                      { padding: 30, duration: 500 });
      }
      renderAdm1();
      return;
    }
    const f = (bnd.features || []).find((x) =>
      x.properties && x.properties.level === 1 && x.properties.name === name);
    if (!f) return;
    selectedAdm1 = name;
    map.setFilter("adm1-highlight",
                  ["all", ["==", ["get", "level"], 1], ["==", ["get", "name"], name]]);
    map.fitBounds(featureBbox(f.geometry), { padding: 40, duration: 500 });
    renderAdm1();
  }

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
  document.getElementById("chart-mode").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-mode]");
    if (!btn) return;
    state.mode = btn.dataset.mode;
    document.querySelectorAll("#chart-mode button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
    renderChart();
  });
  document.getElementById("disc-toggle").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-rate]");
    if (!btn) return;
    state.disc = +btn.dataset.rate;
    document.querySelectorAll("#disc-toggle button").forEach((b) =>
      b.setAttribute("aria-pressed", String(+b.dataset.rate === state.disc)));
    renderChart();
  });
  document.getElementById("prem-toggle").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-pct]");
    if (!btn) return;
    state.prem = +btn.dataset.pct;
    document.querySelectorAll("#prem-toggle button").forEach((b) =>
      b.setAttribute("aria-pressed", String(+b.dataset.pct === state.prem)));
    renderChart();
  });
  document.getElementById("adm1-table").addEventListener("click", (ev) => {
    const th = ev.target.closest("th.sortable");
    if (th) {
      const key = th.dataset.key;
      if (adm1Sort.key === key) adm1Sort.dir = -adm1Sort.dir;
      else { adm1Sort.key = key; adm1Sort.dir = key === "admin_name" ? 1 : -1; }
      renderAdm1();
      return;
    }
    const tr = ev.target.closest("tr.adm1-row");
    if (tr) selectAdm1(tr.dataset.name);
  });
  horizonSelect.addEventListener("change", () => {
    state.horizon = +horizonSelect.value;
    setHash();
    renderAll();
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
