# Regenerates the toolbar icons from the brand mark (see ../brand/README.md).
#   python3 make-icons.py        (needs Pillow)
# Ink rounded square, cream tally mark: four strokes crossed by a fifth.
# Strokes are drawn heavier at small sizes so the mark stays legible at 16px.
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "icons")
INK = (10, 10, 11, 255)       # #0a0a0b
CREAM = (244, 242, 236, 255)  # #f4f2ec
SS = 8                        # supersampling factor


def stroke(draw, p1, p2, width, color):
    draw.line([p1, p2], fill=color, width=int(width))
    r = width / 2.0
    for x, y in (p1, p2):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def render(size):
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = big / 256.0
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=52 * f, fill=INK)
    small = size <= 32
    w = (30 if small else 16) * f
    top, bottom = (58, 198) if small else (70, 186)
    for x in (82, 120, 158, 196):
        stroke(d, (x * f, top * f), (x * f, bottom * f), w, CREAM)
    stroke(d, (64 * f, (bottom - 6) * f), (204 * f, (top + 2) * f), w, CREAM)
    return img.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
for size in (16, 48, 128):
    path = os.path.join(OUT, f"icon{size}.png")
    render(size).save(path, optimize=True)
    print("wrote", os.path.relpath(path, HERE))
