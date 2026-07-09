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

  function renderTiles(mp) {
    const m = mp.metrics;
    const ssp2 = mp.ssp_table.find((r) => r.ssp === "SSP2") || mp.ssp_table[0];
    const tiles = [
      [fmtUsd(m.baseline_aal_2025_usd) + "/yr", "Baseline AAL (2025)"],
      [(100 * m.aal_pct_gdp_2025).toFixed(1) + "%", "AAL as % of GDP"],
      [fmtInt.format(m.baseline_fatalities_2025_per_yr), "Expected fatalities /yr"],
      [ssp2.bcr.toFixed(2), "BCR (SSP2)"],
      [ssp2.bcr_with_lives != null ? ssp2.bcr_with_lives.toFixed(2) : "—",
       "BCR incl. lives (side)"],
      [fmtInt.format(ssp2.lives_saved), "Lives saved to 2075"],
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
    const ssp2 = rows.filter((r) => r.ssp === "SSP2");
    if (!ssp2.length) return;
    const years = ssp2.map((r) => r.year);
    const ben = ssp2.map((r) => r.cum_disc_benefits);
    const cost = ssp2.map((r) => r.cum_disc_costs);
    const W = 420, H = 180, PAD = { l: 46, r: 8, t: 8, b: 22 };
    const xmin = Math.min(...years), xmax = Math.max(...years);
    const ymax = Math.max(...ben, ...cost) || 1;
    const X = (x) => PAD.l + ((x - xmin) / (xmax - xmin || 1)) * (W - PAD.l - PAD.r);
    const Y = (y) => H - PAD.b - (y / ymax) * (H - PAD.t - PAD.b);
    const path = (v) => v.map((y, i) => (i ? "L" : "M") + X(years[i]).toFixed(1) + "," + Y(y).toFixed(1)).join(" ");
    const ticksY = [0, 0.5, 1].map((f) => f * ymax);
    let s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img">';
    ticksY.forEach((t) => {
      s += '<line x1="' + PAD.l + '" x2="' + (W - PAD.r) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" stroke="#e1e0d9"/>' +
        '<text x="' + (PAD.l - 4) + '" y="' + (Y(t) + 3) + '" font-size="9" fill="#898781" text-anchor="end">' + fmtUsd(t) + "</text>";
    });
    [xmin, Math.round((xmin + xmax) / 2), xmax].forEach((t) => {
      s += '<text x="' + X(t) + '" y="' + (H - 6) + '" font-size="9" fill="#898781" text-anchor="middle">' + t + "</text>";
    });
    s += '<path d="' + path(cost) + '" fill="none" stroke="#c0392b" stroke-width="2" stroke-dasharray="5 3"/>';
    s += '<path d="' + path(ben) + '" fill="none" stroke="#1a9850" stroke-width="2.4"/>';
    s += '<text x="' + (W - PAD.r) + '" y="' + (Y(ben[ben.length - 1]) - 5) + '" font-size="10" fill="#1a9850" text-anchor="end">benefits</text>';
    s += '<text x="' + (W - PAD.r) + '" y="' + (Y(cost[cost.length - 1]) - 5) + '" font-size="10" fill="#c0392b" text-anchor="end">costs</text>';
    s += "</svg>";
    document.getElementById("streams-chart").innerHTML = s;
    const ssp2row = mp.ssp_table.find((r) => r.ssp === "SSP2");
    document.getElementById("chart-note").textContent =
      "NPV benefits " + fmtUsd(ssp2row.npv_benefits_usd) + " vs costs " +
      fmtUsd(ssp2row.npv_costs_usd) + " (5% discount rate). Lives saved are not monetised.";
  }

  function renderRetrofit(rj) {
    const tbl = document.getElementById("retrofit-table");
    if (!rj) { tbl.innerHTML = "<tr><td>No retrofit data.</td></tr>"; return; }
    const idx = Object.fromEntries(rj.columns.map((c, i) => [c, i]));
    const rows = rj.rows.slice(0, 10);
    tbl.innerHTML =
      "<tr><th>Class</th><th>Level</th><th class=num>Avoided AAL</th><th class=num>Lives/yr</th><th class=num>BCR</th></tr>" +
      rows.map((r) =>
        "<tr><td class=tax>" + r[idx["class"]] + "</td><td>" + r[idx["current_level"]] +
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
    const [mp, hex, streamsText, rj] = await Promise.all([
      json(base + "metrics.json"),
      json(base + "hex.geojson"),
      fetch(base + "streams.csv").then((r) => (r.ok ? r.text() : "")),
      json(base + "retrofit.json").catch(() => null),
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
    styleHexLayer();
    const e = index.find((c) => c.iso3 === iso);
    if (e && e.bounds) {
      map.fitBounds([[e.bounds[0], e.bounds[1]], [e.bounds[2], e.bounds[3]]],
                    { padding: 30, duration: 600 });
    }
    renderTiles(mp);
    if (streamsText) renderChart(parseCsv(streamsText), mp);
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
