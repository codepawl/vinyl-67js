"""Render one thumbnail per sourced GLB and print its object list.

Usage: blender -b --factory-startup --python survey_models.py -- <raw folder> <output folder>
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

arguments = sys.argv[sys.argv.index("--") + 1:]
raw_folder = Path(arguments[0])
output_folder = Path(arguments[1])
output_folder.mkdir(parents=True, exist_ok=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 540
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("survey")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.35, 0.37, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = world
    return scene


def world_bounds(mesh_objects):
    low = Vector((math.inf, math.inf, math.inf))
    high = Vector((-math.inf, -math.inf, -math.inf))
    for mesh_object in mesh_objects:
        for corner in mesh_object.bound_box:
            point = mesh_object.matrix_world @ Vector(corner)
            low = Vector(map(min, low, point))
            high = Vector(map(max, high, point))
    return low, high


def survey(glb_path):
    scene = reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    mesh_objects = [item for item in scene.objects if item.type == "MESH"]
    low, high = world_bounds(mesh_objects)
    centre = (low + high) / 2
    size = high - low
    radius = max(size.length / 2, 1e-6)

    rows = []
    for mesh_object in sorted(mesh_objects, key=lambda item: -len(item.data.polygons)):
        rows.append({
            "name": mesh_object.name,
            "faces": len(mesh_object.data.polygons),
            "materials": [slot.material.name for slot in mesh_object.material_slots if slot.material],
            "size": [round(value, 4) for value in mesh_object.dimensions],
        })

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
    direction = Vector((0.75, -1.0, 0.62)).normalized()
    camera.location = centre + direction * radius * 3.4
    camera.rotation_euler = (centre - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.clip_start = radius * 0.01
    camera_data.clip_end = radius * 20

    scene.render.filepath = str(output_folder / f"{glb_path.stem}.png")
    bpy.ops.render.render(write_still=True)
    return {
        "uid": glb_path.stem,
        "objects": len(mesh_objects),
        "faces": sum(row["faces"] for row in rows),
        "size": [round(value, 4) for value in size],
        "animations": len(bpy.data.actions),
        "largest": rows[:40],
    }


report = [survey(path) for path in sorted(raw_folder.glob("*.glb"))]
(output_folder / "survey.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
for entry in report:
    print("SURVEY", entry["uid"], entry["objects"], "objects", entry["faces"], "faces", entry["size"])
