"""Audience data for the target areas, from the Census ACS 5-year estimates (Esri Living Atlas ACS layers, public, no key).
  python demographics.py counties     -> data/audience/counties.csv  (the 72 counties inside the five 100-mile circles)
  python demographics.py tracts       -> adds tract-level rent / income / age to every letter in data/letters.json (key 'area')
Estimates carry margins of error; tract values are noisier than county values. Median rent is for all renter units, not for ADUs."""
import csv
import json
import subprocess
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/{}/FeatureServer/{}/query"
BASICS = "ACS_Highlights_Population_Housing_Basics_Boundaries"
SENIOR = "ACS_Highlights_Senior_Well_Being_Boundaries"
COSTS = "ACS_Housing_Costs_Boundaries"
COUNTY, TRACT = 1, 2
SCRATCH = ROOT / "data" / "audience"


def get(url, params):
    q = urllib.parse.urlencode(params)
    out = subprocess.run(["curl", "-s", "-m", "60", "-G", url, "--data", q], capture_output=True, text=True, encoding="utf-8").stdout
    d = json.loads(out)
    if "error" in d:
        raise RuntimeError(d["error"])
    return d


def rows(service, layer, where=None, geom_pt=None, fields="*"):
    p = {"outFields": fields, "returnGeometry": "false", "f": "json", "where": where or "1=1"}
    if geom_pt:
        p.update({"geometry": f"{geom_pt[0]},{geom_pt[1]}", "geometryType": "esriGeometryPoint", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects"})
    out, off = [], 0
    while True:   # these services return at most ~50 rows per request
        d = get(BASE.format(service, layer), p if geom_pt else dict(p, resultOffset=off, orderByFields="GEOID"))
        fs = d.get("features", [])
        out += [f["attributes"] for f in fs]
        if not fs or not d.get("exceededTransferLimit"):
            return out
        off += len(fs)


def pct(a, b):
    return round(100 * a / b, 1) if a is not None and b else None


def merge(geoid_where=None, pt=None, layer=COUNTY, extras=True):
    b = rows(BASICS, layer, geoid_where, pt)
    s = {r["GEOID"]: r for r in rows(SENIOR, layer, geoid_where, pt)} if extras else {}
    c = {r["GEOID"]: r for r in rows(COSTS, layer, geoid_where, pt)} if extras else {}
    out = []
    for r in b:
        g = r["GEOID"]
        sr, cr = s.get(g, {}), c.get(g, {})
        owners, mort = cr.get("B25091_001E"), cr.get("B25091_002E")
        out.append({
            "geoid": g, "name": r.get("NAME"), "pop": r.get("B01001_001E"), "median_age": r.get("B01002_001E"),
            "pct_65plus": r.get("B01001_calc_pctGE65E"), "median_hh_income": r.get("B19049_001E"),
            "owner_rate": r.get("B25003_calc_pctOwnE"), "median_contract_rent": r.get("B25058_001E"), "median_home_value": r.get("B25077_001E"),
            "owners_mortgage_free_pct": pct((owners or 0) - (mort or 0), owners) if owners else None,
            "owners_30plus_burdened_pct": pct(sum((cr.get(f"B25091_{i:03d}E") or 0) for i in (8, 9, 10, 11)), mort) if mort else None,
            "seniors_alone_pct": sr.get("B09021_calc_pctLAGE65E"),
        })
    return out


def counties():
    ctys = json.loads((SCRATCH.parent / "counties72.json").read_text(encoding="utf-8"))
    ids = ",".join(f"'{g}'" for g in ctys)
    data = merge(f"GEOID IN ({ids})")
    for d in data:
        c = ctys[d["geoid"]]
        d["state"], d["near"] = {"06": "CA", "41": "OR", "53": "WA"}[c["st"]], "; ".join(c["near"])
        d["value_to_rent_x"] = round(d["median_home_value"] / (d["median_contract_rent"] * 12), 1) if d["median_home_value"] and d["median_contract_rent"] else None
        d["annual_rent_pct_income"] = round(100 * (d["median_contract_rent"] or 0) * 12 / d["median_hh_income"], 1) if d["median_hh_income"] else None
    data.sort(key=lambda d: -(d["pop"] or 0))
    SCRATCH.mkdir(parents=True, exist_ok=True)
    with open(SCRATCH / "counties.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(data[0]))
        w.writeheader(); w.writerows(data)
    print(len(data), "counties ->", SCRATCH / "counties.csv")


def tracts():
    sys.path.insert(0, str(ROOT / "lotcheck"))
    p = ROOT / "data" / "letters.json"
    letters = json.loads(p.read_text(encoding="utf-8"))
    n = 0
    for code, rec in letters.items():
        f = rec.get("lot") or {}
        ref = f.get("ref")
        if not ref or rec.get("area"):
            continue
        import math
        R = 6371008.8
        lon = ref["lon0"] + math.degrees(ref["cx"] / (R * math.cos(math.radians(ref["lat0"]))))
        lat = ref["lat0"] + math.degrees(ref["cy"] / R)
        try:
            t = merge(pt=(lon, lat), layer=TRACT, extras=False)
        except Exception as e:
            print("skip", code, str(e)[:60]); continue
        if t:
            a = t[0]
            rec["area"] = {k: a[k] for k in ("geoid", "median_hh_income", "median_contract_rent", "median_home_value", "owner_rate", "owners_mortgage_free_pct", "pct_65plus", "median_age")}
            n += 1
        if n % 20 == 0:
            p.write_text(json.dumps(letters, indent=1), encoding="utf-8")
    p.write_text(json.dumps(letters, indent=1), encoding="utf-8")
    print(n, "letters given tract data")


if __name__ == "__main__":
    {"counties": counties, "tracts": tracts}[sys.argv[1]]()
