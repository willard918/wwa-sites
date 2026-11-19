"""Offline checks for geom.py (no network). Run: python test_geom.py"""
import math
import geom

FT = geom.FT
# a 60 x 100 ft lot, street along the south edge (y = 0)
lot = [(0, 0), (60 * FT, 0), (60 * FT, 100 * FT), (0, 100 * FT)]
street = (30 * FT, -5 * FT)
front_i, _ = geom.nearest_edge(street, lot)
assert front_i == 0, "south edge is the street side"
sbs = [(20 if i == front_i else 5) * FT for i in range(4)]

# buildable area is 50 x 75 ft
cells = geom.envelope_cells(lot, sbs)
area = sum((c[2] - c[0]) * (c[3] - c[1]) for c in cells) / FT / FT
assert abs(area - 50 * 75) < 0.1 * 50 * 75, area

# 24 x 16 fits and is placed toward the rear (far from the street)
r = geom.fit_rect(lot, 24 * FT, 16 * FT, sbs, street_pt=street)
assert r, "PL 384 should fit"
cy = sum(c[1] for c in r["corners"]) / 4
assert cy > 50 * FT, "placed in the rear half"

# a 51 x 51 ft square cannot fit in the 50 x 75 ft buildable area (turning it doesn't help)
assert geom.fit_rect(lot, 51 * FT, 51 * FT, sbs, street_pt=street) is None
# but a 51 x 10 ft one can, turned to run along the 75 ft side
assert geom.fit_rect(lot, 51 * FT, 10 * FT, sbs, street_pt=street) is not None

# L-shaped (concave) lot: a unit must not be placed in the notch
L = [(0, 0), (80 * FT, 0), (80 * FT, 30 * FT), (30 * FT, 30 * FT), (30 * FT, 90 * FT), (0, 90 * FT)]
r = geom.fit_rect(L, 24 * FT, 16 * FT, [5 * FT] * 6)
assert r and all(geom.point_in_poly(c, L) for c in r["corners"])

# lot dimensions and area helpers
w, d = geom.lot_dims(lot)
assert abs(w / FT - 60) < 1 and abs(d / FT - 100) < 1
assert abs(geom.area(lot) / FT / FT - 6000) < 1
# obstacles: a 10 x 10 m "house" in the middle of a 40 x 40 m lot; a 7 x 5 m unit must keep 2 m away from it
lot = [(0, 0), (40, 0), (40, 40), (0, 40)]
house = [(15, 15), (25, 15), (25, 25), (15, 25)]
r = geom.fit_rect(lot, 7, 5, [1] * 4, obstacles=[house], obs_clear=2.0)
assert r, "a unit fits beside the house"
assert all(geom.obstacle_dist(c, geom.prep_obstacles([house]), 2.0) >= 2.0 - 1e-6 for c in r["corners"]), "corners keep clear"
assert not geom.fit_rect(lot, 38, 38, [0] * 4, obstacles=[house], obs_clear=2.0), "a unit that would cover the house cannot fit"
cells = geom.envelope_cells(lot, [1] * 4, obstacles=[house], obs_clear=2.0)
assert all(not (c[0] < 25 + 2 and c[2] > 15 - 2 and c[1] < 25 + 2 and c[3] > 15 - 2 and (c[0] + c[2]) / 2 > 17 and (c[0] + c[2]) / 2 < 23 and (c[1] + c[3]) / 2 > 17 and (c[1] + c[3]) / 2 < 23) for c in cells), "no buildable cell inside the house"
print("geom tests passed")
