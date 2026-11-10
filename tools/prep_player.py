"""Turn a sourced GLB into a player GLB whose mesh objects are the app's moving parts.

Usage: blender -b --factory-startup --python prep_player.py -- <config.json>

The config names the source file, the scale and origin that put the model in the app's physics frame
(metres, Z up, record plane at z = 0 for disc players), and an ordered list of groups. Every loose island
of the source goes to the first group with a matching rule, or to the default group. A rule may give:
  sources      1-based indices of the source mesh objects, sorted by name
  sourceNames  substrings of the source object name
  centre       [[x, y, z], [x, y, z]] box the island's bounding-box centre must lie in (source coordinates)
  within       box the island's whole bounding box must lie in
  minSize      [x, y, z] smallest bounding-box size
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

config_path = Path(sys.argv[sys.argv.index("--") + 1])
config = json.loads(config_path.read_text(encoding="utf-8"))
base_folder = config_path.parent


def resolve(path_text):
    path = Path(path_text)
    return path if path.is_absolute() else (base_folder / path)


def island_bounds(island):
    low = Vector((math.inf, math.inf, math.inf))
    high = Vector((-math.inf, -math.inf, -math.inf))
    for corner in island.bound_box:
        point = island.matrix_world @ Vector(corner)
        low = Vector(map(min, low, point))
        high = Vector(map(max, high, point))
    return low, high


def inside(point, box):
    return all(box[0][axis] <= point[axis] <= box[1][axis] for axis in range(3))


def rule_matches(rule, source_index, source_name, low, high):
    if "sources" in rule and source_index not in rule["sources"]:
        return False
    if "sourceNames" in rule and not any(text in source_name for text in rule["sourceNames"]):
        return False
    if "centre" in rule and not inside((low + high) / 2, rule["centre"]):
        return False
    if "within" in rule and not (inside(low, rule["within"]) and inside(high, rule["within"])):
        return False
    if "minSize" in rule:
        size = high - low
        if any(size[axis] < rule["minSize"][axis] for axis in range(3)):
            return False
    return True


def group_for(source_index, source_name, low, high):
    for group in config["groups"]:
        for rule in group["rules"]:
            if rule_matches(rule, source_index, source_name, low, high):
                return group["name"]
    return config["defaultGroup"]


def stretch_along_x(mesh_object, stretch):
    """Lengthen a tube between a pivot and a joint; everything past the joint moves with the tube end."""
    pivot_x = stretch["pivotX"]
    joint_x = stretch["jointX"]
    factor = stretch["factor"]
    shift = (pivot_x - joint_x) * (factor - 1)
    for vertex in mesh_object.data.vertices:
        x = vertex.co.x
        if x >= pivot_x:
            continue
        if x >= joint_x:
            vertex.co.x = pivot_x - (pivot_x - x) * factor
        else:
            vertex.co.x = x - shift


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(resolve(config["source"])))
scene = bpy.context.scene
source_objects = sorted((item for item in scene.objects if item.type == "MESH"), key=lambda item: item.name)

members = {}
dropped = 0
keep_box = config.get("keepBox")
for source_index, source in enumerate(source_objects, start=1):
    source_name = source.name
    world_matrix = source.matrix_world.copy()
    source.parent = None
    source.matrix_world = world_matrix
    bpy.ops.object.select_all(action="DESELECT")
    source.select_set(True)
    bpy.context.view_layer.objects.active = source
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.mesh.separate(type="LOOSE")
    for island in list(bpy.context.selected_objects):
        low, high = island_bounds(island)
        if keep_box and not inside((low + high) / 2, keep_box):
            bpy.data.objects.remove(island, do_unlink=True)
            dropped += 1
            continue
        members.setdefault(group_for(source_index, source_name, low, high), []).append(island)

for item in list(scene.objects):
    if item.type != "MESH":
        bpy.data.objects.remove(item, do_unlink=True)

origin = Vector(config["origin"])
scale = config["scale"]
to_app_frame = Matrix.Scale(scale, 4) @ Matrix.Translation(-origin)
stretches = config.get("stretch", {})

summary = {}
for group_name, islands in members.items():
    bpy.ops.object.select_all(action="DESELECT")
    for island in islands:
        island.select_set(True)
    bpy.context.view_layer.objects.active = islands[0]
    if len(islands) > 1:
        bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = group_name
    joined.data.name = group_name
    if group_name in stretches:
        stretch_along_x(joined, stretches[group_name])
    joined.data.transform(to_app_frame)
    joined.matrix_world = Matrix.Identity(4)
    joined.data.update()
    low = Vector((min(vertex.co[axis] for vertex in joined.data.vertices) for axis in range(3)))
    high = Vector((max(vertex.co[axis] for vertex in joined.data.vertices) for axis in range(3)))
    summary[group_name] = {
        "islands": len(islands),
        "faces": len(joined.data.polygons),
        "low": [round(value, 4) for value in low],
        "high": [round(value, 4) for value in high],
    }

output_path = resolve(config["output"])
output_path.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=str(output_path),
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_image_format=config.get("imageFormat", "AUTO"),
    export_jpeg_quality=85,
    export_animations=False,
)
summary_path = output_path.with_suffix(".parts.json")
summary_path.write_text(json.dumps({"dropped": dropped, "groups": summary}, indent=1), encoding="utf-8")
for group_name, row in sorted(summary.items()):
    print("GROUP", group_name, row["islands"], "islands", row["faces"], "faces", row["low"], row["high"])
print("DROPPED", dropped, "WROTE", output_path)
