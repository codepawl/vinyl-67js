"""Paint the brand lettering out of the 1979 turntable's textures and write the GLB again.

Usage: uv run --no-project --with pillow --with numpy --with scipy python remove_brand_text.py <in.glb> <out.glb> [<folder for before/after crops>]

Small lettering is found as small blobs that differ from the flat surface around them and is filled with
that surface's colour. The slipmat's large lettering is everything bright inside its printed ring.
"""
import io
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Image name in the GLB -> list of (box in pixels, largest blob that still counts as lettering).
SMALL_TEXT = {
    "Image_3": [((560, 180, 740, 240), 600)],    # plinth: brand, "Quartz", model line (base colour)
    "Image_16": [((450, 200, 585, 285), 900), ((500, 615, 625, 685), 500)],  # cartridge model and maker
    "Image_13": [((405, 75, 530, 155), 900)],    # small brand line
    "Image_14": [((405, 75, 530, 155), 900)],    # the same line in its roughness map
}
# The plinth lettering is also pressed faintly into its grainy roughness map, too faint to pick out as
# blobs. There the clean band just above the lettering is copied over it: (source box, top of the copy).
CLONE_OVER = {
    "Image_4": [((586, 184, 745, 202), 202)],
}
SLIPMAT_IMAGE = "Image_0"
SLIPMAT_CENTRE = (580, 484)
SLIPMAT_CLEAR_RADIUS = 338
SLIPMAT_BADGE_BOX = (850, 25, 1015, 180)


def luminance(pixels):
    return pixels[..., :3].astype(np.float32).mean(axis=2)


def erase_small_text(pixels, box, largest_blob):
    left, top, right, bottom = box
    region = pixels[top:bottom, left:right]
    light = luminance(region)
    surface = np.median(light)
    differs = np.abs(light - surface) > 22
    labels, count = ndimage.label(differs)
    if count == 0:
        return 0
    sizes = ndimage.sum(differs, labels, range(1, count + 1))
    lettering = np.isin(labels, [index + 1 for index, size in enumerate(sizes) if size <= largest_blob])
    lettering = ndimage.binary_dilation(lettering, iterations=3) & ~np.isin(
        labels, [index + 1 for index, size in enumerate(sizes) if size > largest_blob]
    )
    surface_colour = np.median(region[~differs].reshape(-1, region.shape[2]), axis=0)
    region[lettering] = surface_colour
    return int(lettering.sum())


def erase_slipmat(pixels):
    height, width = pixels.shape[:2]
    rows, columns = np.mgrid[0:height, 0:width]
    inside = (columns - SLIPMAT_CENTRE[0]) ** 2 + (rows - SLIPMAT_CENTRE[1]) ** 2 < SLIPMAT_CLEAR_RADIUS ** 2
    dark = luminance(pixels) < 45
    mat_colour = np.median(pixels[inside & dark].reshape(-1, pixels.shape[2]), axis=0)
    bright_inside = inside & ~dark
    bright_inside = ndimage.binary_dilation(bright_inside, iterations=2) & inside
    pixels[bright_inside] = mat_colour
    erased = int(bright_inside.sum())

    # The small badge: a dark patch with lettering in it. Closing the dark patch covers the letters.
    left, top, right, bottom = SLIPMAT_BADGE_BOX
    region = pixels[top:bottom, left:right]
    patch = luminance(region) < 60
    filled = ndimage.binary_closing(patch, iterations=9, border_value=0)
    region[filled & ~patch] = mat_colour
    return erased + int((filled & ~patch).sum())


def main():
    source = Path(sys.argv[1]).read_bytes()
    output_path = Path(sys.argv[2])
    crop_folder = Path(sys.argv[3]) if len(sys.argv) > 3 else None
    json_length = struct.unpack_from("<I", source, 12)[0]
    document = json.loads(source[20:20 + json_length].decode("utf-8"))
    binary_start = 20 + json_length + 8
    binary = source[binary_start:]

    replaced = {}
    for image in document["images"]:
        name = image.get("name")
        if name not in SMALL_TEXT and name not in CLONE_OVER and name != SLIPMAT_IMAGE:
            continue
        view = document["bufferViews"][image["bufferView"]]
        offset = view.get("byteOffset", 0)
        picture = Image.open(io.BytesIO(binary[offset:offset + view["byteLength"]]))
        mode = "RGBA" if picture.mode == "RGBA" else "RGB"
        pixels = np.array(picture.convert(mode))
        before = pixels.copy()
        erased = 0
        if name == SLIPMAT_IMAGE:
            erased += erase_slipmat(pixels)
        for box, largest_blob in SMALL_TEXT.get(name, []):
            erased += erase_small_text(pixels, box, largest_blob)
        for (left, top, right, bottom), copy_top in CLONE_OVER.get(name, []):
            band = pixels[top:bottom, left:right].copy()
            pixels[copy_top:copy_top + (bottom - top), left:right] = band
            erased += band.shape[0] * band.shape[1]
        print(name, image["mimeType"], "pixels repainted:", erased)
        encoded = io.BytesIO()
        if image["mimeType"] == "image/jpeg":
            Image.fromarray(pixels).save(encoded, "JPEG", quality=93)
        else:
            Image.fromarray(pixels).save(encoded, "PNG", optimize=True)
        replaced[image["bufferView"]] = encoded.getvalue()
        if crop_folder:
            crop_folder.mkdir(parents=True, exist_ok=True)
            boxes = [box for box, _ in SMALL_TEXT.get(name, [])]
            boxes += [(left, top - 10, right, top + 60) for (left, top, right, _), _ in CLONE_OVER.get(name, [])]
            if name == SLIPMAT_IMAGE:
                boxes = [(0, 0, 1024, 1024)]
            for number, box in enumerate(boxes):
                pair = Image.new("RGB", ((box[2] - box[0]) * 2 + 8, box[3] - box[1]), "#ff00ff")
                pair.paste(Image.fromarray(before).convert("RGB").crop(box), (0, 0))
                pair.paste(Image.fromarray(pixels).convert("RGB").crop(box), (box[2] - box[0] + 8, 0))
                pair.save(crop_folder / f"{name}-{number}.png")

    # Lay the buffer out again, since the repainted images changed size.
    chunks = []
    position = 0
    for index, view in enumerate(document["bufferViews"]):
        offset = view.get("byteOffset", 0)
        data = replaced.get(index, binary[offset:offset + view["byteLength"]])
        padding = (-position) % 4
        chunks.append(b"\x00" * padding)
        position += padding
        view["byteOffset"] = position
        view["byteLength"] = len(data)
        chunks.append(data)
        position += len(data)
    new_binary = b"".join(chunks)
    new_binary += b"\x00" * ((-len(new_binary)) % 4)
    document["buffers"][0]["byteLength"] = len(new_binary)
    new_json = json.dumps(document, separators=(",", ":")).encode("utf-8")
    new_json += b" " * ((-len(new_json)) % 4)
    total = 12 + 8 + len(new_json) + 8 + len(new_binary)
    output_path.write_bytes(
        struct.pack("<4sII", b"glTF", 2, total)
        + struct.pack("<I4s", len(new_json), b"JSON") + new_json
        + struct.pack("<I4s", len(new_binary), b"BIN\x00") + new_binary
    )
    print("wrote", output_path, total)


main()
