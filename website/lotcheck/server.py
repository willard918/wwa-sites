"""Lot check backend (stdlib only).

    python server.py                       # serve http://127.0.0.1:8787  (GET /api/lotcheck?address=...)
    python server.py --check "ADDRESS"     # run once and print a summary
    python server.py --check "ADDRESS" --json

Pipeline: Census geocoder -> county parcel adapter -> geometry (setback envelope, fit test) -> verdict.
Only Jackson County, OR has a parcel adapter so far; everywhere else degrades to the state baseline.
No owner names are read or returned.
"""
import argparse
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# The VPS has no working IPv6 route: Python tried the IPv6 address first and the TLS handshake to ArcGIS Online timed out.
# Outgoing connections use IPv4 only (the web server itself still listens as before).
_gai = socket.getaddrinfo
socket.getaddrinfo = lambda host, port, family=0, *a, **k: _gai(host, port, socket.AF_INET if family in (0, socket.AF_UNSPEC) else family, *a, **k)

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "outreach"))
import geom  # noqa: E402
import rules  # noqa: E402
import outreach  # noqa: E402  (tease email, click tracking, letter codes)

UA = "lotcheck-prototype/0.1"
M2FT = 1 / geom.FT
CENSUS = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress"
JACKSON = "https://jcportal.jacksoncountyor.gov/server/rest/services/Property/Taxlots2/FeatureServer/1/query"


