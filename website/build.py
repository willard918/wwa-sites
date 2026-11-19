"""src/index.src.html + src/adu.js -> index.html (single file, so it opens anywhere).
Also builds splash.html (the page the printed letters point to) from src/splash.src.html."""
import glob
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
UNITS = HERE.parent / "adu" / "units"


def r2(v):
    return round(v, 2)


def room(r):
    poly = r.get("polygon") or []
    at = r.get("at") or ([sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)] if poly else [0, 0])
    return {"name": r.get("name", ""), "at": [r2(at[0]), r2(at[1])], "polygon": [[r2(a), r2(b)] for a, b in poly], "area_sf": r.get("area_sf")}


def compact_units():
    """adu/units/<id>.json -> the fields the 3D model and plans need, minified."""
    out = []
    for f in sorted(glob.glob(str(UNITS / "[0-9A-Z]*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        name = d["name"].replace("�", "–")
        stories = []
        for s in d["stories"]:
            stories.append({
                "name": s["name"], "plate_ft": s["plate_ft"], "floor_to_floor_ft": s["floor_to_floor_ft"],
                "outline": [[r2(a), r2(b)] for a, b in (s.get("outline") or [])],
                "walls": [{"id": w["id"], "a": [r2(w["a"][0]), r2(w["a"][1])], "b": [r2(w["b"][0]), r2(w["b"][1])], "ext": bool(w.get("ext")), "thk_in": w.get("thk_in", 6)} for w in s["walls"]],
                "openings": [{"wall": o["wall"], "type": o["type"], "offset": r2(o["offset"]), "width": r2(o["width"]), "height": r2(o["height"]), "sill": r2(o.get("sill") or 0),
                              "hinge": o.get("hinge"), "swing": o.get("swing")} for o in s["openings"]],
                "rooms": [room(r) for r in s.get("rooms", [])],
            })
        out.append({"id": d["id"], "name": name, "source": d["source"].replace("�", "–"), "roof": d["roof"], "notes": d.get("notes", ""), "stories": stories})
    return out


src = (HERE / "src" / "index.src.html").read_text(encoding="utf-8")
js = (HERE / "src" / "adu.js").read_text(encoding="utf-8")
# The library shows other architects' redrawn plans. It is OFF unless WWA_LIBRARY=1 (rights and credit still to be settled).
import os
import re
SHOW_LIBRARY = os.environ.get("WWA_LIBRARY") == "1"
libdata = ("window.LIBDATA=" + json.dumps(compact_units(), separators=(",", ":")) + ";") if SHOW_LIBRARY else "window.LIBDATA=[];"


def fill(page):
    if not SHOW_LIBRARY:
        page = re.sub(r"<!--LIBNAV-->.*?<!--/LIBNAV-->", "", page, flags=re.S)
        page = re.sub(r"<!--LIBRARY-->.*?<!--/LIBRARY-->", "", page, flags=re.S)
    page = page.replace("/*ADU_JS*/", js)
    page = page.replace("/*PLAN_JS*/", (HERE / "src" / "plan.js").read_text(encoding="utf-8"))
    page = page.replace("/*LOGISTICS_JS*/", (HERE / "src" / "logistics.js").read_text(encoding="utf-8"))
    page = page.replace("/*PERF_JS*/", (HERE / "src" / "perf.js").read_text(encoding="utf-8"))
    page = page.replace("/*PRICING_JS*/", (HERE / "src" / "pricing.js").read_text(encoding="utf-8"))
    page = page.replace("/*LIB_DATA*/", libdata)
    page = page.replace("/*LIB_JS*/", (HERE / "src" / "library.js").read_text(encoding="utf-8"))
    page = page.replace("/*TEASE_JS*/", (HERE / "src" / "tease.js").read_text(encoding="utf-8"))
    # lot check UI lives in lotcheck/ (backend: lotcheck/server.py)
    page = page.replace("/*LOTCHECK_JS*/", (HERE / "lotcheck" / "lotcheck.js").read_text(encoding="utf-8"))
    page = page.replace("/*LOTCHECK_CSS*/", (HERE / "lotcheck" / "lotcheck.css").read_text(encoding="utf-8"))
    return page


page = fill(src)
(HERE / "index.html").write_text(page, encoding="utf-8")
print("index.html", round(len(page) / 1024, 1), "KB", "(library ON)" if SHOW_LIBRARY else "(library hidden; WWA_LIBRARY=1 to show)")
(HERE / "privacy.html").write_text((HERE / "src" / "privacy.src.html").read_text(encoding="utf-8"), encoding="utf-8")
sp = HERE / "src" / "splash.src.html"
if sp.exists():
    s = fill(sp.read_text(encoding="utf-8"))
    (HERE / "splash.html").write_text(s, encoding="utf-8")
    print("splash.html", round(len(s) / 1024, 1), "KB")
