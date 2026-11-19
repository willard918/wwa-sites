/* ADU model + 3D scene for the website. Panel rules mirror adu/adu_model.py. Units: feet, Z up.
   Design details that exist only here (floating roof gap, deep front overhang, deck, landscape) are
   presentation: the panel schedule and quantities come from the model rules. */
(function (global) {
"use strict";
var T = global.THREE;

/* ---------------- model ---------------- */
function walls(p) { var W = p.width, D = p.depth; return {
  front: [[0, 0], [1, 0], W], right: [[W, 0], [0, 1], D], back: [[W, D], [-1, 0], W], left: [[0, D], [0, -1], D] }; }
var TR = 3.0;   /* split roof: height of the step between the low and the high roof (the transom window band) */
function roofTop(p, y) {
  if (p.roof === "split") return p.wall_height + y * p.pitch / 12 + (y >= p.depth / 2 ? TR : 0);
  return p.roof === "shed" ? p.wall_height + y * p.pitch / 12 : p.wall_height;
}
function gablePeak(p) { return p.roof === "gable" ? p.depth / 2 * p.pitch / 12 : 0; }

function validate(p) {
  var e = [], ws = walls(p);
  if (p.width * p.depth > 1200) e.push("Footprint is over 1,200 sq ft, the usual ADU limit. Check local zoning.");
  p.openings.forEach(function (o) {
    var L = ws[o.wall][2];
    if (o.offset < 0.5 || o.offset + o.width > L - 0.5) e.push("The " + o.type + " on the " + o.wall + " wall is too close to a corner.");
    if ((o.type === "window" ? o.sill : 0) + o.height > p.wall_height - 0.5) e.push("The " + o.type + " on the " + o.wall + " wall is too tall.");
  });
  Object.keys(ws).forEach(function (w) {
    var ops = p.openings.filter(function (o) { return o.wall === w; }).sort(function (a, b) { return a.offset - b.offset; });
    for (var i = 1; i < ops.length; i++) if (ops[i].offset < ops[i - 1].offset + ops[i - 1].width + 0.5 - 1e-9) e.push("Two openings overlap on the " + w + " wall.");
  });
  return e;
}

function panelRun(L, ops, mod, top, studSp) {
  var edge = 0.5; ops = ops.slice().sort(function (a, b) { return a.offset - b.offset; });
  var segs = [], pos = 0, i, k;
  ops.forEach(function (o) {
    var s = Math.max(o.offset - edge, 0), e = Math.min(o.offset + o.width + edge, L);
    if (s > pos + 1e-6) segs.push([pos, s, false]);
    segs.push([Math.max(s, pos), e, true]); pos = Math.max(pos, e);
  });
  if (L > pos + 1e-6) segs.push([pos, L, false]);
  for (i = 0; i < segs.length;) {
    var a = segs[i][0], b = segs[i][1], isop = segs[i][2];
    if (!isop && b - a < 1 && segs.length > 1) {
      var j = i > 0 && segs[i - 1][2] ? i - 1 : (i + 1 < segs.length && segs[i + 1][2] ? i + 1 : null);
      if (j !== null) { segs[j][0] = Math.min(segs[j][0], a); segs[j][1] = Math.max(segs[j][1], b); segs.splice(i, 1); continue; }
    }
    i++;
  }
  var cuts = [0];
  segs.forEach(function (s) {
    var n = s[2] ? 1 : Math.max(1, Math.ceil((s[1] - s[0]) / mod - 1e-9));
    for (var k2 = 1; k2 <= n; k2++) cuts.push(s[0] + (s[1] - s[0]) * k2 / n);
  });
  var uniq = {}; cuts.forEach(function (c) { uniq[c.toFixed(4)] = +c.toFixed(4); });
  cuts = Object.keys(uniq).map(function (k3) { return uniq[k3]; }).sort(function (x, y) { return x - y; });
  var out = [];
  for (i = 0; i < cuts.length - 1; i++) {
    var a2 = cuts[i], b2 = cuts[i + 1];
    var local = ops.filter(function (o) { return a2 - 1e-6 <= o.offset && o.offset + o.width <= b2 + 1e-6; })
      .map(function (o) { var c = {}; for (var key in o) c[key] = o[key]; c.offset = o.offset - a2; return c; });
    var sp = studSp / 12, width = b2 - a2, studs = [0];
    for (k = 1; k * sp < width - 0.1; k++) studs.push(k * sp);
    studs.push(width);
    studs = studs.filter(function (x) { return !local.some(function (o) { return o.offset < x && x < o.offset + o.width; }); });
    local.forEach(function (o) { studs.push(o.offset - 0.125, o.offset + o.width + 0.125); });
    var seen = {}; studs.forEach(function (x) { seen[x.toFixed(3)] = 1; });
    var h0 = top(a2), h1 = top(b2);
    out.push({ index: i + 1, start: a2, width: width, h0: h0, h1: h1, openings: local, studs: Object.keys(seen).length,
      area: width * (h0 + h1) / 2 - local.reduce(function (s, o) { return s + o.width * o.height; }, 0) });
  }
  return out;
}

function panelize(p) {
  var ws = walls(p), out = [];
  Object.keys(ws).forEach(function (w) {
    var org = ws[w][0], dir = ws[w][1], L = ws[w][2];
    var ops = p.openings.filter(function (o) { return o.wall === w; });
    var top = function (s) { return roofTop(p, org[1] + dir[1] * s); };
    if (p.roof === "split" && (w === "left" || w === "right")) top = function () { return p.wall_height; };   /* side walls: flat panels, the stepped infill sits on top (like a gable end) */
    panelRun(L, ops, p.module, top, p.stud_spacing).forEach(function (pn) {
      pn.id = w[0].toUpperCase() + ("0" + pn.index).slice(-2); pn.wall = w; out.push(pn);
    });
  });
  return out;
}

function quantities(p, panels) {
  var roofF = p.roof === "flat" ? 1 : 1 / Math.cos(Math.atan(p.pitch / 12));
  var wall = panels.reduce(function (s, x) { return s + x.area; }, 0);
  return { floor: p.width * p.depth, panels: panels.length, wall: wall,
    roof: (p.width + 2 * p.overhang) * (p.depth + 2 * p.overhang + p.front_extra) * roofF,
    studs: panels.reduce(function (s, x) { return s + x.studs; }, 0) };
}

/* Openings: a glazed front (two 6 ft sliders with a post between), clerestory strip on the back, slot windows on the sides. */
function openingsFor(W, D, door) {
  if (global.PLAN) return global.PLAN.layout(W, D, door).openings; /* windows come from the room layout, so none crosses a partition or corner */
  var o = [
    { wall: "front", type: "door", offset: 2.5, width: 3, height: 7, sill: 0 },
    { wall: "front", type: "window", offset: 6.5, width: 6, height: 8, sill: 0 }
  ];
  if (W >= 20) o.push({ wall: "front", type: "window", offset: 13, width: 6, height: 8, sill: 0 });
  for (var x = 3.5; x + 5 <= W - 0.5 + 1e-9; x += 6) o.push({ wall: "back", type: "window", offset: x, width: 5, height: 2, sill: 6.5 });
  o.push({ wall: "right", type: "window", offset: Math.max(2, Math.round(D * 0.3)), width: 2, height: 8, sill: 0.5 });
  o.push({ wall: "left", type: "window", offset: Math.max(2, Math.round(D * 0.55)), width: 2, height: 8, sill: 0.5 });
  return o;
}
function pitchFor(roof) { return roof === "gable" ? 3 : (roof === "shed" || roof === "split") ? 1.5 : 0.25; }

function makeParams(o) {
  var p = { width: 24, depth: 16, wall_height: 9, roof: "shed", pitch: 1.5, overhang: 2, front_extra: 2, module: 4, stud_spacing: 16, wall_thickness: 6.5 };
  for (var k in o) p[k] = o[k];
  if (!p.openings) p.openings = openingsFor(p.width, p.depth, p.door);
  return p;
}

var MODELS = {
  "PL 384": { width: 24, depth: 16, roof: "shed" },
  "PL 576": { width: 24, depth: 24, roof: "flat" },
  "PL 768": { width: 32, depth: 24, roof: "shed" }
};

/* ---------------- materials ---------------- */
var FIN = {
  charcoal: { name: "Charcoal", siding: "#2a2926", trim: "#0a0a09", roof: "#191919", wood: "#a06b43", swatch: "#2a2926" },
  cedar:    { name: "Cedar",    siding: "#7a4f31", trim: "#0e0d0b", roof: "#1b1b1a", wood: "#b88257", swatch: "#7a4f31" },
  white:    { name: "Bone",     siding: "#d3ccbb", trim: "#161615", roof: "#262625", wood: "#a9764c", swatch: "#d3ccbb" }
};
var texCache = {};
function canvasTex(key, w, h, draw, rep) {
  if (texCache[key]) return texCache[key];
  var c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  var t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.encoding = T.sRGBEncoding; t.anisotropy = 8;
  if (rep) t.repeat.set(rep[0], rep[1]);
  texCache[key] = t; return t;
}
function sidingTex(hex) {
  return canvasTex("sid" + hex, 128, 128, function (g, w, h) {
    g.fillStyle = hex; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 90; i++) { g.fillStyle = "rgba(" + (i % 2 ? "0,0,0" : "255,255,255") + "," + (0.02 + (i % 5) * 0.008) + ")"; g.fillRect((i * 37) % w, 0, 1, h); }
    g.fillStyle = "rgba(0,0,0,.55)";
    [0, 43, 85].forEach(function (x) { g.fillRect(x, 0, 3, h); });
    g.fillStyle = "rgba(255,255,255,.06)";
    [4, 47, 89].forEach(function (x) { g.fillRect(x, 0, 1, h); });
  });
}
function woodTex(hex) {
  return canvasTex("wood" + hex, 128, 128, function (g, w, h) {
    g.fillStyle = hex; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 60; i++) { g.fillStyle = "rgba(0,0,0," + (0.03 + (i % 4) * 0.012) + ")"; g.fillRect(0, (i * 53) % h, w, 1); }
    g.fillStyle = "rgba(0,0,0,.35)"; [0, 32, 64, 96].forEach(function (y) { g.fillRect(0, y, w, 2); });
  });
}
function labelSprite(text) {
  var wide = String(text).length > 6, cw = wide ? 320 : 128, c = document.createElement("canvas"); c.width = cw; c.height = 64;
  var g = c.getContext("2d"); g.fillStyle = "rgba(11,10,8,.82)"; g.fillRect(0, 0, cw, 64);
  g.strokeStyle = "#c8553a"; g.lineWidth = 3; g.strokeRect(1.5, 1.5, cw - 3, 61);
  g.fillStyle = "#f1ece1"; g.font = "600 34px Inter, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, cw / 2, 34);
  var s = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(wide ? 3.75 : 1.5, 0.75, 1); s.renderOrder = 10; return s;
}

