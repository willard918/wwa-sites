/* Envelope performance: code-minimum assembly vs the high-performance package, from the unit's own areas and openings.
   PLANNING ESTIMATE: steady-state UA and a design-day load. Not an energy model (no Title 24 / REScheck / PHPP run). Feet, BTU/h, °F. */
(function (global) {
  /* U-values are whole-assembly, framing included.
     CODE column: Oregon 2023 ORSC Table N1101 (R-21 intermediate wall U-0.059, U-0.27 windows, R-30 vaulted or R-49 flat ceiling, R-30 floor) and
     California 2025 Energy Code prescriptive (2x6 wall R-21, windows U-0.27, heat pump water heater, ceiling U-0.025 to 0.031). Oregon air leakage is
     reported as 3 or 4 ACH50 by different summaries; 4 is used here. The code column takes the stricter value where the two differ.
     HIGH column: proposed Pacific Wall panel with 2x6 dense-pack plus 2 in continuous exterior mineral wool, 2x10 roof cassette dense-pack plus
     exterior polyiso, triple glazing, taped air barrier tested to 1.0 ACH50, balanced ventilation. Confirm each item with Pacific Wall and the builder. */
  var PKG = {
    code: { label: "Code minimum",
      wall: { u: 0.059, d: "2x6 at 16 in, R-21 batt, no exterior insulation" }, roof: { u: 0.030, d: "R-30 to R-38 in the roof cassette" },
      floor: { u: 0.033, d: "R-30" }, win: { u: 0.27, d: "Double glazed, low-e, U-0.27" }, door: { u: 0.25, d: "Insulated door" },
      ach50: 4, erv: 0, vent: "Exhaust fan (no heat recovery)" },
    high: { label: "High performance",
      wall: { u: 0.033, d: "2x6 at 16 in dense-pack plus 2 in exterior mineral wool, about R-30" }, roof: { u: 0.020, d: "2x10 cassette dense-pack plus 3 in exterior polyiso, about R-50" },
      floor: { u: 0.026, d: "R-38" }, win: { u: 0.19, d: "Triple glazed, thermally broken frames, U-0.19" }, door: { u: 0.17, d: "Insulated, thermally broken" },
      ach50: 1, erv: 0.75, vent: "Heat-recovery ventilator, 75% effective" }
  };
  var DT = 45, HDD = 4700, COP = 3; /* southern Oregon design temperature difference, heating degree days, seasonal COP of a cold-climate mini-split */

  function areas(p) {
    var W = p.width, D = p.depth, h = p.wall_height, glass = 0, door = 0;
    p.openings.forEach(function (o) { var a = o.width * o.height; if (o.type === "door") door += a; else glass += a; });
    return { wall: Math.max(0, 2 * (W + D) * h - glass - door), glass: glass, door: door, roof: W * D * 1.08, floor: W * D, vol: W * D * h, floorArea: W * D };
  }
  function beds(p) { var L = global.PLAN ? global.PLAN.layout(p.width, p.depth) : null; return L ? L.rooms.filter(function (r) { return r.kind === "bedroom"; }).length : 1; }

  function calc(p, key) {
    var k = PKG[key], a = areas(p), parts = [
      ["Walls", a.wall * k.wall.u], ["Roof", a.roof * k.roof.u], ["Floor", a.floor * k.floor.u], ["Windows", a.glass * k.win.u], ["Door", a.door * k.door.u]];
    var cond = parts.reduce(function (s, x) { return s + x[1]; }, 0);
    var inf = 0.018 * a.vol * (k.ach50 / 20);
    var cfm = 0.03 * a.floorArea + 7.5 * (beds(p) + 1), vent = 1.08 * cfm * (1 - k.erv);
    var ua = cond + inf + vent, peak = ua * DT, annual = ua * 24 * HDD / 3412 / COP;
    return { parts: parts, cond: cond, inf: inf, vent: vent, ua: ua, peak: peak, annual: annual, cfm: cfm };
  }

  function html(p, key) {
    var c = calc(p, "code"), h = calc(p, "high"), cut = 1 - h.peak / c.peak, k = PKG;
    function n(v) { return Math.round(v).toLocaleString("en-US"); }
    var rows = [["Walls", k.code.wall.d, k.high.wall.d], ["Roof", k.code.roof.d, k.high.roof.d], ["Floor", k.code.floor.d, k.high.floor.d], ["Windows", k.code.win.d, k.high.win.d],
      ["Air tightness", k.code.ach50 + " ACH50", k.high.ach50.toFixed(1) + " ACH50, blower-door tested"], ["Ventilation", k.code.vent, k.high.vent],
      ["Heating", "Heat pump (CA 2025 baseline)", "Cold-climate ductless heat pump, sized to the load"], ["Hot water", "Heat pump water heater (CA 2025)", "Heat pump water heater"], ["Fuel", "Electric or gas", "All electric, no combustion"], ["Solar", "CA: required on detached ADUs, OR: solar-ready", "Roof plane clear for 3 to 4 kW, panel ready for a battery"]];
    var s = '<div class="perf"><div class="pf-sum"><b>' + Math.round(cut * 100) + '%</b><span>lower peak heating load than a code-minimum unit</span></div>';
    s += '<div class="pf-nums"><div><small>Peak heating load</small><b>' + n(h.peak) + ' <i>BTU/h</i></b><em>code ' + n(c.peak) + '</em></div><div><small>Heat loss rate</small><b>' + n(h.ua) + ' <i>BTU/h·°F</i></b><em>code ' + n(c.ua) + '</em></div><div><small>Heating energy, upper estimate</small><b>' + n(h.annual) + ' <i>kWh/yr</i></b><em>code ' + n(c.annual) + '</em></div></div>';
    s += '<div class="pf-t"><div class="pf-h"><span></span><span>Code minimum</span><span class="hi">High performance</span></div>';
    rows.forEach(function (r) { s += '<div class="pf-r"><span>' + r[0] + '</span><span>' + r[1] + '</span><span class="hi">' + r[2] + "</span></div>"; });
    s += "</div>";
    s += '<p class="pf-fine">Planning estimate: steady-state heat loss through the unit\'s own wall, roof, floor and opening areas, at a ' + DT + '°F design temperature difference (southern Oregon), ' + n(HDD) + ' degree days and a heat pump COP of ' + COP + '. It ignores solar and internal gains, so the energy figure is an upper bound. It is not a Title 24, REScheck or PHPP energy model. Code values come from the 2023 Oregon Residential Specialty Code and the 2025 California Energy Code prescriptive tables as summarised in public sources; confirm the edition and climate zone with your building department. The high-performance assemblies are proposed and need confirmation from Pacific Wall and your builder. Exterior insulation adds about 2 in to the wall and is not drawn in the 3D model.</p></div>';
    return s;
  }
  global.PERF = { PKG: PKG, calc: calc, html: html };
})(window);
