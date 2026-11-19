"""Check letters against aerial photos: python qa_letters.py [N] [seed]
For N random letters (default 20) re-runs the lot check, puts the lot outline, the building footprints we used and the unit we placed back on Esri
World Imagery, and writes data/qa/qa-sheet.png (one tile per letter) plus a text summary. A person then looks for: a house the data missed,
a footprint where nothing stands, a unit placed over a pool, tree or shed. Imagery is for internal checking only."""
import json
import math
import random
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "lotcheck"))
import server  # noqa: E402
import geom  # noqa: E402

OUT = ROOT / "data" / "qa"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
R = geom.R_EARTH
FT = geom.FT


def to_lonlat(pt_ft, ref):
    x, y = pt_ft[0] * FT + ref["cx"], pt_ft[1] * FT + ref["cy"]
    return (ref["lon0"] + math.degrees(x / (R * math.cos(math.radians(ref["lat0"])))), ref["lat0"] + math.degrees(y / R))


R_WEB = 6378137.0   # Web Mercator uses this radius, NOT the mean Earth radius the lot check uses (that mix-up put the picture 15 km away)


def merc(lon, lat):
    return (math.radians(lon) * R_WEB, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R_WEB)


def imagery(bbox, w, h, path):   # bbox in Web Mercator metres (EPSG:3857) so pixels are square on the ground
    q = urllib.parse.urlencode({"bbox": ",".join(f"{v:.2f}" for v in bbox), "bboxSR": 3857, "imageSR": 3857, "size": f"{w},{h}", "format": "jpg", "f": "image"})
    url = "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export?" + q
    try:
        data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "wwa-qa"}), timeout=40).read()
    except Exception:
        data = subprocess.run(["curl.exe", "-sSL", "--fail", "--max-time", "40", url], capture_output=True).stdout
    path.write_bytes(data)
    return len(data) > 5000


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 11
    letters = json.loads((ROOT / "data" / "letters.json").read_text(encoding="utf-8"))
    codes = sys.argv[3:] if len(sys.argv) > 3 else random.Random(seed).sample(sorted(letters), n)   # or name the codes to look at
    cols = int(__import__("os").environ.get("WWA_QA_COLS", "2" if len(sys.argv) > 3 else "4"))
    OUT.mkdir(parents=True, exist_ok=True)
    tiles, lines = [], []
    for i, code in enumerate(codes):
        rec = letters[code]
        addr = f"{rec['address']}, {rec['city']}, OR {rec['zip']}".strip()
        res = server.lotcheck(addr)
        f = res.get("fit") if res.get("ok") else None
        if not f or not f.get("ref"):
            lines.append(f"{code} {addr}: lookup failed"); continue
        ref = f["ref"]
        lot = [to_lonlat(p, ref) for p in f["lot"]]
        blds = [[to_lonlat(p, ref) for p in b] for b in (f.get("buildings") or [])]
        best = rec["best"]["model"]
        pl = next((r for r in f["results"] if r["model"] == best), None)
        unit = [to_lonlat(p, ref) for p in pl["placement"]] if pl and pl.get("placement") else None
        mlot = [merc(*p) for p in lot]
        xs, ys = [p[0] for p in mlot], [p[1] for p in mlot]
        padx, pady = (max(xs) - min(xs)) * 0.35 + 25, (max(ys) - min(ys)) * 0.35 + 25
        bb = [min(xs) - padx, min(ys) - pady, max(xs) + padx, max(ys) + pady]
        w_m, h_m = bb[2] - bb[0], bb[3] - bb[1]   # make the window at least 3:4 and at most 4:3
        if w_m / h_m < 0.75:
            c = (bb[0] + bb[2]) / 2; bb[0], bb[2] = c - h_m * 0.375, c + h_m * 0.375
        elif w_m / h_m > 1.34:
            c = (bb[1] + bb[3]) / 2; bb[1], bb[3] = c - w_m / 1.34 / 2, c + w_m / 1.34 / 2
        w_m = bb[2] - bb[0]
        if w_m < 175:   # Esri refuses windows zoomed in beyond its imagery (HTTP 500): keep about 0.3 m per pixel or coarser
            f = 175 / w_m; cx_, cy_ = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2; hw, hh = (bb[2] - bb[0]) / 2 * f, (bb[3] - bb[1]) / 2 * f
            bb = [cx_ - hw, cy_ - hh, cx_ + hw, cy_ + hh]
        W = 560
        H = int(W * (bb[3] - bb[1]) / (bb[2] - bb[0]))
        img = OUT / f"{code}.jpg"
        ok = imagery(bb, W, H, img)

        def px(p):
            m = merc(*p)
            return f"{(m[0] - bb[0]) / (bb[2] - bb[0]) * W:.1f},{(bb[3] - m[1]) / (bb[3] - bb[1]) * H:.1f}"
        svg = f'<svg viewBox="0 0 {W} {H}" width="{W}" height="{H}" style="position:absolute;left:0;top:0">'
        svg += f'<polygon points="{" ".join(px(p) for p in lot)}" fill="none" stroke="#fff" stroke-width="2"/>'
        for b in blds:
            svg += f'<polygon points="{" ".join(px(p) for p in b)}" fill="rgba(255,60,60,.25)" stroke="#ff3c3c" stroke-width="2"/>'
        if unit:
            svg += f'<polygon points="{" ".join(px(p) for p in unit)}" fill="rgba(255,215,0,.45)" stroke="#ffd700" stroke-width="2.5"/>'
        svg += "</svg>"
        cap = f"{i + 1}. {rec['address']}, {rec['city']} | {best} | margin {rec['best']['margin']} ft | {len(blds)} bldg"
        tiles.append(f'<div class="t"><div class="c">{cap}</div><div class="m" style="width:{W}px;height:{H}px"><img src="{img.name}" width="{W}" height="{H}">{svg}</div></div>' if ok else f'<div class="t"><div class="c">{cap} (no imagery)</div></div>')
        lines.append(f"{i + 1:2d}. {code} {rec['address']}, {rec['city']}: {best}, {len(blds)} footprint(s), imagery {'ok' if ok else 'MISSING'}")
    html = ('<!doctype html><meta charset=utf-8><style>body{margin:0;background:#111;color:#eee;font:12px Arial}.g{display:grid;grid-template-columns:repeat(COLS,584px);gap:8px;padding:8px}'
            '.t{background:#1b1b1b;padding:4px}.c{padding:2px 2px 4px}.m{position:relative;overflow:hidden}</style>'
            '<div style="padding:8px">White: lot. Red: building footprints the check used. Yellow: where the letter places the unit. Imagery: Esri World Imagery.</div><div class="g">' + "".join(tiles) + "</div>").replace("COLS", str(cols))
    (OUT / "qa-sheet.html").write_text(html, encoding="utf-8")
    rows = (len(tiles) + cols - 1) // cols
    subprocess.run([EDGE, "--headless=new", "--hide-scrollbars", "--virtual-time-budget=15000", f"--window-size={cols * 592 + 16},{rows * 820 + 60}",
                    f"--screenshot={OUT / 'qa-sheet.png'}", (OUT / "qa-sheet.html").as_uri()], capture_output=True, timeout=180)
    print("\n".join(lines))
    print("sheet:", OUT / "qa-sheet.png")


if __name__ == "__main__":
    main()
