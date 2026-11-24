"""Ground slope for a lot, from USGS 3DEP elevation (1 m lidar where it exists; free, no key).

A grid of elevations is sampled over the lot's bounding box (local metres, the same frame as geom.py),
smoothed, and turned into slope in percent. The lot check then refuses to place a unit where the ground is
too steep, and checks that a delivery/crane route can reach the spot without crossing steep ground.

Limits are placeholders to be confirmed by the builder (see THRESHOLDS); they are deliberately cautious,
because a unit shown on ground that cannot be built on is worse than no unit.
"""
import json
import math
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

R_EARTH = 6371008.8
FT = 0.3048
URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples"

THRESHOLDS = {
    "block_pct": 20.0,    # a grid cell steeper than this is treated as unbuildable
    "caution_pct": 10.0,  # above this the site needs real earthwork, shown as a caution
    "mean_pct": 15.0,     # average slope under the footprint must be below this
    "max_blocked_share": 0.05,
    "access_pct": 15.0,   # steepest ground a delivery truck / crane route may cross
}


class TerrainError(Exception):
    pass


def _post(points):
    body = urllib.parse.urlencode({
        "geometry": json.dumps({"points": points, "spatialReference": {"wkid": 4326}}),
        "geometryType": "esriGeometryMultipoint", "returnFirstValueOnly": "true",
        "interpolation": "RSP_BilinearInterpolation", "f": "json"}).encode()
    req = urllib.request.Request(URL, data=body, headers={"User-Agent": "wwa-lotcheck"})
    d = None
    for attempt in range(3):   # the public service times out now and then
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                d = json.loads(r.read().decode("utf-8"))
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1.5 * (attempt + 1))
    if "samples" not in d:
        raise TerrainError(str(d.get("error", d))[:120])
    out = [None] * len(points)
    for s in d["samples"]:
        try:
            out[int(s["locationId"])] = float(s["value"])
        except (KeyError, ValueError, TypeError):
            pass
    return out


def sample_lonlat(points, batch=400):
    chunks = [points[i:i + batch] for i in range(0, len(points), batch)]
    with ThreadPoolExecutor(max_workers=4) as ex:
        res = list(ex.map(_post, chunks))
    return [v for r in res for v in r]


