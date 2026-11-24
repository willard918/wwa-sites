"""Offline tests for terrain.py: a fake elevation service (a tilted plane) instead of USGS. Run: python test_terrain.py"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import geom
import terrain

R = 6371008.8


def fake(slope_pct, azimuth_east=True):
    """Elevation (m) = slope * distance east (or north) of the origin, from lon/lat."""
    def f(points, batch=400):
        out = []
        for lon, lat in points:
            x = math.radians(lon) * R * math.cos(math.radians(45.0))
            y = math.radians(lat) * R
            out.append(slope_pct / 100.0 * (x if azimuth_east else y))
        return out
    return f


def lot(w=30.0, d=40.0):
    return [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]


def build(slope):
    terrain.sample_lonlat = fake(slope)
    return terrain.Terrain(lot(), 0.0, 45.0, 0.0, 0.0)


def rect(cx, cy, w=7.3, d=4.9):
    return [(cx - w / 2, cy - d / 2), (cx + w / 2, cy - d / 2), (cx + w / 2, cy + d / 2), (cx - w / 2, cy + d / 2)]


def main():
    flat = build(2.0)
    assert abs(flat.slope_at(0, 0) - 2.0) < 0.3, flat.slope_at(0, 0)
    assert flat.rect_ok(rect(0, 0)), "a 2% slope should be buildable"
    assert flat.cells("block") == [] and flat.cells("caution") == []
    steep = build(30.0)
    assert abs(steep.slope_at(0, 0) - 30.0) < 1.0, steep.slope_at(0, 0)
    assert not steep.rect_ok(rect(0, 0)), "a 30% slope must not be buildable"
    assert len(steep.cells("block")) > 0
    mid = build(12.0)
    assert mid.rect_ok(rect(0, 0)) and len(mid.cells("caution")) > 0, "12% is buildable but flagged"
    # relief under a 7.3 m (24 ft) wide footprint on a 30% slope is about 7 ft
    _, _, relief = steep.rect_stats(rect(0, 0, 7.3, 4.9))
    assert 5.5 < relief < 8.5, relief
    # access: frontage is the south edge; flat ground is reachable, a 30% hill is not
    flat.set_street(((-15, -20), (15, -20)))
    assert flat.reachable(0, 5)
    steep.set_street(((-15, -20), (15, -20)))
    assert not steep.reachable(0, 5)
    # cells only cover the lot, not the padding
    assert all(c[0] >= -17 / 0.3048 and c[2] <= 17 / 0.3048 for c in steep.cells("block")), "cells leak outside the lot"
    # contours on a 30% plane: 30 m (98 ft) of lot gives ~9 ft... lines are straight, evenly spaced, elevations are multiples of the interval
    c = steep.contours()
    assert c["interval_ft"] in (2, 5, 10) and len(c["levels"]) >= 3, c["interval_ft"]
    assert all(lv["ft"] % c["interval_ft"] == 0 for lv in c["levels"]) and any(lv["idx"] for lv in c["levels"])
    gap = [b["ft"] - a["ft"] for a, b in zip(c["levels"], c["levels"][1:])]
    assert len(set(gap)) == 1, gap
    print("terrain tests passed")


if __name__ == "__main__":
    main()
