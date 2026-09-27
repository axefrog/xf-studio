"""Contact sheet of expression renders: sheet.py <dir> <out.png> <view> name [name ...] (a label under each face)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

folder, out, view, names = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4:]
tiles = []
for name in names:
    image = Image.open(folder / f'{name}-{view}.png').convert('RGB')
    w, h = image.size
    image = image.resize((460, round(460 * h / w)))
    tile = Image.new('RGB', (460, image.size[1] + 30), 'white')
    tile.paste(image, (0, 0))
    ImageDraw.Draw(tile).text((8, image.size[1] + 8), name, fill='black')
    tiles.append(tile)
cols = min(3, len(tiles))
rows = (len(tiles) + cols - 1) // cols
th = tiles[0].size[1]
sheet = Image.new('RGB', (cols * 460, rows * th), 'white')
for i, tile in enumerate(tiles):
    sheet.paste(tile, ((i % cols) * 460, (i // cols) * th))
sheet.save(out)
print(out, sheet.size)
