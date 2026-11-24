"""Find the best backyard-unit candidates across a whole county list instead of a random sample.

    python rank.py pool                 # every class-101 home lot of 0.17-0.75 acre in Medford, Ashland, Talent, Phoenix (with outlines)  -> data/rank/pool.json
    python rank.py prescreen            # cheap ground-slope estimate for every lot (USGS 3DEP, 16 points per lot)                         -> data/rank/prescreen.json
    python rank.py check --n 900        # full lot check (setbacks, buildings, slope, route in) on the most promising lots, resumable     -> data/rank/checked.jsonl
    python rank.py pick --top 200       # score the survivors, write the best 200 into letters.json as a new batch
    python rank.py all                  # everything above

Every stage can be stopped and restarted: work already done is not repeated. Nothing here prints or mails anything.
Score: bigger unit that fits (PL 768 > 576 > 384), more margin, gentler ground, smaller relief, bigger lot. Lots that are steep, have
no building footprint on record, cannot be reached from the street, or are on the held list are never picked.
"""
import argparse
import json
import math
import sys
import time
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA = ROOT / "data" / "rank"
sys.path.insert(0, str(ROOT / "lotcheck"))
sys.path.insert(0, str(HERE))

CITIES = ["MEDFORD", "ASHLAND", "TALENT", "PHOENIX"]
WHERE = "CITY='{c}' AND PROPCLASS='101' AND ACREAGE>=0.17 AND ACREAGE<=0.75 AND ADDRESSNUM IS NOT NULL"
MODEL_PTS = {"PL 384": 1, "PL 576": 2, "PL 768": 3}
BATCH = "top200-2026-11-24"


def cmd_pool(a):
    import server
    DATA.mkdir(parents=True, exist_ok=True)
    pool, seen = [], set()
    for city in CITIES:
        off = 0
        while True:
            d = server.http_json(server.JACKSON, {"where": WHERE.format(c=city), "outFields": "MAPTAXLOT,SITEADD,ADDRESSNUM,CITY,ACREAGE",
                                                  "returnGeometry": "true", "outSR": 4326, "resultOffset": off, "resultRecordCount": 400, "f": "json"}, timeout=90)
            fs = d.get("features") or []
            for f in fs:
                at, g = f["attributes"], f.get("geometry") or {}
                rings = g.get("rings") or []
                if not rings or not at.get("SITEADD") or at["MAPTAXLOT"] in seen:
                    continue
                seen.add(at["MAPTAXLOT"])
                ring = max(rings, key=len)
                pool.append({"id": at["MAPTAXLOT"], "addr": " ".join(str(at["SITEADD"]).split()), "city": city, "acres": at.get("ACREAGE"),
                             "ring": [[round(x, 6), round(y, 6)] for x, y in ring]})
            print(f"  {city} {off + len(fs)}", flush=True)
            if len(fs) < 400:
                break
            off += 400
    (DATA / "pool.json").write_text(json.dumps(pool), encoding="utf-8")
    print(f"pool: {len(pool)} lots")


def _grid(p, n=4):
    xs, ys = [q[0] for q in p["ring"]], [q[1] for q in p["ring"]]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    pts = [[x0 + (x1 - x0) * (i + 0.5) / n, y0 + (y1 - y0) * (j + 0.5) / n] for j in range(n) for i in range(n)]
    return pts, (x1 - x0, y1 - y0)


def cmd_prescreen(a):
    import terrain
    pool = json.loads((DATA / "pool.json").read_text(encoding="utf-8"))
    out_f = DATA / "prescreen.json"
    done = json.loads(out_f.read_text(encoding="utf-8")) if out_f.exists() else {}
    todo = [p for p in pool if p["id"] not in done]
    print(f"prescreen: {len(todo)} lots to do", flush=True)
    n = 4
    chunks = [todo[i:i + 80] for i in range(0, len(todo), 80)]   # 80 lots x 16 points = 1280 points = 4 requests

    def run(chunk):
        pts, meta = [], []
        for p in chunk:
            g, (w, h) = _grid(p, n)
            meta.append((p["id"], len(pts), w, h))
            pts += g
        try:
            z = terrain.sample_lonlat([[round(x, 6), round(y, 6)] for x, y in pts])
        except Exception as e:
            return {}, str(e)[:60]
        res = {}
        for pid, i0, wdeg, hdeg in meta:
            wm = wdeg * 111320.0 * math.cos(math.radians(pts[i0][1]))
            hm = hdeg * 110540.0
            zz = z[i0:i0 + n * n]
            if any(v is None for v in zz):
                res[pid] = None
                continue
            dx, dy = max(wm / n, 1e-6), max(hm / n, 1e-6)
            g = []
            for j in range(n):
                for i in range(n):
                    if i + 1 < n:
                        g.append(abs(zz[j * n + i + 1] - zz[j * n + i]) / dx)
                    if j + 1 < n:
                        g.append(abs(zz[(j + 1) * n + i] - zz[j * n + i]) / dy)
            res[pid] = round(100.0 * sum(g) / len(g), 1)
        return res, None
    t0, bad = time.time(), 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        for k, (res, err) in enumerate(ex.map(run, chunks)):
            bad += bool(err)
            done.update(res)
            if k % 20 == 0:
                out_f.write_text(json.dumps(done), encoding="utf-8")
                print(f"  {len(done)}/{len(pool)} ({int(time.time() - t0)}s, {bad} failed batches)", flush=True)
    out_f.write_text(json.dumps(done), encoding="utf-8")
    vals = sorted(v for v in done.values() if v is not None)
    print(f"prescreen done: {len(vals)} with slope; median {vals[len(vals) // 2]}%, under 10%: {sum(1 for v in vals if v < 10)}, under 14%: {sum(1 for v in vals if v < 14)}", flush=True)


