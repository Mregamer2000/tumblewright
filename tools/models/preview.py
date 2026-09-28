"""Render a contact sheet of the exported models (one framed shot per model, tiled):
    blender -b --factory-startup -P preview.py -- models.glb out.png [model names...]"""
import bpy, sys, math, os, tempfile
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
FRONT = 'front' in args
args = [a for a in args if a != 'front']
GLB, PNG, ONLY = args[0], args[1], set(args[2:])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
COLORS = {'main': (0.85, 0.42, 0.18), 'trim': (0.1, 0.1, 0.12), 'metal': (0.75, 0.77, 0.8), 'darkmetal': (0.25, 0.27, 0.3),
          'rubber': (0.08, 0.08, 0.09), 'glass': (0.6, 0.8, 0.95), 'light': (1, 0.95, 0.7), 'redlight': (1, 0.1, 0.1),
          'white': (0.95, 0.95, 0.95), 'accent': (0.3, 0.85, 0.9), 'fabric': (0.18, 0.19, 0.22), 'hair': (0.25, 0.16, 0.1), 'visor': (0.05, 0.06, 0.08)}
for m in bpy.data.materials:
    m.diffuse_color = (*COLORS.get(m.name.split('.')[0], (0.5, 0.5, 0.5)), 1)
roots = sorted([o for o in bpy.data.objects if o.parent is None and o.type == 'EMPTY' and (not ONLY or o.name in ONLY)], key=lambda o: o.name)
allroots = [o for o in bpy.data.objects if o.parent is None]
sc = bpy.context.scene
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.lens = 50
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'MATERIAL'
sc.display.shading.show_cavity = True
sc.display.shading.show_shadows = True
sc.display.shading.show_object_outline = True
T = 360
sc.render.resolution_x = sc.render.resolution_y = T
sc.render.film_transparent = False
tmp = tempfile.mkdtemp()
shots = []


def tree(o):
    yield o
    for c in o.children:
        yield from tree(c)


for r in roots:
    for o in allroots:
        for x in tree(o):
            x.hide_render = o is not r
    pts = [x.matrix_world @ Vector(c) for x in tree(r) if x.type == 'MESH' for c in x.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    ctr, rad = (lo + hi) / 2, (hi - lo).length / 2
    d = Vector((0.8, 1.25 if FRONT else -1.25, 0.75)).normalized()   # game front (-Z) = blender +Y
    cam.location = ctr + d * rad / math.sin(math.radians(17))
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    f = os.path.join(tmp, r.name + '.png')
    sc.render.filepath = f
    bpy.ops.render.render(write_still=True)
    shots.append((r.name, f))

cols = 6
rows = (len(shots) + cols - 1) // cols
W, H = cols * T, rows * T
sheet = bpy.data.images.new('sheet', W, H)
px = [0.0] * (W * H * 4)
for i, (name, f) in enumerate(shots):
    im = bpy.data.images.load(f)
    src = list(im.pixels)
    cx, cy = (i % cols) * T, (rows - 1 - i // cols) * T
    for y in range(T):
        row = src[y * T * 4:(y + 1) * T * 4]
        o = ((cy + y) * W + cx) * 4
        px[o:o + T * 4] = row
sheet.pixels = px
sheet.filepath_raw = PNG
sheet.file_format = 'PNG'
sheet.save()
print('PREVIEW_OK', PNG, [s[0] for s in shots])
