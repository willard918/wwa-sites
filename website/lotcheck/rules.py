"""State ADU baseline rules and the verdict logic.

These are STATE baselines only. Local codes (city or county) add siting and design rules that are
NOT checked here. Setbacks below are ASSUMPTIONS used for the fit test, not code lookups.
Every item was read from search results on LAST_VERIFIED; nothing here replaces the local code.
"""

LAST_VERIFIED = "2026-11-03"

# Footprints of the lineup (feet). Keep in sync with website/src/adu.js MODELS.
MODELS = [
    {"name": "PL 384", "w": 24, "d": 16},
    {"name": "PL 576", "w": 24, "d": 24},
    {"name": "PL 768", "w": 32, "d": 24},
]

STATES = {
    "OR": {
        "name": "Oregon",
        "setbacks_ft": {"front": 20, "side_rear": 5},
        "summary": [
            "State law (SB 1051, 2017) requires cities over 2,500 residents to allow at least one ADU with each detached single-family home inside the urban growth boundary, subject to reasonable local siting and design rules.",
            "Local rules may not require owner occupancy or off-street parking for ADUs (HB 2001, 2019; DLCD guidance).",
            "Outside city limits the county's own zoning decides. Rules for rural land differ and were not checked.",
        ],
        "sources": [
            {"title": "DLCD guidance on SB 1051 (APA knowledge base)", "url": "https://planning.org/knowledgebase/resource/9139610"},
            {"title": "League of Oregon Cities: DLCD updates ADU guidance", "url": "https://orcities.org/resources/communications/bulletin/dlcd-updates-guidance-adu-requirements"},
        ],
    },
    "WA": {
        "name": "Washington",
        "setbacks_ft": {"front": 20, "side_rear": 5},
        "summary": [
            "State law (HB 1337, 2023) requires jurisdictions to allow two ADUs per lot where single-family homes are allowed, within urban growth areas.",
            "Owner-occupancy requirements are prohibited, except to enforce rules on short-term rental of ADUs.",
            "Cities may limit lots of 2,000 sq ft or less to two ADUs, and ADU impact fees are capped at 50% of the principal home's.",
        ],
        "sources": [
            {"title": "WA Commerce ADU guidance (June 2024)", "url": "https://www.ezview.wa.gov/Portals/_1976/Documents/adu-examples/Commerce_ADU_Guidance_0624.pdf"},
        ],
    },
    "CA": {
        "name": "California",
        "setbacks_ft": {"front": 20, "side_rear": 4},
        "summary": [
            "Local agencies must allow an ADU of at least 800 sq ft even where lot coverage, floor area ratio or open space rules would otherwise prevent it, with 4 ft side and rear setbacks (HCD review letters).",
            "Local agencies may not cap ADU size below 850 sq ft (studio or one bedroom) or 1,000 sq ft (more than one bedroom).",
            "Exact statute sections and review timelines were not checked against the code or the HCD handbook.",
        ],
        "sources": [
            {"title": "HCD ordinance review letter (Arroyo Grande, 2025)", "url": "https://www.hcd.ca.gov/sites/default/files/docs/policy-and-research/ordinance-review-letters/arroyo-grande-adu-findings-100825.pdf"},
            {"title": "HCD ADU resources", "url": "https://www.hcd.ca.gov"},
        ],
    },
}

# Oregon county property class codes (state DOR scheme). Only the common ones; anything else shows its raw code.
USE_CODES = {
    "100": ("Residential, vacant", False),
    "101": ("Residential, with a home", True),
    "400": ("Tract land, vacant", False),
    "401": ("Tract land, with a home", True),
}

DISCLAIMER = (
    "A first look from public data, not a zoning determination. Local code, utilities, easements, flood and fire zones "
    "were not checked, and existing buildings come only from satellite-derived footprints that can be out of date. "
    "Confirm with the city or county planning office."
)