def _check_one(job):
    pid, query = job
    import server
    err = "no result"
    for attempt in range(2):
        try:
            res = server.lotcheck(query)
            if res.get("ok"):
                return pid, res, None
            err = res.get("error", "no result")
        except Exception as e:
            err = str(e)[:60]
    return pid, None, err


def promising(max_slope):
    pool = json.loads((DATA / "pool.json").read_text(encoding="utf-8"))
    pre = json.loads((DATA / "prescreen.json").read_text(encoding="utf-8"))
    rows = []
    for p in pool:
        s = pre.get(p["id"])
        if s is None or s > max_slope:
            continue
        rows.append((min(p.get("acres") or 0, 0.5) * 10 - s * 0.3, p))   # proxy: roomy but not huge, gentle
    rows.sort(key=lambda r: -r[0])
    return [p for _, p in rows], pre


def stratified(max_slope, quotas, seed=11):
    """A spread of lots instead of just the biggest: a random sample per town, and for Medford the mid-sized lots
    (0.17-0.4 acre) where the smaller units are the natural fit. quotas: {city: n}."""
    import random
    rnd = random.Random(seed)
    pool = json.loads((DATA / "pool.json").read_text(encoding="utf-8"))
    pre = json.loads((DATA / "prescreen.json").read_text(encoding="utf-8"))
    out = []
    for city, n in quotas.items():
        rows = [p for p in pool if p["city"] == city and pre.get(p["id"]) is not None and pre[p["id"]] <= max_slope
                and (city != "MEDFORD" or (p.get("acres") or 0) <= 0.4)]
        rnd.shuffle(rows)
        out += rows[:n]
    return out, pre


def cmd_check(a):
    import letters
    if a.strata:
        rows, pre = stratified(a.max_slope, {"ASHLAND": 300, "TALENT": 200, "PHOENIX": 200, "MEDFORD": 300})
        a.n = len(rows)
    else:
        rows, pre = promising(a.max_slope)
    out_f = DATA / "checked.jsonl"
    seen = set()
    if out_f.exists():
        for line in out_f.read_text(encoding="utf-8").splitlines():
            try:
                seen.add(json.loads(line)["id"])
            except ValueError:
                pass
    todo = [p for p in rows[:a.n] if p["id"] not in seen]
    print(f"check: {len(rows)} lots under {a.max_slope}% prescreen slope; top {a.n}: {len(todo)} to do ({len(seen)} done)", flush=True)
    jobs = [(p["id"], f"{p['addr'].title()}, {p['city'].title()}, OR") for p in todo]
    meta = {p["id"]: p for p in todo}
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=4) as ex, open(out_f, "a", encoding="utf-8") as fh:
        for k, (pid, res, err) in enumerate(ex.map(_check_one, jobs)):
            p = meta[pid]
            rec = {"id": pid, "addr": p["addr"], "city": p["city"].title(), "acres": p.get("acres"), "pre": pre.get(pid)}
            if err or not res.get("fit"):
                rec["error"] = err or "no fit data"
            else:
                z = (res["match"]["address"].split(",")[-1] or "").strip().split()[-1]
                rec["entry"] = letters.entry_from_check(res, letters.titlecase_street(p["addr"]), p["city"].title(), "OR", z if z.isdigit() else "", batch=BATCH)
            fh.write(json.dumps(rec) + "\n")
            if k % 25 == 0:
                fh.flush()
                print(f"  {k + 1}/{len(jobs)} ({int(time.time() - t0)}s)", flush=True)
    print("check done", flush=True)


