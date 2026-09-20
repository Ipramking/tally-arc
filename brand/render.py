# -*- coding: utf-8 -*-
import os
from PIL import Image, ImageDraw, ImageFont

BRAND = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BRAND, "png")
os.makedirs(OUT, exist_ok=True)

INK = (10, 10, 11, 255)      # #0a0a0b
CREAM = (244, 242, 236, 255) # #f4f2ec
GREEN = (52, 211, 153, 255)  # #34d399
SS = 4                        # supersample for smooth caps/edges

def rcap_line(d, p1, p2, w, color):
    d.line([p1, p2], fill=color, width=int(w))
    r = w / 2.0
    for (x, y) in (p1, p2):
        d.ellipse([x - r, y - r, x + r, y + r], fill=color)

def render_icon(size, mark, bg, name):
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = S / 256.0
    if bg:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=52 * f, fill=bg)
    w = 16 * f
    for x in (82, 120, 158, 196):
        rcap_line(d, (x * f, 70 * f), (x * f, 186 * f), w, mark)
    rcap_line(d, (64 * f, 180 * f), (204 * f, 72 * f), w, mark)
    img = img.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(OUT, name))
    print("wrote", name)

def render_lockup(name, bg, mark, text_color):
    W, H = 520, 160
    S = SS
    img = Image.new("RGBA", (W * S, H * S), bg if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # mark: svg translate(24,44), stroke 9
    ox, oy, w = 24 * S, 44 * S, 9 * S
    for x in (10, 30, 50, 70):
        rcap_line(d, (ox + x * S, oy + 6 * S), (ox + x * S, oy + 66 * S), w, mark)
    rcap_line(d, (ox + 2 * S, oy + 63 * S), (ox + 78 * S, oy + 9 * S), w, mark)
    # wordmark: IBM Plex Mono SemiBold, tracked
    font = ImageFont.truetype(os.path.join(BRAND, "PlexMono-SemiBold.ttf"), 62 * S)
    tx, baseline, tracking = 140 * S, 98 * S, 10 * S
    # PIL text y is top; approximate top from baseline using ascent
    asc, desc = font.getmetrics()
    ty = baseline - asc + 6 * S
    for ch in "TALLY":
        d.text((tx, ty), ch, font=font, fill=text_color)
        tx += font.getlength(ch) + tracking
    img = img.resize((W * 2, H * 2), Image.LANCZOS)
    img.save(os.path.join(OUT, name))
    print("wrote", name)

render_icon(1024, CREAM, INK, "tally-icon-1024.png")
render_icon(512, CREAM, INK, "tally-icon-512.png")
render_icon(1024, GREEN, INK, "tally-icon-green-1024.png")
render_icon(512, CREAM, None, "tally-mark-512.png")
render_icon(512, GREEN, None, "tally-mark-green-512.png")
render_lockup("tally-lockup.png", None, CREAM, CREAM)
render_lockup("tally-lockup-ink.png", INK, CREAM, CREAM)
print("done")
