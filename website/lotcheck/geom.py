"""Pure-Python lot geometry (no shapely). Local metres, x east / y north.

Used by the lot check to: project a parcel polygon, find the setback envelope, and test whether a
rectangular unit footprint fits inside it.
"""
import math

R_EARTH = 6371008.8
FT = 0.3048


def to_local(lon, lat, lon0, lat0):
    x = math.radians(lon - lon0) * R_EARTH * math.cos(math.radians(lat0))
    y = math.radians(lat - lat0) * R_EARTH
    return (x, y)


def signed_area(poly):
    s = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        s += x1 * y2 - x2 * y1
    return s / 2.0


def area(poly):
    return abs(signed_area(poly))


def centroid(poly):
    a = signed_area(poly)
    if abs(a) < 1e-9:
        n = len(poly)
        return (sum(p[0] for p in poly) / n, sum(p[1] for p in poly) / n)
    cx = cy = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        f = x1 * y2 - x2 * y1
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
    return (cx / (6 * a), cy / (6 * a))


def ensure_ccw(poly):
    return poly if signed_area(poly) > 0 else list(reversed(poly))


def point_in_poly(pt, poly):
    x, y = pt
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-300) + xi:
            inside = not inside
        j = i
    return inside


def seg_dist(p, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 == 0:
        return math.hypot(p[0] - ax, p[1] - ay)
    t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2))
    return math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy))


def edges(poly):
    return [(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))]


def nearest_edge(pt, poly):
    best, bi = 1e18, 0
    for i, (a, b) in enumerate(edges(poly)):
        d = seg_dist(pt, a, b)
        if d < best:
            best, bi = d, i
    return bi, best


def rot(p, ang):
    c, s = math.cos(ang), math.sin(ang)
    return (p[0] * c - p[1] * s, p[0] * s + p[1] * c)


def dominant_angles(poly, k=3):
    """Directions (radians, mod 90 deg, so a rectangle can align) of the k longest edges."""
    items = []
    for a, b in edges(poly):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L > 1.0:
            items.append((L, math.atan2(b[1] - a[1], b[0] - a[0]) % (math.pi / 2)))
    items.sort(reverse=True)
    out = []
    for _, ang in items:
        if all(min(abs(ang - o), math.pi / 2 - abs(ang - o)) > math.radians(3) for o in out):
            out.append(ang)
        if len(out) >= k:
            break
    return out or [0.0]


def lot_dims(poly):
    """Approximate width x depth (m) from the smallest oriented bounding box."""
    best = None
    for ang in dominant_angles(poly, 6) + [0.0]:
        rp = [rot(p, -ang) for p in poly]
        w = max(p[0] for p in rp) - min(p[0] for p in rp)
        d = max(p[1] for p in rp) - min(p[1] for p in rp)
        if best is None or w * d < best[0]:
            best = (w * d, w, d)
    _, w, d = best
    return (min(w, d), max(w, d))