def score(ent):
    best = ent["best"]
    ground = next((r.get("ground") for r in (ent.get("lot") or {}).get("results", []) if r["model"] == best["model"]), None) or {}
    return (40 * MODEL_PTS.get(best["model"], 0) + 1.5 * min(best["margin"], 12) - 2.0 * (ent.get("slope_pct") or 0)
            - 1.0 * (ground.get("relief_ft") or 0) + min(ent.get("lot_sf") or 0, 12000) / 600.0)


def cmd_pick(a):
    import letters
    recs = [json.loads(line) for line in (DATA / "checked.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    held = {v["address"].upper() for v in letters.load().values() if v.get("batch") == "held-aerial-check"}
    ok, why = [], {}
    for r in recs:
        e = r.get("entry")
        if not e:
            reason = "check failed"
        else:
            lot = e.get("lot") or {}
            if e["address"].upper() in held:
                reason = "held (aerial check)"
            elif not e["terrain_ok"]:
                reason = "slope unchecked"
            elif e["status"] != "likely":
                reason = "slope or access rules out every unit" if e["slope_blocked"] else "needs review"
            elif not lot.get("buildings"):
                reason = "no building footprint on record"
            elif not e["best"]:
                reason = "no unit fits with a safe margin"
            elif not (lot.get("terrain") or {}).get("route_checked"):
                reason = "street side unknown (route in not checked)"
            else:
                reason = None
        if reason:
            why[reason] = why.get(reason, 0) + 1
        else:
            ok.append((score(e), r))
    ok.sort(key=lambda t: -t[0])
    print(f"{len(recs)} checked; {len(ok)} qualify; rejected: {why}")
    if a.mix:   # best by score, but with ceilings so the 200 are not all one unit size or one town
        model_cap = {"PL 768": int(a.top * 0.40), "PL 576": int(a.top * 0.35), "PL 384": int(a.top * 0.35)}
        city_cap = {"Medford": int(a.top * 0.50), "Ashland": int(a.top * 0.28), "Talent": int(a.top * 0.18), "Phoenix": int(a.top * 0.18)}
        mc, cc, top, rest = {}, {}, [], []
        for item in ok:
            e = item[1]["entry"]
            m, c = e["best"]["model"], e["city"]
            if mc.get(m, 0) < model_cap.get(m, 0) and cc.get(c, 0) < city_cap.get(c, 0) and len(top) < a.top:
                top.append(item); mc[m] = mc.get(m, 0) + 1; cc[c] = cc.get(c, 0) + 1
            else:
                rest.append(item)
        for item in rest:   # ceilings can leave gaps; fill them with the next best
            if len(top) >= a.top:
                break
            top.append(item)
        top.sort(key=lambda t: -t[0])
    else:
        top = ok[:a.top]
    if len(top) < a.top:
        print(f"only {len(top)} qualify: run `check --n` with a larger number")
    everything = letters.load()
    for code in [c for c, v in everything.items() if v.get("batch") == BATCH]:
        del everything[code]   # re-running pick replaces the batch
    for s, r in top:
        code = letters.new_code(everything)
        r["entry"]["rank_score"] = round(s, 1)
        everything[code] = r["entry"]
    letters.save(everything)
    models = {}
    for s, r in top:
        m = r["entry"]["best"]["model"]
        models[m] = models.get(m, 0) + 1
    if top:
        towns = {}
        for s_, r in top:
            towns[r["entry"]["city"]] = towns.get(r["entry"]["city"], 0) + 1
        print(f"wrote {len(top)} letters (batch {BATCH}): {models}; {towns}; score {top[-1][0]:.1f} to {top[0][0]:.1f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["pool", "prescreen", "check", "pick", "all"])
    ap.add_argument("--n", type=int, default=900)
    ap.add_argument("--top", type=int, default=200)
    ap.add_argument("--max-slope", type=float, default=14.0)
    ap.add_argument("--strata", action="store_true", help="check: a spread across towns and lot sizes instead of the top of the proxy ranking")
    ap.add_argument("--mix", action="store_true", help="pick: cap each unit size and town so the list has variety")
    a = ap.parse_args()
    for st in (["pool", "prescreen", "check", "pick"] if a.stage == "all" else [a.stage]):
        print(f"== {st}", flush=True)
        {"pool": cmd_pool, "prescreen": cmd_prescreen, "check": cmd_check, "pick": cmd_pick}[st](a)


if __name__ == "__main__":
    main()
