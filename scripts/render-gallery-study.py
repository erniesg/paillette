#!/usr/bin/env python3
"""Build a warm, texture-led gallery study and export reusable room material maps.

Run with:
  /opt/homebrew/bin/blender --background --python scripts/render-gallery-study.py

Artwork is read from a local preview cache by default, but ``--art-dir`` makes
the dependency explicit and lets another local artwork directory be supplied.
The script keeps the .blend and review render in /tmp while committing the
small reusable PNG material maps under apps/web/public/room/materials.
"""

import argparse
import json
import math
import random
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "apps/web/node_modules/.room-preview/public/art"
WORKS = ROOT / "apps/web/node_modules/.room-preview/works.json"
MATERIALS = ROOT / "apps/web/public/room/materials"
RENDER = Path("/tmp/paillette-gallery-render.png")
BLEND = Path("/tmp/paillette-gallery-study.blend")
SIZE = 512
random.seed(19)


def look_at(obj, point):
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat("-Z", "Y").to_euler()


def cube(name, loc, scale, material, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        obj.data.materials.append(material)
    if bevel:
        mod = obj.modifiers.new("Soft architectural edges", "BEVEL")
        mod.width = bevel
        mod.segments = 3
    return obj


def image(name, pixels, is_data=False):
    img = bpy.data.images.new(name, width=SIZE, height=SIZE, alpha=False)
    img.colorspace_settings.name = "Non-Color" if is_data else "sRGB"
    img.pixels.foreach_set(pixels)
    img.filepath_raw = str(MATERIALS / f"{name}.png")
    img.file_format = "PNG"
    img.save()
    return img


def make_maps():
    MATERIALS.mkdir(parents=True, exist_ok=True)
    oak, oak_normal, plaster, plaster_normal = [], [], [], []
    board_px = SIZE // 4
    for y in range(SIZE):
        for x in range(SIZE):
            # Four 180 mm boards run along Y. Grain moves slowly along their
            # length and varies across each narrow board, like planed oak.
            board = min(3, x // board_px)
            across = x - board * board_px
            slow_warp = math.sin(y * .024 + math.sin(y * .006) * 2.3)
            grain = math.sin(across * .105 + slow_warp) * .010 + math.sin(across * .39 + y * .009) * .004
            pores = math.sin(across * 1.9 + y * 1.07) * .0018
            board_tone = (-.009, .003, .010, -.004)[board]
            edge = -.075 if across < 4 or across > board_px - 5 else 0.0
            # Alternate boards end at the tile boundary and halfway along it:
            # repeating the tile gives 1.2 m long, genuinely staggered boards.
            end_joint = -.105 if ((board % 2 == 0 and y < 5) or (board % 2 == 1 and 252 < y < 261)) else 0.0
            value = max(0.0, min(1.0, .545 + grain + pores + board_tone + edge + end_joint))
            oak.extend((value * .98, value * .77, value * .58, 1.0))
            # Delicate longitudinal relief; joins are felt but never embossed.
            nx = 0.5 + math.cos(across * .105 + slow_warp) * .006
            ny = 0.5 + (.025 if edge or end_joint else math.sin(across * .39) * .004)
            oak_normal.extend((nx, ny, 1.0, 1.0))
            # Lime plaster: broad cloudy trowel variation with fine aggregate.
            cloud = math.sin(x * .025 + y * .018) * .018 + math.sin(x * .073 - y * .041) * .011
            grit = math.sin(x * 1.7 + y * 2.3) * .006
            p = max(0.0, min(1.0, 0.78 + cloud + grit))
            plaster.extend((p * 1.01, p * 0.98, p * 0.89, 1.0))
            plaster_normal.extend((0.5 + grit * 1.6, 0.5 + cloud * 1.8, 1.0, 1.0))
    return (
        image("oak-color", oak), image("oak-normal", oak_normal, True),
        image("plaster-color", plaster), image("plaster-normal", plaster_normal, True),
    )


def textured_material(name, color_img, normal_img, scale, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = color_img
    tex.projection = "FLAT"
    coord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = scale
    normal_tex = nodes.new("ShaderNodeTexImage")
    normal_tex.image = normal_img
    normal_tex.image.colorspace_settings.name = "Non-Color"
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = 0.14
    bsdf.inputs["Roughness"].default_value = roughness
    links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
    links.new(mapping.outputs["Vector"], normal_tex.inputs["Vector"])
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(normal_tex.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def simple_material(name, color, roughness=0.5, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def ceiling_material():
    """A warm matte ceiling that stays evenly lit without adding room light."""
    mat = simple_material("Ceiling lime", (.89, .86, .78), .86)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    emission = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
    strength = bsdf.inputs.get("Emission Strength")
    if emission:
        emission.default_value = (.89, .86, .78, 1.0)
    if strength:
        # This neutralizes the area-light footprint on the ceiling while
        # retaining the existing gallery light balance below it.
        strength.default_value = 1.50
    return mat


def frame_ring(name, center, width, height, normal, horizontal, material):
    """Build one continuous, beveled frame ring around an artwork opening."""
    vertical = Vector((0, 0, 1))
    normal, horizontal = Vector(normal), Vector(horizontal)
    outer_u, outer_v = width / 2 + .11, height / 2 + .11
    inner_u, inner_v = width / 2, height / 2
    depth = .11
    # Clockwise rectangles in the frame's horizontal/vertical plane. Joining
    # the strips as one mesh gives the corners a clean mitred profile.
    outer = [(-outer_u, -outer_v), (outer_u, -outer_v), (outer_u, outer_v), (-outer_u, outer_v)]
    inner = [(-inner_u, -inner_v), (inner_u, -inner_v), (inner_u, inner_v), (-inner_u, inner_v)]
    vertices = []
    for offset in (-depth / 2, depth / 2):
        for ring in (outer, inner):
            for u, v in ring:
                vertices.append(Vector(center) + horizontal * u + vertical * v + normal * offset)
    faces = []
    # Front and back annular faces, plus the outer and inner returns.
    for i in range(4):
        nxt = (i + 1) % 4
        faces.extend(((i, nxt, 4 + nxt, 4 + i), (8 + i, 12 + i, 12 + nxt, 8 + nxt),
                      (i, 8 + i, 8 + nxt, nxt), (4 + i, 4 + nxt, 12 + nxt, 12 + i)))
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bevel = obj.modifiers.new("Soft mitred frame edges", "BEVEL")
    bevel.width = .018
    bevel.segments = 3
    return obj


def artwork_path(work):
    """Resolve the cached NGA filename while retaining support for local URLs."""
    direct = ART / Path(work["imageUrl"]).name
    if direct.exists():
        return direct
    parts = work["imageUrl"].split("/")
    if "iiif" in parts:
        identifier = parts[parts.index("iiif") + 1]
        cached = ART / f"nga-{identifier}.jpg"
        if cached.exists():
            return cached
    return direct


def add_frame(work, location, width, height, wall):
    """Add a dimensional artwork frame on X-facing or Y-facing gallery walls."""
    art_path = artwork_path(work)
    img = bpy.data.images.load(str(art_path), check_existing=True)
    art_mat = bpy.data.materials.new("Artwork | " + work["title"])
    art_mat.use_nodes = True
    n = art_mat.node_tree.nodes
    n.get("Principled BSDF").inputs["Roughness"].default_value = .47
    tex = n.new("ShaderNodeTexImage")
    tex.image = img
    art_mat.node_tree.links.new(tex.outputs["Color"], n.get("Principled BSDF").inputs["Base Color"])
    frame = simple_material("Walnut frame", (0.08, .032, .013), .32)
    z = location[2]
    if wall == "back":
        # Wall faces toward -Y; art rests just forward of it.
        plane_loc = (location[0], location[1] - .075, z)
        bpy.ops.mesh.primitive_plane_add(size=2, location=plane_loc, rotation=(math.pi / 2, 0, 0))
        art = bpy.context.object
        art.name = "Artwork | " + work["title"]
        art.scale = (width / 2, height / 2, 1)
        art.data.materials.append(art_mat)
        frame_ring("Frame | " + work["title"], (location[0], location[1] - .10, z), width, height,
                   (0, -1, 0), (1, 0, 0), frame)
    else:
        # Side wall faces inward across X.
        direction = 1 if location[0] < 0 else -1
        plane_loc = (location[0] + direction * .075, location[1], z)
        bpy.ops.mesh.primitive_plane_add(size=2, location=plane_loc, rotation=(math.pi/2, 0, direction * math.pi/2))
        art = bpy.context.object
        art.name = "Artwork | " + work["title"]
        art.scale = (width / 2, height / 2, 1)
        art.data.materials.append(art_mat)
        x = location[0] + direction * .10
        frame_ring("Frame | " + work["title"], (x, location[1], z), width, height,
                   (direction, 0, 0), (0, 1, 0), frame)
    # Small white label establishes a human viewing scale.
    label = simple_material("Label stock", (.87, .84, .77), .7)
    if wall == "back":
        cube("Artwork label", (location[0], location[1] - .09, z-height/2-.30), (.32, .025, .075), label)
    else:
        cube("Artwork label", (location[0]+direction*.09, location[1], z-height/2-.30), (.025, .32, .075), label)


def add_spot(location, target, track_axis="x"):
    charcoal = simple_material("Track charcoal", (.025, .022, .019), .28, .45)
    # Cylindrical spot and warm focused pool of light.
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=.105, depth=.28, location=location)
    fixture = bpy.context.object
    fixture.name = "Track spotlight"
    fixture.data.materials.append(charcoal)
    look_at(fixture, target)
    bpy.ops.object.light_add(type="SPOT", location=location)
    light = bpy.context.object
    light.name = "Warm artwork spotlight"
    light.data.energy = 300
    light.data.color = (1.0, .89, .76)
    light.data.spot_size = math.radians(30)
    light.data.spot_blend = .38
    look_at(light, target)


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for data in (bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        pass
    oak_c, oak_n, plaster_c, plaster_n = make_maps()
    # Four boards per 512 px tile: 4 × 0.18 m wide, 1.2 m long, laid along Y.
    oak = textured_material("Warm oak planks", oak_c, oak_n, (17.5, 16.7, 1.0), .45)
    lime = textured_material("Hand troweled lime plaster", plaster_c, plaster_n, (3.0, 4.0, 3.0), .77)
    ceiling = ceiling_material()
    black = simple_material("Architecture charcoal", (.028, .024, .02), .34, .3)
    brass = simple_material("Aged brass", (.36, .20, .065), .28, .68)

    # Gallery envelope: open entry behind camera, long walls and a focal end wall.
    cube("Oak floor", (0, 0, -.11), (6.3, 10.8, .11), oak, .03)
    cube("Left lime plaster wall", (-6.2, .2, 2.1), (.14, 10.6, 2.1), lime, .025)
    cube("Right lime plaster wall", (6.2, .2, 2.1), (.14, 10.6, 2.1), lime, .025)
    cube("Focal lime plaster wall", (0, 10.65, 2.1), (6.3, .14, 2.1), lime, .025)
    cube("Ceiling", (0, .2, 4.25), (6.3, 10.6, .12), ceiling)
    # Deep doorway and a darker threshold make the entry position obvious.
    cube("Entry jamb left", (-4.45, -10.0, 2.1), (1.75, .38, 2.1), lime)
    cube("Entry jamb right", (4.45, -10.0, 2.1), (1.75, .38, 2.1), lime)
    cube("Entry lintel", (0, -10.0, 3.65), (2.7, .38, .55), lime)
    cube("Entry threshold", (0, -9.65, .015), (2.7, .55, .018), brass)

    # Two slim tracks cover the side-wall fixtures without crossing the entry
    # view. They begin and end within the gallery rather than at the camera.
    for x in (-3.32, 3.32):
        cube("Recessed lighting track", (x, 1.65, 4.105), (.018, 6.55, .018), black, .006)
    # The end-wall fixture mounts to a small ceiling stub, so no spotlight
    # floats after removing the central track.
    cube("End wall spotlight mount", (0, 9.30, 4.105), (.22, .018, .018), black, .006)

    works = json.loads(WORKS.read_text())
    chosen = [works[i] for i in (0, 4, 6, 11, 14, 18, 22)]
    placements = [
        (chosen[0], (-6.03, -4.9, 2.15), 2.18, 1.52, "side"),
        (chosen[1], (6.03, -3.7, 2.18), 2.10, 1.42, "side"),
        (chosen[2], (-6.03, 1.0, 2.15), 1.78, 2.25, "side"),
        (chosen[3], (6.03, 2.4, 2.16), 2.10, 1.55, "side"),
        (chosen[4], (-6.03, 6.4, 2.17), 2.34, 1.55, "side"),
        (chosen[5], (6.03, 7.05, 2.14), 1.62, 2.10, "side"),
        (chosen[6], (0, 10.45, 2.30), 2.75, 1.80, "back"),
    ]
    for work, loc, w, h, wall in placements:
        add_frame(work, loc, w, h, wall)
        if wall == "back":
            add_spot((loc[0], loc[1] - 1.15, 3.93), (loc[0], loc[1] - .15, loc[2]))
        else:
            add_spot((loc[0] * .55, loc[1], 3.93), (loc[0] * .95, loc[1], loc[2]))

    # A modest bench provides scale without competing with the framed works.
    cube("Oak gallery bench seat", (1.65, 3.85, .52), (1.35, .40, .10), oak, .025)
    for x in (.70, 2.60):
        cube("Oak gallery bench leg", (x, 3.85, .25), (.10, .30, .25), oak, .018)

    bpy.ops.object.light_add(type="AREA", location=(0, -1.5, 3.95))
    ambient = bpy.context.object
    ambient.name = "Soft gallery ambient"
    ambient.data.energy = 1000
    ambient.data.shape = "RECTANGLE"
    ambient.data.size = 8
    ambient.data.size_y = 13
    ambient.data.color = (1.0, .94, .84)
    look_at(ambient, (0, 2, 0))
    bpy.ops.object.light_add(type="AREA", location=(0, -8.3, 3.45))
    daylight = bpy.context.object
    daylight.name = "Entry daylight fill"
    daylight.data.energy = 900
    daylight.data.shape = "RECTANGLE"
    daylight.data.size = 5.0
    daylight.data.size_y = 2.5
    daylight.data.color = (1.0, .97, .92)
    look_at(daylight, (0, 2.8, 1.4))

    bpy.ops.object.camera_add(location=(0, -9.15, 2.18))
    camera = bpy.context.object
    camera.name = "Entry wide view"
    camera.data.lens = 25
    camera.data.sensor_width = 36
    look_at(camera, (0, 2.7, 1.72))
    bpy.context.scene.camera = camera
    scene = bpy.context.scene
    # Blender 5.1 exposes the Next renderer as BLENDER_EEVEE.
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(RENDER)
    scene.render.film_transparent = False
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (.15, .13, .10, 1.0)
    background.inputs["Strength"].default_value = .28
    scene.view_settings.look = "AgX - Medium Low Contrast"
    # Keep the review artifact portable: artwork and procedural map images travel
    # inside the .blend rather than depending on the local preview cache.
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    bpy.ops.render.render(write_still=True)
    print("GALLERY_OUTPUT", RENDER)
    print("MATERIAL_OUTPUT", MATERIALS)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--art-dir", type=Path, default=ART, help="local directory containing the NGA artwork JPEGs")
    parser.add_argument("--works", type=Path, default=WORKS, help="local works.json metadata file")
    options, _ = parser.parse_known_args()
    ART, WORKS = options.art_dir, options.works
    main()
