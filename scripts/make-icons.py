"""Draws the app icons (a cooking pot with steam, white on the app's green) into public/icons.

Run: python3 scripts/make-icons.py   (needs Pillow). The same drawing is public/icons/icon.svg.
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

GREEN = (47, 111, 79)
WHITE = (255, 255, 255)
OUT = Path(__file__).resolve().parent.parent / 'public' / 'icons'
SS = 4  # draw at 4x and shrink for smooth edges


def pot(draw, s, scale=1.0):
    """The pot, on a 512-unit grid, scaled around the centre by `scale`."""
    def p(v):
        return (256 + (v - 256) * scale) * s

    def box(x0, y0, x1, y1, r):
        draw.rounded_rectangle((p(x0), p(y0), p(x1), p(y1)), radius=r * scale * s, fill=WHITE)

    box(136, 236, 376, 386, 44)  # body
    box(104, 268, 146, 296, 14)  # left handle
    box(366, 268, 408, 296, 14)  # right handle
    box(152, 206, 360, 236, 15)  # lid
    draw.ellipse((p(240), p(172), p(272), p(204)), fill=WHITE)  # knob
    for cx in (200, 256, 312):  # steam
        pts = [(p(cx + 11 * math.sin(t / 8 * math.pi * 2)), p(150 - t * 4.5)) for t in range(0, 11)]
        draw.line(pts, fill=WHITE, width=round(11 * scale * s), joint='curve')
        for x, y in (pts[0], pts[-1]):
            r = 5.5 * scale * s
            draw.ellipse((x - r, y - r, x + r, y + r), fill=WHITE)


def icon(size, rounded, scale):
    s = size * SS / 512
    img = Image.new('RGBA', (size * SS, size * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, size * SS - 1, size * SS - 1), radius=112 * s, fill=GREEN)
    else:
        d.rectangle((0, 0, size * SS, size * SS), fill=GREEN)
    pot(d, s, scale)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
icon(192, True, 1.0).save(OUT / 'icon-192.png')
icon(512, True, 1.0).save(OUT / 'icon-512.png')
icon(512, False, 0.7).save(OUT / 'icon-maskable-512.png')  # full bleed; pot inside the safe zone
icon(180, False, 0.85).convert('RGB').save(OUT / 'apple-touch-icon.png')  # iOS rounds it itself
print('icons written to', OUT)