class Terrain:
    def __init__(self, poly, lon0, lat0, cx, cy, max_points=2600):
        """poly: lot ring in the local frame (metres, already shifted by cx, cy). lon0/lat0/cx/cy as in server.lotcheck."""
        xs, ys = [p[0] for p in poly], [p[1] for p in poly]
        pad = 6.0
        self.x0, self.y0 = min(xs) - pad, min(ys) - pad
        w, h = max(xs) + pad - self.x0, max(ys) + pad - self.y0
        step = max(3.0, math.sqrt(w * h / max_points))
        self.step = step
        self.nx, self.ny = int(w / step) + 1, int(h / step) + 1
        pts = []
        for j in range(self.ny):
            for i in range(self.nx):
                ox, oy = self.x0 + i * step + cx, self.y0 + j * step + cy   # back to the frame centred on lon0/lat0
                lon = lon0 + math.degrees(ox / (R_EARTH * math.cos(math.radians(lat0))))
                lat = lat0 + math.degrees(oy / R_EARTH)
                pts.append([round(lon, 7), round(lat, 7)])
        vals = sample_lonlat(pts)
        good = [v for v in vals if v is not None]
        if len(good) < 0.9 * len(vals):
            raise TerrainError("elevation data missing for this lot")
        fill = sum(good) / len(good)
        self.poly = poly
        self.reach = None
        self.z = [[(vals[j * self.nx + i] if vals[j * self.nx + i] is not None else fill) for i in range(self.nx)] for j in range(self.ny)]
        self._slope()

    def _slope(self):
        nx, ny, s, z = self.nx, self.ny, self.step, self.z
        # 3x3 mean smoothing first: lidar picks up fences, cars and shrubs that are not the ground
        sm = [[0.0] * nx for _ in range(ny)]
        for j in range(ny):
            for i in range(nx):
                a = [z[jj][ii] for jj in range(max(0, j - 1), min(ny, j + 2)) for ii in range(max(0, i - 1), min(nx, i + 2))]
                sm[j][i] = sum(a) / len(a)
        self.zs = sm
        self.sl = [[0.0] * nx for _ in range(ny)]
        for j in range(ny):
            for i in range(nx):
                i0, i1, j0, j1 = max(0, i - 1), min(nx - 1, i + 1), max(0, j - 1), min(ny - 1, j + 1)
                dzdx = (sm[j][i1] - sm[j][i0]) / ((i1 - i0) * s)
                dzdy = (sm[j1][i] - sm[j0][i]) / ((j1 - j0) * s)
                self.sl[j][i] = 100.0 * math.hypot(dzdx, dzdy)

    # ---- lookups (poly-local metres) ----
    def _ij(self, x, y):
        return (min(self.nx - 1, max(0, int(round((x - self.x0) / self.step)))), min(self.ny - 1, max(0, int(round((y - self.y0) / self.step)))))

    def slope_at(self, x, y):
        i, j = self._ij(x, y)
        return self.sl[j][i]

    def elev_at(self, x, y):
        i, j = self._ij(x, y)
        return self.zs[j][i]

    def rect_stats(self, corners):
        """corners: 4 points. -> (mean slope %, share of samples steeper than the block limit, relief in ft)."""
        a, b, c, d = corners
        n = max(2, int(max(math.hypot(b[0] - a[0], b[1] - a[1]), math.hypot(d[0] - a[0], d[1] - a[1])) / self.step) + 1)
        sl, zz, blocked = [], [], 0
        for u in range(n + 1):
            for v in range(n + 1):
                fu, fv = u / n, v / n
                x = a[0] + fu * (b[0] - a[0]) + fv * (d[0] - a[0])
                y = a[1] + fu * (b[1] - a[1]) + fv * (d[1] - a[1])
                s = self.slope_at(x, y)
                sl.append(s)
                zz.append(self.elev_at(x, y))
                blocked += s > THRESHOLDS["block_pct"]
        return sum(sl) / len(sl), blocked / len(sl), (max(zz) - min(zz)) / FT

    def rect_ok(self, corners):
        mean, share, _ = self.rect_stats(corners)
        if mean > THRESHOLDS["mean_pct"] or share > THRESHOLDS["max_blocked_share"]:
            return False
        if self.reach is not None:
            cx = sum(c[0] for c in corners) / 4
            cy = sum(c[1] for c in corners) / 4
            if not self.reachable(cx, cy):
                return False
        return True

    def cell_ok(self, x, y):
        """Used for the buildable-area map: ground not too steep, and reachable from the street when that is known."""
        return self.slope_at(x, y) <= THRESHOLDS["block_pct"] and (self.reach is None or self.reachable(x, y))

    def set_street(self, front_edge):
        """Work out which cells inside the lot a vehicle can reach from the street frontage (front_edge = two points, poly-local metres)
        crossing only ground under access_pct. Seeds are the lot cells along the frontage."""
        import geom
        lim = THRESHOLDS["access_pct"]
        inside = lambda i, j: geom.point_in_poly((self.x0 + i * self.step, self.y0 + j * self.step), self.poly)
        a, b = front_edge
        seeds = []
        for j in range(self.ny):
            for i in range(self.nx):
                if self.sl[j][i] <= lim and inside(i, j) and geom.seg_dist((self.x0 + i * self.step, self.y0 + j * self.step), a, b) <= 1.6 * self.step:
                    seeds.append((i, j))
        seen, stack = set(seeds), list(seeds)
        while stack:
            i, j = stack.pop()
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    ii, jj = i + di, j + dj
                    if (ii, jj) in seen or not (0 <= ii < self.nx and 0 <= jj < self.ny) or self.sl[jj][ii] > lim or not inside(ii, jj):
                        continue
                    seen.add((ii, jj))
                    stack.append((ii, jj))
        self.reach = seen

    def reachable(self, x, y):
        i, j = self._ij(x, y)
        return any((i + a, j + b) in self.reach for a in (-1, 0, 1) for b in (-1, 0, 1))

    def cells(self, kind="block"):
        """Merged horizontal runs [x0, y0, x1, y1] in feet (poly-local) where the ground is steeper than the limit."""
        import geom
        lim = THRESHOLDS["block_pct"] if kind == "block" else THRESHOLDS["caution_pct"]
        s, runs = self.step, []
        inside = lambda i, j: geom.point_in_poly((self.x0 + i * s, self.y0 + j * s), self.poly)   # only cells on the lot, not the padding round it
        for j in range(self.ny):
            start = None
            for i in range(self.nx + 1):
                on = i < self.nx and inside(i, j) and (self.sl[j][i] > lim if kind == "block" else lim < self.sl[j][i] <= THRESHOLDS["block_pct"])
                if on and start is None:
                    start = i
                if not on and start is not None:
                    runs.append([round((self.x0 + (start - 0.5) * s) / FT, 1), round((self.y0 + (j - 0.5) * s) / FT, 1),
                                 round((self.x0 + (i - 0.5) * s) / FT, 1), round((self.y0 + (j + 0.5) * s) / FT, 1)])
                    start = None
        return runs

    def contours(self):
        """Topographic contour lines from the smoothed grid (marching squares). Interval adapts to the lot's relief:
        2 ft on a flat lot, 5 ft on a sloping one, 10 ft on a steep one; every 5th line is an index line. Coordinates are feet, poly-local.
        -> {"interval_ft": n, "levels": [{"ft": elevation above sea level, "idx": bool, "segs": [[x0, y0, x1, y1], ...]}]}"""
        import geom
        s, nx, ny, z = self.step, self.nx, self.ny, self.zs
        lot_z = [z[j][i] for j in range(ny) for i in range(nx) if geom.point_in_poly((self.x0 + i * s, self.y0 + j * s), self.poly)] or [v for r in z for v in r]
        relief = (max(lot_z) - min(lot_z)) / FT
        interval = 2 if relief < 12 else 5 if relief < 50 else 10
        zmin, zmax = min(v for r in z for v in r) / FT, max(v for r in z for v in r) / FT
        out = []
        lvl = math.ceil(zmin / interval) * interval
        while lvl <= zmax:
            L = lvl * FT
            segs = []
            for j in range(ny - 1):
                for i in range(nx - 1):
                    c = [z[j][i], z[j][i + 1], z[j + 1][i + 1], z[j + 1][i]]   # corners: bottom-left, bottom-right, top-right, top-left
                    pts = []
                    for a, b in ((0, 1), (1, 2), (2, 3), (3, 0)):   # edges
                        va, vb = c[a], c[b]
                        if (va < L) != (vb < L):
                            t = (L - va) / (vb - va)
                            xa, ya = (i + (0, 1, 1, 0)[a]), (j + (0, 0, 1, 1)[a])
                            xb, yb = (i + (0, 1, 1, 0)[b]), (j + (0, 0, 1, 1)[b])
                            pts.append((self.x0 + (xa + t * (xb - xa)) * s, self.y0 + (ya + t * (yb - ya)) * s))
                    if len(pts) == 2:
                        segs.append((pts[0], pts[1]))
                    elif len(pts) == 4:   # saddle: pair by the centre value
                        segs.append((pts[0], pts[1]) if sum(c) / 4 >= L else (pts[0], pts[3]))
                        segs.append((pts[2], pts[3]) if sum(c) / 4 >= L else (pts[1], pts[2]))
            if segs:
                out.append({"ft": int(round(lvl)), "idx": int(round(lvl / interval)) % 5 == 0,
                            "segs": [[round(a[0] / FT, 1), round(a[1] / FT, 1), round(b[0] / FT, 1), round(b[1] / FT, 1)] for a, b in segs]})
            lvl += interval
        return {"interval_ft": interval, "levels": out}
