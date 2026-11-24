"""Builds the envelope seal as pure outlines (no live text, no font needed by the vendor).

    python make_seal.py            # writes wwa-seal-v2.svg

Needs fontTools (pip install fonttools) and Georgia Bold from C:\\Windows\\Fonts. Art is black on white, 100 x 100 units for a 1-5/8 in round
embosser (1 unit = 0.41 mm): every line is at least 1.0 unit (0.4 mm) and the letters are 6 units (about 7 pt) tall.
"""
import math
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
FONT = TTFont(r"C:\Windows\Fonts\georgiab.ttf")
GS, CMAP, HMTX, UPM = FONT.getGlyphSet(), FONT.getBestCmap(), FONT["hmtx"], FONT["head"].unitsPerEm
CAP = FONT["OS/2"].sCapHeight or 0.69 * UPM
C = 50.0


def glyph(ch):
    name = CMAP[ord(ch)]
    pen = SVGPathPen(GS)
    GS[name].draw(pen)
    return pen.getCommands(), HMTX[name][0]


def ring_text(text, radius, cap_h, tracking, top=True):
    """Outlined text round a circle. top=True: reads left to right over the top, tops of letters outward.
    top=False: reads left to right along the bottom, tops of letters toward the centre (baseline on `radius`)."""
    s = cap_h / CAP
    items = [(glyph(ch), ch) for ch in text]
    advs = [a * s + tracking for (_, a), _ in items]
    total = sum(advs) - tracking
    out, pos = [], -total / 2
    for ((d, adv), ch), a in zip(items, advs):
        mid = pos + adv * s / 2
        ang = mid / radius   # radians from 12 o'clock (top) or 6 o'clock (bottom)
        if top:
            px, py, rot = C + radius * math.sin(ang), C - radius * math.cos(ang), math.degrees(ang)
        else:
            px, py, rot = C + radius * math.sin(ang), C + radius * math.cos(ang), -math.degrees(ang)
        if d:
            out.append(f'<path transform="translate({px:.3f} {py:.3f}) rotate({rot:.3f}) scale({s:.5f} {-s:.5f}) translate({-adv / 2:.1f} 0)" d="{d}"/>')
        pos += a
    return "\n".join(out)


def ticks():
    out = []
    n = 60
    for i in range(n):
        a = 2 * math.pi * i / n
        long_ = i % 5 == 0
        r0, r1 = (41.4, 46.2) if long_ else (43.4, 46.2)
        out.append(f'<line x1="{C + r0 * math.sin(a):.2f}" y1="{C - r0 * math.cos(a):.2f}" x2="{C + r1 * math.sin(a):.2f}" y2="{C - r1 * math.cos(a):.2f}" stroke-width="{1.15 if long_ else 0.95}"/>')
    return "\n".join(out)


def main():
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1000" height="1000">
<title>Willard Williams Architect envelope seal, 1-5/8 in round embosser (outlined artwork)</title>
<rect width="100" height="100" fill="#fff"/>
<g fill="none" stroke="#000" stroke-linecap="butt">
<circle cx="50" cy="50" r="48.6" stroke-width="1.5"/>
<circle cx="50" cy="50" r="40" stroke-width="1.1"/>
<circle cx="50" cy="50" r="27" stroke-width="1.3"/>
{ticks()}
</g>
<g fill="#000">
{ring_text("WILLARD WILLIAMS", 31.4, 4.9, 0.25, top=True)}
{ring_text("ARCHITECT", 36.4, 4.9, 1.3, top=False)}
<circle cx="{C - 33.4:.2f}" cy="50" r="1.25"/>
<circle cx="{C + 33.4:.2f}" cy="50" r="1.25"/>
<polygon points="35,41.8 65,37.8 65,41.2 35,45.2"/>
</g>
<g fill="none" stroke="#000" stroke-linejoin="miter" stroke-linecap="butt" stroke-miterlimit="6">
<polyline points="36.5,49.8 42.4,61.6 50,52 57.6,61.6 63.5,49.8" stroke-width="2.7"/>
<line x1="33" y1="64.6" x2="67" y2="64.6" stroke-width="1.6"/>
</g>
</svg>
'''
    (HERE / "wwa-seal-v2.svg").write_text(svg, encoding="utf-8")
    print("wrote wwa-seal-v2.svg", len(svg) // 1024, "KB")


if __name__ == "__main__":
    main()
