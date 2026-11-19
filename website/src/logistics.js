/* 3D site logistics scene on an EXAMPLE lot (70 x 125 ft, house at the street, rear alley, unit in the rear yard).
   Only the unit, and the boom reach computed from its size, change. Feet, Z up, street at y < 0, alley at y > 125.
   Uses ADU.buildUnit, ADU.makeTruck, ADU.makeMachine and ADU.aimBoom from adu.js. */
(function (global) {
  var T = global.THREE, A = global.ADU, LW = 70, LD = 125, AL = 10;

  function geom(p) {
    var W = p.width, D = p.depth, ax = 22, ay = 78, mx = ax + W + 7, my = ay + D + 8, reach = 0;
    [[ax, ay], [ax + W, ay], [ax, ay + D], [ax + W, ay + D]].forEach(function (c) { reach = Math.max(reach, Math.hypot(c[0] - mx, c[1] - my)); });
    return { W: W, D: D, ax: ax, ay: ay, mx: mx, my: my, reach: Math.ceil(reach / 5) * 5 + 5 };
  }
  function mat(c, r) { return new T.MeshStandardMaterial({ color: c, roughness: r === undefined ? 0.95 : r }); }
  function flat(x0, y0, x1, y1, z, color) {
    var m = new T.Mesh(new T.PlaneGeometry(x1 - x0, y1 - y0), mat(color, 1)); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, z); m.receiveShadow = true; return m;
  }
  function seg(g, x0, y0, x1, y1, w, color, z) {
    var L = Math.hypot(x1 - x0, y1 - y0), m = new T.Mesh(new T.BoxGeometry(L, w, 0.12), new T.MeshBasicMaterial({ color: color }));
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, z); m.rotation.z = Math.atan2(y1 - y0, x1 - x0); g.add(m);
  }
  function dashed(g, pts, w, color, dash, gap, z) {
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      for (var d = 0; d < L; d += dash + gap) { var e = Math.min(d + dash, L); seg(g, a[0] + ux * d, a[1] + uy * d, a[0] + ux * e, a[1] + uy * e, w, color, z); }
    }
  }
  function label(text, accent) {
    var c = document.createElement("canvas"); c.width = 512; c.height = 96;
    var x = c.getContext("2d"); x.fillStyle = "rgba(11,10,8,.82)"; x.fillRect(0, 0, 512, 96);
    x.strokeStyle = accent || "#4a463c"; x.lineWidth = 4; x.strokeRect(2, 2, 508, 92);
    x.fillStyle = "#e7e0d0"; x.font = "600 40px Inter, Arial, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(text, 256, 50);
    var s = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true, depthTest: false }));
    s.scale.set(20, 3.75, 1); s.renderOrder = 10; return s;
  }
  function tag(g, text, x, y, z, accent) { var s = label(text, accent); s.position.set(x, y, z); g.add(s); return s; }

  function steps(reach) {
    return "<h3>On site, step by step</h3><ol class=\"lgsteps\">" +
      "<li><b>Before the truck.</b> Permit issued, slab or footings poured and cured, utilities stubbed to the pad.</li>" +
      "<li><b>Delivery.</b> Panels and roof cassettes arrive stacked in set order on a flatbed, which backs in and leaves the way it came. Pacific Wall's Ramona quote assumed one 48 ft common carrier (the Etna carrier is not known yet); the driver must be able to enter and leave the site without help, and the builder unloads (their terms).</li>" +
      "<li><b>The set.</b> A Gradall-type telescopic-boom machine stands the numbered wall panels in order, then sets the roof cassettes one by one. Pacific Wall's email said to expect a crane. How long the set takes depends on the project (a day for some, a few days for others), so confirm the machine and the schedule with the builder.</li>" +
      "<li><b>Dry-in and finish.</b> Roofing, doors and windows, mechanical, electrical and plumbing, interior finishes (typical sequence; duration depends on the builder).</li>" +
      "<li><b>Connect and inspect.</b> Utilities tied in, final inspection, occupancy.</li></ol>" +
      "<div class=\"lgcheck\"><small>Check before booking the machine (typical)</small><ul>" +
      "<li>Boom reach needed for this unit from the example machine spot: about <b>" + reach + " ft</b>. Confirm against the machine's load chart for the heaviest wall panel and roof cassette.</li>" +
      "<li>Overhead power lines near the boom's swing.</li><li>Ground bearing under the machine, and access wide enough for the carrier and the machine.</li>" +
      "<li>Street or alley staging permit if the truck cannot park on site.</li></ul></div>";
  }

  function mount(box) {
    box.innerHTML = '<div class="lgwrap"><div class="lgfig"><canvas class="lg3d" aria-label="Interactive 3D site logistics model"></canvas>' +
      '<p class="lgcap">Example lot only, with alley access. Drag to look around. Your lot check supplies the real boundary; the machine position, truck access and utilities change with it.</p></div><div class="lgtext"></div></div>';
    var canvas = box.querySelector("canvas"), textBox = box.querySelector(".lgtext");
    var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.72;
    var scene = new T.Scene(); scene.background = new T.Color("#0e0d0b"); scene.fog = new T.Fog("#0e0d0b", 240, 560);
    var camera = new T.PerspectiveCamera(32, 16 / 9, 1, 1200);
    var hemi = new T.HemisphereLight(0xcfd8ee, 0x2a2824, 0.7), sun = new T.DirectionalLight(0xfff0dc, 1.35);
    sun.position.set(-30, -50, 95); sun.target.position.set(35, 70, 0); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005;
    var sc = sun.shadow.camera; sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 1; sc.far = 260;
    scene.add(hemi, sun, sun.target);

    /* static site: ground, street, alley, lot, setbacks, existing house */
    var stat = new T.Group(); scene.add(stat);
    stat.add(flat(-260, -260, 330, 400, -0.2, "#0b0a08"));
    stat.add(flat(-120, -24, 190, 0, 0, "#141311"));
    stat.add(flat(-120, LD, 190, LD + AL, 0, "#141311"));
    stat.add(flat(0, 0, LW, LD, 0.02, "#191c16"));
    seg(stat, 0, 0, LW, 0, 0.5, "#c9c2b0", 0.1); seg(stat, LW, 0, LW, LD, 0.5, "#c9c2b0", 0.1); seg(stat, LW, LD, 0, LD, 0.5, "#c9c2b0", 0.1); seg(stat, 0, LD, 0, 0, 0.5, "#c9c2b0", 0.1);
    dashed(stat, [[5, 5], [LW - 5, 5], [LW - 5, LD - 5], [5, LD - 5], [5, 5]], 0.3, "#8a8372", 2, 1.4, 0.1);
    var hb = new T.Mesh(new T.BoxGeometry(46, 30, 9), mat("#2b2925", 0.9)); hb.position.set(41, 23, 4.5); hb.castShadow = true; hb.receiveShadow = true; stat.add(hb);
    var hr = new T.Mesh(new T.BoxGeometry(49, 33, 0.9), mat("#1f1e1c", 0.8)); hr.position.set(41, 23, 9.45); hr.castShadow = true; stat.add(hr);
    tag(stat, "EXISTING HOUSE", 41, 23, 15);
    tag(stat, "STREET", 35, -12, 1.5); tag(stat, "ALLEY", 8, LD + AL / 2, 1.5);
    tag(stat, "5 ft setbacks (assumed)", 52, 4, 1.5);

    var dyn = null, S = { yaw: -1.25, el: 0.62, r: 160, tgt: new T.Vector3(40, 72, 2) };
    function draw() {
      var w = canvas.clientWidth || 800, h = canvas.clientHeight || 520;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      var k = Math.max(1, 1.5 / camera.aspect); /* keep the whole lot in view on narrow canvases */
      camera.up.set(0, 0, 1);
      camera.position.set(S.tgt.x + S.r * k * Math.cos(S.el) * Math.cos(S.yaw), S.tgt.y + S.r * k * Math.cos(S.el) * Math.sin(S.yaw), S.tgt.z + S.r * k * Math.sin(S.el));
      camera.lookAt(S.tgt); renderer.render(scene, camera);
    }
    var drag = null;
    canvas.style.touchAction = "pan-y";
    canvas.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY, yaw: S.yaw, el: S.el }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", function (e) {
      if (!drag) return; S.yaw = drag.yaw - (e.clientX - drag.x) * 0.008; S.el = Math.max(0.12, Math.min(1.45, drag.el + (e.clientY - drag.y) * 0.005)); draw();
    });
    canvas.addEventListener("pointerup", function () { drag = null; });
    if (global.ResizeObserver) new ResizeObserver(function () { draw(); }).observe(canvas);

    var timer = null, lastP = null;
    function build(p) {
      var G = geom(p), W = G.W, D = G.D, g = new T.Group();
      var u = A.buildUnit(p, { finish: "charcoal", dusk: true }); u.group.position.set(G.ax, G.ay, 0); g.add(u.group);
      tag(g, "NEW UNIT " + W + " × " + D, G.ax + W / 2, G.ay + D / 2, u.top + 6, "#c8553a");
      /* utilities from the house to the unit */
      var ux = G.ax + W / 2; dashed(g, [[41, 38], [41, 60], [ux, 60], [ux, G.ay]], 0.55, "#8fb4c8", 2.2, 1.4, 0.12);
      tag(g, "water · sewer · power", (41 + ux) / 2, 61.5, 1.5, "#8fb4c8");
      /* truck backed into the alley, panel stack on the bed; it leaves forward (+x), the way it came */
      var tcx = Math.min(46, G.ax + W / 2 + 6), tk = A.makeTruck(); tk.truck.rotation.z = Math.PI / 2; tk.truck.position.set(tcx, LD + AL / 2, 0); g.add(tk.truck);
      tag(g, "48 FT CARRIER", tcx, LD + AL / 2, 14);
      /* the machine, its reach, and the next panel on the hook */
      var MM = A.makeMachine(); MM.mach.position.set(G.mx, G.my, 0); g.add(MM.mach, MM.cable, MM.hook);
      var tgt = new T.Vector3(G.ax - 6, G.ay - 2, 9); A.aimBoom(MM, G.mx, G.my, tgt);
      var pn = new T.Mesh(new T.BoxGeometry(4, 0.54, 9), mat("#1f1f21", 0.7)); pn.position.set(tgt.x, tgt.y, tgt.z + 1.6 - 4.5); g.add(pn);
      var ring = new T.Mesh(new T.RingGeometry(G.reach - 0.3, G.reach, 120), new T.MeshBasicMaterial({ color: "#d08a3a", transparent: true, opacity: 0.7, side: T.DoubleSide, depthWrite: false }));
      ring.position.set(G.mx, G.my, 0.14); g.add(ring);
      var disc = new T.Mesh(new T.CircleGeometry(G.reach, 120), new T.MeshBasicMaterial({ color: "#d08a3a", transparent: true, opacity: 0.07, depthWrite: false }));
      disc.position.set(G.mx, G.my, 0.12); g.add(disc);
      tag(g, "BOOM REACH ~" + G.reach + " ft", G.mx + G.reach * 0.72, G.my + G.reach * 0.69, 1.5, "#d08a3a");
      g.traverse(function (m) { if (m.isMesh && !m.material.transparent) { m.castShadow = m.castShadow !== false; m.receiveShadow = true; } });
      return { g: g, reach: G.reach };
    }
    function update(p) {
      lastP = p; clearTimeout(timer);
      timer = setTimeout(function () {
        if (dyn) { scene.remove(dyn.g); dyn.g.traverse(function (m) { if (m.geometry) m.geometry.dispose(); }); }
        dyn = build(lastP); scene.add(dyn.g); textBox.innerHTML = steps(dyn.reach); draw();
      }, 140);
    }
    return { update: update, draw: draw };
  }
  global.LOGI = { mount: mount, geom: geom };
})(window);
