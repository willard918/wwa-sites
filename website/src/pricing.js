/* Planning-estimate price model. ALL RATES ARE PLACEHOLDERS: replace with real Pacific Wall / Trillium numbers before publishing.
   Edit only the PRICING object. Inputs come from A.quantities (floor area, roof area, panels). */
/* REAL REFERENCE DATA (from email/Drive, 2026-11-04), not yet used in the formulas below:
   - Pacific Wall Systems proposal "RAMONA ADU", 4 Nov 2024 (Montclair CA, plans 10/8/2024): wall panel framing $12,287.21 + sheeting $3,972.80
     + very top plate $531.25 + framing hardware $328.00 + 2nd-floor and roof cassettes $24,078.37 + freight (one 48 ft common carrier) $2,900
     = $41,197.63, FOB Phoenix OR, no tax. 2x6 @16 OC, 1/2 CDX, labour and materials. Excludes decks, accessory blocking, hardware (by others),
     design, foundation, crane, set. Payment 50% at production start. Quote valid 30 days. Floor area of that job not stated in the proposal.
   - Pacific Wall "Willard Williams ADU - Wall Panel and Roof Cassette Proposal 10-21-26" (Etna CA): priced FOB Phoenix, set with a crane (Alex Knecht's email said one day; some projects will take a few days).
     THE AMOUNT IS IN A PDF ATTACHED TO THE EMAIL AND WAS NOT READABLE; enter it here when known.
   - JPL Structures (John Langeloh, PE), Etna project: structural fee $3,200 (accepted by email 20 Oct 2026). */
(function (global) {
  var PRICING = {
    placeholder: true,
    tiers: {
      /* Each tier is built from three lines. UNIT (factory panel kit, delivered to the Phoenix OR yard) is based on the Ramona proposal:
         $41,197.63 less $2,900 freight over about 1,600 sf = about $24/sf (your 2024 email said about $28/sf). Ramona was a larger two-level job; small ADUs carry
         more wall per square foot, so the rate used is $55/sf (JUDGEMENT after two requests to go higher; first $28 x 1.4 = $39. Replace with Alex's Etna total), plus the $2,900 freight.
         DESIGN = $3,200 structural (JPL, Etna, real) + $15,000 design and permit drawings (PLACEHOLDER).
         SITE = foundation, crane and set, utilities, finish work, builder margin: ALL PLACEHOLDER (Managed and Turnkey were set first as
         $235/sf + $26,000 and $320/sf + $40,000 totals; site is what is left after unit and design). */
      kit:      { label: "Design & Kit", note: "Permit-ready drawings and the Pacific Wall panel kit delivered to the yard. You choose the builder and do the site work.",
                  unit: { perSf: 55, fixed: 2900 }, design: { perSf: 0, fixed: 18200 }, site: { perSf: 0, fixed: 0 } },
      managed:  { label: "Managed",      note: "The kit, plus we coordinate the builder, foundation and the panel set.",
                  unit: { perSf: 55, fixed: 2900 }, design: { perSf: 0, fixed: 18200 }, site: { perSf: 150, fixed: 8000 } },
      turnkey:  { label: "Turnkey",      note: "One contract: design, permit, build, utilities connected.",
                  unit: { perSf: 55, fixed: 2900 }, design: { perSf: 0, fixed: 18200 }, site: { perSf: 170, fixed: 12000 } }
    },
    roof:   { shed: 0, flat: 0.02, gable: 0.04 },        /* fractional uplift on the build cost */
    finish: { charcoal: 0, cedar: 0.04, bone: 0.01 },
    perf:   { code: { perSf: 0, fixed: 0 }, high: { perSf: 14, fixed: 4500 } }, /* PLACEHOLDER uplift on the factory kit: triple glazing, exterior insulation, ventilator, air-sealing, blower-door test */
    range: 0.20,                                           /* +/- shown around the estimate; local sources span $167-$320/sf */
    /* 2026-11-13: site rates re-set so a 576 sf Turnkey lands near $305/sf and Managed near $280/sf, inside the local evidence
       (Trillium Guide 21: $167-$300/sf installed; Pacific Nest sheet: $316/sf). See data/audience/LOCAL-NUMBERS.md. Still a planning estimate, not a quote. */
    finance: { rate: 6.75, years: 30, down: 20 }           /* Guide 21 terms; defaults for the calculator */
  };

  function estimate(tier, q, roof, finish, perf) {
    var t = PRICING.tiers[tier]; if (!t || !q) return null;
    var up = 1 + (PRICING.roof[roof] || 0) + (PRICING.finish[finish] || 0), r = PRICING.range, parts = {}, mid = 0;
    ["unit", "design", "site"].forEach(function (k) {
      var pf = PRICING.perf[perf || "high"] || PRICING.perf.high, ex = k === "unit" ? pf : { perSf: 0, fixed: 0 };
      var v = Math.round(((t[k].perSf + ex.perSf) * q.floor + t[k].fixed + ex.fixed) * up / 500) * 500; parts[k] = v; mid += v; });
    return { mid: mid, parts: parts, low: Math.round(mid * (1 - r) / 500) * 500, high: Math.round(mid * (1 + r) / 500) * 500 };
  }
  /* standard fixed-rate amortisation; rate in % per year */
  function payment(price, downPct, ratePct, years) {
    var loan = price * (1 - downPct / 100), n = years * 12, i = ratePct / 100 / 12;
    if (loan <= 0) return 0;
    return i === 0 ? loan / n : loan * i / (1 - Math.pow(1 + i, -n));
  }
  function usd(n) { return "$" + Math.round(n).toLocaleString("en-US"); }

  global.PRICE = { PRICING: PRICING, estimate: estimate, payment: payment, usd: usd };
})(window);
