"""Split every mesh of a GLB into loose islands and print each island's bounds.

Usage: blender -b --factory-startup --python dump_islands.py -- <model.glb> <out.json> [top view png]
Coordinates are Blender world space (Z up) as imported, before any normalising.
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

arguments = sys.argv[sys.argv.index("--") + 1:]
glb_path = Path(arguments[0])
json_path = Path(arguments[1])
top_view_path = Path(arguments[2]) if len(arguments) > 2 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(glb_path))
scene = bpy.context.scene
source_objects = sorted((item for item in scene.objects if item.type == "MESH"), key=lambda item: item.name)

rows = []
for source_index, source in enumerate(source_objects, start=1):
    source_name = source.name
    bpy.ops.object.select_all(action="DESELECT")
    source.select_set(True)
    bpy.context.view_layer.objects.active = source
    bpy.ops.mesh.separate(type="LOOSE")
    islands = list(bpy.context.selected_objects)
    for island in islands:
        low = Vector((math.inf, math.inf, math.inf))
        high = Vector((-math.inf, -math.inf, -math.inf))
        for corner in island.bound_box:
            point = island.matrix_world @ Vector(corner)
            low = Vector(map(min, low, point))
            high = Vector(map(max, high, point))
        rows.append({
            "source": source_index,
            "sourceName": source_name,
            "island": island.name,
            "faces": len(island.data.polygons),
            "low": [round(value, 4) for value in low],
            "high": [round(value, 4) for value in high],
        })

json_path.write_text(json.dumps(rows, indent=0), encoding="utf-8")
print("ISLANDS", len(rows))

if top_view_path:
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 1100
    world = bpy.data.worlds.new("top")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.5, 0.52, 1.0)
    scene.world = world
    all_low = Vector((min(row["low"][axis] for row in rows) for axis in range(3)))
    all_high = Vector((max(row["high"][axis] for row in rows) for axis in range(3)))
    centre = (all_low + all_high) / 2
    span = max(all_high.x - all_low.x, (all_high.y - all_low.y) * 1400 / 1100)
    camera_data = bpy.data.cameras.new("top")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = span * 1.05
    camera = bpy.data.objects.new("top", camera_data)
    camera.location = (centre.x, centre.y, all_high.z + span)
    scene.collection.objects.link(camera)
    scene.camera = camera
    sun_data = bpy.data.lights.new("key", "SUN")
    sun_data.energy = 3.0
    sun = bpy.data.objects.new("key", sun_data)
    sun.rotation_euler = (math.radians(25), 0, math.radians(20))
    scene.collection.objects.link(sun)
    scene.render.filepath = str(top_view_path)
    bpy.ops.render.render(write_still=True)
    print("TOPVIEW centre", [round(value, 4) for value in centre], "orthoScale", round(span * 1.05, 4))
