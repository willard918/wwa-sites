"""Mail-merge for the printed letters: recipients -> codes + lot checks -> print-ready PDF + a CSV for the mail house.

    python letters.py candidates --n 200            # pick 200 Jackson County, OR homes whose lots look able to hold a backyard unit (DRAFT list)
    python letters.py csv recipients.csv            # or use your own list: columns address,city,state,zip (optional: name)
    python letters.py hero                          # render the dusk banner used on every letter (needs Edge + internet for three.js)
    python letters.py build [--base https://willardwilliamsarchitect.com] [--limit N]
                                                    # -> data/letters/letters.html, letters.pdf, mailmerge.csv, proof-N.png

Letters are addressed "Current Resident" unless the CSV has a name. The candidate list uses only PUBLIC site addresses and lot shapes from the county
parcel layer: no owner names are read. Codes use an alphabet without 0/O/1/I; the QR code and printed URL point to <base>/l/<CODE>.
Needs `pip install segno` and Microsoft Edge. Print only after the site is live at --base: until then the QR leads nowhere.
"""
import argparse
import base64
import csv
import html
import json
import os
import random
import secrets
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA = ROOT / "data"
OUT = DATA / "letters"
LETTERS = DATA / "letters.json"
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
sys.path.insert(0, str(ROOT / "lotcheck"))

E = html.escape


