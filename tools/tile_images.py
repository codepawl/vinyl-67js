"""Tile every PNG in a folder into one labelled JPEG sheet.

Usage: uv run --no-project --with pillow python tile_images.py <folder> <columns> [tile width]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

folder = Path(sys.argv[1])
columns = int(sys.argv[2])
tile_width = int(sys.argv[3]) if len(sys.argv) > 3 else 400

files = sorted(folder.glob("*.png"))
first = Image.open(files[0])
tile_height = round(tile_width * first.height / first.width)
rows = (len(files) + columns - 1) // columns
sheet = Image.new("RGB", (columns * tile_width, rows * tile_height), (20, 20, 20))
draw = ImageDraw.Draw(sheet)
for index, path in enumerate(files):
    left = (index % columns) * tile_width
    top = (index // columns) * tile_height
    sheet.paste(Image.open(path).convert("RGB").resize((tile_width, tile_height)), (left, top))
    draw.text((left + 6, top + 4), path.stem[:44], fill=(255, 255, 0))
sheet.save(folder / "sheet.jpg", quality=85)
print(sheet.size, len(files))