/* ---------------- geometry ---------------- */
function wallMatrix(p, wall, start) {
  var w = walls(p)[wall], org = w[0], d = w[1];
  var X = new T.Vector3(d[0], d[1], 0), Y = new T.Vector3(0, 0, 1), Z = new T.Vector3(d[1], -d[0], 0);
  var M = new T.Matrix4().makeBasis(X, Y, Z);
  M.setPosition(org[0] + d[0] * start, org[1] + d[1] * start, 0);
  return M;
}
function mk(geo, mat, name, noShadow) { var m = new T.Mesh(geo, mat); m.castShadow = !noShadow; m.receiveShadow = true; if (name) m.name = name; return m; }
function box(w, h, d, mat, x, y, z) { var m = mk(new T.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }

var GAP = 0;      /* roof cassettes bear directly on the wall top plate (no gap) */
var RT = 0.95;    /* roof edge thickness: 2x12 rim (11.25 in) + 5/8 in plywood + roofing, per the Pacific Wall bid notes (2x10 @24 in cassettes) */


/* ---- services x-ray: the building goes ghost and the MEP systems show, colour coded, from the same routing as the plan ---- */
function addServices(p, g) {
  var m = global.PLAN && global.PLAN.mep(p.width, p.depth); if (!m) return;
  var W = p.width, D = p.depth, h = p.wall_height, col = { cold: 0x4aa8ff, hot: 0xff7a4a, drain: 0xb8925e, pwr: 0xffc94a, data: 0x5ee08a, ref: 0xff5fd0, air: 0x8fd3d8 };
  var V = new T.Vector3(), UP = new T.Vector3(0, 1, 0);
  function bas(c, op) { return new T.MeshBasicMaterial({ color: c, transparent: op != null, opacity: op == null ? 1 : op, depthWrite: op == null, toneMapped: false }); }
  function add(o, nm) { o.name = nm || "Services"; o.userData.noexport = true; g.add(o); return o; }
  function seg(a, b, r, c, z, nm) { /* cylinder between two plan points at height z */
    var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy); if (len < 1e-4) return;
    var cy = new T.Mesh(new T.CylinderGeometry(r, r, len, 10), bas(c)); cy.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z);
    cy.quaternion.setFromUnitVectors(UP, V.set(dx, dy, 0).normalize()); add(cy, nm);
  }
  function path(pts, r, c, z, nm) { for (var i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i], r, c, z, nm); }
  function blk(x, y, w, d, ht, z, c, op, nm) { var b = new T.Mesh(new T.BoxGeometry(w, d, ht), bas(c, op)); b.position.set(x + w / 2, y + d / 2, z + ht / 2); return add(b, nm); }
  function edges(x, y, w, d, ht, z, c, op) { var e = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(w, d, ht)), new T.LineBasicMaterial({ color: c, transparent: true, opacity: op, toneMapped: false })); e.position.set(x + w / 2, y + d / 2, z + ht / 2); return add(e); }
  function tag(t, x, y, z, sc) { var sp = labelSprite(t); sp.position.set(x, y, z); sp.scale.set(sp.scale.x * (sc || 1), 0.75 * (sc || 1), 1); return add(sp, "Services label"); }
  var zT = h - 1.0;
  /* floor zone and ghost partitions */
  var fl = new T.Mesh(new T.PlaneGeometry(W - 1.1, D - 1.1), bas(0x1a1814, 0.55)); fl.position.set(W / 2, D / 2, 0.05); add(fl);
  (global.PLAN.layout(W, D).parts || []).forEach(function (q) {
    var hz = Math.abs(q[1] - q[3]) < 1e-6, len = hz ? Math.abs(q[2] - q[0]) : Math.abs(q[3] - q[1]);
    edges(Math.min(q[0], q[2]) - (hz ? 0 : 0.18), Math.min(q[1], q[3]) - (hz ? 0.18 : 0), hz ? len : 0.36, hz ? 0.36 : len, h - 0.4, 0.05, 0xd9d2c3, 0.35);
  });
  /* mechanical core, ghosted, with its door */
  var c = m.core; edges(c.x, c.y, c.w, c.h, h - 0.3, 0.05, 0xffffff, 0.55); tag("MECH CORE", c.x + c.w / 2, c.y + c.h / 2, h + 0.7, 1.15);
  /* service ceiling: tray with power and data lanes */
  for (var i = 1; i < m.tray.length; i++) {
    var a = m.tray[i - 1], b = m.tray[i];
    blk(Math.min(a[0], b[0]), a[1] - 0.45, Math.abs(b[0] - a[0]), 0.9, 0.34, zT - 0.34, 0x3a352c, 0.55, "Raceway");
    edges(Math.min(a[0], b[0]), a[1] - 0.45, Math.abs(b[0] - a[0]), 0.9, 0.34, zT - 0.34, 0xffc94a, 0.5);
    seg(a, b, 0.07, col.pwr, zT - 0.12, "Power"); seg([a[0], a[1] + 0.3], [b[0], b[1] + 0.3], 0.05, col.data, zT - 0.12, "Data");
  }
  tag("SERVICE CEILING", (m.spine.x0 + m.spine.x1) / 2, m.spine.y, zT + 0.9, 1.4);
  /* branches: power and data drop to each room's junction box */
  m.drops.forEach(function (d) {
    seg([d.sx, d.sy], [d.x, d.y], 0.045, col.pwr, zT - 0.2, "Power"); seg([d.sx + 0.3, d.sy], [d.x + 0.3, d.y], 0.035, col.data, zT - 0.2, "Data");
    blk(d.x - 0.1, d.y - 0.25, 0.5, 0.5, 0.25, zT - 0.45, 0xffc94a, null, "Junction box");
  });
  /* refrigerant and air */
  m.ref.forEach(function (q) { path(q, 0.05, col.ref, zT - 0.55, "Refrigerant"); });
  m.air.forEach(function (q) { path(q, 0.2, col.air, zT - 0.95, "Air"); });
  /* pipes: supply in the wall zone, drains in the floor zone */
  m.pipes.forEach(function (q) { path(q.pts, q.sys === "drain" ? 0.15 : 0.075, col[q.sys], q.sys === "drain" ? 0.2 : q.sys === "hot" ? 1.55 : 1.2, q.sys === "drain" ? "Drain" : "Pipe"); });
  /* wet-wall risers and the stack */
  var lat = m.pipes.filter(function (q) { return q.label === "LATERAL"; })[0];
  if (lat) { var sk = lat.pts[0]; seg([sk[0], sk[1]], [sk[0], sk[1]], 0.01, col.drain, 0); var rs = new T.Mesh(new T.CylinderGeometry(0.17, 0.17, h + 1.2, 12), bas(col.drain)); rs.rotation.x = Math.PI / 2; rs.position.set(sk[0], sk[1], (h + 1.2) / 2 - 0.1); add(rs, "Vent stack"); tag("STACK, VENT", sk[0], sk[1], h + 1.6, 1.1); }
  /* equipment */
  m.equip.forEach(function (e) {
    if (e.k === "hpwh") { var t = new T.Mesh(new T.CylinderGeometry(e.r, e.r, 5.2, 24), bas(col.hot, 0.55)); t.rotation.x = Math.PI / 2; t.position.set(e.x, e.y, 2.7); add(t, "HPWH"); tag("HEAT PUMP WATER HEATER", e.x, e.y, 6.1, 1.1); }
    else if (e.k === "panel") { blk(e.x - (e.w < e.h ? 0.1 : 0), e.y, e.w < e.h ? 0.45 : e.w, e.w < e.h ? e.h : 0.45, 2.6, 3.8, col.pwr, 0.85, "Panel"); tag("PANEL", e.x, e.y, 7.0, 0.9); }
    else if (e.k === "rack") { blk(e.x - (e.w < e.h ? 0.1 : 0), e.y, e.w < e.h ? 0.45 : e.w, e.w < e.h ? e.h : 0.45, 2.0, 1.4, col.data, 0.85, "Data"); tag("DATA", e.x, e.y, 3.9, 0.9); }
    else if (e.k === "erv") { blk(e.x, e.y, e.w, e.h, 0.9, h - 1.6, col.air, 0.7, "ERV"); tag("HEAT-RECOVERY VENT", e.x + e.w / 2, e.y + e.h / 2, h - 0.2, 1.1); }
  });
  m.heads.forEach(function (q) { blk(q.x - q.w / 2, q.y - q.h / 2, q.w, q.h, 0.9, h - 1.9, 0xe8e1d2, 0.95, "Heat pump head"); });
  m.leaks.forEach(function (q) { var sp = new T.Mesh(new T.SphereGeometry(0.16, 10, 8), bas(0x5ee0d0)); sp.position.set(q.x, q.y, 0.18); add(sp, "Leak sensor"); });
  m.access.forEach(function (q) { blk(q.x, q.y, q.w, q.h, h - 1.0, 0.3, 0xf1ece1, 0.28, "Access panel"); edges(q.x, q.y, q.w, q.h, h - 1.0, 0.3, 0xf1ece1, 0.9); });
  m.hatches.forEach(function (q) { blk(q.x, q.y, q.w, q.h, 0.05, 0.05, 0xf1ece1, 0.3, "Floor hatch"); edges(q.x, q.y, q.w, q.h, 0.06, 0.05, 0xf1ece1, 0.9); });
  /* outside: heat pump, disconnect and meter, cleanout */
  m.ext.forEach(function (q) {
    if (q.k === "clean") { var cl = new T.Mesh(new T.CylinderGeometry(q.r, q.r, 0.4, 14), bas(col.drain)); cl.rotation.x = Math.PI / 2; cl.position.set(q.x, q.y, 0.1); add(cl, "Cleanout"); tag("CLEANOUT", q.x, q.y, 1.5, 0.9); }
    else { var ht = q.k === "condenser" ? 2.6 : 3.4; blk(q.x, q.y, q.w, q.h, ht, 0, q.k === "condenser" ? col.ref : col.pwr, 0.6, q.k); tag(q.label, q.x + q.w / 2, q.y + q.h / 2, ht + 0.9, 1.0); }
  });
}

