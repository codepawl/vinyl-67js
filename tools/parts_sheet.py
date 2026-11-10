"""Render a sourced GLB whole and each mesh object alone, from one fixed camera.

Usage: blender -b --factory-startup --python parts_sheet.py -- <model.glb> <output folder> [azimuth degrees]
Writes <output folder>/<index>_<object name>.png and parts.json (name, faces, world bounds).
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

arguments = sys.argv[sys.argv.index("--") + 1:]
glb_path = Path(arguments[0])
output_folder = Path(arguments[1])
azimuth = math.radians(float(arguments[2])) if len(arguments) > 2 else math.radians(-35)
output_folder.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 520
scene.render.resolution_y = 400
world = bpy.data.worlds.new("sheet")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.4, 0.4, 0.42, 1.0)
scene.world = world

bpy.ops.import_scene.gltf(filepath=str(glb_path))
mesh_objects = [item for item in scene.objects if item.type == "MESH"]


def bounds_of(objects):
    low = Vector((math.inf, math.inf, math.inf))
    high = Vector((-math.inf, -math.inf, -math.inf))
    for item in objects:
        for corner in item.bound_box:
            point = item.matrix_world @ Vector(corner)
            low = Vector(map(min, low, point))
            high = Vector(map(max, high, point))
    return low, high


low, high = bounds_of(mesh_objects)
centre = (low + high) / 2
radius = (high - low).length / 2

sun_data = bpy.data.lights.new("key", "SUN")
sun_data.energy = 3.0
sun = bpy.data.objects.new("key", sun_data)
sun.rotation_euler = (math.radians(50), 0, math.radians(35))
scene.collection.objects.link(sun)

camera_data = bpy.data.cameras.new("camera")
camera_data.lens = 60
camera = bpy.data.objects.new("camera", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
direction = Vector((math.sin(azimuth), -math.cos(azimuth), 0.62)).normalized()
camera.location = centre + direction * radius * 3.3
camera.rotation_euler = (centre - camera.location).to_track_quat("-Z", "Y").to_euler()
camera_data.clip_start = radius * 0.01
camera_data.clip_end = radius * 20


def render(name):
    scene.render.filepath = str(output_folder / f"{name}.png")
    bpy.ops.render.render(write_still=True)


render("00_all")
rows = []
ordered = sorted(mesh_objects, key=lambda item: item.name)
for index, target in enumerate(ordered, start=1):
    for item in mesh_objects:
        item.hide_render = item is not target
    safe_name = "".join(character if character.isalnum() else "-" for character in target.name)[:40]
    render(f"{index:02d}_{safe_name}")
    part_low, part_high = bounds_of([target])
    rows.append({
        "index": index,
        "name": target.name,
        "faces": len(target.data.polygons),
        "materials": [slot.material.name for slot in target.material_slots if slot.material],
        "low": [round(value, 4) for value in part_low],
        "high": [round(value, 4) for value in part_high],
    })

(output_folder / "parts.json").write_text(json.dumps({
    "low": [round(value, 4) for value in low],
    "high": [round(value, 4) for value in high],
    "parts": rows,
}, indent=1), encoding="utf-8")
print("PARTS", glb_path.stem, len(rows))
