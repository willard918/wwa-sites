/* Lot check UI: the hero address form -> /api/lotcheck -> a report overlay with an SVG lot plan.
   Needs: #lotform, #addr, #result in the page. API base: window.LOTCHECK_API, else local server when
   opened from a file or localhost, else same origin. */
(function () {
"use strict";
var form = document.getElementById("lotform"), input = document.getElementById("addr"), status = document.getElementById("result");
if (!form || !input || !status) return;

var API = window.LOTCHECK_API != null ? window.LOTCHECK_API :
  (location.protocol === "file:" ? "http://127.0.0.1:8787" : "");
var MAIL = "contact@pacificlivingsolutions.com";
var NS = "http://www.w3.org/2000/svg";

function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function svg(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
function say(msg, html) { status.style.display = "block"; status.textContent = ""; if (html) status.appendChild(html); else status.textContent = msg; }
function ftin(f) { return Math.round(f) + "′"; }
function num(n) { return Number(n).toLocaleString("en-US"); }

var overlay = null, lastFocus = null;
function closeOverlay() {
  if (overlay) { overlay.remove(); overlay = null; document.body.style.overflow = ""; if (lastFocus) lastFocus.focus(); }
}
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeOverlay(); });

form.addEventListener("submit", function (e) {
  e.preventDefault();
  var a = input.value.trim();
  if (!a) { status.style.display = "none"; return; }
  var btn = form.querySelector("button"), label = btn.textContent;
  btn.disabled = true; btn.textContent = "Checking…"; say("Looking up your lot…");
  var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 45000);
  fetch(API + "/api/lotcheck?address=" + encodeURIComponent(a), { signal: ctl.signal })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok) { say(d.error || "Something went wrong. Please try again."); return; }
      status.style.display = "none"; lastFocus = btn; render(d);
    })
    .catch(function () {
      var box = el("span");
      box.appendChild(document.createTextNode("The lot check is offline right now. Email your address to "));
      var a2 = el("a", "", MAIL); a2.href = "mailto:" + MAIL + "?subject=" + encodeURIComponent("Lot review request"); a2.style.textDecoration = "underline";
      box.appendChild(a2); box.appendChild(document.createTextNode(" and we'll check it by hand."));
      say("", box);
    })
    .then(function () { clearTimeout(t); btn.disabled = false; btn.textContent = label; });
});

/* ---------- report ---------- */
function render(d) {
  closeOverlay(); window.LASTLOT = d;
  overlay = el("div", "lc-ov"); overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", "Lot check report");
  overlay.addEventListener("click", function (e) { if (e.target === overlay) closeOverlay(); });
  var card = el("div", "lc-card"); overlay.appendChild(card);
  var x = el("button", "lc-x", "×"); x.type = "button"; x.setAttribute("aria-label", "Close"); x.addEventListener("click", closeOverlay); card.appendChild(x);

  var j = d.jurisdiction, v = d.verdict, p = d.parcel, f = d.fit;
  card.appendChild(el("div", "lc-eyebrow", "Lot check"));
  card.appendChild(el("h3", "lc-addr", d.match.address.replace(/\b([A-Z])([A-Z]{2,})\b/g, function (m, a, b) { return a + b.toLowerCase(); }).replace(/(\d)([A-Z]{2})\b/g, function (m, a, b) { return a + b.toLowerCase(); })
    .replace(/\b(RD|ST|DR|LN|CT|PL|AV)\b(?=,|$)/g, function (m) { return m[0] + m[1].toLowerCase(); })));
  var where = (j.county ? j.county + " County, " : "") + j.state + " · " + (j.place ? j.place + " city limits" : (j.kind === "unincorporated" ? "outside city limits" : ""));
  card.appendChild(el("div", "lc-sub", where));

  var grid = el("div", "lc-grid" + (f ? "" : " lc-one")); card.appendChild(grid);
  var info = el("div", "lc-info");
  if (f) { var plan = el("div", "lc-plan"); grid.appendChild(plan); drawPlan(plan, f); }
  grid.appendChild(info);

  var vb = el("div", "lc-verdict st-" + v.status); vb.appendChild(el("b", "", v.headline));
  var ul = el("ul"); v.reasons.forEach(function (r) { ul.appendChild(el("li", "", r)); }); vb.appendChild(ul);
  info.appendChild(vb);
  (d.notes || []).forEach(function (n) { info.appendChild(el("p", "lc-note", n)); });

  if (p) {
    var dl = el("dl", "lc-facts");
    [["Parcel", p.id], ["Lot size", num(p.area_sf) + " sq ft" + (p.acres ? " (" + p.acres + " ac)" : "")],
     ["Approx. shape", ftin(p.dims_ft[0]) + " × " + ftin(p.dims_ft[1])], ["Land use", p.use],
     ["Zoning", p.zoning ? p.zoning.code : "Not connected yet"]].forEach(function (r) {
      if (r[1] == null) return; dl.appendChild(el("dt", "", r[0])); dl.appendChild(el("dd", "", r[1]));
    });
    info.appendChild(dl);
  }
  if (f) {
    info.appendChild(el("h4", "", "Which units fit"));
    var fl = el("div", "lc-fit");
    f.results.forEach(function (r) {
      var row = el("div", "lc-row" + (r.fits ? " ok" : " no"));
      row.appendChild(el("span", "", r.model + "  " + r.size_ft[0] + "′ × " + r.size_ft[1] + "′"));
      row.appendChild(el("span", "", r.fits ? (r.margin_ft < 1 ? "Tight fit, " : "Fits, ") + r.margin_ft + "′ to spare" + (r.size_ok === false ? " · may exceed size cap" : "") : "Does not fit"));
      fl.appendChild(row);
    });
    info.appendChild(fl);
    info.appendChild(el("p", "lc-note", "Setbacks assumed: " + f.assumptions.front_ft + "′ front, " + f.assumptions.side_rear_ft + "′ side and rear. " + f.assumptions.note));
  }
  if (d.rules) {
    info.appendChild(el("h4", "", d.rules.state + " state baseline"));
    var rl = el("ul", "lc-rules"); d.rules.summary.forEach(function (s) { rl.appendChild(el("li", "", s)); }); info.appendChild(rl);
    var src = el("p", "lc-note", "Sources (read " + d.rules.last_verified + "): ");
    d.rules.sources.forEach(function (s, i) {
      var a = el("a", "", s.title); a.href = s.url; a.target = "_blank"; a.rel = "noopener"; src.appendChild(a);
      if (i < d.rules.sources.length - 1) src.appendChild(document.createTextNode("; "));
    });
    info.appendChild(src);
  }

  var foot = el("div", "lc-foot");
  foot.appendChild(el("p", "lc-note", d.disclaimer));
  foot.appendChild(el("p", "lc-note", "Data: " + d.data_sources.join("; ") + "."));
  var cta = el("div", "lc-cta");
  var c1 = el("a", "btn", "Configure a unit"); c1.href = "#configure"; c1.addEventListener("click", closeOverlay); cta.appendChild(c1);
  var c2 = el("a", "btn ghost", "Ask us to review this lot"); c2.href = "mailto:" + MAIL + "?subject=" + encodeURIComponent("Lot review request: " + d.match.address); cta.appendChild(c2);
  foot.appendChild(cta); card.appendChild(foot);

  document.body.appendChild(overlay); document.body.style.overflow = "hidden"; x.focus();
}