function buildUnit(p, opt) {
  opt = opt || {};
  var fin = FIN[opt.finish || "charcoal"], g = new T.Group(), thk = p.wall_thickness / 12;
  var h = p.wall_height, sl = p.pitch / 12, W = p.width, D = p.depth, dusk = !!opt.dusk;
  var M = {
    Siding: new T.MeshStandardMaterial({ map: sidingTex(fin.siding), roughness: 0.8, metalness: 0, name: "Siding" }),
    Trim: new T.MeshStandardMaterial({ color: fin.trim, roughness: 0.4, metalness: dusk ? 0.2 : 0.5, name: "Trim", envMapIntensity: 0.8 }),
    Glass: new T.MeshStandardMaterial({ color: dusk ? "#0c141c" : "#1d2b34", roughness: 0.04, metalness: dusk ? 0.2 : 0.85, transparent: true, opacity: dusk ? 0.34 : 0.55, name: "Glass", envMapIntensity: 1.4 }),
    Wood: new T.MeshStandardMaterial({ map: woodTex(fin.wood), roughness: 0.7, name: "Wood" }),
    Roof: new T.MeshStandardMaterial({ color: dusk ? "#0b0b0b" : fin.roof, roughness: dusk ? 0.9 : 0.32, metalness: dusk ? 0.1 : 0.75, flatShading: true, side: T.DoubleSide, name: "Roof", envMapIntensity: 1.1 }),
    Plinth: new T.MeshStandardMaterial({ color: "#070707", roughness: 1, name: "Plinth" })
  };
  var glow = new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, name: "Interior" });
  var panels = panelize(p), edgeMat = new T.LineBasicMaterial({ color: 0xc8553a });
  var gableRoof = p.roof === "gable", X = !!opt.services;
  if (X) { [M.Siding, M.Trim, M.Wood].forEach(function (mm) { mm.transparent = true; mm.opacity = 0.1; mm.depthWrite = false; }); M.Glass.opacity = 0.05; M.Glass.depthWrite = false; }

  if (dusk) { var spill = new T.PointLight(0xffa550, 1.6, 34, 1.6); spill.position.set(W * 0.5, -2.2, 1.4); g.add(spill); }
  /* lit interior seen through the glass */
  (function () {
    if (X) return;
    var ih = h + GAP - 0.05, iw = W - 2 * thk - 0.1, id = D - 2 * thk - 0.1, geo = new T.BoxGeometry(iw, id, ih), pos = geo.attributes.position, col = [], i;
    var lo = dusk ? [0.55, 0.28, 0.08] : [0.55, 0.55, 0.52], hi = dusk ? [1.0, 0.72, 0.38] : [0.9, 0.9, 0.86];
    for (i = 0; i < pos.count; i++) { var t = (pos.getZ(i) + ih / 2) / ih; col.push(lo[0] + (hi[0] - lo[0]) * t, lo[1] + (hi[1] - lo[1]) * t, lo[2] + (hi[2] - lo[2]) * t); }
    geo.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    var m = new T.Mesh(geo, glow); m.position.set(W / 2, D / 2, ih / 2 + 0.05); m.name = "Interior"; m.userData.noexport = true; g.add(m);
  })();

  panels.forEach(function (pn) {
    var sh = new T.Shape();
    sh.moveTo(0, 0); sh.lineTo(pn.width, 0); sh.lineTo(pn.width, pn.h1); sh.lineTo(0, pn.h0); sh.closePath();
    pn.openings.forEach(function (o) {
      var y0 = o.type === "door" ? 0.001 : o.sill, hole = new T.Path();
      hole.moveTo(o.offset, y0); hole.lineTo(o.offset + o.width, y0); hole.lineTo(o.offset + o.width, y0 + o.height); hole.lineTo(o.offset, y0 + o.height); hole.closePath();
      sh.holes.push(hole);
    });
    var geo = new T.ExtrudeGeometry(sh, { depth: thk, bevelEnabled: false }); geo.translate(0, 0, -thk);
    var wg = new T.Group(); wg.name = "panel"; wg.userData.pid = pn.id; wg.add(mk(geo, [M.Siding, M.Trim]));
    pn.openings.forEach(function (o) {
      var cx = o.offset + o.width / 2, y0 = o.type === "door" ? 0 : o.sill, cy = y0 + o.height / 2, fw = 0.09, zc = -thk * 0.5;
      if (o.type === "window") {
        var gl = new T.Mesh(new T.PlaneGeometry(o.width, o.height), M.Glass); gl.position.set(cx, cy, zc); gl.name = "Glass"; wg.add(gl);
        wg.add(box(o.width, fw, 0.28, M.Trim, cx, y0 + fw / 2, zc));
        wg.add(box(o.width, fw, 0.28, M.Trim, cx, y0 + o.height - fw / 2, zc));
        wg.add(box(fw, o.height, 0.28, M.Trim, o.offset + fw / 2, cy, zc));
        wg.add(box(fw, o.height, 0.28, M.Trim, o.offset + o.width - fw / 2, cy, zc));
        var n = Math.max(1, Math.round(o.width / 3)), k;
        if (o.height > 4) for (k = 1; k < n; k++) wg.add(box(0.07, o.height, 0.22, M.Trim, o.offset + o.width * k / n, cy, zc));
        else if (o.width >= 4) wg.add(box(0.06, o.height, 0.2, M.Trim, cx, cy, zc));
      } else {
        wg.add(box(o.width - 0.12, o.height - 0.06, 0.18, M.Wood, cx, cy - 0.02, -thk * 0.55));
        wg.add(box(0.05, 1.1, 0.06, M.Trim, o.offset + o.width - 0.42, 3.2, -thk * 0.55 + 0.13));
      }
    });
    /* glass band under the floating roof */
    if (GAP > 0.1 && !(gableRoof && (pn.wall === "left" || pn.wall === "right"))) {
      var bs = new T.Shape(); bs.moveTo(0, pn.h0); bs.lineTo(pn.width, pn.h1); bs.lineTo(pn.width, pn.h1 + GAP); bs.lineTo(0, pn.h0 + GAP); bs.closePath();
      var band = new T.Mesh(new T.ShapeGeometry(bs), M.Glass); band.position.z = -thk * 0.5; band.name = "Glass"; wg.add(band);
    }
    if (opt.showPanels) {
      wg.add(new T.LineSegments(new T.EdgesGeometry(geo), edgeMat));
      var sp = labelSprite(pn.id); sp.position.set(pn.width / 2, 1.4, 0.25); sp.name = "label"; wg.add(sp);
    }
    wg.applyMatrix4(wallMatrix(p, pn.wall, pn.start)); g.add(wg);
  });

  /* roof: thin plate, wood soffit, deep front overhang */
  var ov = p.overhang, fe = p.front_extra, x0 = -ov, x1 = W + ov, y0 = -(ov + fe), y1 = D + ov;
  function slab(pts) {
    if (X) return;
    var geo = new T.BufferGeometry(), v = [], uv = [];
    pts.forEach(function (q) { v.push(q[0], q[1], q[2] + RT); uv.push(q[0] / 4, q[1] / 4); });   /* top face; the points given are the UNDERSIDE of the roof */
    pts.forEach(function (q) { v.push(q[0], q[1], q[2]); uv.push(q[0] / 4, q[1] / 4); });
    geo.setAttribute("position", new T.Float32BufferAttribute(v, 3)); geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    geo.setIndex([4, 6, 5, 4, 7, 6,  0, 1, 2, 0, 2, 3, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]);
    geo.addGroup(0, 6, 0); geo.addGroup(6, 30, 1); geo.computeVertexNormals();
    var m = mk(geo, [M.Wood, M.Roof], "Roof"); g.add(m);
  }
  var base = h + GAP;
  /* cassette strips: 4 ft wide (to be confirmed with Pacific Wall), spanning front to back like the real 2x10 @24 in cassettes, with 1 in joints */
  var nStrip = Math.max(2, Math.round((x1 - x0) / 4)), stripW = (x1 - x0) / nStrip;
  function strips(mkPts) { for (var k = 0; k < nStrip; k++) slab(mkPts(x0 + k * stripW + (k ? 0.1 : 0), x0 + (k + 1) * stripW - (k < nStrip - 1 ? 0.1 : 0))); }
  if (p.roof === "shed") strips(function (xa, xb) { return [[xa, y0, base + y0 * sl], [xb, y0, base + y0 * sl], [xb, y1, base + y1 * sl], [xa, y1, base + y1 * sl]]; });
  else if (gableRoof) {
    var ym = D / 2, pk = base + ym * sl;
    strips(function (xa, xb) { return [[xa, y0, base + y0 * sl], [xb, y0, base + y0 * sl], [xb, ym, pk + 0.02], [xa, ym, pk + 0.02]]; });
    strips(function (xa, xb) { return [[xa, ym, pk + 0.02], [xb, ym, pk + 0.02], [xb, y1, base - (y1 - D) * sl], [xa, y1, base - (y1 - D) * sl]]; });
    ["right", "left"].forEach(function (w) {
      var s2 = new T.Shape(); s2.moveTo(0, h); s2.lineTo(D, h); s2.lineTo(D, base); s2.lineTo(ym, pk); s2.lineTo(0, base); s2.closePath();
      var gg = new T.ExtrudeGeometry(s2, { depth: thk, bevelEnabled: false }); gg.translate(0, 0, -thk);
      var wg = new T.Group(); wg.add(mk(gg, [M.Siding, M.Trim])); wg.applyMatrix4(wallMatrix(p, w, 0)); g.add(wg);
    });
  } else if (p.roof === "split") {
    /* two shed planes: the low one over the front half, the high one over the back half, TR higher, with a band of glass (the transom) between */
    var ys = D / 2;
    strips(function (xa, xb) { return [[xa, y0, base + y0 * sl], [xb, y0, base + y0 * sl], [xb, ys, base + ys * sl], [xa, ys, base + ys * sl]]; });
    strips(function (xa, xb) { return [[xa, ys, base + TR + ys * sl], [xb, ys, base + TR + ys * sl], [xb, y1, base + TR + y1 * sl], [xa, y1, base + TR + y1 * sl]]; });
    ["right", "left"].forEach(function (w) {
      var f = function (y) { return w === "right" ? y : D - y; }, z = function (y) { return base + (y >= ys ? TR : 0) + y * sl; };
      var s3 = new T.Shape(); s3.moveTo(f(0), h); s3.lineTo(f(D), h); s3.lineTo(f(D), z(D)); s3.lineTo(f(ys), z(D)); s3.lineTo(f(ys), z(ys - 0.001)); s3.lineTo(f(0), z(0)); s3.closePath();
      var g3 = new T.ExtrudeGeometry(s3, { depth: thk, bevelEnabled: false }); g3.translate(0, 0, -thk);
      var w3 = new T.Group(); w3.add(mk(g3, [M.Siding, M.Trim])); w3.applyMatrix4(wallMatrix(p, w, 0)); g.add(w3);
    });
    if (!X) {   /* the transom window, with mullions */
      var zb = base + ys * sl + RT * 0.5, tg = new T.Mesh(new T.PlaneGeometry(W - 2 * thk, TR - RT * 0.5), M.Glass); tg.name = "Glass";
      tg.rotation.x = Math.PI / 2; tg.position.set(W / 2, ys, zb + (TR - RT * 0.5) / 2); g.add(tg);
      var nm = Math.max(2, Math.round(W / 4)), kk;
      for (kk = 1; kk < nm; kk++) g.add(box(0.07, 0.2, TR - RT * 0.5, M.Trim, thk + (W - 2 * thk) * kk / nm, ys, zb + (TR - RT * 0.5) / 2));
      g.add(box(W - 2 * thk, 0.2, 0.09, M.Trim, W / 2, ys, zb + 0.045));
    }
  } else strips(function (xa, xb) { return [[xa, y0, base], [xb, y0, base], [xb, y1, base], [xa, y1, base]]; });

  var iPosts = g.children.length;
  /* slim corner posts carry a floating roof (only when there is a gap) */
  (GAP > 0.1 ? [[0.15, 0.15], [W - 0.15, 0.15], [W - 0.15, D - 0.15], [0.15, D - 0.15]] : []).forEach(function (c) {
    var top = roofTop(p, c[1]) + GAP + (gableRoof ? 0 : 0);
    g.add(box(0.3, 0.3, top, M.Trim, c[0], c[1], top / 2));
  });

  var iSite = g.children.length;
  /* recessed plinth makes the box hover, deck and steps in cedar */
  var pl = mk(new T.BoxGeometry(W - 1.4, D - 1.4, 0.7), M.Plinth, "Plinth", true); pl.position.set(W / 2, D / 2, -0.35); g.add(pl);
  var deckD = 9, plank = 0.5, nPl = Math.floor(deckD / plank), i2;
  for (i2 = 0; i2 < nPl; i2++) {
    var pm = new T.MeshStandardMaterial({ color: new T.Color(fin.wood).multiplyScalar(0.8 + ((i2 * 37) % 7) / 18), roughness: 0.72, name: "Wood" });
    var pk2 = mk(new T.BoxGeometry(W + 3, plank - 0.05, 0.14), pm, "Deck"); pk2.position.set(W / 2, -0.55 - i2 * plank - plank / 2, -0.09); g.add(pk2);
  }
  var step = box(5, 1.1, 0.4, M.Wood, 3.8, -0.55 - deckD - 0.55, -0.3); step.name = "Deck"; g.add(step);

  var iDet = g.children.length;
  /* ---- detail: LED line, fire pit with lounge chairs, furniture seen through the glass, path lights ---- */
  var warm = new T.MeshBasicMaterial({ color: dusk ? "#ffb066" : "#ffd9a8" }), dark = new T.MeshStandardMaterial({ color: dusk ? "#17130f" : "#2a2622", roughness: 0.85, name: "Furniture" });
  var cush = new T.MeshStandardMaterial({ color: dusk ? "#2c2a28" : "#b9b3a6", roughness: 1, name: "Cushion" });
  function glowBit(m) { m.userData.noexport = true; m.castShadow = false; return m; }
  var yf = -(p.overhang + p.front_extra), ledZ = roofTop(p, yf) + GAP - 0.07;
  g.add(glowBit(box(W + 2 * p.overhang - 0.6, 0.1, 0.05, warm, W / 2, yf + 0.18, ledZ)));
  var fx = W - 4, fy = -6.2;
  var pit = mk(new T.CylinderGeometry(1.25, 1.1, 0.8, 24), dark, "Firepit"); pit.rotation.x = Math.PI / 2; pit.position.set(fx, fy, 0.3); g.add(pit);
  var ember = new T.Mesh(new T.CircleGeometry(0.95, 24), new T.MeshBasicMaterial({ color: dusk ? "#ff7a2a" : "#7a4a2a" })); ember.position.set(fx, fy, 0.72); g.add(glowBit(ember));
  if (dusk) { var fl = new T.PointLight(0xff8a3a, 1.3, 15, 1.6); fl.position.set(fx, fy, 1.6); g.add(fl); }
  [-3, 3].forEach(function (dx) {
    var seat = mk(new T.BoxGeometry(2.4, 2.2, 0.9), dark, "Chair"); seat.position.set(fx + dx, fy, 0.45); g.add(seat);
    var cu = mk(new T.BoxGeometry(2.1, 1.9, 0.35), cush, "Chair"); cu.position.set(fx + dx, fy, 1.05); g.add(cu);
    var bk = mk(new T.BoxGeometry(0.4, 2.2, 1.6), dark, "Chair"); bk.position.set(fx + dx + (dx < 0 ? -1.1 : 1.1), fy, 1.0); g.add(bk);
  });
  /* furniture silhouettes inside, seen against the lit interior */
  /* the same layout as the floor plan: partitions and furniture, so the model and the plan agree */
  var LY = global.PLAN ? global.PLAN.layout(W, D) : null, sx = W * 0.3, sy = 8, isl = null;
  if (LY && !X) {
    LY.parts.forEach(function (s) {
      var horiz = Math.abs(s[1] - s[3]) < 1e-6, len = horiz ? Math.abs(s[2] - s[0]) : Math.abs(s[3] - s[1]);
      var pw = mk(new T.BoxGeometry(horiz ? len : 0.36, horiz ? 0.36 : len, h - 0.4), dark, "Partition", true);
      pw.position.set((s[0] + s[2]) / 2, (s[1] + s[3]) / 2, (h - 0.4) / 2 + 0.05); g.add(pw);
    });
    LY.items.forEach(function (q) {
      var hh = global.PLAN.HEIGHT[q.k] || 2, round = q.shape === "round", m;
      if (q.k === "shower") return;
      m = mk(round ? new T.CylinderGeometry(q.w / 2, q.w / 2, hh, 16) : new T.BoxGeometry(q.w, q.h, hh), q.k === "chair" || q.k === "dchair" || q.k === "stool" ? cush : dark, q.k === "island" ? "Island" : "Furniture", true);
      if (round) m.rotation.x = Math.PI / 2;
      m.position.set(q.x + q.w / 2, q.y + q.h / 2, hh / 2 + 0.05); g.add(m);
      if (q.k === "sofa") { /* back cushion on the back side */
        var bk = mk(new T.BoxGeometry(q.w, 0.7, 1.2), dark, "Sofa", true); bk.position.set(q.x + q.w / 2, q.back === "S" ? q.y + 0.35 : q.y + q.h - 0.35, hh + 0.65); g.add(bk); sx = q.x + q.w / 2; sy = q.y;
      }
      if (q.k === "island") isl = q;
    });
  }
  if (isl) [0.3, 0.7].forEach(function (u) {
    var px = isl.x + isl.w / 2, py = isl.y + isl.h * u;
    var pend = new T.Mesh(new T.CylinderGeometry(0.35, 0.5, 0.5, 14), warm); pend.rotation.x = Math.PI / 2; pend.position.set(px, py, 6.4); g.add(glowBit(pend));
    var cord = box(0.03, 0.03, h - 6.7, dark, px, py, 6.65 + (h - 6.7) / 2); cord.castShadow = false; g.add(cord);
  });
  var lampPole = box(0.08, 0.08, 4.6, dark, sx + 4.3, sy + 0.8, 2.3); lampPole.castShadow = false; g.add(lampPole);
  var lampTop = new T.Mesh(new T.SphereGeometry(0.5, 14, 10), warm); lampTop.position.set(sx + 4.3, sy + 0.8, 4.7); g.add(glowBit(lampTop));
  /* path lights along the stepping pads */
  [[2.0, -13], [5.6, -13], [2.0, -20], [5.6, -20]].forEach(function (pt) {
    var post = box(0.12, 0.12, 1.3, dark, pt[0], pt[1], 0.2); post.castShadow = false; g.add(post);
    var cap = new T.Mesh(new T.SphereGeometry(0.17, 10, 8), warm); cap.position.set(pt[0], pt[1], 0.9); g.add(glowBit(cap));
  });

  if (X) { g.children.slice(iDet).forEach(function (c) { g.remove(c); }); addServices(p, g); }
  g.userData.seq = { posts: [iPosts, iSite], site: [iSite, iDet], details: [iDet, g.children.length] };
  return { group: g, panels: panels, width: W, depth: D, top: h + GAP + RT + (p.roof === "shed" ? D * sl : p.roof === "split" ? D * sl + TR : gableRoof ? D / 2 * sl : 0) };
}

