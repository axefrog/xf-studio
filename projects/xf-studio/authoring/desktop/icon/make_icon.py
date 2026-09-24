"""Rasterize the deliberately simple polygon SVG without a browser dependency."""
from pathlib import Path
from xml.etree import ElementTree

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
SVG = HERE / "icon.svg"
root = ElementTree.parse(SVG).getroot()
polygons = []
for element in root:
    if element.tag.rsplit("}", 1)[-1] != "polygon":
        raise ValueError("Icon generator only supports SVG polygons")
    points = [tuple(map(float, pair.split(","))) for pair in element.attrib["points"].split()]
    polygons.append((element.attrib["fill"], points))

pngs = []
for size in (16, 24, 32, 48, 64, 128, 256):
    scale = size * 4 / 256
    canvas = Image.new("RGBA", (size * 4, size * 4), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    for color, points in polygons:
        draw.polygon([(x * scale, y * scale) for x, y in points], fill=color)
    image = canvas.resize((size, size), Image.Resampling.LANCZOS)
    image.save(HERE / f"icon-{size}.png")
    if size in (16, 32, 48, 256):
        pngs.append(image)

# Pillow stores all Windows icon resolutions in one ICO container.
pngs[-1].save(HERE / "icon.ico", format="ICO", sizes=[(size, size) for size in (16, 32, 48, 256)])
print("Generated 16/24/32/48/64/128/256 PNG and multi-resolution ICO")
