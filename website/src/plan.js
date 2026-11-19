/* Floor plans (SVG) and a preliminary code check, from ONE layout that also drives the windows and the 3D furniture.
   Plan coordinates: feet, x from the left, y from the FRONT wall (0) to the back (D). Walls and openings are exact;
   rooms, furniture and fixtures are a typical arrangement sized to real products, not a design for a specific client. */
(function (global) {
  var T = 0.54, H = 0.18; /* 6.5 in exterior wall, 4.3 in interior partition (H = half) */
  function f(n) { return Math.round(n * 100) / 100; }
  function ftin(v) { var ft = Math.floor(v + 1e-6), inch = Math.round((v - ft) * 12); if (inch === 12) { ft++; inch = 0; } return ft + "'-" + inch + '"'; }

  /* ---------------- layout ---------------- */
  function layout(W, D, doorSide) {
    var rooms = [], parts = [], items = [], doors = [], ops = [], studio = D < 20;
    function room(name, x0, y0, x1, y1, o) { var r = { name: name, x: x0, y: y0, w: x1 - x0, h: y1 - y0, hab: false, kind: "" }; for (var k in o) r[k] = o[k]; rooms.push(r); return r; }
    function it(k, x, y, w, h, back, room, o) { var r = { k: k, x: f(x), y: f(y), w: f(w), h: f(h), back: back || "N", room: room }; for (var q in o) r[q] = o[q]; items.push(r); return r; }
    function door(ax, x, y, w, hinge, dir, type, room) { doors.push({ ax: ax, x: f(x), y: f(y), w: w, hinge: hinge, dir: dir, type: type || "swing", room: room }); }
    /* pos: plan x for front/back walls, plan y (from the front) for side walls. off: the model's own offset convention. */
    function win(wall, pos, w, h, sill, room, op, o) {
      var off = wall === "front" ? pos : wall === "back" ? W - pos - w : wall === "right" ? pos : D - pos - w;
      var r = { wall: wall, type: "window", offset: f(off), width: w, height: h, sill: sill, room: room, op: op, pos: f(pos) }; for (var q in o) r[q] = o[q]; ops.push(r); }

    /* front wall: entry door and the sliders (same for every model) */
    var west = doorSide === "west";
    if (west) { /* entry on the west (left) end wall, 1 ft from the front corner; the front gets a fixed glass panel where the door was */
      ops.push({ wall: "left", type: "door", offset: f(D - 1.0 - 3), width: 3, height: 7, sill: 0, room: "LIVING", pos: 1.0 });
      win("front", 2.5, 3, 8, 0, "LIVING", 0);
    } else ops.push({ wall: "front", type: "door", offset: 2.5, width: 3, height: 7, sill: 0, room: "LIVING", pos: 2.5 });
    win("front", 6.5, 6, 8, 0, "LIVING", 0.5);
    if (W >= 20) win("front", 13, 6, 8, 0, "LIVING", 0.5);

    if (studio) {
      var bw = 7.5, bd = 8, yb = D - bd, yt = D - T;
      var living = room("LIVING / SLEEPING", T, T, W - T, yt, { hab: true, kind: "living", area: (W - 2 * T) * (D - 2 * T) - (bw - T) * (bd - T) });
      var bath = room("BATH", T, yb + H, bw - H, yt, { kind: "bath" });
      parts.push([T, yb, bw, yb], [bw, yb, bw, yt]);
      /* bath: shower in the back left corner, toilet beside it, vanity on the left wall */
      it("shower", T, yt - 3, 3, 3, "N", "BATH");
      it("toilet", 4.7, yt - 2.3, 1.4, 2.3, "N", "BATH");
      it("vanity", T, yb + 0.95, 1.5, 3, "W", "BATH");
      door("h", 4.0, yb, 3, "R", 1, "swing", "BATH");
      win("back", 4.0, 2.5, 2, 6.5, "BATH", 0.5);
      /* kitchen run along the back wall */
      var kx = 10.7;
      room("MECH", 7.6, yt - 2.2, 10.6, yt, { kind: "mech" });
      parts.push([10.6, yt - 2.2, 10.6, yt]);
      it("mech", 7.6, yt - 2.2, 3, 2.2, "N", "MECH");
      door("h", 7.6, yt - 2.2, 3, "L", -1, "bifold", "MECH");
      it("fridge", kx, yt - 2.5, 2.5, 2.5, "N", "KITCHEN");
      it("cab", kx + 2.5, yt - 2, 1, 2, "N", "KITCHEN");
      it("range", kx + 3.5, yt - 2, 2.5, 2, "N", "KITCHEN");
      it("sink", kx + 6, yt - 2, 2.4, 2, "N", "KITCHEN");
      win("back", kx + 5.7, 2.5, 3, 3.5, "LIVING", 0.5);
      /* wet wall: bath and kitchen share the back left. Sleeping zone at the far right end, away from the kitchen,
         headboard on the right wall with a wardrobe at the back that screens it from the kitchen. */
      var bx = W - T - 6.67;
      it("bed", bx, 3.0, 6.67, 5, "E", "LIVING");
      it("night", W - T - 1.5, 1.4, 1.5, 1.5, "E", "LIVING");
      it("night", W - T - 1.5, 8.1, 1.5, 1.5, "E", "LIVING");
      win("right", 4.0, 3, 2, 5, "LIVING", 0.5);
      it("wardrobe", W - T - 2, 10.4, 2, 5.06, "E", "LIVING");
      door("v", W - T - 2, 10.4, 5.06, "L", -1, "bifold", "LIVING");
      /* living: sofa facing the glass, chair, coffee table */
      it("sofa", 9, 5.4, 7, 3, "N", "LIVING");
      it("table", 10.5, 3.3, 3, 1.5, "N", "LIVING", { shape: "coffee" });
      it("chair", 2.4, 5.0, 2.5, 2.5, "E", "LIVING");
      win("left", west ? 5.2 : 3.8, 2, 8, 0.5, "LIVING", 0.5);
      if (W >= 28) it("dining", bx - 3.6, 4.2, 2.5, 2.5, "N", "LIVING", { shape: "round" });
      return { studio: true, rooms: rooms, parts: parts, items: items, doors: doors, openings: ops, kitchen: { x: kx, y: yt - 2 } };
    }

    /* one or two bedrooms: a 9 ft band across the back (bedroom | bath | util or bedroom 2), living and kitchen in front */
    var bandD = 9, bed = 12, bath = 8, py = D - bandD, yt2 = D - T, third = W - bed - bath, two = third >= 10;
    var y0 = py + H;
    var living2 = room("LIVING / KITCHEN", T, T, W - T, py - H, { hab: true, kind: "living" });
    parts.push([T, py, W - T, py], [bed, py, bed, yt2], [bed + bath, py, bed + bath, yt2]);

    /* bedroom: headboard on the side wall, wardrobe and door at the far end, egress casement on the back wall */
    function bedroom(name, x0, x1, mir) {
      var w = x1 - x0;
      function X(u, ww) { return mir ? x1 - u - ww : x0 + u; }
      room(name, x0, y0, x1, yt2, { hab: true, kind: "bedroom", lx: X(8.9, 0), ly: py + 4.6 });
      it("bed", X(0, 6.67), 16.9 + (py - 15), 6.67, 5, mir ? "E" : "W", name);
      it("night", X(0, 1.5), y0 + 0.2, 1.5, 1.5, mir ? "E" : "W", name);
      it("night", X(0, 1.5), yt2 - 1.5, 1.5, 1.5, mir ? "E" : "W", name);
      it("wardrobe", X(w - 3.08, 3.08), yt2 - 2, 3.08, 2, "N", name);
      door("h", X(w - 3.08, 3.08), yt2 - 2, 3.08, "L", -1, "bifold", name);
      door("h", X(8.0, 2.67), py, 2.67, mir ? "L" : "R", 1, "swing", name);
      win("back", X(2.8, 3), 3, 4, 2.5, name, 0.9, { egress: true });
      if (w >= 14.6) win("back", X(7.2, 4), 4, 3, 3.5, name, 0.5);
    }
    bedroom(two ? "BEDROOM 1" : "BEDROOM", T, bed - H, false);
    /* bath */
    room("BATH", bed + H, y0, bed + bath - H, yt2, { kind: "bath" });
    it("toilet", bed + 2.3 - 0.2, yt2 - 2.3, 1.4, 2.3, "N", "BATH");
    it("shower", bed + bath - H - 3, yt2 - 3, 3, 3, "N", "BATH");
    it("vanity", bed + bath - H - 1.5, y0 + 0.7, 1.5, 3.2, "E", "BATH");
    door("h", bed + 0.7, py, 3, "L", 1, "swing", "BATH");
    win("back", bed + 1.0, 3, 2, 6.5, "BATH", 0.5);
    /* util or second bedroom */
    if (two) {
      bedroom("BEDROOM 2", bed + bath + H, W - T, true);
      var ux = 16.0, uy = py - H - 2.6;
      room("UTIL", ux, uy, ux + 6, py - H, { kind: "util" });
      parts.push([ux, uy, ux, py], [ux + 6, uy, ux + 6, py]);
      it("washer", ux + 0.2, uy + 0.05, 2.3, 2.5, "N", "UTIL", { shape: "wd" });
      it("hpwh", ux + 2.8, uy + 0.3, 2.0, 2.0, "N", "UTIL", { shape: "round" });
      door("h", ux + 0.1, uy, 5.8, "L", -1, "bifold", "UTIL");
    } else {
      room("UTIL", bed + bath + H, y0, W - T, yt2, { kind: "util" });
      it("washer", bed + bath + 0.9, yt2 - 2.5, 2.3, 2.5, "N", "UTIL", { shape: "wd" });
      door("h", bed + bath + 0.4, py, 2.8, "L", 1, "bifold", "UTIL");
      if (third < 7) it("hpwh", bed + bath + 1.2, yt2 - 5.0, 2.0, 2.0, "N", "UTIL", { shape: "round" });
      if (third >= 7) { it("hpwh", bed + bath + 3.9, yt2 - 2.4, 2.4, 2.4, "N", "UTIL", { shape: "round" }); it("shelf", W - T - 1.2, yt2 - 5, 1.2, 5, "E", "UTIL"); }
    }
    /* kitchen along the right wall, island, living, dining */
    var xr = W - T - 2, ky = 1.6, deep = D >= 24, lyTop = py - H;
    it("sink", xr, ky, 2, 2.6, "E", "KITCHEN");
    if (deep) {
      it("dw", xr, ky + 2.6, 2, 2, "E", "KITCHEN");
      it("range", xr, ky + 4.6, 2, 2.5, "E", "KITCHEN");
      it("cab", xr, ky + 7.1, 2, 1.1, "E", "KITCHEN");
      it("fridge", xr - 0.5, ky + 8.2, 2.5, 2.5, "E", "KITCHEN");
    } else { /* shallow living area: compact run, no island */
      it("range", xr, ky + 2.6, 2, 2.5, "E", "KITCHEN");
      it("fridge", xr - 0.5, ky + 5.1, 2.5, 2.5, "E", "KITCHEN");
    }
    win("right", 2.2, 2, 3, 3.5, "LIVING", 0.5);
    if (deep) {
      var ix = xr - 3.6 - 2.5;
      it("island", ix, 4.0, 2.5, 5.5, "E", "KITCHEN");
      it("stool", ix - 1.4, 4.8, 1.2, 1.2, "E", "KITCHEN", { shape: "round" });
      it("stool", ix - 1.4, 7.6, 1.2, 1.2, "E", "KITCHEN", { shape: "round" });
      it("sofa", 5.0, 8.5, 7, 3, "N", "LIVING");
      it("table", 6.5, 6.0, 3, 1.5, "N", "LIVING", { shape: "coffee" });
      it("chair", 2.6, 5.5, 2.5, 2.5, "E", "LIVING");
    } else {
      it("sofa", 2.2, 7.3, 6, 3, "N", "LIVING");
      it("table", 3.2, 5.0, 3, 1.5, "N", "LIVING", { shape: "coffee" });
      it("chair", 6.8, 3.9, 2.5, 2.5, "E", "LIVING");
    }
    win("left", Math.min(8.8, lyTop - 2.6), 2, 8, 0.5, "LIVING", 0.5);
    if (two) { /* wider unit: dining table between living and kitchen */
      it("dining", 15.0, 3.0, 5, 3, "N", "LIVING", { shape: "dining" });
      [16.2, 18.4].forEach(function (cx) { it("dchair", cx, 1.5, 1.4, 1.4, "N", "LIVING"); it("dchair", cx, 6.1, 1.4, 1.4, "N", "LIVING"); });
    } else {
      it("dining", 10.9, 1.6, 2.5, 2.5, "N", "LIVING", { shape: "round" });
    }
    return { studio: false, rooms: rooms, parts: parts, items: items, doors: doors, openings: ops, kitchen: { x: xr, y: ky } };
  }


  /* ---------------- services: MEP routing, equipment and access, from the same layout ---------------- */
  /* Principles: one mechanical core holds every piece of equipment behind one door; one continuous service ceiling carries power, data,
     refrigerant and air in separate lanes; supply piping runs in the wet wall behind full-height removable panels; drains run in a floor
     zone with hatches; every junction is reachable without cutting finishes. Coordinates match layout(): x from the left, y from the front. */
  function mep(W, D) {
    var L = layout(W, D), yt = D - T, o = { pipes: [], tray: [], dtray: [], air: [], ref: [], drops: [], equip: [], heads: [], access: [], hatches: [], leaks: [], ext: [], labels: [], spine: null };
    function P(sys, pts, label) { o.pipes.push({ sys: sys, pts: pts, label: label }); }
    var ceil = 0;
    if (L.studio) {
      var sy = yt - 0.8, st = 7.85, en = W - T - 1.0;
      o.core = { x: 7.6, y: yt - 2.2, w: 3, h: 2.2 };
      o.equip.push({ k: "hpwh", x: 8.7, y: yt - 1.2, r: 1.0, label: "HPWH" }, { k: "panel", x: 9.7, y: yt - 0.45, w: 1.1, h: 0.4, label: "PANEL" }, { k: "rack", x: 8.0, y: yt - 0.45, w: 1.4, h: 0.4, label: "DATA" },
        { k: "erv", x: 7.7, y: yt - 2.15, w: 1.6, h: 0.9, label: "ERV", dashed: true });
      o.spine = { y: sy, x0: 1.4, x1: en };
      o.tray = [[1.4, sy], [en, sy]];
      o.dtray = [[1.4, sy + 0.3], [en, sy + 0.3]];
      [[3.5, 11.0, "BATH"], [12.5, 7.4, "LIVING"], [19.5, 5.5, "SLEEP"], [4.0, 2.4, "ENTRY"]].forEach(function (d) { o.drops.push({ x: d[0], y: d[1], sx: d[0], sy: sy, label: d[2] }); });
      o.heads.push({ x: 14.8, y: yt - 0.35, w: 2.8, h: 0.5, label: "HEAD" });
      o.air.push([[8.2, yt - 1.4], [8.2, 12.6], [12.5, 12.6], [12.5, 8.0]], [[8.8, yt - 1.4], [8.8, 12.8], [19.5, 12.8], [19.5, 6.2]]);
      o.ref.push([[14.8, yt - 0.35], [14.8, sy - 0.5], [9.3, sy - 0.5], [9.3, D + 1.0]]);
      var sx = 6.85;
      P("cold", [[8.0, yt - 0.9], [1.0, yt - 0.9]], "COLD"); P("hot", [[8.0, yt - 0.6], [1.0, yt - 0.6]], "HOT");
      P("cold", [[10.8, yt - 0.9], [17.9, yt - 0.9]]); P("hot", [[10.8, yt - 0.6], [17.9, yt - 0.6]]);
      P("cold", [[1.0, yt - 0.9], [1.0, 10.6]]); P("hot", [[1.0, yt - 0.6], [1.0, 10.6]]);
      P("drain", [[17.9, yt - 1.2], [17.9, 13.0], [sx, 13.0]], "DRAIN"); P("drain", [[5.4, yt - 1.2], [5.4, 13.0]]); P("drain", [[2.0, yt - 1.6], [2.0, 13.0]]); P("drain", [[1.4, 10.8], [1.4, 13.0]]);
      P("drain", [[sx, 13.0], [sx, D + 2.2]], "LATERAL");
      o.access.push({ x: 7.4, y: yt - 2.0, w: 0.3, h: 1.8, label: "WET-WALL ACCESS" });
      o.hatches.push({ x: sx - 0.8, y: 12.2, w: 1.6, h: 1.6, label: "STACK" }, { x: 13.4, y: 12.2, w: 1.6, h: 1.6, label: "TRUNK" });
      [[5.4, yt - 1.2], [2.0, yt - 1.6], [17.9, yt - 1.2], [8.7, yt - 1.2]].forEach(function (q) { o.leaks.push({ x: q[0], y: q[1] }); });
      o.ext.push({ k: "condenser", x: 8.0, y: D + 0.5, w: 3.0, h: 1.2, label: "HEAT PUMP" }, { k: "pedestal", x: 12.0, y: D + 0.4, w: 1.6, h: 0.9, label: "DISCONNECT, METER" }, { k: "clean", x: sx, y: D + 2.2, r: 0.45, label: "CLEANOUT" });
    } else {
      var py = D - 9, y0 = py + H, two = (W - 20) >= 10, sp = py, ur = L.rooms.filter(function (r) { return r.kind === "util"; })[0];
      o.core = { x: ur.x, y: ur.y, w: ur.w, h: ur.h };
      var hp = L.items.filter(function (i) { return i.k === "hpwh"; })[0], ex = ur.x + ur.w;
      o.equip.push({ k: "hpwh", x: hp.x + hp.w / 2, y: hp.y + hp.h / 2, r: hp.w / 2, label: "HPWH" }, { k: "panel", x: ex - 0.4, y: ur.y + 0.5, w: 0.4, h: 1.0, label: "PANEL" },
        { k: "rack", x: ex - 0.4, y: ur.y + 1.6, w: 0.4, h: 1.0, label: "DATA" }, { k: "erv", x: ur.x + 0.3, y: ur.y + 0.5, w: 2.0, h: 1.0, label: "ERV", dashed: true });
      o.spine = { y: sp, x0: 1.4, x1: W - T - 1.0 };
      o.tray = [[1.4, sp], [W - T - 1.0, sp]]; o.dtray = [[1.4, sp + 0.3], [W - T - 1.0, sp + 0.3]];
      var drops = [[5.5, 19.4, "BED 1"], [16, 18.5, "BATH"], [ur.x + 1.6, ur.y + 1.2, "MECH"], [10, 8.5, "LIVING"], [W - 8, 7.5, "KITCHEN"]];
      if (two) drops.push([W - 5.5, 19.4, "BED 2"]); if (W >= 32) drops.push([17.5, 4.5, "DINING"]);
      drops.forEach(function (d) { o.drops.push({ x: d[0], y: d[1], sx: d[0], sy: sp, label: d[2] }); });
      o.heads.push({ x: 10, y: py - 0.4, w: 2.8, h: 0.5, label: "HEAD" }, { x: 5.5, y: y0 + 0.4, w: 2.8, h: 0.5, label: "HEAD" });
      if (two) o.heads.push({ x: W - 5.5, y: y0 + 0.4, w: 2.8, h: 0.5, label: "HEAD" });
      var cxo = two ? 19.9 : ur.x + 1.2;
      o.ref.push([[10, py - 0.4], [10, py - 0.6], [cxo, py - 0.6], [cxo, D + 1.0]], [[5.5, y0 + 0.4], [5.5, py + 0.6], [cxo, py + 0.6]]);
      if (two) o.ref.push([[W - 5.5, y0 + 0.4], [W - 5.5, py + 0.6], [cxo, py + 0.6]]);
      var ax0 = ur.x + 1.0, ay0 = ur.y + 1.0;
      o.air.push([[ax0, ay0], [ax0, py - 0.9], [10, py - 0.9], [10, 9.5]], [[ax0, py - 0.9], [5.0, py - 0.9], [5.0, y0 + 1.5]]);
      if (two) o.air.push([[ax0, py - 0.9], [W - 5.0, py - 0.9], [W - 5.0, y0 + 1.5]]);
      o.air.push([[15.5, y0 + 1.0], [15.5, py - 0.9]]);
      var sx2 = 13.6, sty = yt - 0.95, kxp = W - T - 0.9, kd = W - T - 1.3, ax = hp.x + hp.w / 2 + 0.4, ay = py - 0.8;
      function feed(off, tail) { var s = two ? [[ax, ay - off], [19.7 - off, ay - off], [19.7 - off, sty - off]] : [[ax, sty - off]]; return s.concat(tail); }
      P("cold", feed(0, [[14.8, sty]]), "COLD"); P("hot", feed(0.3, [[17.6, sty - 0.3]])); P("hot", [[17.6, sty - 0.3], [17.6, sty]]);
      P("cold", [[19.6, sty], [19.6, 17.4]]); P("hot", [[19.4, sty - 0.3], [19.4, 17.4]]);
      P("cold", two ? [[ax, ay], [kxp, ay], [kxp, 3.2]] : [[ax, sty], [kxp, sty], [kxp, 3.2]]); P("hot", two ? [[ax, ay - 0.3], [kxp - 0.3, ay - 0.3], [kxp - 0.3, 3.2]] : [[ax, sty - 0.3], [kxp - 0.3, sty - 0.3], [kxp - 0.3, 3.2]]);
      P("drain", [[19.2, 17.4], [19.2, 20.0], [sx2, 20.0]], "DRAIN"); P("drain", [[18.3, 22.0], [18.3, 20.0]]); P("drain", [[14.8, 22.3], [14.8, 20.0]]);
      P("drain", [[kd, 3.2], [kd, 13.0], [sx2, 13.0], [sx2, 20.0]]);
      P("drain", [[sx2, 20.0], [sx2, D + 2.2]], "LATERAL");
      o.access.push({ x: 20.0, y: 16.4, w: 0.4, h: 4.4, label: "WET-WALL ACCESS" });
      o.hatches.push({ x: sx2 - 0.8, y: 19.2, w: 1.6, h: 1.6, label: "STACK" }, { x: 17.0, y: 12.2, w: 1.6, h: 1.6, label: "TRUNK" });
      [[14.8, 22.3], [18.3, 22.0], [19.2, 17.4], [kd, 3.2], [hp.x + hp.w / 2, hp.y + hp.h / 2], [ur.x + 1.2, ur.y + ur.h - 0.6]].forEach(function (q) { o.leaks.push({ x: q[0], y: q[1] }); });
      o.ext.push({ k: "condenser", x: cxo - 1.2, y: D + 0.5, w: 3.0, h: 1.2, label: "HEAT PUMP" }, { k: "pedestal", x: W - T - 4.2, y: D + 0.4, w: 1.6, h: 0.9, label: "DISCONNECT, METER" }, { k: "clean", x: sx2, y: D + 2.2, r: 0.45, label: "CLEANOUT" });
    }
    return o;
  }

  /* ---------------- drawing ---------------- */
  var HEIGHT = { bed: 2, night: 2, wardrobe: 6.8, sofa: 2.8, table: 1.5, chair: 2.6, fridge: 5.8, cab: 3, range: 3, sink: 3, dw: 3, island: 3.2, stool: 2.4, dining: 2.5, dchair: 2.8, toilet: 2.6, vanity: 2.8, shower: 0.2, washer: 6.5, hpwh: 5.5, shelf: 6, mech: 7 };
  function side(back, w, h, t, m) { /* strip of thickness t along the back side, inset m */
    if (back === "N") return { x: m, y: 0, w: w - 2 * m, h: t };
    if (back === "S") return { x: m, y: h - t, w: w - 2 * m, h: t };
    if (back === "W") return { x: 0, y: m, w: t, h: h - 2 * m };
    return { x: w - t, y: m, w: t, h: h - 2 * m };
  }
  function drawItem(d, D) {
    var w = d.w, h = d.h, g = '<g transform="translate(' + f(d.x) + " " + f(D - d.y - d.h) + ')" class="fp-it">', s, k = d.k;
    function R(x, y, ww, hh, rx, cls) { return '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(ww) + '" height="' + f(hh) + '" rx="' + (rx || 0) + '" class="' + (cls || "") + '"/>'; }
    function C(cx, cy, r, cls) { return '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(r) + '" class="' + (cls || "") + '"/>'; }
    if (k === "bed") {
      g += R(0, 0, w, h, 0.15);
      var pw = 0.9, long = w > h; /* long side = bed length */
      s = side(d.back, w, h, 0.9, 0.3);
      if (long) { g += R(s.x, s.y + 0.2, s.w, 1.7, 0.2, "fp-d2"); g += R(s.x, h - 1.9, s.w, 1.7, 0.2, "fp-d2"); } else { g += R(0.2, 0.2, 1.7, 1.7, 0.2, "fp-d2"); }
      if (long) { var bx = d.back === "W" ? 0.2 : w - 1.2; g += R(bx, 0.35, 1.0, 1.9, 0.25, "fp-d2") + R(bx, h - 2.25, 1.0, 1.9, 0.25, "fp-d2"); var fx = d.back === "W" ? w * 0.45 : w * 0.55; g += '<line x1="' + f(fx) + '" y1="0.1" x2="' + f(fx) + '" y2="' + (h - 0.1) + '" class="fp-d2"/>'; }
      else { var by = d.back === "N" ? 0.2 : h - 1.2; g += R(0.35, by, 1.9, 1.0, 0.25, "fp-d2") + R(w - 2.25, by, 1.9, 1.0, 0.25, "fp-d2"); }
    } else if (k === "night" || k === "table" && d.shape === "coffee") g += R(0, 0, w, h, 0.1);
    else if (k === "sofa") { g += R(0, 0, w, h, 0.25); s = side(d.back, w, h, 0.75, 0); g += R(s.x, s.y, s.w, s.h, 0.2, "fp-d2"); g += '<line x1="' + f(w / 3) + '" y1="' + (d.back === "N" ? 0.8 : 0.1) + '" x2="' + f(w / 3) + '" y2="' + (d.back === "N" ? h - 0.1 : h - 0.8) + '" class="fp-d2"/><line x1="' + f(2 * w / 3) + '" y1="' + (d.back === "N" ? 0.8 : 0.1) + '" x2="' + f(2 * w / 3) + '" y2="' + (d.back === "N" ? h - 0.1 : h - 0.8) + '" class="fp-d2"/>'; }
    else if (k === "chair") { g += R(0, 0, w, h, 0.4); g += R(0.15, 0.15, w - 0.3, 0.6, 0.2, "fp-d2"); }
    else if (k === "dining") g += d.shape === "round" ? C(w / 2, h / 2, w / 2) : R(0, 0, w, h, 0.1);
    else if (k === "dchair" || k === "stool") g += d.shape === "round" ? C(w / 2, h / 2, w / 2) : R(0, 0, w, h, 0.25);
    else if (k === "island") { g += R(0, 0, w, h, 0.08); g += R(0.15, 0.15, w - 0.3, h - 0.3, 0.05, "fp-d2"); }
    else if (k === "wardrobe") { g += R(0, 0, w, h); g += '<line x1="0" y1="0" x2="' + f(w) + '" y2="' + f(h) + '" class="fp-d2"/><line x1="' + f(w) + '" y1="0" x2="0" y2="' + f(h) + '" class="fp-d2"/>'; }
    else if (k === "cab") g += R(0, 0, w, h);
    else if (k === "fridge") { g += R(0, 0, w, h, 0.1); g += '<text x="' + f(w / 2) + '" y="' + f(h / 2 + 0.25) + '" text-anchor="middle" class="fp-t">REF</text>'; }
    else if (k === "range") {
      g += R(0, 0, w, h); var q = Math.min(w, h) / 4, cx0 = w / 2, cy0 = h / 2, o = Math.min(w, h) * 0.22;
      [[-o, -o], [o, -o], [-o, o], [o, o]].forEach(function (p) { g += C(cx0 + p[0], cy0 + p[1], q * 0.7, "fp-d2"); });
    } else if (k === "sink") { g += R(0, 0, w, h); g += w > h ? R(0.35, 0.35, w - 0.7, h - 0.7, 0.2, "fp-d2") : R(0.35, 0.35, w - 0.7, h - 0.7, 0.2, "fp-d2"); g += C(w / 2, h / 2, 0.12, "fp-d2"); }
    else if (k === "dw") { g += R(0, 0, w, h); g += '<text x="' + f(w / 2) + '" y="' + f(h / 2 + 0.2) + '" text-anchor="middle" class="fp-t">DW</text>'; }
    else if (k === "toilet") { /* tank on the back side, bowl toward the room */
      var tk = side(d.back, w, h, 0.75, 0.05); g += R(tk.x, tk.y, tk.w, tk.h, 0.1);
      var bcx = w / 2, bcy = d.back === "N" ? 0.75 + (h - 0.75) / 2 : (h - 0.75) / 2;
      g += '<ellipse cx="' + f(bcx) + '" cy="' + f(bcy) + '" rx="' + f(w / 2 - 0.05) + '" ry="' + f((h - 0.75) / 2 - 0.02) + '" class=""/>';
    } else if (k === "vanity") { g += R(0, 0, w, h, 0.05); var vv = w < h; g += vv ? '<ellipse cx="' + f(w / 2) + '" cy="' + f(h / 2) + '" rx="' + f(w / 2 - 0.3) + '" ry="0.6" class="fp-d2"/>' : '<ellipse cx="' + f(w / 2) + '" cy="' + f(h / 2) + '" rx="0.6" ry="' + f(h / 2 - 0.3) + '" class="fp-d2"/>'; if (vv) g += ""; g += ""; }
    else if (k === "shower") { g += R(0, 0, w, h); g += '<line x1="0" y1="0" x2="' + f(w) + '" y2="' + f(h) + '" class="fp-d2"/>' + C(w / 2, h / 2, 0.22, "fp-d2"); }
    else if (k === "washer") { g += R(0, 0, w, h, 0.1); g += C(w / 2, h / 2, Math.min(w, h) * 0.32, "fp-d2"); g += '<text x="' + f(w / 2) + '" y="' + f(h / 2 + 0.22) + '" text-anchor="middle" class="fp-t">W/D</text>'; }
    else if (k === "hpwh") { g += C(w / 2, h / 2, w / 2 - 0.05); g += '<text x="' + f(w / 2) + '" y="' + f(h / 2 + 0.2) + '" text-anchor="middle" class="fp-t">HPWH</text>'; }
    else if (k === "mech") { g += R(0, 0, w, h, 0.05); g += '<text x="' + f(w / 2) + '" y="' + f(h / 2 + 0.2) + '" text-anchor="middle" class="fp-t">MECH</text>'; }
    else g += R(0, 0, w, h);
    return g + "</g>";
  }

  /* door symbol: opening gap + leaf + swing arc, or two bifold leaves. Returns svg. */
  function drawDoor(d, D) {
    var P = function (x, y) { return [f(x), f(D - y)]; }, out = "", a, b, hx, hy, fx, fy, lx, ly;
    if (d.ax === "h") { /* spans x..x+w at y; swings in +/-y */
      var x0 = d.x, x1 = d.x + d.w, y = d.y;
      out += '<rect x="' + f(x0) + '" y="' + f(D - y - 0.2) + '" width="' + d.w + '" height="0.4" class="fp-open"/>';
      if (d.type === "bifold") {
        var m = (x0 + x1) / 2, dy = d.dir * d.w * 0.28;
        a = P(x0, y); b = P(m, y + dy); var c = P(x1, y);
        return out + '<polyline points="' + a + " " + b + " " + c + '" class="fp-leaf"/>';
      }
      hx = d.hinge === "L" ? x0 : x1; fx = d.hinge === "L" ? x1 : x0; hy = y; fy = y; lx = hx; ly = y + d.dir * d.w;
    } else { /* spans y..y+w at x; swings in +/-x */
      var ya = d.y, yb = d.y + d.w, x = d.x;
      out += '<rect x="' + f(x - 0.2) + '" y="' + f(D - yb) + '" width="0.4" height="' + d.w + '" class="fp-open"/>';
      if (d.type === "bifold") {
        var mm = (ya + yb) / 2, dx = d.dir * d.w * 0.28, a2 = P(x, ya), b2 = P(x + dx, mm), c2 = P(x, yb);
        return out + '<polyline points="' + a2 + " " + b2 + " " + c2 + '" class="fp-leaf"/>';
      }
      hy = d.hinge === "L" ? ya : yb; fy = d.hinge === "L" ? yb : ya; hx = x; fx = x; lx = x + d.dir * d.w; ly = hy;
    }
    var H0 = P(hx, hy), F0 = P(fx, fy), L0 = P(lx, ly);
    var ax = F0[0] - H0[0], ay = F0[1] - H0[1], bx = L0[0] - H0[0], by = L0[1] - H0[1], sweep = ax * by - ay * bx > 0 ? 1 : 0;
    return out + '<line x1="' + H0[0] + '" y1="' + H0[1] + '" x2="' + L0[0] + '" y2="' + L0[1] + '" class="fp-leaf"/><path d="M' + F0[0] + " " + F0[1] + "A" + d.w + " " + d.w + " 0 0 " + sweep + " " + L0[0] + " " + L0[1] + '" class="fp-swing"/>';
  }


  var MC = { cold: "#4aa8ff", hot: "#ff7a4a", drain: "#b8925e", pwr: "#ffc94a", data: "#5ee08a", ref: "#ff5fd0", air: "#8fd3d8" };
  function drawMep(m, D) {
    var o = [], Y = function (y) { return f(D - y); };
    function line(pts, cls) { return '<polyline points="' + pts.map(function (q) { return f(q[0]) + " " + Y(q[1]); }).join(" ") + '" class="' + cls + '"/>'; }
    o.push('<g class="mep">');
    m.hatches.forEach(function (h) { o.push('<rect x="' + f(h.x) + '" y="' + Y(h.y + h.h) + '" width="' + h.w + '" height="' + h.h + '" class="mep-hatch"/><line x1="' + f(h.x) + '" y1="' + Y(h.y + h.h) + '" x2="' + f(h.x + h.w) + '" y2="' + Y(h.y) + '" class="mep-hatch"/><line x1="' + f(h.x + h.w) + '" y1="' + Y(h.y + h.h) + '" x2="' + f(h.x) + '" y2="' + Y(h.y) + '" class="mep-hatch"/>'); });
    m.air.forEach(function (a) { o.push(line(a, "mep-air")); });
    m.ref.forEach(function (a) { o.push(line(a, "mep-ref")); });
    o.push(line(m.tray, "mep-tray")); o.push(line(m.tray, "mep-pwr")); o.push(line(m.dtray, "mep-data"));
    m.drops.forEach(function (d) { o.push(line([[d.sx, d.sy], [d.x, d.y]], "mep-pwr thin") + line([[d.sx + 0.3, d.sy], [d.x + 0.3, d.y]], "mep-data thin") + '<circle cx="' + f(d.x + 0.15) + '" cy="' + Y(d.y) + '" r=".32" class="mep-jb"/>'); });
    m.pipes.forEach(function (q) { o.push(line(q.pts, "mep-" + q.sys)); });
    m.access.forEach(function (a) { o.push('<rect x="' + f(a.x) + '" y="' + Y(a.y + a.h) + '" width="' + a.w + '" height="' + a.h + '" class="mep-acc"/>'); });
    m.equip.forEach(function (e) {
      if (e.k === "hpwh") o.push('<circle cx="' + f(e.x) + '" cy="' + Y(e.y) + '" r="' + f(e.r) + '" class="mep-eq hot"/>');
      else o.push('<rect x="' + f(e.x) + '" y="' + Y(e.y + e.h) + '" width="' + e.w + '" height="' + e.h + '" class="mep-eq ' + (e.k === "panel" ? "pwr" : e.k === "rack" ? "data" : "air") + '"' + (e.dashed ? ' stroke-dasharray=".25 .2"' : "") + "/>");
    });
    m.heads.forEach(function (h) { o.push('<rect x="' + f(h.x - h.w / 2) + '" y="' + Y(h.y + h.h / 2) + '" width="' + h.w + '" height="' + h.h + '" rx=".15" class="mep-eq ref"/>'); });
    m.leaks.forEach(function (q) { o.push('<circle cx="' + f(q.x) + '" cy="' + Y(q.y) + '" r=".2" class="mep-leak"/>'); });
    m.ext.forEach(function (e) {
      if (e.k === "clean") o.push('<circle cx="' + f(e.x) + '" cy="' + Y(e.y) + '" r="' + e.r + '" class="mep-eq drain"/>');
      else o.push('<rect x="' + f(e.x) + '" y="' + Y(e.y + e.h) + '" width="' + e.w + '" height="' + e.h + '" rx=".1" class="mep-eq ' + (e.k === "condenser" ? "ref" : "pwr") + '"/>');
    });
    var tag = function (x, y, t) { return '<text x="' + f(x) + '" y="' + Y(y) + '" class="mep-t" text-anchor="middle">' + t + "</text>"; };
    m.equip.forEach(function (e) { if (e.k === "hpwh") o.push(tag(e.x, e.y - 0.15, e.label)); if (e.k === "erv") o.push(tag(e.x + e.w / 2, e.y + e.h / 2 - 0.15, e.label)); });
    m.ext.forEach(function (e) { o.push(tag(e.x + (e.w ? e.w / 2 : 0), e.y + (e.h ? e.h + 0.3 : 0.9), e.label)); });
    m.access.forEach(function (a) { o.push(tag(a.x + a.w + 1.6, a.y + a.h / 2, "ACCESS")); });
    o.push("</g>");
    return o.join("");
  }
  var LEGEND = [["pwr", "Power raceway"], ["data", "Data and low voltage"], ["cold", "Cold water"], ["hot", "Hot water"], ["drain", "Drain and vent"], ["ref", "Refrigerant"], ["air", "Fresh air and exhaust"]];
  var MEPNOTES = [
    ["One mechanical core", "Heat pump water heater, electrical panel, network rack, ventilation unit and the water manifold sit behind one door. Nothing important is above a ceiling, in a crawlspace or behind a finished wall."],
    ["Service ceiling", "A continuous raceway runs the width of the unit above the hall line, with hinged ceiling tiles. Power, data, refrigerant and air each have their own lane, each with spare capacity. New circuits and cables are pulled, not fished."],
    ["Wet wall", "Supply piping runs in a pre-plumbed wall behind a full-height removable panel on the dry side. A manifold with a shut-off for every fixture, so one fixture can be isolated without closing the house."],
    ["Floor zone", "Drains run in the floor cassette below the finished floor with hatches at the stack and at each junction, and a cleanout outside the wall. A fall of \u00bc\u2033 per foot is kept everywhere."],
    ["Monitored", "Leak sensors under each fixture and the water heater, with an automatic main shut-off. Every line is colour coded and tagged, and the as-built is delivered as a model with the unit."],
    ["Outside", "Heat pump, disconnect, meter, hose bib and sewer cleanout stand on one service side, 3 ft clear. Spare 2\u2033 conduit goes from the panel to the roof for solar and battery."]
  ];
  function mepHtml() {
    var h = '<div class="mepx"><small>Services</small><div class="mep-leg">';
    LEGEND.forEach(function (l) { h += '<span><i style="background:' + MC[l[0]] + '"></i>' + l[1] + "</span>"; });
    h += '<span><i class="acc"></i>Access panel or hatch</span><span><i class="lk"></i>Leak sensor</span></div><div class="mep-notes">';
    MEPNOTES.forEach(function (n) { h += "<p><b>" + n[0] + ".</b> " + n[1] + "</p>"; });
    h += '<p class="cc-src">Working clearance of 36 in deep by 30 in wide in front of the panel and no panel in a bathroom or clothes closet (NEC 110.26, 240.24). Routes shown are typical and schematic; the electrician, plumber and mechanical engineer fix the final sizes.</p></div></div>';
    return h;
  }

  /* p: params incl. width, depth, openings. opts: {dims:true, labels:true, deck:true, furn:true} */
  function svg(p, opts) {
    opts = opts || {}; var W = p.width, D = p.depth, L = layout(W, D), pad = opts.dims === false ? 2 : 5, deckD = opts.deck === false ? 0 : 8, out = [];
    function Y(y) { return f(D - y); }
    out.push('<svg class="fplan" viewBox="' + (-pad) + " " + (-pad) + " " + (W + 2 * pad) + " " + (D + deckD + 2 * pad) + '" role="img" aria-label="Floor plan with furniture, ' + ftin(W) + " by " + ftin(D) + '" xmlns="http://www.w3.org/2000/svg">');
    out.push('<rect x="0" y="0" width="' + W + '" height="' + D + '" class="fp-floor"/>');
    if (opts.deck !== false) out.push('<rect x="-0.5" y="' + D + '" width="' + (W + 1) + '" height="' + deckD + '" class="fp-deck"/>');
    L.parts.forEach(function (s) { out.push('<line x1="' + f(s[0]) + '" y1="' + Y(s[1]) + '" x2="' + f(s[2]) + '" y2="' + Y(s[3]) + '" class="fp-int"/>'); });
    if (opts.furn !== false) { out.push(opts.mep ? '<g class="fp-fade">' : "<g>"); L.items.forEach(function (d) { out.push(drawItem(d, D)); }); out.push("</g>"); }
    out.push('<path d="M0 0H' + W + 'V' + D + 'H0Z M' + T + ' ' + T + 'V' + f(D - T) + 'H' + f(W - T) + 'V' + T + 'Z" fill-rule="evenodd" class="fp-wall"/>');
    var wallGeom = {
      front: function (o) { return { x: o.offset, y: D - T, w: o.width, h: T, horiz: true }; },
      back: function (o) { return { x: W - o.offset - o.width, y: 0, w: o.width, h: T, horiz: true }; },
      right: function (o) { return { x: W - T, y: D - o.offset - o.width, w: T, h: o.width, horiz: false }; },
      left: function (o) { return { x: 0, y: o.offset, w: T, h: o.width, horiz: false }; }
    };
    p.openings.forEach(function (o) {
      var g = wallGeom[o.wall](o); if (!g) return;
      var x = g.x, y = g.y, w = g.w, h = g.h;
      out.push('<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(h) + '" class="fp-open"/>');
      if (o.type !== "door") {
        if (g.horiz) out.push('<line x1="' + f(x) + '" y1="' + f(y + h / 2 - 0.08) + '" x2="' + f(x + w) + '" y2="' + f(y + h / 2 - 0.08) + '" class="fp-glass"/><line x1="' + f(x) + '" y1="' + f(y + h / 2 + 0.08) + '" x2="' + f(x + w) + '" y2="' + f(y + h / 2 + 0.08) + '" class="fp-glass"/>');
        else out.push('<line x1="' + f(x + w / 2 - 0.08) + '" y1="' + f(y) + '" x2="' + f(x + w / 2 - 0.08) + '" y2="' + f(y + h) + '" class="fp-glass"/><line x1="' + f(x + w / 2 + 0.08) + '" y1="' + f(y) + '" x2="' + f(x + w / 2 + 0.08) + '" y2="' + f(y + h) + '" class="fp-glass"/>');
      } else if (o.wall === "left") { /* west entry: swings in, hinged at the front end */
        out.push('<path d="M' + f(x + w) + " " + f(y) + 'A' + h + " " + h + " 0 0 1 " + f(x + w + h) + " " + f(y + h) + '" class="fp-swing"/><line x1="' + f(x + w) + '" y1="' + f(y + h) + '" x2="' + f(x + w + h) + '" y2="' + f(y + h) + '" class="fp-leaf"/>');
      } else { /* entry: swings in, hinged on the left jamb */
        out.push('<path d="M' + f(x) + " " + f(y) + "v" + f(-w) + 'A' + w + " " + w + " 0 0 1 " + f(x + w) + " " + f(y) + '" class="fp-swing"/><line x1="' + f(x) + '" y1="' + f(y) + '" x2="' + f(x) + '" y2="' + f(y - w) + '" class="fp-leaf"/>');
      }
    });
    L.doors.forEach(function (d) { out.push(drawDoor(d, D)); });
    if (opts.mep) out.push(drawMep(mep(W, D), D));
    if (opts.labels !== false) L.rooms.forEach(function (r) {
      var cx = r.x + r.w / 2, cy = D - (r.y + r.h / 2), small = r.w < 9 || r.h < 8, nm = r.name;
      if (r.lx) { cx = r.lx; cy = D - r.ly; small = true; }
      if (r.name === "LIVING / SLEEPING") { cx = 12.8; cy = D - 10.9; }
      if (r.name === "LIVING / KITCHEN") { if (D < 24) { cx = 15.2; cy = D - 7.2; } else { cx = 8.2; cy = D - (D - 9 - 1.3); } }
      out.push('<text x="' + f(cx) + '" y="' + f(cy) + '" class="fp-room' + (small ? " sm" : "") + '" text-anchor="middle">' + nm + '</text>');
      var ar = r.area || r.w * r.h; out.push('<text x="' + f(cx) + '" y="' + f(cy + (small ? 1.2 : 1.5)) + '" class="fp-sf" text-anchor="middle">' + Math.round(ar) + ' sf</text>');
    });
    if (opts.deck !== false) out.push('<text x="' + f(W / 2) + '" y="' + f(D + deckD / 2 + 0.6) + '" class="fp-room sm" text-anchor="middle">DECK</text>');
    if (opts.dims !== false) {
      out.push('<g class="fp-dim"><line x1="0" y1="' + f(-2.2) + '" x2="' + W + '" y2="' + f(-2.2) + '"/><text x="' + f(W / 2) + '" y="' + f(-2.8) + '" text-anchor="middle">' + ftin(W) + '</text>');
      out.push('<line x1="' + f(W + 2.2) + '" y1="0" x2="' + f(W + 2.2) + '" y2="' + D + '"/><text x="' + f(W + 3) + '" y="' + f(D / 2) + '" transform="rotate(90 ' + f(W + 3) + " " + f(D / 2) + ')" text-anchor="middle">' + ftin(D) + '</text></g>');
    }
    out.push("</svg>");
    return out.join("");
  }

  /* ---------------- preliminary code check ---------------- */
  function rectsOverlap(a, b, m) { m = m || 0; return a.x < b.x + b.w - m && b.x < a.x + a.w - m && a.y < b.y + b.h - m && b.y < a.y + a.h - m; }
  function doorRect(d) {
    if (d.type === "bifold") return d.ax === "h" ? { x: d.x, y: Math.min(d.y, d.y + d.dir * 1.5), w: d.w, h: 1.5 } : { x: Math.min(d.x, d.x + d.dir * 1.5), y: d.y, w: 1.5, h: d.w };
    return d.ax === "h" ? { x: d.x, y: Math.min(d.y, d.y + d.dir * d.w), w: d.w, h: d.w } : { x: Math.min(d.x, d.x + d.dir * d.w), y: d.y, w: d.w, h: d.w };
  }
  /* Free clear distance from a point along a direction to the nearest obstruction (room walls or other fixtures). */
  function turnCircle(room, items, d) {
    var r = d / 2, best = false;
    for (var cx = room.x + r; cx <= room.x + room.w - r + 1e-6 && !best; cx += 0.25)
      for (var cy = room.y + r; cy <= room.y + room.h - r + 1e-6 && !best; cy += 0.25) {
        var ok = true;
        for (var i = 0; i < items.length && ok; i++) { var q = items[i]; if (q.room !== room.name) continue;
          var nx = Math.max(q.x, Math.min(cx, q.x + q.w)), ny = Math.max(q.y, Math.min(cy, q.y + q.h));
          if ((nx - cx) * (nx - cx) + (ny - cy) * (ny - cy) < r * r - 1e-6) ok = false; }
        if (ok) best = true;
      }
    return best;
  }
  function check(p) {
    var W = p.width, D = p.depth, L = layout(W, D), rows = [], ops = p.openings, hgt = p.wall_height;
    function row(group, name, req, have, status, note) { rows.push({ group: group, name: name, req: req, have: have, status: status, note: note || "" }); }
    var sf = function (v) { return Math.round(v) + " sf"; };
    L.rooms.filter(function (r) { return r.hab; }).forEach(function (r) {
      var area = r.area || r.w * r.h, md = r.kind === "living" ? (L.studio ? 7.5 : 14.3) : Math.min(r.w, r.h), glz = 0, opn = 0, eg = null;
      ops.forEach(function (o) {
        var rn = o.room || ""; if (o.type !== "window" || rn.indexOf(r.name) !== 0 && !(r.kind === "living" && rn === "LIVING")) return;
        var a = o.width * o.height; glz += a; opn += a * (o.op || 0.5); if (o.egress) eg = o;
      });
      var nm = r.name;
      row(nm, "Floor area", "≥ 70 sf (R304.1)", sf(area), area >= 70 ? "ok" : "fail");
      row(nm, "Least dimension", "≥ 7'-0\" (R304.2)", ftin(md), md >= 7 ? "ok" : "fail");
      row(nm, "Daylight, glazing", "≥ 8% of floor (R303.1) = " + sf(area * 0.08), sf(glz) + " (" + Math.round(glz / area * 100) + "%)", glz >= area * 0.08 ? "ok" : "fail");
      row(nm, "Ventilation, openable", "≥ 4% of floor (R303.1) = " + sf(area * 0.04), sf(opn) + " (" + Math.round(opn / area * 100) + "%)", opn >= area * 0.04 ? "ok" : "fail");
      if (r.kind === "bedroom") {
        var net = eg ? (eg.width - 0.25) * (eg.height - 0.25) : 0, okE = eg && net >= 5.7 && eg.height - 0.25 >= 2 && eg.width - 0.25 >= 20 / 12 && eg.sill <= 44 / 12 + 1e-6;
        row(nm, "Escape and rescue opening", "≥ 5.7 sf net, ≥ 24\" high, ≥ 20\" wide, sill ≤ 44\" (R310)", eg ? net.toFixed(1) + " sf net, sill " + Math.round(eg.sill * 12) + "\"" : "none", okE ? "ok" : "fail");
      }
    });
    L.studio && row("LIVING / SLEEPING", "Sleeping area exit", "Exterior door in the room (R310.1 exception)", "3'-0\" entry door", "ok", "Studios sleep in the living room; the entry door serves as the escape opening.");
    /* bath */
    var bath = L.rooms.filter(function (r) { return r.kind === "bath"; })[0], tl = L.items.filter(function (i) { return i.k === "toilet"; })[0], sh = L.items.filter(function (i) { return i.k === "shower"; })[0];
    if (bath && tl) {
      var cx = tl.x + tl.w / 2, left = cx - bath.x, right = bath.x + bath.w - cx;
      L.items.forEach(function (q) { if (q === tl || q.room !== "BATH") return; if (q.y < tl.y + tl.h && q.y + q.h > tl.y) { if (q.x + q.w <= cx) left = Math.min(left, cx - (q.x + q.w)); else if (q.x >= cx) right = Math.min(right, q.x - cx); } });
      var fr = tl.y - (bath.y); L.items.forEach(function (q) { if (q.room !== "BATH" || q === tl) return; if (q.x < cx + 1.25 && q.x + q.w > cx - 1.25 && q.y + q.h <= tl.y) fr = Math.min(fr, tl.y - (q.y + q.h)); });
      var okT = left >= 1.25 && right >= 1.25 && fr >= 1.75;
      row("BATH", "Toilet clearance", "15\" centreline to wall or fixture, 21\" in front (R307.1)", Math.round(Math.min(left, right) * 12) + "\" sides, " + Math.round(fr * 12) + "\" front", okT ? "ok" : "fail");
    }
    if (sh) row("BATH", "Shower size", "≥ 30\" × 30\" interior, ≥ 900 sq in (R307.2)", Math.round(sh.w * 12) + "\" × " + Math.round(sh.h * 12) + "\"", sh.w >= 2.5 && sh.h >= 2.5 && sh.w * sh.h * 144 >= 900 ? "ok" : "fail");
    var bw2 = ops.filter(function (o) { return o.room === "BATH"; }).reduce(function (s, o) { return s + o.width * o.height; }, 0);
    row("BATH", "Light and air", "Window ≥ 3 sf (1.5 sf openable), or exhaust fan 50 cfm (R303.3)", bw2.toFixed(0) + " sf window + exhaust fan", bw2 >= 3 ? "ok" : "check");
    /* general */
    var swingHits = [], ovl = [];
    L.doors.forEach(function (d) { var dr = doorRect(d); L.items.forEach(function (q) { if (rectsOverlap(dr, q, 0.05) && q.room === d.room) swingHits.push(d.room + ": " + q.k); }); });
    for (var i = 0; i < L.items.length; i++) for (var j = i + 1; j < L.items.length; j++) if (rectsOverlap(L.items[i], L.items[j], 0.05)) ovl.push(L.items[i].k + "/" + L.items[j].k);
    row("GENERAL", "Furniture and door swings clear", "Nothing overlaps; doors open fully", swingHits.length + ovl.length === 0 ? "no conflicts" : (swingHits.concat(ovl)).join(", "), swingHits.length + ovl.length === 0 ? "ok" : "fail");
    row("GENERAL", "Ceiling height", "≥ 7'-0\" habitable, 6'-4\" bath or kitchen at lowest point (R305)", ftin(hgt) + " wall" + (p.roof === "shed" ? ", rising" : ""), hgt >= 7 ? "ok" : "fail");
    row("GENERAL", "Entry door", "≥ 3'-0\" × 6'-8\" (R311.2)", "3'-0\" × 7'-0\"", "ok");
    row("GENERAL", "Interior doors", "Bedroom and bath 32\" clear is good practice, 30\" min", "2'-8\" to 3'-0\" nominal", "ok");
    /* accessibility: advisory */
    var bd = L.doors.filter(function (d) { return d.room === "BATH"; })[0], circ = bath ? turnCircle(bath, L.items, 5) : false;
    row("ACCESS", "Bath door", "≥ 32\" clear (accessible-ready)", bd ? Math.round(bd.w * 12) - 4 + "\" clear" : "—", bd && bd.w >= 2.9 ? "ok" : "check");
    row("ACCESS", "Bath turning space", "5'-0\" circle, if you want a fully accessible bath", circ ? "fits" : "does not fit", circ ? "ok" : "check", circ ? "" : "Not required for a private ADU; the 2-bedroom plan or a custom bath can provide it.");
    row("ACCESS", "Entry", "Step-free path to the door, low threshold (accessible-ready)", "Depends on the site and the foundation", "check");
    return { rows: rows, studio: L.studio };
  }

  /* static notes shown with the table: law as of the research date; confirm with the local building department */
  var NOTES = [
    { t: "Solar", s: "California", d: "The 2022 and 2025 Energy Codes require rooftop solar on new detached ADUs, with exceptions (solar access, size, local rules). Confirm with the city. Plan for roughly 2 to 4 kW on the roof, roof face clear and a service panel with room for a battery." },
    { t: "Solar", s: "Oregon", d: "The 2023 Oregon Residential Specialty Code adds solar-ready wiring or a metal raceway to new homes; check whether your city applies it to ADUs." },
    { t: "Accessibility", s: "CA and OR", d: "A single private ADU is not covered by the ADA. California Building Code Chapter 11A may apply in some cases and the sources disagree, so ask the building department. The ‘access’ rows above are good practice, not a legal finding." },
    { t: "Alarms", s: "CA and OR", d: "Smoke alarms in each bedroom and outside it, interconnected, hard-wired with battery backup (R314). Carbon monoxide alarm if any fuel-burning appliance or attached garage (R315). All-electric avoids the CO alarm." },
    { t: "Energy", s: "CA and OR", d: "Heat pump, ventilation fan in the bath and kitchen, and insulation per the local energy code. The panel frame is 2x6 at 6½″; the high-performance package adds about 2″ of exterior insulation (see Energy performance)." }
  ];
  var SRC = "Based on the 2021 IRC sections that California (CRC) and Oregon (ORSC) adopt, which is where the section numbers come from. City amendments and the edition in force (ORSC 2023, CRC 2025) can change values. This is a design aid, not a code review.";

  function checkHtml(p) {
    var c = check(p), g = {}, order = [];
    c.rows.forEach(function (r) { if (!g[r.group]) { g[r.group] = []; order.push(r.group); } g[r.group].push(r); });
    var h = '<div class="ccheck"><small>Preliminary code check (CA and OR)</small>';
    var bad = c.rows.filter(function (r) { return r.status === "fail"; }).length;
    h += '<div class="cc-sum ' + (bad ? "bad" : "good") + '">' + (bad ? bad + " item" + (bad > 1 ? "s" : "") + " to fix" : "No failures against the checks below") + "</div>";
    order.forEach(function (n) {
      h += '<div class="cc-g"><b>' + n + "</b>";
      g[n].forEach(function (r) { h += '<div class="cc-r ' + r.status + '" title="' + (r.note || r.req).replace(/"/g, "&quot;") + '"><span class="cc-i">' + (r.status === "ok" ? "✓" : r.status === "fail" ? "✕" : "!") + '</span><span class="cc-n">' + r.name + '</span><span class="cc-v">' + r.have + '</span><span class="cc-q">' + r.req + "</span></div>"; });
      h += "</div>";
    });
    h += '<div class="cc-notes">';
    NOTES.forEach(function (n) { h += "<p><b>" + n.t + ", " + n.s + ".</b> " + n.d + "</p>"; });
    h += '<p class="cc-src">' + SRC + "</p></div></div>";
    return h;
  }

  global.PLAN = { svg: svg, layout: layout, mep: mep, mepHtml: mepHtml, MC: MC, check: check, checkHtml: checkHtml, HEIGHT: HEIGHT };
})(window);