/* ---------- plan drawing (feet, north up) ---------- */
window.LOTPLAN = function (host, f) { drawPlan(host, f); };   /* the splash page draws the same plan from a letter's stored result */
function drawPlan(host, f) {
  var pts = f.lot, minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  pts.forEach(function (q) { minx = Math.min(minx, q[0]); maxx = Math.max(maxx, q[0]); miny = Math.min(miny, q[1]); maxy = Math.max(maxy, q[1]); });
  var pad = Math.max(maxx - minx, maxy - miny) * 0.1 + 6, W = maxx - minx + 2 * pad, H = maxy - miny + 2 * pad;
  function P(q) { return (q[0] - minx + pad).toFixed(1) + "," + (maxy - q[1] + pad).toFixed(1); }
  function poly(arr) { return arr.map(P).join(" "); }
  var s = svg("svg", { viewBox: "0 0 " + W.toFixed(1) + " " + H.toFixed(1), role: "img", "aria-label": "Lot plan with setback area and placed unit" });
  s.appendChild(svg("polygon", { points: poly(pts), fill: "#17140f", stroke: "#f1ece1", "stroke-width": (W / 300).toFixed(2) }));
  var T = f.terrain || {};
  [["caution_cells", "rgba(214,170,60,.22)"], ["steep_cells", "rgba(190,60,50,.38)"]].forEach(function (g) {   /* ground slope: amber = needs earthwork, red = too steep to build */
    var cells = T[g[0]]; if (!cells || !cells.length) return;
    var d2 = "";
    cells.forEach(function (c) {
      var a = P([c[0], c[3]]).split(","), w = (c[2] - c[0]).toFixed(1), h = (c[3] - c[1]).toFixed(1);
      d2 += "M" + a[0] + " " + a[1] + "h" + w + "v" + h + "h-" + w + "z";
    });
    s.appendChild(svg("path", { d: d2, fill: g[1], stroke: "none", "clip-path": "" }));
  });
  var CT = T.contours;
  if (CT && CT.levels) {   /* topographic contour lines: thin brown, every fifth heavier and labelled with its elevation in feet */
    var thin = "", thick = "", labs = [];
    CT.levels.forEach(function (lv) {
      var dpath = "";
      lv.segs.forEach(function (g) { var a = P([g[0], g[1]]).split(","), b = P([g[2], g[3]]).split(","); dpath += "M" + a[0] + " " + a[1] + "L" + b[0] + " " + b[1]; });
      if (lv.idx) { thick += dpath; var m = lv.segs[Math.floor(lv.segs.length / 2)], c = P([(m[0] + m[2]) / 2, (m[1] + m[3]) / 2]).split(","); labs.push([lv.ft, c[0], c[1]]); }
      else thin += dpath;
    });
    if (thin) s.appendChild(svg("path", { d: thin, fill: "none", stroke: "rgba(196,160,112,.55)", "stroke-width": (W / 800).toFixed(2), "stroke-linecap": "round" }));
    if (thick) s.appendChild(svg("path", { d: thick, fill: "none", stroke: "rgba(226,190,140,.9)", "stroke-width": (W / 420).toFixed(2), "stroke-linecap": "round" }));
    labs.forEach(function (l) {
      var t2 = svg("text", { x: l[1], y: l[2], "text-anchor": "middle", fill: "#e8cfa6", "font-size": (W / 30).toFixed(1), "font-family": "Inter,sans-serif", stroke: "#17140f", "stroke-width": (W / 150).toFixed(2), "paint-order": "stroke" });
      t2.textContent = l[0]; s.appendChild(t2);
    });
  }
  if (f.envelope_cells && f.envelope_cells.length) {
    var dd = "";
    f.envelope_cells.forEach(function (c) {
      var a = P([c[0], c[3]]).split(","), w = (c[2] - c[0]).toFixed(1), h = (c[3] - c[1]).toFixed(1);
      dd += "M" + a[0] + " " + a[1] + "h" + w + "v" + h + "h-" + w + "z";
    });
    s.appendChild(svg("path", { d: dd, fill: "rgba(200,85,58,.22)", stroke: "none" }));
  }
  if (f.front_edge) {
    s.appendChild(svg("polyline", { points: poly(f.front_edge), fill: "none", stroke: "#c8553a", "stroke-width": (W / 120).toFixed(2) }));
    var mx = (f.front_edge[0][0] + f.front_edge[1][0]) / 2, my = (f.front_edge[0][1] + f.front_edge[1][1]) / 2;
    var t = svg("text", { x: P([mx, my]).split(",")[0], y: (parseFloat(P([mx, my]).split(",")[1]) + W / 22).toFixed(1), "text-anchor": "middle", fill: "#c8553a", "font-size": (W / 34).toFixed(1), "font-family": "Inter,sans-serif", "letter-spacing": "1" });
    t.textContent = "STREET SIDE (assumed)"; s.appendChild(t);
  }
  (f.buildings || []).forEach(function (b) {   /* existing buildings (satellite-derived footprints) */
    s.appendChild(svg("polygon", { points: poly(b), fill: "#3a362e", stroke: "#8f897b", "stroke-width": (W / 400).toFixed(2) }));
  });
  var unit = svg("polygon", { points: "", fill: "rgba(241,236,225,.88)", stroke: "#f1ece1", "stroke-width": (W / 300).toFixed(2) });
  var lab = svg("text", { "text-anchor": "middle", fill: "#f1ece1", "font-size": (W / 34).toFixed(1), "font-family": "Inter,sans-serif", "font-weight": "600" });
  s.appendChild(unit); s.appendChild(lab); host.appendChild(s);

  var chips = el("div", "chips lc-chips");
  var first = null;
  function pick(r, btn) {
    Array.prototype.forEach.call(chips.children, function (c) { c.setAttribute("aria-pressed", String(c === btn)); });
    unit.setAttribute("points", poly(r.placement));
    var cx = 0, top = -1e9; r.placement.forEach(function (q) { cx += q[0] / 4; top = Math.max(top, q[1]); });
    var c = P([cx, top]).split(","); lab.setAttribute("x", c[0]); lab.setAttribute("y", (parseFloat(c[1]) - W / 50).toFixed(1));
    lab.textContent = r.model + "  " + r.size_ft[0] + "′×" + r.size_ft[1] + "′";
  }
  f.results.forEach(function (r) {
    var b = el("button", "chip", r.model + (r.fits ? "" : " (no fit)")); b.type = "button"; b.disabled = !r.fits;
    if (r.fits) { b.addEventListener("click", function () { pick(r, b); }); if (!first) first = [r, b]; }
    chips.appendChild(b);
  });
  host.appendChild(chips);
  if (first) pick(first[0], first[1]); else { unit.setAttribute("points", ""); }
  var leg = el("p", "lc-note", "Solid line: lot. Shaded: area left after assumed setbacks and a " + f.assumptions.building_clear_ft + "′ gap from buildings. Grey: existing buildings from satellite-derived footprints, which can be out of date." + (f.buildings_note ? " " + f.buildings_note : "") +
    (T.checked ? " Brown lines are ground contours every " + ((CT && CT.interval_ft) || 5) + " ft (elevation in feet on the heavier ones). Red: ground steeper than " + T.block_pct + "% (not buildable for a prefab unit). Amber: 10 to " + T.block_pct + "% (needs earthwork). From USGS elevation data on a 10 ft grid; a survey is still needed." : (T.note ? " " + T.note : "")));
  host.appendChild(leg);
}
})();