def load():
    try:
        return json.loads(LETTERS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save(d):
    DATA.mkdir(exist_ok=True)
    LETTERS.write_text(json.dumps(d, ensure_ascii=False, indent=0), encoding="utf-8")


def new_code(existing):
    while True:
        c = "".join(secrets.choice(ALPHABET) for _ in range(6))
        if c not in existing:
            return c


def titlecase_street(s):
    out = []
    for w in s.title().split():
        out.append(w.upper() if w.upper() in ("NE", "NW", "SE", "SW", "N", "S", "E", "W") else w)
    return " ".join(out)


# ----------------------------------------------------------------------------- recipients
def entry_from_check(res, addr, city, state, zipc, name=None, batch="draft"):
    """Reduce a lotcheck() result to what the letter and splash page need."""
    fit, v, p = res.get("fit"), res.get("verdict") or {}, res.get("parcel")
    results = fit["results"] if fit else []
    best = None
    for r in results:  # the biggest that fits with at least a foot to spare (results are listed smallest first); a 0.1 ft "fit" is not worth a claim in print
        if r["fits"] and r["margin_ft"] is not None and r["margin_ft"] >= float(os.environ.get("WWA_MIN_MARGIN_FT", "1.0")) and r.get("size_ok", True):
            best = r
    terr = (fit or {}).get("terrain") or {}
    ground = next((r.get("ground") for r in results if best and r["model"] == best["model"]), None)
    return {"address": addr, "city": city, "state": state, "zip": zipc, "name": name, "batch": batch, "created": time.strftime("%Y-%m-%d"),
            "terrain_ok": bool(terr.get("checked")), "slope_blocked": any(r.get("slope_blocked") for r in results), "slope_pct": ground["mean_slope_pct"] if ground else None,
            "verdict": v.get("headline"), "status": v.get("status"), "lot_sf": p.get("area_sf") if p else None,
            "best": {"model": best["model"], "size": best["size_ft"], "margin": best["margin_ft"]} if best else None,
            "lot": fit}


def cmd_candidates(a):
    import server  # lotcheck/server.py
    rnd = random.Random(a.seed)
    rows = []
    for city in a.cities:
        off = 0
        while True:
            d = server.http_json(server.JACKSON, {"where": f"CITY='{city}' AND PROPCLASS='101' AND ACREAGE>={a.min_acres} AND ACREAGE<={a.max_acres} AND ADDRESSNUM IS NOT NULL",
                                                  "outFields": "MAPTAXLOT,SITEADD,ADDRESSNUM,CITY,ACREAGE", "returnGeometry": "false", "resultOffset": off, "resultRecordCount": 1000, "f": "json"})
            fs = d.get("features") or []
            rows += [f["attributes"] for f in fs]
            if len(fs) < 1000 or off > 5000:
                break
            off += 1000
    rows = [r for r in rows if r.get("SITEADD") and str(r.get("ADDRESSNUM", "")).strip()]
    rnd.shuffle(rows)
    print(f"{len(rows)} candidate parcels; checking until {a.n} qualify")
    letters, kept, seen = load(), 0, {v["address"].upper() for v in load().values()}
    for r in rows:
        if kept >= a.n:
            break
        site = " ".join(str(r["SITEADD"]).split()).title()
        if site.upper() in seen:
            continue
        try:
            res = server.lotcheck(f"{site}, {r['CITY'].title()}, OR")
        except Exception as e:
            print("  skip", site, str(e)[:60]); continue
        if not res.get("ok") or not res.get("fit"):
            continue
        if res["verdict"].get("status") not in ("likely",) or not res["fit"].get("buildings"):   # no footprint data = we cannot say the unit avoids the house
            continue
        z = (res["match"]["address"].split(",")[-1] or "").strip().split()[-1]
        code = new_code(letters)
        ent = entry_from_check(res, titlecase_street(site), r["CITY"].title(), "OR", z if z.isdigit() else "", batch=a.batch)
        if not ent["best"]:
            continue
        letters[code] = ent
        seen.add(site.upper()); kept += 1
        if kept % 10 == 0:
            save(letters); print(f"  {kept}/{a.n}")
        time.sleep(0.2)
    save(letters)
    print(f"{kept} added, {len(letters)} letters in {LETTERS}")


def cmd_csv(a):
    import server
    letters = load()
    with open(a.file, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            addr, city, st, z = (r.get("address") or "").strip(), (r.get("city") or "").strip(), (r.get("state") or "OR").strip(), (r.get("zip") or "").strip()
            if not addr:
                continue
            res = server.lotcheck(f"{addr}, {city}, {st} {z}".strip(", "))
            ent = entry_from_check(res if res.get("ok") else {"verdict": {}}, addr, city, st, z, name=(r.get("name") or "").strip() or None, batch=a.batch)
            if res.get("ok") and res.get("fit") and not ent["terrain_ok"]:
                print("NOT GENERATED (ground slope could not be checked):", addr); continue
            if ent["slope_blocked"] and not ent["best"]:
                print("NOT GENERATED (too steep or no route in for a prefab unit):", addr); continue
            code = new_code(letters)
            letters[code] = ent
            print(code, addr, "-", letters[code]["verdict"] or res.get("error"))
    save(letters)


# ----------------------------------------------------------------------------- pieces
def edge(*args, timeout=180):   # own Edge profile: a running Edge otherwise swallows the headless job
    return subprocess.run([EDGE, "--headless=new", "--disable-gpu-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--no-first-run", "--user-data-dir=" + str(DATA / "edge-profile"), *args],
                          capture_output=True, text=True, timeout=timeout)


def _recheck_one(job):
    code, query = job
    import server
    err = "no result"
    for attempt in range(2):
        try:
            res = server.lotcheck(query)
            if res.get("ok"):
                return code, res, None
            err = res.get("error", "no result")
        except Exception as e:
            err = str(e)[:60]
    return code, None, err


def cmd_recheck(a):
    """Re-run the lot check (now with ground slope) on every stored letter. Entries that no longer qualify are marked `dropped`
    and are neither printed nor shown on the splash page. Writes the result back to letters.json (backup kept next to it)."""
    import server
    from concurrent.futures import ProcessPoolExecutor
    letters = load()
    LETTERS.with_name("letters.pre-recheck.json").write_text(json.dumps(letters), encoding="utf-8")
    todo = [c for c, v in letters.items() if not v.get("rechecked")]
    if a.limit:
        todo = todo[:a.limit]

    done = 0
    jobs = [(c, f"{letters[c]['address']}, {letters[c]['city']}, {letters[c]['state']} {letters[c].get('zip') or ''}".strip()) for c in todo]
    with ProcessPoolExecutor(max_workers=4) as ex:   # processes, not threads: the placement search is CPU-bound and time-capped, so threads sharing one core would starve it
        for code, res, err in ex.map(_recheck_one, jobs):
            v = letters[code]
            if err or not res.get("ok") or not res.get("fit"):
                v["dropped"] = "check failed: " + (err or res.get("error", "no fit data"))[:60]
                v.pop("rechecked", None)   # run recheck again to retry these
                continue
            else:
                new = entry_from_check(res, v["address"], v["city"], v["state"], v.get("zip") or "", name=v.get("name"), batch=v.get("batch"))
                new["created"] = v.get("created")
                if v.get("area"):
                    new["area"] = v["area"]
                v.update(new)
                if not new["terrain_ok"]:
                    v["dropped"] = "ground slope could not be checked"
                elif new["status"] != "likely" or not new["best"]:
                    v["dropped"] = "slope or access rules out every unit" if new["slope_blocked"] else "no longer qualifies"
                else:
                    v.pop("dropped", None)
            v["rechecked"] = time.strftime("%Y-%m-%d")
            done += 1
            if done % 10 == 0:
                save(letters)
                print(f"  {done}/{len(todo)}, {sum(1 for x in letters.values() if x.get('dropped'))} dropped", flush=True)
    save(letters)
    print(f"{done} rechecked; {sum(1 for x in letters.values() if x.get('dropped'))} dropped, {sum(1 for x in letters.values() if not x.get('dropped'))} kept")


def cmd_hero(a):
    """Render the PL 384 at dusk with ADU.renderStill inside headless Edge and keep the JPEG."""
    src = ROOT / "src"
    page = ("<!doctype html><meta charset=utf-8><pre id=o>wait</pre><script src='https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'></script><script>"
            + (src / "adu.js").read_text(encoding="utf-8") + "</script><script>" + (src / "plan.js").read_text(encoding="utf-8") + "</script><script>"
            "var A=ADU,o=document.getElementById('o');try{var p=A.makeParams({width:24,depth:16,roof:'shed',pitch:A.pitchFor('shed')});"
            "o.textContent='IMG:'+A.renderStill(p,{dusk:true,finish:'charcoal'},{az:-0.98,el:0.1,fov:21,r:70,dx:-5,dz:-0.5},2550,780)}catch(e){o.textContent='ERR '+e}</script>")
    tmp = HERE / "_hero.html"
    tmp.write_text(page, encoding="utf-8")
    r = edge("--virtual-time-budget=25000", "--dump-dom", tmp.as_uri())
    tmp.unlink(missing_ok=True)
    dom = r.stdout
    i = dom.find("IMG:data:image/jpeg;base64,")
    if i < 0:
        print("no image;", dom[dom.find("<pre"):][:300], r.stderr[-300:]); sys.exit(1)
    b64 = dom[i + len("IMG:data:image/jpeg;base64,"):].split("</pre>")[0].strip()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "hero.jpg").write_bytes(base64.b64decode(b64))
    print("hero.jpg", (OUT / "hero.jpg").stat().st_size // 1024, "KB")


def lot_svg(rec):
    """Lot outline, setback area and the placed unit, as a small ink-friendly SVG (feet, north up)."""
    f = rec.get("lot")
    if not f:
        return ""
    pts = f["lot"]
    xs, ys = [q[0] for q in pts], [q[1] for q in pts]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    pad = max(maxx - minx, maxy - miny) * 0.06 + 3
    W, H = maxx - minx + 2 * pad, maxy - miny + 2 * pad

    def P(q):
        return f"{q[0] - minx + pad:.1f},{maxy - q[1] + pad:.1f}"
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {H:.1f}" class="lot">']
    o.append(f'<polygon points="{" ".join(P(q) for q in pts)}" fill="#fff" stroke="#0b0a08" stroke-width="{W / 160:.2f}"/>')
    d = ""
    for c in f.get("envelope_cells") or []:
        x, y = c[0] - minx + pad, maxy - c[3] + pad
        d += f"M{x:.1f} {y:.1f}h{c[2] - c[0]:.1f}v{c[3] - c[1]:.1f}h-{c[2] - c[0]:.1f}z"
    if d:
        o.append(f'<path d="{d}" fill="#e9e4d8" stroke="none"/>')
    o.append(f'<clipPath id="lotclip"><polygon points="{" ".join(P(q) for q in pts)}"/></clipPath>')   # slope cells are sampled on a padded grid: clip them to the lot
    for key, col in (("caution_cells", "#f0dca0"), ("steep_cells", "#b9453a")):   # ground slope: pale = needs earthwork, dark red = too steep
        d2 = ""
        for c in (f.get("terrain") or {}).get(key) or []:
            x, y = c[0] - minx + pad, maxy - c[3] + pad
            d2 += f"M{x:.1f} {y:.1f}h{c[2] - c[0]:.1f}v{c[3] - c[1]:.1f}h-{c[2] - c[0]:.1f}z"
        if d2:
            o.append(f'<path d="{d2}" fill="{col}" fill-opacity=".38" stroke="none" clip-path="url(#lotclip)"/>')
    ct = (f.get("terrain") or {}).get("contours")
    if ct:   # topographic contour lines (USGS 3DEP lidar): thin brown, every fifth line heavier with its elevation in feet
        thin = thick = ""
        labels = []
        for lv in ct["levels"]:
            d3 = ""
            for x0, y0, x1, y1 in lv["segs"]:
                d3 += f"M{x0 - minx + pad:.1f} {maxy - y0 + pad:.1f}L{x1 - minx + pad:.1f} {maxy - y1 + pad:.1f}"
            if lv["idx"]:
                thick += d3
                x0, y0, x1, y1 = lv["segs"][len(lv["segs"]) // 2]
                labels.append((lv["ft"], (x0 + x1) / 2 - minx + pad, maxy - (y0 + y1) / 2 + pad))
            else:
                thin += d3
        if thin:
            o.append(f'<path d="{thin}" fill="none" stroke="#9a7b55" stroke-width="{W / 800:.2f}" stroke-linecap="round"/>')
        if thick:
            o.append(f'<path d="{thick}" fill="none" stroke="#6e5232" stroke-width="{W / 420:.2f}" stroke-linecap="round"/>')
        for ft, lx, ly in labels:
            o.append(f'<text x="{lx:.1f}" y="{ly:.1f}" font-size="{W / 30:.1f}" font-family="Arial,sans-serif" fill="#4a3920" text-anchor="middle" stroke="#fff" stroke-width="{W / 150:.2f}" paint-order="stroke">{ft}</text>')
    for b in f.get("buildings") or []:   # existing buildings (satellite-derived footprints)
        o.append(f'<polygon points="{" ".join(P(q) for q in b)}" fill="#8f897b" stroke="#0b0a08" stroke-width="{W / 400:.2f}"/>')
    best = rec.get("best")
    pl = next((r["placement"] for r in f["results"] if best and r["model"] == best["model"] and r.get("placement")), None)
    if pl:
        o.append(f'<polygon points="{" ".join(P(q) for q in pl)}" fill="#c8553a" stroke="#0b0a08" stroke-width="{W / 300:.2f}"/>')
    if f.get("front_edge"):
        o.append(f'<polyline points="{" ".join(P(q) for q in f["front_edge"])}" fill="none" stroke="#0b0a08" stroke-width="{W / 60:.2f}" stroke-dasharray="{W / 40:.1f} {W / 80:.1f}"/>')
    o.append("</svg>")
    return "".join(o)


def qr_svg(url):
    import segno
    return segno.make(url, error="m").svg_inline(scale=4, border=4, dark="#0b0a08", light="#ffffff", omitsize=True)


def money(n):
    return f"{n:,}"


CSS = """
@page{size:8.5in 11in;margin:0}
*{box-sizing:border-box;margin:0}
html,body{background:#fff}
body{font:10.5pt/1.5 'Segoe UI',Arial,sans-serif;color:#1b1a17;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{position:relative;width:8.5in;height:11in;overflow:hidden;page-break-after:always;break-after:page}
.lh{position:absolute;left:.9in;right:.9in;top:.55in;display:flex;justify-content:space-between;align-items:baseline;font-size:8pt;letter-spacing:.22em;text-transform:uppercase}
.lh b{font-weight:600;letter-spacing:.26em}.lh span{color:#7a7467}
.to{position:absolute;left:.95in;top:2.05in;width:3.9in;font-size:10.5pt;line-height:1.35}
.hl{position:absolute;left:.9in;right:.9in;top:3.35in}
h1{font:400 27pt/1.04 Georgia,'Times New Roman',serif;letter-spacing:-.01em;margin-bottom:.18in}
.body{position:absolute;left:.9in;width:4.15in;top:4.55in;font-size:10.2pt;line-height:1.5}
.body p{margin-bottom:.1in}
.right{position:absolute;right:.9in;top:4.5in;width:2.3in}
.lot{width:100%;height:2.15in;display:block;border:.6pt solid #cfc8b8;background:#fff}
.cap{font-size:7pt;line-height:1.35;color:#7a7467;margin-top:.05in}
.qr{position:absolute;left:3.75in;top:7.47in;width:4.1in;display:flex;gap:.16in;align-items:center}
.qr svg{width:1.15in;height:1.15in;flex:none;margin:-.12in 0}.qr div{font-size:8pt;line-height:1.4;color:#3a372f}.qr b{display:block;font:400 11pt/1.2 Georgia,serif;color:#0b0a08;letter-spacing:.01em;margin-top:.03in;word-break:break-all}
.sig{position:absolute;left:.9in;top:7.55in;width:2.7in;font-size:10.2pt;line-height:1.35}
.sig i{display:block;height:.3in}
.sig small{display:block;font-size:8pt;color:#7a7467;letter-spacing:.04em}
.hero{position:absolute;left:0;right:0;bottom:0;height:2in;background:#0b0a08 center 46%/cover no-repeat}
.hero:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,#0b0a08 0%,rgba(11,10,8,0) 22%)}
.fine{position:absolute;left:.9in;right:.9in;bottom:2.05in;font-size:7pt;line-height:1.4;color:#8f897b}
.tag{position:absolute;left:.9in;bottom:1.5in;z-index:2;color:#f1ece1;font-size:8pt;letter-spacing:.22em;text-transform:uppercase}
.tag b{font:300 15pt Georgia,serif;letter-spacing:.01em;text-transform:none;display:block;margin-bottom:.02in}
"""


def letter_html(code, rec, base, hero_uri):
    street = rec["address"]
    addr_line = f'{street}<br>{E(rec["city"] or "")}, {E(rec["state"] or "OR")} {E(rec["zip"] or "")}'
    who = E(rec["name"]) if rec.get("name") else "Current Resident"
    sal = "Dear neighbor,"
    if rec.get("name"):
        nm = rec["name"].strip()
        if " and " in nm or " & " in nm:   # a couple: "Dear Thomas and Kathy,"
            first = [w.split()[0] for w in nm.replace(" & ", " and ").split(" and ") if w.split()]
            sal = f'Dear {E(" and ".join(first))},'
        else:
            sal = f'Dear {E(nm.split()[0])},'
    best, sf = rec.get("best"), rec.get("lot_sf")
    gap = ((rec.get("lot") or {}).get("assumptions") or {}).get("building_clear_ft", 6)   # the gap the check actually used for this lot
    area = {"PL 384": 384, "PL 576": 576, "PL 768": 768}.get(best["model"]) if best else None
    if best and sf:
        find = (f"The county shows your lot at about <b>{money(sf)} square feet</b>. Using the state's rules, cautious setbacks and the buildings already on the lot, "
                f"a <b>{area} square foot</b> backyard home looks like it could fit. "
                f"The drawing shows where. It is an estimate from public records."
                + (f" The ground there is gentle, about {rec['slope_pct']:g}% slope on public elevation data." if rec.get("slope_pct") is not None else ""))
    elif sf:
        find = f"The county shows your lot at about <b>{money(sf)} square feet</b>. It is a close call, and I would be glad to look at it properly."
    else:
        find = "I could not find enough on the county record to say, but I would be glad to look at it properly."
    area_rec = rec.get("area") or {}
    rent = area_rec.get("rent_used")
    if best and rent:   # sourced, not promised: the Census median for the neighbourhood, per year, before costs
        find += (f" Typical rent in your area is about <b>${money(int(rent))} a month</b> (Census), so a backyard home might bring in roughly <b>${money(int(round(rent * 12, -2)))} a year</b>, before costs.")
    url = f"{base}/l/{code}"
    return f"""<section class="page">
<div class="lh"><b>Willard Williams Architect</b><span>Phoenix, Oregon</span></div>
<div class="to">{who}<br>{addr_line}</div>
<div class="hl"><h1>We looked at {E(street)}.<br>Here is what we found.</h1></div>
<div class="body"><p>{sal}</p>
<p>I am an architect in Phoenix. I design small backyard homes built from factory panels. Out of curiosity, I looked up your property.</p>
<p>{find}</p>
<p>If a second home, a place for family or a rental has crossed your mind, scan the code to see your lot in 3D. No form, and no one will call. To talk, write or ring me.</p></div>
<div class="right">{lot_svg(rec)}<div class="cap">Your lot (outline), the room left after setbacks and a {gap:g} ft gap from the buildings (light), the buildings now on it (grey) and a {E(best["model"]) if best else "unit"} placed on it (rust). Brown lines: ground contours every {(((rec.get("lot") or {}).get("terrain") or {}).get("contours") or {}).get("interval_ft", 5)} ft, from public lidar. Dashed edge: the street side, assumed. A first look from public records, not a survey.</div></div>
<div class="sig"><i></i>Willard Williams, Architect<small>willardw@willardwilliamsarchitect.com<br>(425) 951-9459</small></div>
<div class="qr">{qr_svg(url)}<div>Scan, or go to<br><b>{E(url.replace("https://", "").replace("http://", ""))}</b></div></div>
<div class="fine">Planning figures only: setbacks are assumed, building outlines come from satellite data that can be out of date, and easements, utilities and your city's size limits are not checked. Nothing is built before we confirm the rules with your city or county. Construction work is by Trillium Design Build Company, Oregon CCB #257175. You will get this letter once. If you would rather not hear from us, do nothing.</div>
<div class="hero" style="background-image:url('{hero_uri}')"></div><div class="tag"><b>Precision, at home.</b>Prefabricated ADUs &middot; Oregon &middot; Washington &middot; California</div>
</section>"""


def cmd_build(a):
    letters = json.loads(Path(a.letters).read_text(encoding="utf-8")) if a.letters else load()
    codes = [c for c, v in letters.items() if (v.get("batch") == a.batch if a.batch else True) and not v.get("dropped")]
    if a.limit:
        codes = codes[:a.limit]
    if not codes:
        print("no letters; run candidates or csv first"); sys.exit(1)
    OUT.mkdir(parents=True, exist_ok=True)
    hero = OUT / "hero.jpg"
    if not hero.exists():
        print("no hero.jpg yet; run `letters.py hero`"); sys.exit(1)
    body = "".join(letter_html(c, letters[c], a.base.rstrip("/"), hero.as_uri()) for c in codes)
    f = OUT / "letters.html"
    f.write_text(f"<!doctype html><html><head><meta charset=utf-8><title>Letters</title><style>{CSS}</style></head><body>{body}</body></html>", encoding="utf-8")
    with open(OUT / "mailmerge.csv", "w", newline="", encoding="utf-8") as m:
        w = csv.writer(m)
        w.writerow(["code", "name", "address", "city", "state", "zip", "url", "lot_sf", "best_fit", "batch"])
        for c in codes:
            v = letters[c]
            w.writerow([c, v.get("name") or "Current Resident", v["address"], v["city"], v["state"], v["zip"], f"{a.base.rstrip('/')}/l/{c}", v.get("lot_sf") or "", (v.get("best") or {}).get("model", ""), v.get("batch")])
    pdf = OUT / "letters.pdf"
    r = edge("--virtual-time-budget=20000", "--no-pdf-header-footer", f"--print-to-pdf={pdf}", f.as_uri(), timeout=600)
    print(len(codes), "letters ->", pdf, f"{pdf.stat().st_size // 1024} KB" if pdf.exists() else "FAILED " + r.stderr[-300:])
    if a.proof:
        one = OUT / "_one.html"
        one.write_text(f"<!doctype html><html><head><meta charset=utf-8><style>{CSS}</style></head><body>{letter_html(codes[0], letters[codes[0]], a.base.rstrip('/'), hero.as_uri())}</body></html>", encoding="utf-8")
        edge("--virtual-time-budget=8000", "--hide-scrollbars", f"--screenshot={OUT / 'proof-1.png'}", "--window-size=816,1056", one.as_uri())
        print("proof ->", OUT / "proof-1.png")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    c = sp.add_parser("candidates"); c.add_argument("--n", type=int, default=200); c.add_argument("--cities", nargs="+", default=["PHOENIX", "TALENT"])
    c.add_argument("--min-acres", type=float, default=0.17); c.add_argument("--max-acres", type=float, default=0.75); c.add_argument("--seed", type=int, default=7); c.add_argument("--batch", default="draft-1")
    x = sp.add_parser("csv"); x.add_argument("file"); x.add_argument("--batch", default="csv-1")
    sp.add_parser("hero")
    rc = sp.add_parser("recheck"); rc.add_argument("--limit", type=int)
    b = sp.add_parser("build"); b.add_argument("--base", default="https://willardwilliamsarchitect.com"); b.add_argument("--limit", type=int); b.add_argument("--batch"); b.add_argument("--proof", action="store_true"); b.add_argument("--letters", help="read a different letters.json (for proofs)")
    a = ap.parse_args()
    {"candidates": cmd_candidates, "csv": cmd_csv, "hero": cmd_hero, "build": cmd_build, "recheck": cmd_recheck}[a.cmd](a)