def clip_halfplane(poly, a, b, offset):
    """Keep the part of CCW `poly` that is at least `offset` to the left of line a->b."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy)
    if L == 0:
        return poly
    nx, ny = -dy / L, dx / L  # left normal

    def side(p):
        return (p[0] - a[0]) * nx + (p[1] - a[1]) * ny - offset

    out = []
    for i in range(len(poly)):
        p, q = poly[i], poly[(i + 1) % len(poly)]
        sp, sq = side(p), side(q)
        if sp >= 0:
            out.append(p)
        if (sp >= 0) != (sq >= 0):
            t = sp / (sp - sq)
            out.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
    return out


def envelope(poly, setbacks):
    """Approximate buildable region: clip the lot by each edge shifted inward by its setback.
    Exact for convex lots; slightly over-trims concave ones."""
    poly = ensure_ccw(poly)
    cur = list(poly)
    for (a, b), sb in zip(edges(poly), setbacks):
        if not cur:
            break
        cur = clip_halfplane(cur, a, b, sb)
    return cur


def _clear(pt, poly, es, sbs):
    """Smallest (distance - setback) from pt to any lot edge; negative if too close or outside."""
    if not point_in_poly(pt, poly):
        return -1.0
    m = 1e18
    for (a, b), sb in zip(es, sbs):
        m = min(m, seg_dist(pt, a, b) - sb)
        if m < 0:
            return m
    return m


def prep_obstacles(obstacles):
    """[(ring, (minx, miny, maxx, maxy))] so a point far from every obstacle is rejected in O(1)."""
    out = []
    for ring in obstacles or []:
        xs, ys = [p[0] for p in ring], [p[1] for p in ring]
        out.append((ring, (min(xs), min(ys), max(xs), max(ys))))
    return out


def obstacle_dist(pt, obs, limit):
    """Distance from pt to the nearest obstacle (0 inside one); anything farther than `limit` is reported as `limit`."""
    m = limit
    for ring, (x0, y0, x1, y1) in obs:
        if pt[0] < x0 - m or pt[0] > x1 + m or pt[1] < y0 - m or pt[1] > y1 + m:
            continue
        if point_in_poly(pt, ring):
            return 0.0
        for i in range(len(ring)):
            m = min(m, seg_dist(pt, ring[i], ring[(i + 1) % len(ring)]))
    return m


def fit_rect(poly, w, d, setbacks, street_pt=None, budget=250000, seconds=2.5, obstacles=None, obs_clear=0.0, terrain=None):
    """Find a w x d rectangle (metres) inside `poly` keeping each edge's setback.
    Returns {corners, clearance, angle} or None. Prefers the spot farthest from street_pt (rear yard).
    Large lots are searched more coarsely and every search stops after `seconds`.
    `obstacles`: rings (existing buildings) that the rectangle must stay `obs_clear` metres away from."""
    import time
    obs = prep_obstacles(obstacles)
    deadline = time.time() + seconds
    poly = ensure_ccw(poly)
    es = edges(poly)
    area_m2 = area(poly)
    big = area_m2 > 4000
    step = max(1.0, math.sqrt(area_m2) / (18.0 if big else 45.0))
    best, best_score, spent = None, -1e18, 0
    bases = dominant_angles(poly, 1 if big else 3)
    for base in bases:
        for ang in (base, base + math.pi / 2):
            rp = [rot(p, -ang) for p in poly]
            minx, maxx = min(p[0] for p in rp), max(p[0] for p in rp)
            miny, maxy = min(p[1] for p in rp), max(p[1] for p in rp)
            x = minx
            while x + w <= maxx + 1e-9:
                y = miny
                while y + d <= maxy + 1e-9:
                    spent += 1
                    if spent > budget or (spent % 200 == 0 and time.time() > deadline):
                        return best
                    corners_r = [(x, y), (x + w, y), (x + w, y + d), (x, y + d)]
                    corners = [rot(c, ang) for c in corners_r]
                    ok = True
                    clearance = 1e18
                    for c in corners:
                        cl = _clear(c, poly, es, setbacks)
                        if cl < 0:
                            ok = False
                            break
                        clearance = min(clearance, cl)
                    if ok and obs:
                        for ring, _bb in obs:   # a building sitting wholly inside the rectangle has no point near its edge
                            if any(x <= q[0] <= x + w and y <= q[1] <= y + d for q in (rot(v, -ang) for v in ring)):
                                ok = False
                                break
                        for c in corners:
                            if ok and obstacle_dist(c, obs, obs_clear) < obs_clear:
                                ok = False
                    if ok:
                        # sample the perimeter every ~1 m
                        for i in range(4):
                            a, b = corners_r[i], corners_r[(i + 1) % 4]
                            L = math.hypot(b[0] - a[0], b[1] - a[1])
                            n = max(1, int(L / 1.0))
                            for k in range(1, n):
                                t = k / n
                                p = rot((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])), ang)
                                cl = _clear(p, poly, es, setbacks)
                                if cl < 0 or (obs and obstacle_dist(p, obs, obs_clear) < obs_clear):
                                    ok = False
                                    break
                                clearance = min(clearance, cl)
                            if not ok:
                                break
                    if ok and terrain is not None and not terrain.rect_ok(corners):
                        ok = False
                    if ok:
                        cx = sum(c[0] for c in corners) / 4
                        cy = sum(c[1] for c in corners) / 4
                        score = (math.hypot(cx - street_pt[0], cy - street_pt[1]) if street_pt else 0.0) + 0.01 * clearance
                        if score > best_score:
                            best_score = score
                            best = {"corners": corners, "clearance": clearance, "angle": ang}
                    y += step
                x += step
    return best


def envelope_cells(poly, setbacks, obstacles=None, obs_clear=0.0, terrain=None):
    """Buildable area as merged horizontal runs [x0, y0, x1, y1] (metres): every cell centre is inside the lot
    and at least each edge's setback away from it. Correct for any lot shape, including flag lots."""
    poly = ensure_ccw(poly)
    es = edges(poly)
    obs = prep_obstacles(obstacles)
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    cell = max(0.5, math.sqrt(area(poly)) / 70.0)
    runs = []
    y = miny + cell / 2
    while y < maxy:
        x = minx + cell / 2
        start = None
        while x < maxx:
            ok = _clear((x, y), poly, es, setbacks) >= 0 and not (obs and obstacle_dist((x, y), obs, obs_clear) < obs_clear)
            if ok and terrain is not None and not terrain.cell_ok(x, y):
                ok = False
            if ok and start is None:
                start = x - cell / 2
            if not ok and start is not None:
                runs.append([start, y - cell / 2, x - cell / 2, y + cell / 2])
                start = None
            x += cell
        if start is not None:
            runs.append([start, y - cell / 2, x - cell / 2, y + cell / 2])
        y += cell
    return runs