/* ---------------- sky, landscape ---------------- */
var SKY = {
  dusk: { zen: "#070b18", mid: "#2b3a64", hor: "#c9602f", glow: "#ffa860", fog: "#232a42", ground: "#0b0d12", gravel: "#0e1014", far: "#0a0d16", grass: "#8d8a78", tree: "#070b09", stone: "#2a2c31" },
  day:  { zen: "#5f8fcf", mid: "#9dbfe3", hor: "#e9f0f2", glow: "#fff1cf", fog: "#d4dcdc", ground: "#6f745a", gravel: "#a39f90", far: "#6f7a58", grass: "#a9b574", tree: "#3d5a3a", stone: "#7d7a72" }
};
var GLOW_DIR = new T.Vector3(-0.8, 0.65, 0.05).normalize();
function skyMat(pal) {
  return new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, fog: false,
    uniforms: { zen: { value: new T.Color(pal.zen) }, mid: { value: new T.Color(pal.mid) }, hor: { value: new T.Color(pal.hor) },
      gnd: { value: new T.Color(pal.fog) }, glow: { value: new T.Color(pal.glow) }, sd: { value: GLOW_DIR } },
    vertexShader: "varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader: "uniform vec3 zen,mid,hor,gnd,glow,sd; varying vec3 vP; void main(){ float h=vP.z; vec3 c;" +
      "if(h>=0.0){ c=mix(hor,mid,smoothstep(0.0,0.22,h)); c=mix(c,zen,smoothstep(0.18,0.85,h)); } else { c=mix(hor,gnd,smoothstep(0.0,0.2,-h)); }" +
      "float s=max(dot(normalize(vP),sd),0.0); c+=glow*(pow(s,5.0)*0.22+pow(s,40.0)*0.5); gl_FragColor=vec4(c,1.0); }"
  });
}
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function buildLandscape(p, pal) {
  var g = new T.Group(), W = p.width, D = p.depth, rnd = rng(7), i, d = new T.Object3D();
  var gr = mk(new T.PlaneGeometry(W + 30, D + 34), new T.MeshStandardMaterial({ color: pal.gravel, roughness: 1 }), "gravel", true);
  gr.position.set(W / 2, D / 2 - 4, -0.46); g.add(gr);
  /* ornamental grasses */
  var blade = new T.ConeGeometry(0.07, 1.7, 4), gm = new T.MeshStandardMaterial({ color: pal.grass, roughness: 0.9 });
  var clumps = [[-2.5, -3], [-3, 4], [-2.8, D - 2], [W + 3, 1], [W + 3.5, D - 3], [W / 2, D + 4.5], [W * 0.25, D + 5], [W * 0.75, D + 4], [W + 2, -4.5], [-3.5, -7]];
  var inst = new T.InstancedMesh(blade, gm, clumps.length * 14); var n = 0;
  clumps.forEach(function (c) { for (i = 0; i < 14; i++) {
    var a = rnd() * 6.28, r = rnd() * 0.9, s = 0.7 + rnd() * 0.9;
    d.position.set(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, -0.45 + 0.85 * s); d.rotation.set((rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5, 0); d.rotation.x += Math.PI / 2; d.scale.set(1, s, 1);
    d.rotation.set(Math.PI / 2 + (rnd() - 0.5) * 0.35, 0, (rnd() - 0.5) * 0.4); d.updateMatrix(); inst.setMatrixAt(n++, d.matrix); } });
  inst.castShadow = false; g.add(inst);
  /* stones and stepping pads */
  var sm = new T.MeshStandardMaterial({ color: pal.stone, roughness: 0.95 });
  [[-4.5, -1.5, 0.9], [W + 5, -6, 0.7], [W + 4.2, D + 2, 1.1]].forEach(function (b) {
    var m = mk(new T.DodecahedronGeometry(b[2], 0), sm, "stone"); m.scale.set(1.2, 1, 0.65); m.position.set(b[0], b[1], -0.46 + b[2] * 0.3); m.rotation.z = rnd() * 3; g.add(m); });
  for (i = 0; i < 6; i++) { var pad = mk(new T.BoxGeometry(3, 1.8, 0.12), sm, "pad"); pad.position.set(3.8 + (i % 2 ? 0.3 : -0.3), -10.5 - i * 2.6, -0.4); g.add(pad); }
  /* sculpted tree: low-poly canopy blobs, set back left of the deck */
  var cm = new T.MeshStandardMaterial({ color: pal === SKY.dusk ? "#0b130d" : "#587a4c", roughness: 1, flatShading: true }), tk = new T.MeshStandardMaterial({ color: pal === SKY.dusk ? "#120d09" : "#2b2118", roughness: 1 });
  [[-6, -6, 1], [W + 10, -3, 0.8]].forEach(function (tp) {
    var s = tp[2], tr = mk(new T.CylinderGeometry(0.25 * s, 0.4 * s, 7 * s, 8), tk, "tree"); tr.rotation.x = Math.PI / 2; tr.position.set(tp[0], tp[1], 3 * s); g.add(tr);
    [[0, 0, 8.2, 3.2], [1.6, 0.6, 6.6, 2.4], [-1.5, -0.8, 7, 2.6], [0.4, 1.4, 10, 2]].forEach(function (b) {
      var bl = mk(new T.DodecahedronGeometry(b[3] * s, 0), cm, "tree"); bl.position.set(tp[0] + b[0] * s, tp[1] + b[1] * s, b[2] * s); g.add(bl); });
  });
  /* ridgeline: one smooth dark silhouette ring instead of cone trees */
  var RN = 160, pos = [], idx = [], R0 = 330;
  for (i = 0; i <= RN; i++) {
    var an = i / RN * Math.PI * 2, hh = 14 + 9 * Math.sin(an * 3 + 1) + 6 * Math.sin(an * 7) + 3 * Math.sin(an * 17 + 2);
    pos.push(Math.cos(an) * R0, Math.sin(an) * R0, -2, Math.cos(an) * R0, Math.sin(an) * R0, hh);
    if (i < RN) { var a0 = i * 2; idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3); }
  }
  var rg = new T.BufferGeometry(); rg.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); rg.setIndex(idx);
  var ridge = new T.Mesh(rg, new T.MeshBasicMaterial({ color: pal.far, side: T.DoubleSide })); ridge.position.set(W / 2, D / 2, 0); g.add(ridge);
  /* warm light pool spilling from the glazing */
  var cv = document.createElement("canvas"); cv.width = cv.height = 256; var cx = cv.getContext("2d"), gd = cx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gd.addColorStop(0, "rgba(255,170,90,0.55)"); gd.addColorStop(0.45, "rgba(255,150,70,0.18)"); gd.addColorStop(1, "rgba(255,140,60,0)"); cx.fillStyle = gd; cx.fillRect(0, 0, 256, 256);
  if (pal === SKY.dusk) {
    var pool = new T.Mesh(new T.PlaneGeometry(W + 16, 26), new T.MeshBasicMaterial({ map: new T.CanvasTexture(cv), transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false }));
    pool.position.set(W / 2, -7, -0.4); pool.name = "pool"; g.add(pool);
  }
  g.traverse(function (o) { o.userData.noexport = true; });
  return g;
}