def http_json(url, params, timeout=25):
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(url + "?" + q, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


# ----------------------------------------------------------------------------- geocode
def geocode(address):
    d = http_json(CENSUS, {"address": address, "benchmark": "Public_AR_Current", "vintage": "Current_Current", "format": "json"})
    ms = d.get("result", {}).get("addressMatches", [])
    if not ms:
        return None
    m = ms[0]
    g = m.get("geographies", {})
    county = (g.get("Counties") or [{}])[0]
    place = (g.get("Incorporated Places") or [{}])[0]
    state = (m.get("addressComponents") or {}).get("state")
    return {
        "matched": m["matchedAddress"],
        "lon": m["coordinates"]["x"], "lat": m["coordinates"]["y"],
        "state": state,
        "county": (county.get("NAME") or "").replace(" County", ""), "county_fips": county.get("GEOID"),
        "place": re.sub(r" (city|town|CDP)$", "", place.get("NAME") or "") or None,
        "house": (re.match(r"\s*(\d+)", m["matchedAddress"]) or [None, None])[1],
        "street_known": True,
    }


# ----------------------------------------------------------------------------- parcel adapters
SUFFIXES = {"ST", "STREET", "AVE", "AVENUE", "WAY", "DR", "DRIVE", "RD", "ROAD", "LN", "LANE", "CT", "COURT", "PL", "PLACE",
            "BLVD", "HWY", "CIR", "CIRCLE", "TRL", "TRAIL", "LOOP", "PKWY", "TER", "N", "S", "E", "W", "NE", "NW", "SE", "SW"}
J_FIELDS = "MAPTAXLOT,SITEADD,ADDRESSNUM,CITY,ACREAGE,ZONECLASS,PROPCLASS,IMPRMV"


def parse_street(address):
    """'150 Sugar Pine Rd, Trail, OR' -> ('150', 'SUGAR PINE'). Letters, digits and spaces only (it goes into a where clause)."""
    first = re.sub(r"[^A-Za-z0-9 ]", " ", address.split(",")[0]).upper().split()
    if len(first) < 2 or not first[0].isdigit():
        return None, None
    words = [w for w in first[1:] if w not in SUFFIXES]
    return first[0], " ".join(words) or None


def _jackson_parcel(f):
    rings = (f.get("geometry") or {}).get("rings") or []
    if not rings:
        return None
    ring = max(rings, key=lambda r: geom.area([tuple(p) for p in r]))
    ll = [tuple(p) for p in ring]
    if ll[0] == ll[-1]:
        ll = ll[:-1]
    a = f["attributes"]
    code = str(a.get("PROPCLASS") or "")
    use = rules.USE_CODES.get(code)
    zone = (a.get("ZONECLASS") or "").strip() or None
    imprmv = a.get("IMPRMV")
    return {
        "id": a.get("MAPTAXLOT"), "site_address": a.get("SITEADD"), "acres": a.get("ACREAGE"), "city_field": a.get("CITY"),
        "use": use[0] if use else (f"County class {code}" if code else None),
        "improved": use[1] if use else None,  # unknown land-use class: don't guess from the improvement value (exempt land reads 0)
        "zoning": {"code": zone, "source": "Jackson County GIS"} if zone else None,
        "polygon_lonlat": ll,
        "source": "Jackson County GIS, Property/Taxlots2 (weekly refresh)",
    }


def jackson_by_address(address):
    house, core = parse_street(address)
    if not house or not core:
        return None
    d = http_json(JACKSON, {"where": f"ADDRESSNUM='{house}' AND UPPER(SITEADD) LIKE '%{core}%'", "outFields": J_FIELDS,
                            "returnGeometry": "true", "outSR": 4326, "f": "json"})
    feats = d.get("features") or []
    return _jackson_parcel(feats[0]) if len(feats) == 1 else None  # ambiguous -> let the map point decide


def jackson_or(geo):
    """Jackson County OR taxlots. Address match first, then the lot at / nearest the geocoded point."""
    if geo.get("parcel_pre"):
        return geo["parcel_pre"]
    p = jackson_by_address(geo["matched"])
    if p:
        return p
    d = http_json(JACKSON, {
        "geometry": f"{geo['lon']},{geo['lat']}", "geometryType": "esriGeometryPoint", "inSR": 4326, "outSR": 4326,
        "spatialRel": "esriSpatialRelIntersects", "distance": 30, "units": "esriSRUnit_Meter",
        "outFields": J_FIELDS, "returnGeometry": "true", "f": "json"})
    cands = []
    for f in d.get("features") or []:
        par = _jackson_parcel(f)
        if not par:
            continue
        ll = par["polygon_lonlat"]
        lon0, lat0 = sum(q[0] for q in ll) / len(ll), sum(q[1] for q in ll) / len(ll)
        loc = [geom.to_local(x, y, lon0, lat0) for x, y in ll]
        pt = geom.to_local(geo["lon"], geo["lat"], lon0, lat0)
        _, dist = geom.nearest_edge(pt, loc)
        cands.append((0 if geom.point_in_poly(pt, loc) else 1, dist, par))
    if not cands:
        return None
    cands.sort(key=lambda c: c[:2])
    par = cands[0][2]
    par["note"] = "Lot chosen by map position because the county has no exact address match."
    return par


def jackson_fallback_geo(address):
    """Census doesn't know new streets. If the county does, locate the lot from its record."""
    par = jackson_by_address(address)
    if not par:
        return None
    ll = par["polygon_lonlat"]
    lon, lat = sum(q[0] for q in ll) / len(ll), sum(q[1] for q in ll) / len(ll)
    d = http_json("https://geocoding.geo.census.gov/geocoder/geographies/coordinates",
                  {"x": lon, "y": lat, "benchmark": "Public_AR_Current", "vintage": "Current_Current", "format": "json"})
    g = (d.get("result") or {}).get("geographies") or {}
    county = (g.get("Counties") or [{}])[0]
    place = (g.get("Incorporated Places") or [{}])[0]
    return {"matched": f"{par['site_address']}, {par.get('city_field') or ''}, OR".replace(" ,", ","), "lon": lon, "lat": lat, "state": "OR",
            "county": (county.get("NAME") or "Jackson").replace(" County", ""), "county_fips": county.get("GEOID") or "41029",
            "place": re.sub(r" (city|town|CDP)$", "", place.get("NAME") or "") or None, "house": None,
            "street_known": False, "parcel_pre": par}


# Existing buildings: FEMA / Oak Ridge National Laboratory "USA Structures" footprints (satellite-derived, nationwide, public).
STRUCTURES = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0/query"
BUILDING_CLEAR_FT = float(os.environ.get("WWA_BUILDING_CLEAR_FT", "6"))       # assumed minimum gap between the new unit and any existing building (fire separation), not a code lookup
CA_ADU_FLOOR_SF = 850           # statutory minimum size a California city must allow (studio/1BR); not the city's actual cap
TYPICAL_ADU_CAP_SF = 800       # many Oregon cities cap a detached ADU at about 800 sq ft or 75% of the main house; this city's cap is NOT checked


def structures(ll, lon0, lat0, cx, cy, poly):
    """Building footprints that touch the lot, as rings in the lot's local metres. Returns (rings, info)."""
    xs, ys = [p[0] for p in ll], [p[1] for p in ll]
    pad = 0.00003
    d = http_json(STRUCT_URL(), {"where": "1=1", "geometry": f"{min(xs) - pad},{min(ys) - pad},{max(xs) + pad},{max(ys) + pad}", "geometryType": "esriGeometryEnvelope",
                                 "inSR": 4326, "outSR": 4326, "spatialRel": "esriSpatialRelIntersects", "returnGeometry": "true",
                                 "outFields": "OCC_CLS,SQFEET,OUTBLDG,IMAGE_DATE", "f": "json"}, timeout=20)
    rings, sqft, img = [], [], []
    for f in d.get("features") or []:
        rg = (f.get("geometry") or {}).get("rings") or []
        if not rg:
            continue
        ring = [(a - cx, b - cy) for a, b in (geom.to_local(x, y, lon0, lat0) for x, y in rg[0])]
        if ring[0] == ring[-1]:
            ring = ring[:-1]
        if len(ring) < 3:
            continue
        mid = (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
        if geom.point_in_poly(mid, poly) or any(geom.point_in_poly(p, poly) for p in ring):
            rings.append(ring)
            a = f["attributes"]
            sqft.append(a.get("SQFEET") or 0)
            if a.get("IMAGE_DATE"):
                img.append(a["IMAGE_DATE"])
    return rings, {"sqft": sqft, "image_ms": max(img) if img else None}


def STRUCT_URL():
    return STRUCTURES


# Alameda County CA: the county's open-data parcel layer (data.acgov.org "Parcels", ~490k parcels, no zoning).
ALAMEDA = "https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services/Parcels/FeatureServer/0/query"
A_FIELDS = "APN,SitusAddress,SitusCity,UseCode"
A_USE = {"1100": ("Single-family residence", True)}   # other use codes are shown as 'County use code N' and sent to review; none are guessed


def _alameda_parcel(f):
    rings = (f.get("geometry") or {}).get("rings") or []
    if not rings:
        return None
    ring = max(rings, key=lambda r: geom.area([tuple(p) for p in r]))
    ll = [tuple(p) for p in ring]
    if ll[0] == ll[-1]:
        ll = ll[:-1]
    a = f["attributes"]
    code = str(a.get("UseCode") or "").strip()
    use = A_USE.get(code)
    return {
        "id": a.get("APN"), "site_address": a.get("SitusAddress"), "acres": None, "city_field": a.get("SitusCity"),
        "use": use[0] if use else (f"County use code {code}" if code else None),
        "improved": use[1] if use else None,
        "zoning": None,
        "polygon_lonlat": ll,
        "source": "Alameda County open data, Parcels",
    }


def alameda_ca(geo):
    """Alameda County parcels: exact address match (when unique), else the lot at / nearest the geocoded point."""
    if geo.get("parcel_pre"):
        return geo["parcel_pre"]
    house, core = parse_street(geo["matched"])
    if house and core:
        where = f"SitusStreetNumber='{house}' AND UPPER(SitusStreetName) LIKE '%{core}%'"
        if geo.get("place") and re.fullmatch(r"[A-Za-z ]+", geo["place"]):
            where += f" AND UPPER(SitusCity)='{geo['place'].upper()}'"
        d = http_json(ALAMEDA, {"where": where, "outFields": A_FIELDS, "returnGeometry": "true", "outSR": 4326, "f": "json"})
        feats = d.get("features") or []
        if len(feats) == 1:
            return _alameda_parcel(feats[0])
    d = http_json(ALAMEDA, {
        "geometry": f"{geo['lon']},{geo['lat']}", "geometryType": "esriGeometryPoint", "inSR": 4326, "outSR": 4326,
        "spatialRel": "esriSpatialRelIntersects", "distance": 30, "units": "esriSRUnit_Meter",
        "outFields": A_FIELDS, "returnGeometry": "true", "f": "json"})
    cands = []
    for f in d.get("features") or []:
        par = _alameda_parcel(f)
        if not par:
            continue
        ll = par["polygon_lonlat"]
        lon0, lat0 = sum(q[0] for q in ll) / len(ll), sum(q[1] for q in ll) / len(ll)
        loc = [geom.to_local(x, y, lon0, lat0) for x, y in ll]
        pt = geom.to_local(geo["lon"], geo["lat"], lon0, lat0)
        _, dist = geom.nearest_edge(pt, loc)
        cands.append((0 if geom.point_in_poly(pt, loc) else 1, dist, par))
    if not cands:
        return None
    cands.sort(key=lambda c: c[:2])
    par = cands[0][2]
    par["note"] = "Lot chosen by map position because the county has no exact address match."
    return par



# ---- statewide / multi-county layers, one generic lookup -----------------------------------------------------------------------
def _ring_parcel(f, make):
    rings = (f.get("geometry") or {}).get("rings") or []
    if not rings:
        return None
    ring = max(rings, key=lambda r: geom.area([tuple(p) for p in r]))
    ll = [tuple(p) for p in ring]
    if ll[0] == ll[-1]:
        ll = ll[:-1]
    par = make(f["attributes"])
    par["polygon_lonlat"] = ll
    return par


def arcgis_lookup(geo, url, fields, addr_col, county_where, make):
    """Exact address match when it is unique, else the lot at / nearest the geocoded point. Works for any ArcGIS parcel layer."""
    if geo.get("parcel_pre"):
        return geo["parcel_pre"]
    house, core = parse_street(geo["matched"])
    if house and core and addr_col:
        where = (addr_col(house, core) if callable(addr_col) else f"UPPER({addr_col}) LIKE '{house} %{core}%'") + (f" AND {county_where}" if county_where else "")
        d = http_json(url, {"where": where, "outFields": fields, "returnGeometry": "true", "outSR": 4326, "f": "json"})
        feats = d.get("features") or []
        if len(feats) == 1:
            return _ring_parcel(feats[0], make)
    d = http_json(url, {
        "geometry": f"{geo['lon']},{geo['lat']}", "geometryType": "esriGeometryPoint", "inSR": 4326, "outSR": 4326,
        "spatialRel": "esriSpatialRelIntersects", "distance": 30, "units": "esriSRUnit_Meter",
        "where": county_where or "1=1", "outFields": fields, "returnGeometry": "true", "f": "json"})
    cands = []
    for f in d.get("features") or []:
        par = _ring_parcel(f, make)
        if not par:
            continue
        ll = par["polygon_lonlat"]
        lon0, lat0 = sum(q[0] for q in ll) / len(ll), sum(q[1] for q in ll) / len(ll)
        loc = [geom.to_local(x, y, lon0, lat0) for x, y in ll]
        pt = geom.to_local(geo["lon"], geo["lat"], lon0, lat0)
        _, dist = geom.nearest_edge(pt, loc)
        cands.append((0 if geom.point_in_poly(pt, loc) else 1, dist, par))
    if not cands:
        return None
    cands.sort(key=lambda c: c[:2])
    par = cands[0][2]
    par["note"] = "Lot chosen by map position because the county has no exact address match."
    return par


# Washington: the state's statewide parcel layer (all 39 counties, county data normalised; DOR land-use codes)
WA_PARCELS = "https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0/query"
WA_USE = {11: ("Single-family residence", True), 91: ("Undeveloped land", False)}   # others are shown as 'County land-use code N' and sent to review


def _wa_make(a):
    code = a.get("LANDUSE_CD")
    use = WA_USE.get(code)
    return {"id": a.get("PARCEL_ID_NR"), "site_address": a.get("SITUS_ADDRESS"), "acres": None, "city_field": a.get("SITUS_CITY_NM"),
            "use": use[0] if use else (f"County land-use code {code}" if code is not None else None),
            "improved": use[1] if use else None, "zoning": None, "source": "Washington statewide parcels (Geospatial Open Data Portal)"}


def wa_statewide(geo):
    return arcgis_lookup(geo, WA_PARCELS, "PARCEL_ID_NR,SITUS_ADDRESS,SITUS_CITY_NM,LANDUSE_CD", "SITUS_ADDRESS",
                         f"FIPS_NR='{geo['county_fips'][2:]}'", _wa_make)


# Oregon: Water Resources Dept combined tax lots (13 counties incl. Curry, Klamath, Lake; no use class, no zoning)
OR_OWRD = "https://gis.wrd.state.or.us/server/rest/services/tax/Tax_Lots_Public_View_WGS84/FeatureServer/2/query"


def _or_make(a):
    return {"id": a.get("maptaxlot"), "site_address": a.get("site_address"), "acres": None, "city_field": None,
            "use": None, "improved": None, "use_unavailable": True, "zoning": None, "source": "Oregon Water Resources Dept combined tax lots"}


def or_owrd(geo):
    return arcgis_lookup(geo, OR_OWRD, "maptaxlot,site_address", "site_address", f"county_name='{geo['county']}'" if re.fullmatch(r"[A-Za-z ]+", geo["county"] or "") else None, _or_make)



# ---- Bay Area / Sacramento county layers (public county services; see README for sources) -------------------------------------------
def _simple(source, idk, addrk, cityk=None, useknow=None, usek=None, zonek=None, unavailable=False):
    def make(a):
        use, improved = None, None
        if useknow is not None:
            u = useknow(a)
            if u:
                use, improved = u
        if use is None and usek:
            raw = a.get(usek)
            use = str(raw) if raw not in (None, "") else None
        zone = a.get(zonek) if zonek else None
        return {"id": a.get(idk), "site_address": a.get(addrk) if isinstance(addrk, str) else addrk(a), "acres": None,
                "city_field": a.get(cityk) if cityk else None, "use": use, "improved": improved,
                "use_unavailable": bool(unavailable) and improved is None, "zoning": {"code": zone, "source": source} if zone else None, "source": source}
    return make


def _cc_use(a):
    return ("Single-family residence", True) if a.get("USE_CODE") == 11 else None


def _sonoma_use(a):
    c = str(a.get("UseCode") or "")
    desc = (a.get("UseCodeDescription") or "").title()
    if c in ("0010", "0017", "0019", "0022", "0023", "0051"):
        return (desc or "Single-family residence", True)
    if c in ("0000", "0001", "0006"):
        return (desc or "Vacant residential lot", False)
    return None


def _sac_use(a):
    return None


CC = "https://gis.cccounty.us/arcgis/rest/services/CCMAP/Assessment_Parcels_ArcPro/MapServer/0/query"
SCL = "https://services8.arcgis.com/fpjs8A5Vtkshblnd/arcgis/rest/services/Santa_Clara_County_Parcels/FeatureServer/0/query"
SFO = "https://services.arcgis.com/Zs2aNLFN00jrS4gG/arcgis/rest/services/Active_Parcels_from_DataSF_pulled_daily_/FeatureServer/0/query"
SMC = "https://gis.smcgov.org/maps/rest/services/ACRE/ACTIVE_PARCELS/MapServer/0/query"
SON = "https://socogis.sonomacounty.ca.gov/map/rest/services/OWTSPublic/Cities_GIS_Parcel_Base/FeatureServer/0/query"
SAC = "https://services1.arcgis.com/5NARefyPVtAeuJPU/arcgis/rest/services/Parcels/FeatureServer/0/query"

_sac_make_base = _simple("Sacramento County parcels", "APN", lambda a: f"{a.get('STREET_NBR') or ''} {a.get('STREET_NAM') or ''}".strip(), "CITY", usek="LU_SPECIF")


def _sac_make(a):
    p = _sac_make_base(a)
    res = "resid" in (a.get("LU_GENERAL") or "").lower()
    p["use"] = f"{a.get('LU_GENERAL') or ''} / {a.get('LU_SPECIF') or ''}".strip(" /") or None
    p["improved"] = None
    p["use_unavailable"] = res   # residential land use, but no 'has a home' flag: a home is inferred from the building footprint
    return p


COUNTY_LAYERS = {
    "06013": (CC, "APN,full_address_search,s_city,USE_CODE,Description", "full_address_search", None,
              _simple("Contra Costa County assessor parcels", "APN", "full_address_search", "s_city", useknow=_cc_use, usek="Description")),
    "06085": (SCL, "apn,situs_hous,situs_st_1,situs_st_2,situs_city", lambda h, c: f"situs_hous='{h}' AND UPPER(situs_st_1) LIKE '%{c}%'", None,
              _simple("Santa Clara County parcels", "apn", lambda a: f"{a.get('situs_hous') or ''} {a.get('situs_st_1') or ''} {a.get('situs_st_2') or ''}".strip(), "situs_city", unavailable=True)),
    "06075": (SFO, "blklot,from_address_num,street_name,street_type,zoning_code", lambda h, c: f"from_address_num={h} AND UPPER(street_name) LIKE '%{c}%'", None,
              _simple("San Francisco Planning (DataSF) parcels", "blklot", lambda a: f"{a.get('from_address_num') or ''} {a.get('street_name') or ''} {a.get('street_type') or ''}".strip(), None, zonek="zoning_code", unavailable=True)),
    "06081": (SMC, "APN,SITUS_ADDR,SITUS_CITY", "SITUS_ADDR", None,
              _simple("San Mateo County parcels", "APN", "SITUS_ADDR", "SITUS_CITY", unavailable=True)),
    "06097": (SON, "APN,UseCode,UseCodeDescription,SitusFormatted1,SitusCity", lambda h, c: f"TRIM(SitusStreetNo)='{h}' AND UPPER(SitusStreetName) LIKE '%{c}%'", "Type='PCL'",
              _simple("Sonoma County parcels", "APN", "SitusFormatted1", None, useknow=_sonoma_use, usek="UseCodeDescription")),
    "06067": (SAC, "APN,STREET_NBR,STREET_NAM,CITY,LU_GENERAL,LU_SPECIF", lambda h, c: f"STREET_NBR='{h}' AND UPPER(STREET_NAM) LIKE '%{c}%'", None, _sac_make),
}


def make_county_adapter(fips):
    url, fields, addr, where, make = COUNTY_LAYERS[fips]
    return lambda geo: arcgis_lookup(geo, url, fields, addr, where, make)


ADAPTERS = {"41029": jackson_or, "06001": alameda_ca}  # county FIPS -> adapter
ADAPTERS.update({f"53{n:03d}": wa_statewide for n in range(1, 78, 2)})
ADAPTERS.update({"41015": or_owrd, "41035": or_owrd, "41037": or_owrd})
ADAPTERS.update({f: make_county_adapter(f) for f in COUNTY_LAYERS})


# ----------------------------------------------------------------------------- pipeline
def pt_ft(p):
    return [round(p[0] * M2FT, 2), round(p[1] * M2FT, 2)]


def lotcheck(address):
    address = (address or "").strip()
    if len(address) < 6 or len(address) > 200:
        return {"ok": False, "error": "Enter a full street address, including city and state."}
    try:
        geo = geocode(address)
    except Exception as e:  # network or service failure
        return {"ok": False, "error": "The address service did not respond. Try again in a moment.", "detail": str(e)[:120]}
    if not geo and re.search(r"\b(OR|Oregon)\b", address, re.I):
        try:
            geo = jackson_fallback_geo(address)
        except Exception as e:
            import traceback; traceback.print_exc()
            geo = None
    if not geo:
        return {"ok": False, "error": "We couldn't find that address. Check the spelling and include the city and state."}

    state = geo["state"]
    kind = "city" if geo["place"] else ("unincorporated" if geo["county"] else None)
    out = {"ok": True, "match": {"address": geo["matched"], "lat": round(geo["lat"], 6), "lon": round(geo["lon"], 6)},
           "jurisdiction": {"state": state, "county": geo["county"], "place": geo["place"], "kind": kind},
           "parcel": None, "fit": None, "data_sources": ["US Census Geocoder (address, county, city limits)"]}

    parcel, fit = None, None
    adapter = ADAPTERS.get(geo["county_fips"])
    if adapter:
        try:
            parcel = adapter(geo)
        except Exception as e:
            out["notes"] = [f"The county parcel service did not respond ({str(e)[:80]})."]
    elif state in rules.STATES:
        out["notes"] = [f"Parcel data for {geo['county'] or 'this'} County is not connected yet."]

    if parcel:
        out["data_sources"].append(parcel.pop("source"))
        ll = parcel.pop("polygon_lonlat")
        lon0 = sum(p[0] for p in ll) / len(ll)
        lat0 = sum(p[1] for p in ll) / len(ll)
        poly = geom.ensure_ccw([geom.to_local(x, y, lon0, lat0) for x, y in ll])
        street = geom.to_local(geo["lon"], geo["lat"], lon0, lat0)
        cx, cy = geom.centroid(poly)
        poly = [(x - cx, y - cy) for x, y in poly]
        street = (street[0] - cx, street[1] - cy)
        area_m2 = geom.area(poly)
        w, d = geom.lot_dims(poly)
        mail_city = parcel.pop("city_field", None)
        if mail_city and geo.get("place") and mail_city.strip().lower() != geo["place"].lower():
            out.setdefault("notes", []).append(f"The county lists the mailing city as {mail_city.title()}, but this lot is inside {geo['place']} city limits.")
        parcel["area_sf"] = round(area_m2 * 10.7639)
        parcel["dims_ft"] = [round(w * M2FT), round(d * M2FT)]
        parcel["dims_note"] = "Approximate bounding size of the lot shape."

        sb = rules.STATES[state]["setbacks_ft"] if state in rules.STATES else {"front": 20, "side_rear": 5}
        _, street_dist = geom.nearest_edge(street, poly)
        street_known = bool(geo.get("street_known", True)) and street_dist < 100
        if street_known:
            front_i, _ = geom.nearest_edge(street, poly)
            sbs = [(sb["front"] if i == front_i else sb["side_rear"]) * geom.FT for i in range(len(poly))]
            front_edge, street_pt = geom.edges(poly)[front_i], street
        else:  # street side unknown: the larger setback on every edge is the cautious choice
            front_i, front_edge, street_pt = None, None, None
            sbs = [sb["front"] * geom.FT] * len(poly)
        bl, binfo, bnote = [], None, None
        try:
            bl, binfo = structures(ll, lon0, lat0, cx, cy, poly)
        except Exception as e:
            bnote = f"Existing buildings could not be loaded ({str(e)[:60]}), so the fit below ignores them."
        clear_m = BUILDING_CLEAR_FT * geom.FT
        if binfo is not None and not bl:
            bnote = "No building footprint was found on this lot in the satellite-derived data (which can be out of date), so the fit ignores existing buildings."
        cells = geom.envelope_cells(poly, sbs, obstacles=bl, obs_clear=clear_m)
        primary_sf = round(max(binfo["sqft"])) if binfo and binfo["sqft"] else None
        if state == "CA":
            cap_sf = CA_ADU_FLOOR_SF   # California bars cities from capping a detached ADU below this; the city's own cap may be higher
        else:
            cap_sf = min(TYPICAL_ADU_CAP_SF, round(0.75 * primary_sf)) if primary_sf else TYPICAL_ADU_CAP_SF
        results = []
        for m in rules.MODELS:
            t0 = time.time()
            mw, md = m["w"] * geom.FT, m["d"] * geom.FT
            # first look for a spot with a ~2 ft margin to spare, then accept the bare minimum
            r = (geom.fit_rect(poly, mw, md, [x + 0.6 for x in sbs], street_pt=street_pt, obstacles=bl, obs_clear=clear_m)
                 or geom.fit_rect(poly, mw, md, sbs, street_pt=street_pt, obstacles=bl, obs_clear=clear_m))
            results.append({"model": m["name"], "size_ft": [m["w"], m["d"]], "sf": m["w"] * m["d"], "size_ok": m["w"] * m["d"] <= cap_sf, "fits": bool(r),
                            "placement": [pt_ft(c) for c in r["corners"]] if r else None,
                            "margin_ft": round(r["clearance"] * M2FT, 1) if r else None,
                            "ms": int((time.time() - t0) * 1000)})
        note = ("Assumed setbacks, not code lookups. The street side is the lot edge nearest the address point; a corner lot's second street side "
                "is not detected. Existing buildings come from satellite-derived footprints and can be out of date. Easements, slopes and utilities are not known.")
        if not street_known:
            note = ("Assumed setbacks, not code lookups. The street side could not be located for this address, so the larger front setback "
                    "was applied to every edge (cautious). Existing buildings come from satellite-derived footprints and can be out of date. Easements, slopes and utilities are not known.")
        fit = {
            "assumptions": {"front_ft": sb["front"], "side_rear_ft": sb["side_rear"], "street_known": street_known, "note": note,
                            "building_clear_ft": BUILDING_CLEAR_FT, "typical_cap_sf": cap_sf, "primary_sf": primary_sf},
            "buildings": [[pt_ft(p) for p in r] for r in bl] if binfo is not None else None, "buildings_note": bnote,
            "ref": {"lon0": lon0, "lat0": lat0, "cx": cx, "cy": cy},   # lets a QA script put the local plan back on a map
            "results": results, "lot": [pt_ft(p) for p in poly], "envelope_cells": [[round(v * M2FT, 1) for v in c] for c in cells],
            "front_edge": [pt_ft(front_edge[0]), pt_ft(front_edge[1])] if front_edge else None,
            "street_pt": pt_ft(street_pt) if street_pt else None,
        }
        out["parcel"] = parcel
        out["fit"] = fit

    out["verdict"] = rules.verdict(state, kind, parcel, fit)
    st = rules.STATES.get(state)
    if st:
        out["rules"] = {"state": st["name"], "summary": st["summary"], "sources": st["sources"], "last_verified": rules.LAST_VERIFIED}
    out["disclaimer"] = rules.DISCLAIMER
    return out


# ----------------------------------------------------------------------------- http
_cache, _hits, _rl = {}, {}, {}


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", outreach.base_url() if os.environ.get("WWA_BASE_URL") else "*")  # the page and API share an origin; with WWA_BASE_URL set, only that origin
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", outreach.base_url() if os.environ.get("WWA_BASE_URL") else "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _ip(self):
        """The visitor's address. Behind a proxy or load balancer set WWA_TRUST_PROXY=1 to read X-Forwarded-For; otherwise every visitor would look like the proxy."""
        if os.environ.get("WWA_TRUST_PROXY") == "1":
            xf = (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
            if xf:
                return xf
        return self.client_address[0]

    def _html(self, name, inject=""):
        f = Path(__file__).resolve().parent.parent / name
        if not f.exists():
            return self._send(404, {"ok": False, "error": "run build.py first"})
        body = f.read_text(encoding="utf-8").replace("</head>", inject + "</head>", 1).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _limited(self, bucket, n, per=3600):
        ip, now = self._ip(), time.time()
        h = _rl.setdefault(bucket, {})
        h[ip] = [t for t in h.get(ip, []) if now - t < per] + [now]
        return len(h[ip]) > n

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != "/api/tease":
            return self._send(404, {"ok": False, "error": "not found"})
        if self._limited("tease", 12):
            return self._send(429, {"ok": False, "error": "Too many requests. Try again later."})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > 3_000_000:
                return self._send(413, {"ok": False, "error": "Request too large."})
            body = json.loads(self.rfile.read(n).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self._send(400, {"ok": False, "error": "Bad request."})
        code, out = outreach.handle_tease(body, self._ip(), lotcheck)
        self._send(code, out)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/api/health":
            return self._send(200, {"ok": True})
        if u.path in ("/", "/index.html"):  # the built single-file site, so page and API share an origin
            f = Path(__file__).resolve().parent.parent / "index.html"
            if not f.exists():
                return self._send(404, {"ok": False, "error": "run build.py first"})
            body = f.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if u.path.startswith("/e/"):  # email click -> back to the design, logged
            dest = outreach.track(u.path[3:], urllib.parse.parse_qs(u.query), self._ip())
            self.send_response(302)
            self.send_header("Location", dest)
            self.end_headers()
            return
        if u.path.startswith("/u/"):  # one-click unsubscribe
            ok = outreach.unsubscribe(u.path[3:], self._ip())
            body = ("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>Unsubscribed</title><body style='background:#0b0a08;color:#f1ece1;font:18px/1.6 Georgia,serif;padding:12vh 24px;max-width:560px;margin:0 auto'>"
                    + ("<h1 style='font-weight:300'>You are unsubscribed.</h1><p>We will not email you again.</p>" if ok else "<h1 style='font-weight:300'>We could not find that link.</h1><p>Reply to any email from us with the word stop and we will remove you.</p>")
                    + "</body>").encode("utf-8")
            self.send_response(200 if ok else 404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if u.path in ("/privacy", "/privacy.html"):
            return self._html("privacy.html")
        if u.path == "/api/letter" or u.path.startswith("/api/letter/"):
            info = outreach.letter_public(u.path[len("/api/letter/"):].upper())
            return self._send(200 if info else 404, {"ok": True, **info} if info else {"ok": False, "error": "Unknown code."})
        if u.path == "/l" or u.path.startswith("/l/"):  # the splash page printed letters point to
            code = u.path[3:].strip("/").upper()
            info = outreach.letter_public(code) if code else None
            if code:
                outreach.log_event("letter_open", self._ip(), code=code, known=bool(info))
            return self._html("splash.html", "<script>window.LETTER=" + json.dumps(info).replace("<", "\\u003c") + ";</script>")
        if u.path != "/api/lotcheck":
            return self._send(404, {"ok": False, "error": "not found"})
        ip = self._ip()
        now = time.time()
        _hits[ip] = [t for t in _hits.get(ip, []) if now - t < 60] + [now]
        if len(_hits[ip]) > 30:
            return self._send(429, {"ok": False, "error": "Too many requests. Wait a minute and try again."})
        addr = (urllib.parse.parse_qs(u.query).get("address") or [""])[0]
        key = re.sub(r"\s+", " ", addr.strip().lower())
        if key in _cache and now - _cache[key][0] < 3600:
            return self._send(200, _cache[key][1])
        res = lotcheck(addr)
        if res.get("ok") and len(_cache) < 500:
            _cache[key] = (now, res)
        self._send(200 if res.get("ok") else 400, res)

    def log_message(self, *a):  # keep addresses out of the console
        pass


def summary(r):
    if not r.get("ok"):
        return "ERROR: " + r["error"]
    j, p, f, v = r["jurisdiction"], r["parcel"], r["fit"], r["verdict"]
    lines = [f"{r['match']['address']}  ({j['county']} Co., {j['state']}, {j['place'] or 'unincorporated'})",
             f"VERDICT: {v['headline']}"] + ["  - " + x for x in v["reasons"]]
    if p:
        lines.append(f"Parcel {p['id']} | {p['site_address']} | {p['acres']} ac ({p['area_sf']} sf) | ~{p['dims_ft'][0]}x{p['dims_ft'][1]} ft | {p['use']} | zoning: {(p['zoning'] or {}).get('code')}")
        lines.append(f"Assumed setbacks: front {f['assumptions']['front_ft']} ft, side/rear {f['assumptions']['side_rear_ft']} ft")
        for x in f["results"]:
            lines.append(f"  {x['model']} {x['size_ft'][0]}x{x['size_ft'][1]}: " + (f"fits (margin {x['margin_ft']} ft, {x['ms']} ms)" if x["fits"] else f"does not fit ({x['ms']} ms)"))
    for n in r.get("notes", []):
        lines.append("note: " + n)
    return "\n".join(lines)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--host", default=os.environ.get("WWA_HOST", "127.0.0.1"), help="0.0.0.0 inside a container; keep 127.0.0.1 behind a reverse proxy on the same machine")
    a = ap.parse_args()
    if a.check:
        r = lotcheck(a.check)
        print(json.dumps(r, indent=1) if a.json else summary(r))
    else:
        print(f"lotcheck serving on http://{a.host}:{a.port}/api/lotcheck?address=...  (Ctrl+C to stop)", flush=True)
        ThreadingHTTPServer((a.host, a.port), H).serve_forever()
