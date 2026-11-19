/* The reference library: the 18 DADU designs in adu/units/*.json drawn as 3D models and plans, in the same dusk look as the PL units.
   Data: window.LIBDATA (compacted by build.py from adu/units). Feet, plan y up (north), front facade = lowest y (faces the camera at az -0.9).
   These are redrawn REFERENCE designs by other architects (see each unit's `source`); they are shown with credit and are not Pacific Living Solutions products. */
(function (global) {
  var T = global.THREE, A = global.ADU, FIN = A.FIN;

  function polyArea(p) { var s = 0, i, j; for (i = 0; i < p.length; i++) { j = (i + 1) % p.length; s += p[i][0] * p[j][1] - p[j][0] * p[i][1]; } return Math.abs(s) / 2; }
  function extWalls(st) { return st.walls.filter(function (w) { return w.ext; }); }
  function bboxOf(walls) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    walls.forEach(function (w) { [w.a, w.b].forEach(function (q) { var t = (w.thk_in || 6) / 24; x0 = Math.min(x0, q[0] - t); y0 = Math.min(y0, q[1] - t); x1 = Math.max(x1, q[0] + t); y1 = Math.max(y1, q[1] + t); }); });
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  function footprint(st) {
    if (st.outline && st.outline.length >= 3) return st.outline;
    var b = bboxOf(extWalls(st)); return [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
  }
  function stats(u) {
    var sf = 0, beds = 0;
    u.stories.forEach(function (st) {
      var a = polyArea(footprint(st)); sf += a;
      st.rooms.forEach(function (r) { if (/BED|BR\b|SLEEP|PRIMARY|MASTER/i.test(r.name) && !/BATH|CLOS/i.test(r.name)) beds++; });
    });
    return { sf: Math.round(sf), beds: beds, stories: u.stories.length };
  }

  var roofTexCache = {};
  function roofTex(dusk) {   /* standing-seam metal: a dark sheet with fine raised seams every 16 in */
    var key = dusk ? "d" : "n"; if (roofTexCache[key]) return roofTexCache[key];
    var c = document.createElement("canvas"); c.width = c.height = 128; var g = c.getContext("2d");
    g.fillStyle = dusk ? "#121212" : "#2b2c2e"; g.fillRect(0, 0, 128, 128);
    for (var i = 0; i < 3; i++) { var x = i * 42.67; g.fillStyle = dusk ? "#262626" : "#47494c"; g.fillRect(x, 0, 3, 128); g.fillStyle = "rgba(0,0,0,.5)"; g.fillRect(x + 3, 0, 2, 128); }
    var t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.encoding = T.sRGBEncoding; t.anisotropy = 8; roofTexCache[key] = t; return t;
  }
  function mats(fin, dusk) {
    return {
      Siding: new T.MeshStandardMaterial({ map: A.sidingTex(fin.siding), roughness: 0.8, name: "Siding" }),
      Trim: new T.MeshStandardMaterial({ color: fin.trim, roughness: 0.4, metalness: dusk ? 0.2 : 0.5, name: "Trim", envMapIntensity: 0.8 }),
      Glass: new T.MeshStandardMaterial({ color: dusk ? "#0c141c" : "#1d2b34", roughness: 0.04, metalness: dusk ? 0.2 : 0.85, transparent: true, opacity: dusk ? 0.34 : 0.55, name: "Glass", envMapIntensity: 1.4 }),
      Wood: new T.MeshStandardMaterial({ map: A.woodTex(fin.wood), roughness: 0.7, name: "Wood" }),
      Roof: new T.MeshStandardMaterial({ map: roofTex(dusk), color: 0xffffff, roughness: dusk ? 0.55 : 0.32, metalness: dusk ? 0.35 : 0.7, flatShading: true, side: T.DoubleSide, name: "Roof", envMapIntensity: 1.1 }),
      Plinth: new T.MeshStandardMaterial({ color: "#070707", roughness: 1, name: "Plinth" }),
      Int: new T.MeshStandardMaterial({ color: dusk ? "#17130f" : "#cfc8b8", roughness: 0.9, name: "Interior wall" }),
      Glow: new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, name: "Interior" })
    };
  }

  /* the roof underside height above the wall top plate at plan point (x, y) */
  function roofFn(r, b) {
    var sl = r.pitch / 12;
    if (r.type === "gable") {
      if (r.ridge === "y") { var xm = (b.x0 + b.x1) / 2; return function (x) { return (xm - Math.abs(x - xm) - b.x0) * sl; }; }
      var ym = (b.y0 + b.y1) / 2; return function (x, y) { return (ym - Math.abs(y - ym) - b.y0) * sl; };
    }
    var hs = r.high_side || "n";
    return function (x, y) { return (hs === "n" ? y - b.y0 : hs === "s" ? b.y1 - y : hs === "e" ? x - b.x0 : b.x1 - x) * sl; };
  }

  function build(u, opt) {
    opt = opt || {};
    var fin = FIN[opt.finish || "charcoal"], dusk = !!opt.dusk, M = mats(fin, dusk), g = new T.Group();
    var r = u.roof, ov = r.overhang || 1, n = u.stories.length, z0 = [], zz = 0, i;
    u.stories.forEach(function (st) { z0.push(zz); zz += st.floor_to_floor_ft; });
    var all = bboxOf([].concat.apply([], u.stories.map(extWalls)));
    var top = u.stories[n - 1], tb = bboxOf(extWalls(top)), zt = z0[n - 1] + top.plate_ft, rz = roofFn(r, tb);
    var W = all.x1 - all.x0, D = all.y1 - all.y0;
    var mk = A.mk, box = A.box;

    function wallPanel(w, st, z, isTop) {
      var dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L0 = Math.hypot(dx, dy), thk = (w.thk_in || 6) / 12, ext = !!w.ext, e = ext ? thk / 2 : 0, L = L0 + 2 * e, h = st.plate_ft - (ext ? 0 : 0.35);
      var ux = dx / L0, uy = dy / L0, ox = w.a[0] - ux * e, oy = w.a[1] - uy * e, ops = st.openings.filter(function (o) { return o.wall === w.id; });
      var prof = [[0, h], [L, h]];
      if (isTop && ext) {   /* the wall follows the roof underside, so gable ends and the tall side of a shed are closed */
        var ts = [0, 1];
        if (r.type === "gable") {   /* the ridge crosses this wall where the wall runs across it */
          var alongX = r.ridge === "y", d0 = alongX ? ux : uy, tm = alongX ? (tb.x0 + tb.x1) / 2 - ox : (tb.y0 + tb.y1) / 2 - oy;
          if (Math.abs(d0) > 1e-6) { var t = tm / (d0 * L); if (t > 0.01 && t < 0.99) ts.push(t); }
        }
        ts.sort(function (a, b) { return a - b; });
        prof = ts.map(function (t) { return [t * L, h + Math.max(0, rz(ox + ux * L * t, oy + uy * L * t))]; });
      }
      var sh = new T.Shape(); sh.moveTo(0, 0); sh.lineTo(L, 0);
      for (i = prof.length - 1; i >= 0; i--) sh.lineTo(prof[i][0], prof[i][1]);
      sh.closePath();
      ops.forEach(function (o) {
        var x = o.offset + e, y0 = o.type === "window" || o.type === "slider" ? Math.max(o.sill || 0, 0.1) : 0.001, hh = Math.min(o.height, h - y0 - 0.15), ww = Math.min(o.width, L - x - 0.02);
        var ho = new T.Path(); ho.moveTo(x, y0); ho.lineTo(x + ww, y0); ho.lineTo(x + ww, y0 + hh); ho.lineTo(x, y0 + hh); ho.closePath(); sh.holes.push(ho);
      });
      var geo = new T.ExtrudeGeometry(sh, { depth: thk, bevelEnabled: false }); geo.translate(0, 0, -thk / 2);
      var wg = new T.Group(); wg.add(mk(geo, ext ? [M.Siding, M.Trim] : M.Int, ext ? "Wall" : "Partition", !ext));
      if (ext) ops.forEach(function (o) {
        var x = o.offset + e, y0 = o.type === "window" || o.type === "slider" ? Math.max(o.sill || 0, 0.1) : 0.001, hh = Math.min(o.height, h - y0 - 0.15), ww = Math.min(o.width, L - x - 0.02);
        var cx = x + ww / 2, cy = y0 + hh / 2, fw = 0.09, zc = 0;
        if (o.type === "window" || o.type === "slider") {
          var gl = new T.Mesh(new T.PlaneGeometry(ww, hh), M.Glass); gl.position.set(cx, cy, zc); gl.name = "Glass"; wg.add(gl);
          wg.add(box(ww, fw, 0.28, M.Trim, cx, y0 + fw / 2, zc)); wg.add(box(ww, fw, 0.28, M.Trim, cx, y0 + hh - fw / 2, zc));
          wg.add(box(fw, hh, 0.28, M.Trim, x + fw / 2, cy, zc)); wg.add(box(fw, hh, 0.28, M.Trim, x + ww - fw / 2, cy, zc));
          var nn = o.type === "slider" ? 2 : (ww > 5 ? 3 : ww > 3.4 ? 2 : 1); for (var k2 = 1; k2 < nn; k2++) wg.add(box(0.07, hh, 0.22, M.Trim, x + ww * k2 / nn, cy, zc));
        } else if (o.type === "door") {
          wg.add(box(ww - 0.12, hh - 0.06, 0.18, M.Wood, cx, cy - 0.02, -thk * 0.1));
          wg.add(box(0.05, 1.1, 0.06, M.Trim, x + (o.hinge === "a" ? ww - 0.42 : 0.42), 3.2, -thk * 0.1 + 0.13));
        } else if (o.type === "garage") {
          wg.add(box(ww - 0.1, hh - 0.05, 0.16, M.Siding, cx, cy, 0));
          for (var k3 = 1; k3 < 4; k3++) wg.add(box(ww - 0.1, 0.04, 0.2, M.Trim, cx, y0 + hh * k3 / 4, 0));
        }
      });
      var ang = Math.atan2(dy, dx), X = new T.Vector3(ux, uy, 0), Y = new T.Vector3(0, 0, 1), Z = new T.Vector3(uy, -ux, 0);
      var mx = new T.Matrix4().makeBasis(X, Y, Z); mx.setPosition(ox, oy, z); wg.applyMatrix4(mx); return wg;
    }

    function polyShape(pts, ins) {
      var s = new T.Shape(); pts.forEach(function (q, k) { if (k) s.lineTo(q[0], q[1]); else s.moveTo(q[0], q[1]); }); s.closePath(); return s;
    }

    u.stories.forEach(function (st, si) {
      var fp = footprint(st), b = bboxOf(extWalls(st)), z = z0[si], ih = st.plate_ft - 0.1;
      /* lit interior seen through the glass */
      var gs = polyShape(fp), ig = new T.ExtrudeGeometry(gs, { depth: ih, bevelEnabled: false }), pos = ig.attributes.position, col = [], lo = dusk ? [0.55, 0.28, 0.08] : [0.55, 0.55, 0.52], hi = dusk ? [1.0, 0.72, 0.38] : [0.9, 0.9, 0.86], k;
      for (k = 0; k < pos.count; k++) { var t = pos.getZ(k) / ih; col.push(lo[0] + (hi[0] - lo[0]) * t, lo[1] + (hi[1] - lo[1]) * t, lo[2] + (hi[2] - lo[2]) * t); }
      ig.setAttribute("color", new T.Float32BufferAttribute(col, 3));
      var cx0 = (b.x0 + b.x1) / 2, cy0 = (b.y0 + b.y1) / 2, sxs = (b.x1 - b.x0 - 1.2) / (b.x1 - b.x0), sys = (b.y1 - b.y0 - 1.2) / (b.y1 - b.y0);
      var im = new T.Mesh(ig, M.Glow); im.scale.set(sxs, sys, 1); im.position.set(cx0 - cx0 * sxs, cy0 - cy0 * sys, z + 0.05); im.name = "Interior"; im.userData.noexport = true; g.add(im);
      /* floor plate band between storeys, plinth under the ground floor */
      if (si > 0) { var fl = mk(new T.ExtrudeGeometry(polyShape(fp), { depth: 0.8, bevelEnabled: false }), M.Trim, "Floor"); fl.position.set(0, 0, z - 0.8); g.add(fl); }
      else { var pl = mk(new T.ExtrudeGeometry(polyShape(fp), { depth: 0.5, bevelEnabled: false }), M.Plinth, "Plinth", true); pl.scale.set(0.985, 0.985, 1); pl.position.set(cx0 - cx0 * 0.985, cy0 - cy0 * 0.985, -0.5); g.add(pl); }
      st.walls.forEach(function (w) { g.add(wallPanel(w, st, z, si === n - 1)); });
      /* lower roof where the ground floor is wider than the storey above */
      if (si < n - 1) {
        var ub = bboxOf(extWalls(u.stories[si + 1]));
        if ((b.x1 - b.x0) * (b.y1 - b.y0) > (ub.x1 - ub.x0) * (ub.y1 - ub.y0) * 1.08) {
          var cap = mk(new T.ExtrudeGeometry(polyShape(fp), { depth: 0.45, bevelEnabled: false }), M.Roof, "Roof"); cap.position.set(0, 0, z + st.plate_ft); g.add(cap);
        }
      }
    });

    /* roof over the top storey */
    var RT = 0.5, x0 = tb.x0 - ov, x1 = tb.x1 + ov, y0 = tb.y0 - ov, y1 = tb.y1 + ov;
    function slab(pts) {
      var geo = new T.BufferGeometry(), v = [], uv = [];
      pts.forEach(function (q) { v.push(q[0], q[1], q[2] + RT); uv.push(q[0] / 4, q[1] / 4); });
      pts.forEach(function (q) { v.push(q[0], q[1], q[2]); uv.push(q[0] / 4, q[1] / 4); });
      geo.setAttribute("position", new T.Float32BufferAttribute(v, 3)); geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
      geo.setIndex([4, 6, 5, 4, 7, 6, 0, 1, 2, 0, 2, 3, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]);
      geo.addGroup(0, 6, 0); geo.addGroup(6, 30, 1); geo.computeVertexNormals(); g.add(mk(geo, [M.Wood, M.Roof], "Roof"));
    }
    /* the underside drops past the wall line along the slope (the overhang) */
    var sl = r.pitch / 12;
    function zAt(x, y) {
      if (r.type === "gable") {
        if (r.ridge === "y") { var xm = (tb.x0 + tb.x1) / 2; return zt + (xm - Math.abs(x - xm) - tb.x0) * sl; }
        var ym = (tb.y0 + tb.y1) / 2; return zt + (ym - Math.abs(y - ym) - tb.y0) * sl;
      }
      return zt + rz(x, y);
    }
    if (r.type === "gable") {
      if (r.ridge === "y") { var xm2 = (tb.x0 + tb.x1) / 2; slab([[x0, y0, zAt(x0, 0)], [xm2, y0, zAt(xm2, 0) + 0.02], [xm2, y1, zAt(xm2, 0) + 0.02], [x0, y1, zAt(x0, 0)]]); slab([[xm2, y0, zAt(xm2, 0) + 0.02], [x1, y0, zAt(x1, 0)], [x1, y1, zAt(x1, 0)], [xm2, y1, zAt(xm2, 0) + 0.02]]); }
      else { var ym2 = (tb.y0 + tb.y1) / 2; slab([[x0, y0, zAt(0, y0)], [x1, y0, zAt(0, y0)], [x1, ym2, zAt(0, ym2) + 0.02], [x0, ym2, zAt(0, ym2) + 0.02]]); slab([[x0, ym2, zAt(0, ym2) + 0.02], [x1, ym2, zAt(0, ym2) + 0.02], [x1, y1, zAt(0, y1)], [x0, y1, zAt(0, y1)]]); }
    } else slab([[x0, y0, zAt(x0, y0)], [x1, y0, zAt(x1, y0)], [x1, y1, zAt(x1, y1)], [x0, y1, zAt(x0, y1)]]);
    var peak = Math.max(zAt(x0, y0), zAt(x1, y1), r.type === "gable" ? zAt((tb.x0 + tb.x1) / 2, (tb.y0 + tb.y1) / 2) : 0) + RT;

    /* warm glow under the eaves and a spill light on the front lawn */
    var warm = new T.MeshBasicMaterial({ color: dusk ? "#ffb066" : "#ffd9a8" });
    var led = box(W, 0.1, 0.05, warm, (all.x0 + all.x1) / 2, all.y0 - 0.4, z0[0] + u.stories[0].plate_ft + 0.1); led.castShadow = false; led.userData.noexport = true; if (n === 1) g.add(led);
    if (dusk) { var spill = new T.PointLight(0xffa550, 1.5, 36, 1.6); spill.position.set((all.x0 + all.x1) / 2, all.y0 - 3, 1.6); g.add(spill); }
    g.userData.seq = { posts: [0, 0], site: [0, 0], details: [0, g.children.length] };
    return { group: g, x0: all.x0, y0: all.y0, w: W, d: D, top: peak };
  }

  /* ---- a still of a library unit (data URL) ---- */
  function still(u, opt, view, w, h) {
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var S = A.Stage(c, { still: true, fov: (view && view.fov) || 28 });
    S.renderer.setSize(w, h, false);
    var m = build(u, opt); S.showModel(m, opt);
    var span = Math.max(m.w, m.d);
    if (view) { S.orbit.az = view.az; S.orbit.el = view.el; if (view.r) S.orbit.r = view.r * span / 24; if (view.dz) S.orbit.target.z += view.dz; }
    S.draw();
    var url = c.toDataURL("image/jpeg", 0.9);
    S.renderer.dispose(); S.renderer.forceContextLoss && S.renderer.forceContextLoss();
    return url;
  }

  /* ---- plan as SVG (dark page) ---- */
  function plan(u, si, o) {
    o = o || {}; var st = u.stories[si], b = bboxOf(extWalls(st)), pad = 3, Wd = b.x1 - b.x0 + 2 * pad, Hd = b.y1 - b.y0 + 2 * pad, ink = "#f1ece1", out = [];
    function X(x) { return +(x - b.x0 + pad).toFixed(2); } function Y(y) { return +(b.y1 - y + pad).toFixed(2); }
    var byId = {}; st.walls.forEach(function (w) { byId[w.id] = w; });
    st.rooms.forEach(function (rm) { out.push('<polygon points="' + rm.polygon.map(function (q) { return X(q[0]) + "," + Y(q[1]); }).join(" ") + '" fill="#1b1813" stroke="none"/>'); });
    st.walls.forEach(function (w) {
      var thk = (w.thk_in || 6) / 12, dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, e = w.ext ? thk / 2 : 0, ops = st.openings.filter(function (q) { return q.wall === w.id; }).sort(function (p, q) { return p.offset - q.offset; });
      var segs = [], cur = -e;
      ops.forEach(function (q) { segs.push([cur, q.offset]); cur = q.offset + q.width; }); segs.push([cur, L + e]);
      segs.forEach(function (s) { if (s[1] - s[0] > 0.02) out.push('<line x1="' + X(w.a[0] + ux * s[0]) + '" y1="' + Y(w.a[1] + uy * s[0]) + '" x2="' + X(w.a[0] + ux * s[1]) + '" y2="' + Y(w.a[1] + uy * s[1]) + '" stroke="' + ink + '" stroke-width="' + (w.ext ? thk : Math.max(thk, 0.3)).toFixed(2) + '" stroke-linecap="butt"/>'); });
      ops.forEach(function (q) {
        var p0 = [w.a[0] + ux * q.offset, w.a[1] + uy * q.offset], p1 = [w.a[0] + ux * (q.offset + q.width), w.a[1] + uy * (q.offset + q.width)];
        if (q.type === "window" || q.type === "slider") out.push('<line x1="' + X(p0[0]) + '" y1="' + Y(p0[1]) + '" x2="' + X(p1[0]) + '" y2="' + Y(p1[1]) + '" stroke="#c8553a" stroke-width="' + (thk * 0.45).toFixed(2) + '"/>');
        else if (q.type === "door") {
          var hp = q.hinge === "a" ? p0 : p1, cp = q.hinge === "a" ? p1 : p0, sgn = q.swing === "left" ? 1 : -1, nx = -uy * sgn, ny = ux * sgn;
          var op = [hp[0] + nx * q.width, hp[1] + ny * q.width];
          var v1x = X(cp[0]) - X(hp[0]), v1y = Y(cp[1]) - Y(hp[1]), v2x = X(op[0]) - X(hp[0]), v2y = Y(op[1]) - Y(hp[1]);
          out.push('<line x1="' + X(hp[0]) + '" y1="' + Y(hp[1]) + '" x2="' + X(op[0]) + '" y2="' + Y(op[1]) + '" stroke="' + ink + '" stroke-width="0.12"/>');
          out.push('<path d="M' + X(cp[0]) + " " + Y(cp[1]) + " A" + q.width + " " + q.width + " 0 0 " + (v1x * v2y - v1y * v2x > 0 ? 1 : 0) + " " + X(op[0]) + " " + Y(op[1]) + '" fill="none" stroke="#8f897b" stroke-width="0.07"/>');
        }
      });
    });
    st.rooms.forEach(function (rm) { out.push('<text x="' + X(rm.at[0]) + '" y="' + Y(rm.at[1]) + '" fill="#aaa393" font-size="0.95" text-anchor="middle" font-family="Inter,sans-serif" letter-spacing="0.06">' + String(rm.name).replace(/[<&]/g, "") + "</text>"); });
    return '<svg class="lib-plan" viewBox="0 0 ' + Wd.toFixed(2) + " " + Hd.toFixed(2) + '" role="img" aria-label="' + st.name + ' plan of ' + u.name.replace(/"/g, "") + '">' + out.join("") + "</svg>";
  }

  /* ---- catalogue ---- */
  function describe(u) {
    var s = stats(u), kind = s.beds === 0 ? "Studio" : s.beds === 1 ? "One bedroom" : s.beds + " bedrooms";
    return { sf: s.sf, beds: s.beds, stories: s.stories, kind: kind, bb: bboxOf([].concat.apply([], u.stories.map(extWalls))), roof: u.roof.type };
  }

  global.LIB = { build: build, still: still, plan: plan, describe: describe, stats: stats, data: function () { return global.LIBDATA || []; } };
})(window);