/* ---------------- site machinery (shared by the assembly animation and the site logistics scene) ---------------- */
function stdMat(c) { return new T.MeshStandardMaterial({ color: c, roughness: 0.8 }); }
/* 48 ft flatbed with a panel stack; local +y is the trailer's length, the cab is at -y. */
function makeTruck() {
  var truck = new T.Group();
  var trailer = new T.Mesh(new T.BoxGeometry(8, 48, 1.2), stdMat("#1d1d1f")); trailer.position.set(0, 0, 3.4); truck.add(trailer);
  var cab = new T.Mesh(new T.BoxGeometry(8, 7, 9), stdMat("#3b3934")); cab.position.set(0, -27.5, 4.6); truck.add(cab);
  [-18, -4, 18].forEach(function (yy) { [-3.6, 3.6].forEach(function (xx) { var w = new T.Mesh(new T.CylinderGeometry(1.5, 1.5, 0.9, 14), stdMat("#101010")); w.rotation.z = Math.PI / 2; w.position.set(xx, yy, 1.5); truck.add(w); }); });
  var stackGeo = new T.BoxGeometry(6.6, 42, 3.4); stackGeo.translate(0, 0, 1.7);
  var stack = new T.Mesh(stackGeo, stdMat("#6a5436")); stack.position.set(0, 0, 4); truck.add(stack);
  return { truck: truck, stack: stack };
}
/* Gradall-type machine: wheeled carrier, turret, cab, telescoping boom. */
function makeMachine() {
  var mach = new T.Group(), ym = stdMat("#b07a1c"), dk = stdMat("#242422");
  var chassis = new T.Mesh(new T.BoxGeometry(7.6, 15, 2.2), ym); chassis.position.z = 3; mach.add(chassis);
  [[-3.5, -5.5], [3.5, -5.5], [-3.5, 5.5], [3.5, 5.5]].forEach(function (w) { var wh = new T.Mesh(new T.CylinderGeometry(2.1, 2.1, 1.6, 16), dk); wh.rotation.z = Math.PI / 2; wh.position.set(w[0], w[1], 2.1); mach.add(wh); });
  var tt = new T.Group(); tt.position.z = 4.1; mach.add(tt);
  var turret = new T.Mesh(new T.BoxGeometry(6, 6, 1.4), ym); turret.position.z = 0.7; tt.add(turret);
  var cabin = new T.Mesh(new T.BoxGeometry(3.4, 3.6, 3.6), dk); cabin.position.set(-1.2, 1.4, 3.3); tt.add(cabin);
  var bp = new T.Group(); bp.position.set(1.6, 0, 2.3); tt.add(bp);
  var boomGeo = new T.BoxGeometry(1, 1.1, 1.1); boomGeo.translate(0.5, 0, 0);
  var boom = new T.Mesh(boomGeo, ym); bp.add(boom);
  var boomIn = new T.Mesh(boomGeo, stdMat("#d0a24a")); boomIn.scale.set(1, 0.8, 0.8); bp.add(boomIn);
  var cableGeo = new T.BoxGeometry(0.07, 0.07, 1); cableGeo.translate(0, 0, -0.5);
  var cable = new T.Mesh(cableGeo, stdMat("#111"));
  var hook = new T.Mesh(new T.BoxGeometry(0.5, 0.5, 0.7), stdMat("#e6c04a"));
  return { mach: mach, tt: tt, bp: bp, boom: boom, boomIn: boomIn, cable: cable, hook: hook, pivotZ: 6.4 };
}
/* Slew the boom toward a load at tgt, pitch it to a tip just above, telescope out, hang the cable. m: makeMachine() result placed at (mx, my). */
function aimBoom(m, mx, my, tgt) {
  var dx = tgt.x - mx, dy = tgt.y - my, hd = Math.max(5, Math.hypot(dx, dy) - 1.6), yaw = Math.atan2(dy, dx);
  var tipZ = Math.max(m.pivotZ + 3, tgt.z + 4.2), th = Math.atan2(tipZ - m.pivotZ, hd), BL = Math.hypot(hd, tipZ - m.pivotZ);
  m.tt.rotation.z = yaw - m.mach.rotation.z; m.bp.rotation.y = -th; m.boom.scale.x = BL * 0.62; m.boomIn.scale.x = BL;
  var tipX = mx + Math.cos(yaw) * (hd + 1.6), tipY = my + Math.sin(yaw) * (hd + 1.6), loadTop = tgt.z + 1.6;
  m.cable.position.set(tipX, tipY, tipZ); m.cable.scale.z = Math.max(0.4, tipZ - loadTop); m.hook.position.set(tipX, tipY, loadTop);
}