def verdict(state, kind, parcel, fit):
    """kind: 'city' | 'unincorporated' | None. Returns {status, headline, reasons}."""
    reasons = []
    st = STATES.get(state)
    if st is None:
        return {"status": "none", "headline": "We serve Oregon, Washington and California",
                "reasons": ["This address is outside those three states."]}
    if parcel is None:
        reasons.append("Parcel data is not connected for this county yet, so lot size and fit could not be checked.")
        reasons.append(f"{st['name']} state law sets a baseline (below), but your city or county code decides.")
        return {"status": "nodata", "headline": "Not enough data yet", "reasons": reasons}

    status = "likely"
    parcel_note = ""
    has_home = parcel.get("improved")
    if has_home is None and parcel.get("use_unavailable"):
        # this county's data has no land-use class: a building footprint on the lot is the only sign of a home
        if fit and fit.get("buildings"):
            has_home = True
            parcel_note = "This county's data has no land-use class, so a home is assumed from the building footprint on the lot."
        else:
            has_home = False
    if has_home is False:
        status = "review"
        reasons.append("County records show no home on this lot. State ADU rules assume a single-family home, so a vacant lot needs a closer look.")
    elif has_home:
        reasons.append(parcel_note if parcel.get("use_unavailable") else "County records show a home on the lot.")
    else:
        status = "review"
        reasons.append(f"The county's land-use class for this lot ({parcel.get('use') or 'unknown'}) is not one we recognize as a home site, so check that a home is allowed there.")
    if kind == "unincorporated":
        status = "review"
        reasons.append("The lot is outside city limits, so the county's own zoning applies and rural rules differ from the state baseline.")
    elif kind == "city":
        reasons.append(f"The lot is inside a city, where the {st['name']} state ADU baseline applies.")
        if state == "OR":
            reasons.append("Oregon's requirement covers cities over 2,500 residents. This city's population was not checked.")
    zone = (parcel.get("zoning") or {}).get("code")
    if zone:
        reasons.append(f"Zoning code on record: {zone}. Its ADU rules were not checked.")
    elif kind == "city":
        reasons.append("City zoning is not connected yet, so the zone and its limits were not checked.")
    if fit is not None:
        fits = [r["model"] for r in fit["results"] if r["fits"]]
        terr = fit.get("terrain") or {}
        steep = [r["model"] for r in fit["results"] if r.get("slope_blocked")]
        if terr.get("checked") is False:
            status = "review"
            reasons.append(terr.get("note") or "Ground slope could not be checked, so the fit ignores it.")
        if not fits:
            status = "review"
            if steep:
                reasons.append("The ground here is too steep, or has no drivable route in from the street, for a prefab unit (we look for gentle ground, under about 15% average slope, and a route under 15%). "
                               "None of our units are suggested for this lot as it stands. A site survey and a design made for the slope could still work.")
            else:
                reasons.append("None of our units fit inside the assumed setbacks. A smaller unit or a site survey may change that.")
        else:
            if steep:
                reasons.append(f"{', '.join(steep)} would fit on flat ground but the slope rules " + ("it" if len(steep) == 1 else "them") + " out.")
            gs = [r["ground"]["mean_slope_pct"] for r in fit["results"] if r["fits"] and r.get("ground")]
            if gs:
                reasons.append(f"Ground slope under the suggested spot is about {max(gs):g}% (USGS elevation data, about 10 ft grid). A survey is still needed.")
            reasons.append("Fits with assumed setbacks: " + ", ".join(fits) + ".")
            if fit.get("buildings"):
                reasons.append(f"{len(fit['buildings'])} existing building(s) were taken from satellite-derived footprints and kept {fit['assumptions']['building_clear_ft']} ft clear. That data can be out of date, for example for recent rebuilds.")
            elif fit.get("buildings_note"):
                status = "review"
                reasons.append(fit["buildings_note"])
            big = [r["model"] for r in fit["results"] if r["fits"] and not r.get("size_ok", True)]
            if big and state == "CA":
                reasons.append(f"{', '.join(big)} are larger than the {fit['assumptions']['typical_cap_sf']} sq ft that California guarantees for a detached ADU. The city's own cap may allow more or less; it was not checked.")
            elif big:
                reasons.append(f"{', '.join(big)} may exceed the size cap many Oregon cities set for detached ADUs (about {fit['assumptions']['typical_cap_sf']} sq ft, or 75% of the main house). This city's cap was not checked.")
    headline = {"likely": "Likely allowed", "review": "Needs review"}[status]
    return {"status": status, "headline": headline, "reasons": reasons}
