"""Join the three machines of each look into one row, for a style pick.

Usage: uv run --no-project --with pillow python style_sheets.py <folder of <look>-<player>.png>
"""
import sys
from pathlib import Path

from PIL import Image

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
folder = Path(sys.argv[1])
players = ["phonograph-1877", "gramophone-1925", "direct-drive-1979"]
tile_width = 1100

for look in ["studio", "parlour", "daylight"]:
    tiles = []
    for player in players:
        image = Image.open(folder / f"{look}-{player}.png").convert("RGB")
        tile_height = round(tile_width * image.height / image.width)
        tiles.append(image.resize((tile_width, tile_height), Image.LANCZOS))
    sheet = Image.new("RGB", (tile_width * len(tiles), tiles[0].height))
    for index, tile in enumerate(tiles):
        sheet.paste(tile, (index * tile_width, 0))
    output = folder / f"style-{look}.jpg"
    sheet.save(output, quality=90)
    print(output, sheet.size)