/* ---------------- stage (renderer + camera + lights) ---------------- */
function Stage(canvas, o) {
  o = o || {};
  var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: !!o.still });
  renderer.setPixelRatio(o.still ? 1 : Math.min(global.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping;
  var scene = new T.Scene(), camera = new T.PerspectiveCamera(o.fov || 30, 16 / 9, 0.5, 1200);
  var hemi = new T.HemisphereLight(0xffffff, 0x2a2118, 1), sun = new T.DirectionalLight(0xffffff, 1);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
  var sc = sun.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 220;
  var fill = new T.DirectionalLight(0x9db4ff, 0.5); fill.position.set(60, -25, 18); scene.add(hemi, sun, sun.target, fill);
  var ground = new T.Mesh(new T.CircleGeometry(500, 64), new T.MeshStandardMaterial({ color: "#100e0b", roughness: 1 }));
  ground.position.z = -0.5; ground.receiveShadow = true; ground.name = "ground"; scene.add(ground);
  var dome = new T.Mesh(new T.SphereGeometry(700, 32, 16), skyMat(SKY.dusk)); dome.rotation.x = Math.PI / 2; scene.add(dome);
  var pmrem = new T.PMREMGenerator(renderer), land = null;
  var S = { scene: scene, camera: camera, renderer: renderer, unit: null, orbit: { az: -0.8, el: 0.2, r: 50, target: new T.Vector3(12, 8, 4) }, auto: false };

  S.look = function (dusk) {
    var pal = dusk ? SKY.dusk : SKY.day;
    dome.material.dispose(); dome.material = skyMat(pal);
    if (scene.environment) { scene.environment.dispose(); scene.environment = null; }
    if (!dusk) {   /* sky reflections for day only: the dusk map rendered the scene black (cause not found), and adds little at dusk */
      var es = new T.Scene(), em = new T.Mesh(new T.SphereGeometry(50, 32, 16), skyMat(pal)); em.rotation.x = Math.PI / 2; es.add(em);
      scene.environment = pmrem.fromScene(es).texture;
    }
    scene.fog = new T.Fog(new T.Color(pal.fog), 80, 420);
    ground.material.color.set(pal.ground);
    hemi.color.set(dusk ? 0x6f86b0 : 0xdbe8f5); hemi.groundColor.set(dusk ? 0x120e0a : 0x6d6a5a); hemi.intensity = dusk ? 0.6 : 0.85;
    fill.intensity = dusk ? 0.9 : 0.35; sun.color.set(dusk ? 0xffa766 : 0xfff3df); sun.intensity = dusk ? 2.0 : 1.7;
    sun.position.set(dusk ? -28 : -35, dusk ? -42 : -45, dusk ? 46 : 55);
    renderer.toneMappingExposure = dusk ? 1.0 : 0.95;
    return pal;
  };
  S.show = function (p, opt) {
    if (S.assembling && S._cleanup) S._cleanup(true);
    if (S.unit) scene.remove(S.unit.group);
    if (land) scene.remove(land);
    var pal = S.look(!!(opt && opt.dusk));
    S.unit = buildUnit(p, opt); scene.add(S.unit.group);
    land = buildLandscape(p, pal); scene.add(land);
    S.orbit.target.set(p.width / 2, p.depth / 2 - 1.5, S.unit.top / 2.6);
    sun.target.position.copy(S.orbit.target); sun.target.updateMatrixWorld();
    if (!o.keepZoom) S.orbit.r = Math.max(p.width, p.depth) * 1.85 + 10;
    if (opt && opt.services) { var asp0 = (canvas.clientWidth || 1) / (canvas.clientHeight || 1); S.orbit.r *= 0.52 * (asp0 < 1 ? Math.min(2, 1 / asp0 * 0.95) : 1); if (!S._svc) S.orbit.el = 0.78; }
    S._svc = !!(opt && opt.services);
    S.draw();
  };
  /* a prebuilt model from library.js: {group, x0, y0, w, d, top}. The group is shifted so its footprint starts at the origin, like the PL units. */
  S.showModel = function (m, opt) {
    if (S.assembling && S._cleanup) S._cleanup(true);
    if (S.unit) scene.remove(S.unit.group);
    if (land) scene.remove(land);
    var pal = S.look(!!(opt && opt.dusk)), p = { width: m.w, depth: m.d };
    m.group.position.set(-m.x0, -m.y0, 0);
    var holder = new T.Group(); holder.add(m.group);
    S.unit = { group: holder, width: m.w, depth: m.d, top: m.top }; scene.add(holder);
    land = buildLandscape(p, pal); scene.add(land);
    S.orbit.target.set(m.w / 2, m.d / 2 - 1.5, m.top / 2.6);
    sun.target.position.copy(S.orbit.target); sun.target.updateMatrixWorld();
    if (!o.keepZoom || (opt && opt.refit)) S.orbit.r = Math.max(m.w, m.d) * 1.85 + 10;
    S.draw();
  };
  S.draw = function () {
    var w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
    if (!o.still) renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    var t = S.orbit.target, b = S.orbit;
    camera.up.set(0, 0, 1);
    camera.position.set(t.x + b.r * Math.cos(b.el) * Math.cos(b.az), t.y + b.r * Math.cos(b.el) * Math.sin(b.az), t.z + b.r * Math.sin(b.el));
    camera.lookAt(t); renderer.render(scene, camera);
  };
  /* ---- assembly animation: truck delivers, tower crane sets each wall panel, then the roof, then the site comes alive ---- */
  function ease(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
  S._tok = 0; S.assembling = false;
  S.assemble = function (done) {
    if (!S.unit) return;
    if (S.assembling && S._cleanup) S._cleanup(true);
    var token = ++S._tok, g = S.unit.group, seq = g.userData.seq, kids = g.children.slice(), i;
    var W = S.unit.width, D = S.unit.depth, topZ = S.unit.top;
    /* classify */
    var panels = [], roofs = [], site = [], posts = [], dets = [], interior = null, lights = [];
    kids.forEach(function (o, idx) {
      if (o.isLight) { lights.push(o); return; }
      if (o.name === "panel") panels.push(o);
      else if (o.name === "Roof") roofs.push(o);
      else if (o.name === "Interior") interior = o;
      else if (idx >= seq.posts[0] && idx < seq.posts[1]) posts.push(o);
      else if (idx >= seq.site[0] && idx < seq.site[1]) site.push(o);
      else if (idx >= seq.details[0] && idx < seq.details[1]) dets.push(o);
    });
    var sx = W / 2 + 6, sy = D + 20, mx = W + 7, my = D + 8;
    /* truck with a panel stack, and a Gradall-type telescopic-boom machine */
    var extra = new T.Group(), tk = makeTruck(), truck = tk.truck, stack = tk.stack;
    truck.rotation.z = Math.PI / 2; truck.position.set(sx + 110, sy, 0); extra.add(truck);
    var MM = makeMachine(), mach = MM.mach;
    mach.position.set(mx, my, 0); mach.visible = false; extra.add(mach, MM.cable, MM.hook);
    extra.traverse(function (m) { if (m.isMesh) { m.castShadow = true; m.userData.noexport = true; } });
    extra.userData.noexport = true; g.add(extra);
    /* start state */
    var all = [].concat(panels, roofs, site, posts, dets, interior ? [interior] : [], lights);
    all.forEach(function (m) { m.visible = false; });
    var items = [];
    var tPan0 = 3.0, stag = 0.22, fly = 1.15;
    function boxCentre(o) { var b = new T.Box3().setFromObject(o), c = new T.Vector3(); b.getCenter(c); return c; }
    panels.forEach(function (o, k) {
      o.userData.base = o.position.clone(); var c = boxCentre(o); o.userData.c0 = c;
      items.push({ o: o, t0: tPan0 + k * stag, dur: fly, arc: 7, from: new T.Vector3(sx + ((k * 5) % 13) - 6, sy + (k % 2 ? 0.7 : -0.7), 6.2) });
    });
    var tRoof = tPan0 + panels.length * stag + fly * 0.4;
    roofs.forEach(function (o, k) {
      o.userData.base = o.position.clone(); o.userData.c0 = boxCentre(o);
      items.push({ o: o, t0: tRoof + k * 0.5, dur: 1.6, arc: 8, from: new T.Vector3(sx + (k % 3) * 2 - 2, sy, 8), roof: true });
    });
    var tRoofEnd = tRoof + roofs.length * 0.5 + 1.2, tDet0 = tRoofEnd + 0.2, tEnd = tDet0 + dets.length * 0.07 + 2.6;
    var r0 = S.orbit.r, el0 = S.orbit.el, az0 = S.orbit.az, wasAuto = S.auto; S.auto = false; S.assembling = true;
    var start = performance.now();
    function finish(cancel) {
      g.remove(extra); extra.traverse(function (m) { if (m.geometry) m.geometry.dispose(); });
      all.forEach(function (m) { m.visible = true; if (m.userData.base) m.position.copy(m.userData.base); });
      S.assembling = false; S._cleanup = null; S.orbit.r = r0; S.orbit.el = el0; if (cancel) S.orbit.az = az0; S.auto = wasAuto; S._tok++; S.draw(); if (done) done(!!cancel);
    }
    S._cleanup = finish;
    (function frame(now) {
      if (token !== S._tok) return;  /* cancelled or replaced: its cleanup already ran */
      var t = (now - start) / 1000, live = null;
      /* site works */
      site.forEach(function (m, k) { m.visible = t > 0.6 + k * 0.045; });
      posts.forEach(function (m) { m.visible = t > tPan0 + 0.3; });
      /* truck in / out */
      var tin = ease(t / 2.4), tout = ease((t - (tEnd - 2.4)) / 2.2);
      truck.position.x = sx + 110 * (1 - tin) + 110 * tout;
      var used = Math.min(1, Math.max(0, (t - tPan0) / (panels.length * stag + fly)));
      var usedRoof = Math.min(1, Math.max(0, (t - tRoof) / (roofs.length * 0.5 + 1)));
      stack.scale.z = Math.max(0.05, 1 - used * 0.65 - usedRoof * 0.3);
      /* the machine is on site for the whole lift */
      mach.visible = t > tPan0 - 1.2 && t < tEnd - 0.9;
      /* panels and roof */
      items.forEach(function (it) {
        var u = (t - it.t0) / it.dur, o = it.o;
        if (u <= 0) { o.visible = false; return; }
        o.visible = true;
        var e = ease(u), arc = Math.sin(Math.PI * Math.min(1, u)) * it.arc * (u < 1 ? 1 : 0), b = o.userData.base, c0 = o.userData.c0;
        var dx = (it.from.x - c0.x) * (1 - e), dy = (it.from.y - c0.y) * (1 - e), dz = (it.from.z - c0.z) * (1 - e) + arc;
        o.position.set(b.x + dx, b.y + dy, b.z + dz);
        if (u < 1) live = { c: new T.Vector3(c0.x + dx, c0.y + dy, c0.z + dz), top: it.roof ? (S.unit.top - 1) : null };
      });
      /* boom follows the load: slew toward it, pitch up to a tip just above it, telescope out; the cable hangs from the tip */
      aimBoom(MM, mx, my, live ? live.c : new T.Vector3(sx, sy, 10));
      /* the site comes alive */
      if (interior) interior.visible = t > tRoofEnd;
      dets.forEach(function (m, k) { m.visible = t > tDet0 + k * 0.07; });
      lights.forEach(function (m) { m.visible = t > tRoofEnd; });
      /* camera pulls back a little and drifts */
      var pull = 1 + 0.55 * Math.sin(Math.PI * Math.min(1, t / tEnd));
      S.orbit.r = r0 * pull; S.orbit.az = az0 + 0.18 * Math.min(1, t / tEnd);
      S.draw();
      if (t >= tEnd) { S.orbit.az = az0 + 0.18; finish(false); return; }
      requestAnimationFrame(frame);
    })(start);
  };
  S.stopAssemble = function () { if (S.assembling && S._cleanup) S._cleanup(true); };

  if (o.interactive) {
    var drag = null;
    canvas.style.touchAction = "pan-y";
    canvas.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY, az: S.orbit.az, el: S.orbit.el }; S.auto = false; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", function (e) {
      if (!drag) return;
      S.orbit.az = drag.az - (e.clientX - drag.x) * 0.008;
      S.orbit.el = Math.max(0.03, Math.min(1.4, drag.el + (e.clientY - drag.y) * 0.005)); S.draw();
    });
    canvas.addEventListener("pointerup", function () { drag = null; });
    canvas.addEventListener("wheel", function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault(); S.orbit.r = Math.max(18, Math.min(260, S.orbit.r * (1 + Math.sign(e.deltaY) * 0.08))); S.draw();
    }, { passive: false });
    if (global.ResizeObserver) new ResizeObserver(function () { S.draw(); }).observe(canvas);
  }
  S.spin = function (on) {
    S.auto = on; if (!on) return;
    (function tick() { if (!S.auto) return; S.orbit.az += 0.0035; S.draw(); requestAnimationFrame(tick); })();
  };
  return S;
}

/* A still image of a unit as a data URL. */
function renderStill(p, opt, view, w, h) {
  var c = document.createElement("canvas"); c.width = w; c.height = h;
  var S = Stage(c, { still: true, fov: (view && view.fov) || 30 });
  S.renderer.setSize(w, h, false);
  S.show(p, opt);
  if (view) {
    S.orbit.az = view.az; S.orbit.el = view.el; if (view.r) S.orbit.r = view.r * Math.max(p.width, p.depth) / 24; if (view.dz) S.orbit.target.z += view.dz;
    if (view.dx) { S.orbit.target.x += -Math.sin(view.az) * view.dx; S.orbit.target.y += Math.cos(view.az) * view.dx; }
  }
  S.draw();
  var url = c.toDataURL("image/jpeg", 0.92);
  S.renderer.dispose(); S.renderer.forceContextLoss && S.renderer.forceContextLoss();
  return url;
}

/* ---------------- OBJ export (for Twinmotion / Rhino / Archicad) ---------------- */
function exportOBJ(unit, name) {
  var M2 = 0.3048, lines = ["# " + name + " - Willard Williams Architect", "mtllib " + name + ".mtl"], mats = {}, vOff = 1;
  unit.group.updateMatrixWorld(true);
  unit.group.traverse(function (m) {
    if (!m.isMesh || m.userData.noexport) return;
    var geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry, pos = geo.attributes.position, v = new T.Vector3(), i;
    var groups = geo.groups && geo.groups.length ? geo.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
    lines.push("o " + (m.name || "part") + "_" + vOff);
    for (i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      lines.push("v " + (v.x * M2).toFixed(4) + " " + (v.z * M2).toFixed(4) + " " + (-v.y * M2).toFixed(4)); }
    groups.forEach(function (gr) {
      var mat = Array.isArray(m.material) ? m.material[gr.materialIndex] : m.material;
      mats[mat.name || "Material"] = mat; lines.push("usemtl " + (mat.name || "Material"));
      for (i = gr.start; i < gr.start + gr.count; i += 3) lines.push("f " + (vOff + i) + " " + (vOff + i + 1) + " " + (vOff + i + 2));
    });
    vOff += pos.count;
  });
  var mtl = Object.keys(mats).map(function (k) {
    var m = mats[k], col = m.color || new T.Color(0x888888);
    return "newmtl " + k + "\nKd " + col.r.toFixed(3) + " " + col.g.toFixed(3) + " " + col.b.toFixed(3) + "\nd " + (m.transparent ? 0.4 : 1) + "\n";
  }).join("\n");
  return { obj: lines.join("\n"), mtl: mtl };
}
function download(name, text) {
  var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

global.ADU = { walls: walls, validate: validate, panelize: panelize, quantities: quantities, makeParams: makeParams, openingsFor: openingsFor, pitchFor: pitchFor,
  MODELS: MODELS, FIN: FIN, buildUnit: buildUnit, makeTruck: makeTruck, makeMachine: makeMachine, aimBoom: aimBoom, Stage: Stage, renderStill: renderStill, exportOBJ: exportOBJ, download: download,
  mk: mk, box: box, sidingTex: sidingTex, woodTex: woodTex, labelSprite: labelSprite, rng: rng, SKY: SKY };
})(window);
