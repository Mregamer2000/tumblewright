"""
Tumblewright model builder (Blender 4.2+ / 5.x, run headless):

    blender --background --factory-startup --python tools/models/build_models.py -- out.glb

Every model is authored in GAME units/axes (metres, +Y up, forward = -Z) and converted to
Blender axes on output, so the exported glTF matches the game's physics colliders exactly.
Each top-level node is one model (e.g. "crate"); sub-nodes are only used where the game
animates parts (avatar head/legs/gun). Material names are SLOTS the game maps to its own
tier-aware materials: main (entity material + paint color), trim, metal, darkmetal, rubber,
glass, light, redlight, white, accent, fabric, hair, visor.
"""
import bpy, bmesh, math, sys
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = next((a for a in ARGS if not a.startswith('--')), 'models.glb')
# --lowpoly: the same models rebuilt PS1-style for the Low graphics tier (few segments, no bevels, hard edges)
LOW = '--lowpoly' in ARGS


def S(seg, lo):
    return max(lo, int(round(seg * 0.34))) if LOW else seg
TAU = math.pi * 2
G2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # game (x,y,z) -> blender (x,-z,y)
RX90 = Matrix.Rotation(-math.pi / 2, 4, 'X')                          # blender-primitive Z axis -> game Y axis

bpy.ops.wm.read_factory_settings(use_empty=True)
MATS = {}


def mat(name):
    if name not in MATS:
        m = bpy.data.materials.new(name)
        m.diffuse_color = {'main': (0.8, 0.5, 0.3, 1), 'trim': (0.1, 0.1, 0.1, 1)}.get(name, (0.6, 0.6, 0.6, 1))
        MATS[name] = m
    return MATS[name]


# ---------------------------------------------------------------------------
# primitive builders: return a fresh bmesh in GAME space
# ---------------------------------------------------------------------------
def bm_box(sx, sy, sz):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    return bm


def bm_cyl(r1, r2, h, seg=24, caps=True):
    seg = S(seg, 6)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h)
    bmesh.ops.transform(bm, matrix=RX90, verts=bm.verts)
    return bm


def bm_sphere(r, seg=20, rings=12):
    seg, rings = S(seg, 6), (max(4, rings // 2) if LOW else rings)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    bmesh.ops.transform(bm, matrix=RX90, verts=bm.verts)
    return bm


def bm_lathe(profile, seg=32):
    """profile: list of (radius, y) from bottom to top, revolved around game Y."""
    seg = S(seg, 6)
    if LOW and len(profile) > 7:   # thin long profiles out, keeping both ends
        profile = profile[::2] + ([profile[-1]] if (len(profile) - 1) % 2 else [])
    bm = bmesh.new()
    verts = [bm.verts.new((r, y, 0)) for r, y in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 1, 0), angle=TAU, steps=seg, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    # cap degenerate poles (radius 0) are merged by remove_doubles; fill open ends
    boundary = [e for e in bm.edges if e.is_boundary]
    if boundary:
        bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
    return bm


def bm_torus(R, r, seg=32, rseg=10):
    rseg = max(3, rseg // 3) if LOW else rseg
    prof = [(R + r * math.cos(a), r * math.sin(a)) for a in [i / rseg * TAU for i in range(rseg + 1)]]
    return bm_lathe(prof, seg)


def bm_profile(points_zy, width):
    """Extrude a side profile (list of (z, y) in order) across game X, centred."""
    bm = bmesh.new()
    vs = [bm.verts.new((-width / 2, y, z)) for z, y in points_zy]
    f = bm.faces.new(vs)
    res = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(width, 0, 0), verts=nv)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def bm_profile_x(points_zy, length):
    """Extrude a cross-section (z, y) along game X (for blocks/barriers)."""
    return bm_profile(points_zy, length)


def bevel(bm, width, seg=2, angle=30):
    if LOW:
        return bm
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(angle)]
    if edges and width > 0:
        bmesh.ops.bevel(bm, geom=edges, offset=width, offset_type='OFFSET', segments=seg, profile=0.5, affect='EDGES', clamp_overlap=True)
    return bm


def xf(bm, pos=(0, 0, 0), rot=(0, 0, 0), scale=None):
    """rot = game-space Euler XYZ in radians."""
    if scale:
        bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    m = Matrix.Translation(Vector(pos)) @ Matrix.Rotation(rot[2], 4, 'Z') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X')
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm


def bm_tube(a, b, r, seg=12):
    seg = max(4, S(seg, 4))
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = bm_cyl(r, r, d.length, seg)
    q = Vector((0, 1, 0)).rotation_difference(d.normalized())
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4(), verts=bm.verts)
    return bm


def bm_rbox(sx, sy, sz, r, seg=2):
    return bevel(bm_box(sx, sy, sz), min(r, sx / 2.05, sy / 2.05, sz / 2.05), seg)


# ---------------------------------------------------------------------------
# node = one exported mesh object (with several material slots)
# ---------------------------------------------------------------------------
class Node:
    def __init__(self, name, origin=(0, 0, 0)):
        self.name, self.origin = name, Vector(origin)
        self.bm, self.slots, self.children = bmesh.new(), [], []

    def add(self, piece, slot):
        if slot not in self.slots:
            self.slots.append(slot)
        idx = self.slots.index(slot)
        # make every face point outward (lathe/spin pieces come out inside-out otherwise, and the game culls back faces)
        bmesh.ops.recalc_face_normals(piece, faces=piece.faces)
        me = bpy.data.meshes.new('tmp')
        piece.to_mesh(me)
        piece.free()
        n0 = len(self.bm.faces)
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        self.bm.faces.ensure_lookup_table()
        for f in self.bm.faces[n0:]:
            f.material_index = idx
        return self

    def child(self, node):
        self.children.append(node)
        return node

    def build(self, parent=None, parent_origin=Vector((0, 0, 0))):
        bm = self.bm
        bmesh.ops.translate(bm, vec=-self.origin, verts=bm.verts)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        # world-scale box-projected UVs (1 UV unit = 1 m) so procedural textures tile correctly
        uv = bm.loops.layers.uv.verify()
        bm.normal_update()
        for f in bm.faces:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                c = l.vert.co + self.origin
                l[uv].uv = (c.z, c.y) if ax == 0 else (c.x, c.z) if ax == 1 else (c.x, c.y)
        bmesh.ops.transform(bm, matrix=G2B, verts=bm.verts)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for s in self.slots:
            me.materials.append(mat(s))
        for p in me.polygons:
            p.use_smooth = True
        me.set_sharp_from_angle(angle=math.radians(38))
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = G2B @ (self.origin - parent_origin)
        if parent:
            ob.parent = parent
        for c in self.children:
            c.build(ob, self.origin)
        return ob


def model(name):
    """Top-level model root (an empty) so the game can find models by name."""
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    return root


def finish(name, *nodes):
    root = model(name)
    for n in nodes:
        n.build(root)


# ---------------------------------------------------------------------------
# PROPS
# ---------------------------------------------------------------------------
def crate():
    n = Node('crate_mesh')
    s, t, b = 1.0, 0.1, 0.06            # size, frame beam width, plank board thickness
    h = s / 2
    # frame: 12 edge beams
    for ax in range(3):
        for u in (-1, 1):
            for v in (-1, 1):
                dims, pos = [t, t, t], [0, 0, 0]
                dims[ax] = s
                o = [i for i in range(3) if i != ax]
                pos[o[0]] = u * (h - t / 2)
                pos[o[1]] = v * (h - t / 2)
                n.add(xf(bm_rbox(*dims, 0.012), pos), 'main')
    # planked faces (4 boards per face, small gaps) + diagonal brace on the sides
    inner = s - 2 * t
    for ax in range(3):
        for sgn in (-1, 1):
            for i in range(4):
                bw = inner / 4 - 0.008
                off = -inner / 2 + (i + 0.5) * inner / 4
                dims, pos = [0, 0, 0], [0, 0, 0]
                o = [k for k in range(3) if k != ax]
                dims[ax] = b
                dims[o[0]] = inner + 0.01
                dims[o[1]] = bw
                pos[ax] = sgn * (h - b / 2 - 0.012)
                pos[o[1]] = off
                n.add(xf(bm_rbox(*dims, 0.006, 1), pos), 'main')
            if ax != 1:
                L = inner * math.sqrt(2) - 0.05
                dims = [0.02 + b, t * 0.8, L] if ax == 0 else [L, t * 0.8, 0.02 + b]
                pos = [0, 0, 0]
                pos[ax] = sgn * (h - b / 2 + 0.008)
                rot = (math.pi / 4 * sgn, 0, 0) if ax == 0 else (0, 0, math.pi / 4 * sgn)
                n.add(xf(bm_rbox(*dims, 0.01, 1), pos, rot), 'main')
    # corner brackets
    for x in (-1, 1):
        for y in (-1, 1):
            for z in (-1, 1):
                n.add(xf(bm_rbox(0.16, 0.16, 0.16, 0.02), (x * (h - 0.07), y * (h - 0.07), z * (h - 0.07))), 'darkmetal')
    finish('crate', n)


def metal_crate():
    n = Node('mcrate_mesh')
    s, h = 1.0, 0.5
    n.add(bm_rbox(0.92, 0.92, 0.92, 0.02), 'main')
    # corrugation on the four sides
    for side in range(4):
        for i in range(9):
            off = -0.36 + i * 0.09
            if side < 2:
                n.add(xf(bm_rbox(0.035, 0.8, 0.05, 0.012, 1), (off, 0, (1 if side == 0 else -1) * 0.468)), 'main')
            else:
                n.add(xf(bm_rbox(0.05, 0.8, 0.035, 0.012, 1), ((1 if side == 2 else -1) * 0.468, 0, off)), 'main')
    # top stiffeners
    for i in (-0.2, 0.2):
        n.add(xf(bm_rbox(0.84, 0.03, 0.08, 0.01, 1), (0, 0.468, i)), 'main')
    # frame + corner castings
    for ax in range(3):
        for u in (-1, 1):
            for v in (-1, 1):
                dims, pos = [0.07, 0.07, 0.07], [0, 0, 0]
                dims[ax] = 0.9
                o = [i for i in range(3) if i != ax]
                pos[o[0]] = u * (h - 0.035)
                pos[o[1]] = v * (h - 0.035)
                n.add(xf(bm_rbox(*dims, 0.01, 1), pos), 'darkmetal')
    for x in (-1, 1):
        for y in (-1, 1):
            for z in (-1, 1):
                n.add(xf(bm_rbox(0.11, 0.11, 0.11, 0.015), (x * 0.445, y * 0.445, z * 0.445)), 'darkmetal')
    # door lock bars + handles on the front (-Z)
    for x in (-0.12, 0.12):
        n.add(bm_tube((x, -0.42, -0.51), (x, 0.42, -0.51), 0.012, 10), 'metal')
        n.add(xf(bm_rbox(0.05, 0.12, 0.025, 0.008, 1), (x + 0.04, 0, -0.52)), 'metal')
    finish('mcrate', n)


def barrel(name='barrel'):
    n = Node(name + '_mesh')
    r, H = 0.34, 1.0
    prof = []
    for i in range(13):
        y = -H / 2 + 0.035 + i * (H - 0.07) / 12
        prof.append((r * (0.955 + 0.045 * math.cos(y / (H / 2) * math.pi / 2)), y))
    body = [(r * 0.94, -H / 2 + 0.03)] + prof + [(r * 0.94, H / 2 - 0.03)]
    n.add(bm_lathe(body, 40), 'main')
    for y in (-H / 2 + 0.022, H / 2 - 0.022):  # rolled chimes
        n.add(xf(bm_torus(r * 0.955, 0.022, 40, 8), (0, y, 0)), 'main')
    for y in (-0.18, 0.18):  # rolling hoops
        n.add(xf(bm_torus(r * 1.0, 0.014, 40, 8), (0, y, 0)), 'main')
    n.add(xf(bm_cyl(r * 0.93, r * 0.93, 0.02, 40), (0, H / 2 - 0.035, 0)), 'main')   # lid
    n.add(xf(bm_cyl(r * 0.93, r * 0.93, 0.02, 40), (0, -H / 2 + 0.035, 0)), 'main')
    for x, rr in ((0.18, 0.045), (-0.2, 0.03)):  # bungs
        n.add(xf(bevel(bm_cyl(rr, rr, 0.03, 16), 0.006, 1), (x, H / 2 - 0.02, 0.05)), 'darkmetal')
    if name == 'xbarrel':   # explosive: hazard band + flame diamonds front and back
        n.add(bm_lathe([(r * 1.003, -0.12), (r * 1.012, -0.11), (r * 1.012, 0.11), (r * 1.003, 0.12), (r * 1.003, -0.12)], 40), 'second')
        for sgn in (1, -1):
            z = sgn * (r * 1.012 + 0.004)
            n.add(xf(bm_box(0.15, 0.15, 0.008), (0, 0, z), (0, 0, math.pi / 4)), 'white')
            n.add(xf(bm_box(0.1, 0.1, 0.01), (0, 0, z + sgn * 0.002), (0, 0, math.pi / 4)), 'trim')
            n.add(xf(bm_sphere(0.028, 10, 6), (0, -0.012, z + sgn * 0.006), scale=(1, 1.3, 0.25)), 'red')
    finish(name, n)


def xbarrel():
    barrel('xbarrel')


def cone():
    n = Node('cone_mesh')
    n.add(xf(bm_rbox(0.52, 0.035, 0.52, 0.03), (0, -0.33, 0)), 'trim')
    body = [(0.21, -0.315), (0.2, -0.28), (0.035, 0.34), (0.02, 0.35), (0.0, 0.352)]
    n.add(bm_lathe(body, 28), 'main')
    for y0, y1 in ((-0.1, 0.0), (0.1, 0.17)):
        ra = 0.2 - (y0 + 0.28) / 0.62 * 0.165 + 0.004
        rb = 0.2 - (y1 + 0.28) / 0.62 * 0.165 + 0.004
        n.add(bm_lathe([(ra, y0), (rb, y1)], 28), 'white')
    finish('cone', n)


def concrete_block():
    n = Node('cblock_mesh')
    sec = [(-0.3, -0.3), (0.3, -0.3), (0.3, -0.12), (0.24, 0.3), (-0.24, 0.3), (-0.3, -0.12)]
    n.add(bevel(bm_profile_x(sec, 1.2), 0.025, 2, 20), 'main')
    for x in (-0.38, 0.38):  # lifting loops
        n.add(xf(bm_torus(0.06, 0.013, 16, 6), (x, 0.3, 0), (math.pi / 2, 0, 0)), 'metal')
    for x in (-0.3, 0.3):  # forklift pockets
        n.add(xf(bm_box(0.2, 0.08, 0.62), (x, -0.24, 0)), 'trim')
    finish('cblock', n)


def seat():
    n = Node('seat_mesh')
    # pan shell + side bolsters
    n.add(xf(bm_rbox(0.6, 0.09, 0.58, 0.035), (0, -0.025, 0)), 'main')
    for x in (-0.27, 0.27):
        n.add(xf(bm_rbox(0.07, 0.14, 0.52, 0.03), (x, 0.04, -0.01)), 'main')
    n.add(xf(bm_rbox(0.46, 0.06, 0.48, 0.03), (0, 0.045, -0.02)), 'fabric')
    # backrest shell, bolsters, cushion, headrest
    n.add(xf(bm_rbox(0.6, 0.64, 0.1, 0.04), (0, 0.37, 0.27), (-0.12, 0, 0)), 'main')
    for x in (-0.26, 0.26):
        n.add(xf(bm_rbox(0.08, 0.5, 0.12, 0.035), (x, 0.33, 0.2), (-0.12, 0, 0)), 'main')
    n.add(xf(bm_rbox(0.42, 0.5, 0.05, 0.025), (0, 0.33, 0.205), (-0.12, 0, 0)), 'fabric')
    n.add(xf(bm_rbox(0.3, 0.14, 0.08, 0.035), (0, 0.66, 0.29), (-0.12, 0, 0)), 'fabric')
    # mounting rails
    for x in (-0.18, 0.18):
        n.add(xf(bm_rbox(0.04, 0.03, 0.56, 0.01, 1), (x, -0.085, 0)), 'darkmetal')
    finish('seat', n)


def wheel():
    """Reference wheel: radius 1, width 1, axle along game Y. The game scales it to (r, w, r)."""
    n = Node('wheel_mesh')
    tire = [(0.62, -0.46), (0.78, -0.5), (0.93, -0.47), (0.99, -0.38), (1.0, -0.2), (1.0, 0.2), (0.99, 0.38), (0.93, 0.47), (0.78, 0.5), (0.62, 0.46)]
    n.add(bm_lathe(tire, 40), 'main')
    for i in range(20):  # tread blocks
        a = i / 20 * TAU
        for side in (-1, 1):
            b = xf(bm_box(0.17, 0.3, 0.05), (0, side * 0.2, 1.0), (0, 0, 0))
            bmesh.ops.transform(b, matrix=Matrix.Rotation(a + side * 0.08, 4, 'Y'), verts=b.verts)
            n.add(b, 'main')
    rim = [(0.63, -0.44), (0.6, -0.34), (0.3, -0.3), (0.2, -0.36), (0.0, -0.36)]
    n.add(bm_lathe(rim, 36), 'metal')
    n.add(bm_lathe([(0.63, 0.44), (0.6, 0.34), (0.0, 0.34)], 36), 'darkmetal')
    for i in range(5):  # spokes
        a = i / 5 * TAU
        s = xf(bm_rbox(0.12, 0.08, 0.42, 0.02, 1), (0, -0.33, 0.39))
        bmesh.ops.transform(s, matrix=Matrix.Rotation(a, 4, 'Y'), verts=s.verts)
        n.add(s, 'metal')
        nut = xf(bm_cyl(0.035, 0.035, 0.06, 8), (0, -0.39, 0.13))
        bmesh.ops.transform(nut, matrix=Matrix.Rotation(a + 0.6, 4, 'Y'), verts=nut.verts)
        n.add(nut, 'darkmetal')
    n.add(xf(bevel(bm_cyl(0.11, 0.11, 0.06, 20), 0.02, 2), (0, -0.38, 0)), 'metal')
    finish('wheel', n)


# ---------------------------------------------------------------------------
# VEHICLES (authored in the chassis entity's local space)
# ---------------------------------------------------------------------------
def arch_points(cz, cy, R, y_bottom, forward_first, steps=12):
    t0 = math.asin(max(-1, min(1, (y_bottom - cy) / R)))
    ts = [t0 + (math.pi - 2 * t0) * i / steps for i in range(steps + 1)]
    pts = [(cz + R * math.cos(t), cy + R * math.sin(t)) for t in ts]   # from +z side to -z side
    return pts if forward_first else pts[::-1]


def car():
    n = Node('car_mesh')
    yb, wy, R = -0.15, -0.2, 0.47
    prof = [(-1.62, yb), (-1.66, 0.02), (-1.6, 0.16), (-1.2, 0.27), (-0.62, 0.34), (-0.48, 0.35),
            (-0.44, 0.17), (0.6, 0.17), (0.68, 0.36), (1.2, 0.38), (1.6, 0.32), (1.68, 0.1), (1.64, yb)]
    # bottom line back to front with wheel arches (rear arch first)
    prof += arch_points(1.0, wy, R, yb, True)
    prof += arch_points(-0.98, wy, R, yb, True)
    body = bm_profile(prof, 1.52)
    n.add(bevel(body, 0.045, 3, 25), 'main')
    # cockpit tub sides, dashboard, windshield frame + glass
    for x in (-0.71, 0.71):
        n.add(xf(bm_rbox(0.1, 0.24, 1.0, 0.04), (x, 0.3, 0.1)), 'main')
    n.add(xf(bm_rbox(1.3, 0.14, 0.2, 0.04), (0, 0.3, -0.38)), 'trim')
    n.add(bm_tube((0.0, 0.34, -0.3), (0.0, 0.42, -0.15), 0.018), 'darkmetal')
    n.add(xf(bm_torus(0.12, 0.018, 20, 6), (0, 0.44, -0.13), (1.1, 0, 0)), 'trim')
    wind_rot = (0.55, 0, 0)
    n.add(xf(bm_box(1.3, 0.52, 0.02), (0, 0.62, -0.46), wind_rot), 'glass')
    for x in (-0.67, 0.67):
        n.add(bm_tube((x, 0.35, -0.6), (x, 0.8, -0.34), 0.025), 'darkmetal')
    n.add(bm_tube((-0.67, 0.8, -0.34), (0.67, 0.8, -0.34), 0.025), 'darkmetal')
    # roll bar behind the seat
    for x in (-0.45, 0.45):
        n.add(bm_tube((x, 0.36, 0.7), (x * 0.9, 0.95, 0.62), 0.035), 'metal')
    n.add(bm_tube((-0.405, 0.95, 0.62), (0.405, 0.95, 0.62), 0.035), 'metal')
    # lights, grille, bumpers, mirrors, exhaust
    for x in (-0.5, 0.5):
        n.add(xf(bm_rbox(0.3, 0.1, 0.06, 0.03), (x, 0.13, -1.62), (0.4, 0, 0)), 'light')
        n.add(xf(bm_rbox(0.28, 0.08, 0.05, 0.02), (x, 0.23, 1.66)), 'redlight')
        n.add(xf(bm_rbox(0.1, 0.07, 0.12, 0.02), (x * 1.56, 0.44, -0.44)), 'darkmetal')
    n.add(xf(bm_rbox(0.62, 0.12, 0.05, 0.02), (0, 0.0, -1.66)), 'trim')
    for z in (-1.68, 1.7):
        n.add(xf(bm_rbox(1.58, 0.12, 0.1, 0.045), (0, -0.08, z)), 'darkmetal')
    for x in (-0.3, -0.18):
        n.add(bm_tube((x, -0.12, 1.4), (x, -0.12, 1.76), 0.035), 'metal')
    # underbody pan
    n.add(xf(bm_box(1.3, 0.04, 2.9), (0, -0.16, 0)), 'trim')
    finish('car', n)


def kart():
    n = Node('kart_mesh')
    n.add(xf(bm_rbox(0.86, 0.04, 1.6, 0.015), (0, -0.02, 0)), 'main')           # floor pan
    fr = [(-0.46, 0.0, -0.85), (0.46, 0.0, -0.85), (0.46, 0.0, 0.88), (-0.46, 0.0, 0.88)]
    for i in range(4):
        n.add(bm_tube(fr[i], fr[(i + 1) % 4], 0.025), 'darkmetal')
    for side in (-1, 1):   # side pods
        n.add(xf(bm_rbox(0.16, 0.14, 0.7, 0.05), (side * 0.52, 0.06, 0.05)), 'main')
        n.add(bm_tube((side * 0.46, 0.0, -0.85), (side * 0.5, 0.05, -1.02), 0.022), 'darkmetal')
    n.add(bm_tube((-0.5, 0.05, -1.02), (0.5, 0.05, -1.02), 0.022), 'darkmetal')        # front bumper
    n.add(bm_tube((-0.55, 0.06, 1.0), (0.55, 0.06, 1.0), 0.025), 'darkmetal')          # rear bumper
    nose = [(-0.98, 0.0), (-0.98, 0.07), (-0.6, 0.22), (-0.45, 0.22), (-0.45, 0.0)]
    n.add(bevel(bm_profile(nose, 0.8), 0.03, 2), 'main')
    n.add(xf(bm_rbox(0.26, 0.14, 0.01, 0.02), (0, 0.13, -0.95), (0.35, 0, 0)), 'white')
    n.add(bm_tube((0, 0.18, -0.48), (0, 0.42, -0.25), 0.018), 'darkmetal')             # steering column
    n.add(xf(bm_torus(0.13, 0.018, 20, 6), (0, 0.43, -0.23), (1.0, 0, 0)), 'trim')
    n.add(xf(bm_rbox(0.24, 0.22, 0.26, 0.03), (0.2, 0.15, 0.72)), 'darkmetal')         # engine
    for i in range(4):
        n.add(xf(bm_box(0.26, 0.012, 0.28), (0.2, 0.1 + i * 0.045, 0.72)), 'metal')
    n.add(bm_tube((0.32, 0.15, 0.72), (0.4, 0.18, 1.02), 0.03), 'metal')               # exhaust
    finish('kart', n)


def pickup():
    """Pickup truck. Wheels (added by the game): r 0.45 at x ±0.86, rest centre y -0.36, z -1.42 / 1.3."""
    n = Node('pickup_mesh')
    yb = -0.22
    side = [(-2.22, yb), (-2.26, 0.05), (-2.2, 0.36), (-0.62, 0.42), (-0.5, 1.02), (0.72, 1.06), (0.78, 0.44), (2.2, 0.44), (2.24, 0.1), (2.2, yb)]
    side += arch_points(1.3, -0.36, 0.53, yb, True)
    side += arch_points(-1.42, -0.36, 0.53, yb, True)
    body = bm_profile(side, 1.9)
    n.add(bevel(body, 0.05, 3, 25), 'main')
    # bed: hollow it out visually with a dark floor + inner walls
    n.add(xf(bm_box(1.7, 0.02, 1.36), (0, 0.445, 1.47)), 'trim')
    for x in (-0.9, 0.9):
        n.add(xf(bm_rbox(0.1, 0.1, 1.46, 0.03), (x, 0.49, 1.47)), 'main')                     # bed rails
    n.add(xf(bm_rbox(1.9, 0.1, 0.1, 0.03), (0, 0.49, 2.17)), 'main')                            # tailgate top
    # windows
    n.add(xf(bm_box(1.72, 0.5, 0.02), (0, 0.74, -0.57), (0.2, 0, 0)), 'glass')                   # windshield
    n.add(xf(bm_box(1.72, 0.42, 0.02), (0, 0.76, 0.77)), 'glass')                               # rear window
    for x in (-0.955, 0.955):
        n.add(xf(bm_box(0.02, 0.42, 1.02), (x, 0.76, 0.1)), 'glass')                           # side windows
        n.add(xf(bm_box(0.02, 0.5, 0.05), (x * 1.001, 0.74, 0.1)), 'trim')                     # B pillar
        n.add(xf(bm_rbox(0.08, 0.12, 0.16, 0.02), (x * 1.08, 0.72, -0.5)), 'darkmetal')         # mirrors
        n.add(xf(bm_rbox(0.03, 0.04, 0.2, 0.01), (x * 1.0, 0.34, 0.2)), 'darkmetal')           # door handle
    # grille, lights, bumpers
    n.add(xf(bm_rbox(1.2, 0.3, 0.06, 0.03), (0, 0.12, -2.25)), 'trim')
    for i in range(4):
        n.add(xf(bm_box(1.1, 0.02, 0.07), (0, 0.02 + i * 0.07, -2.27)), 'metal')
    for x in (-0.78, 0.78):
        n.add(xf(bm_rbox(0.3, 0.16, 0.06, 0.03), (x, 0.18, -2.24)), 'light')
        n.add(xf(bm_rbox(0.12, 0.28, 0.05, 0.02), (x * 1.08, 0.22, 2.22)), 'redlight')
    for z, w in ((-2.32, 1.96), (2.3, 1.96)):
        n.add(xf(bm_rbox(w, 0.16, 0.14, 0.05), (0, -0.12, z)), 'metal')
    n.add(xf(bm_box(1.5, 0.04, 4.2), (0, -0.24, 0)), 'trim')                                    # underbody
    finish('pickup', n)


def monster():
    """Monster truck. Wheels r 0.8, w 0.6 at x ±1.22, rest centre y -0.55, z ±1.4."""
    n = Node('monster_mesh')
    yb = 0.02
    side = [(-2.05, yb), (-2.1, 0.3), (-2.0, 0.55), (-0.6, 0.6), (-0.45, 1.25), (0.75, 1.28), (0.82, 0.62), (2.0, 0.62), (2.05, 0.3), (2.0, yb)]
    body = bm_profile(side, 2.0)
    n.add(bevel(body, 0.06, 3, 25), 'main')
    for x in (-1.0, 1.0):                                                                        # fender flares
        for z in (-1.4, 1.4):
            n.add(xf(bm_rbox(0.3, 0.1, 1.5, 0.04), (x * 1.08, 0.05, z)), 'trim')
    n.add(xf(bm_box(1.82, 0.52, 0.02), (0, 0.95, -0.52), (0.18, 0, 0)), 'glass')
    n.add(xf(bm_box(1.82, 0.45, 0.02), (0, 0.97, 0.81)), 'glass')
    for x in (-1.005, 1.005):
        n.add(xf(bm_box(0.02, 0.45, 1.05), (x, 0.97, 0.15)), 'glass')
    n.add(xf(bm_box(1.8, 0.02, 1.1), (0, 0.63, 1.42)), 'trim')                                   # bed floor
    for i in range(5):                                                                           # roof light bar
        n.add(xf(bm_rbox(0.14, 0.1, 0.1, 0.02), (-0.5 + i * 0.25, 1.34, -0.3)), 'light')
    n.add(xf(bm_box(1.3, 0.04, 0.12), (0, 1.3, -0.3)), 'darkmetal')
    # frame + shocks + axles
    for x in (-0.55, 0.55):
        n.add(xf(bm_box(0.14, 0.16, 3.6), (x, -0.22, 0)), 'darkmetal')
    for z in (-1.4, 1.4):
        n.add(bm_tube((-1.0, -0.55, z), (1.0, -0.55, z), 0.07, 12), 'darkmetal')                 # axle
        n.add(xf(bm_sphere(0.2, 14, 10), (0, -0.55, z)), 'darkmetal')                            # diff
        for x in (-0.75, 0.75):
            n.add(bm_tube((x, -0.5, z + 0.15), (x * 0.8, 0.2, z + 0.1), 0.05, 10), 'accent')     # shocks
            n.add(bm_tube((x, -0.5, z - 0.15), (x * 0.8, 0.2, z - 0.1), 0.05, 10), 'accent')
    for x in (-0.7, 0.7):
        n.add(xf(bm_rbox(0.34, 0.2, 0.06, 0.03), (x, 0.36, -2.07)), 'light')
        n.add(xf(bm_rbox(0.2, 0.2, 0.05, 0.02), (x * 1.2, 0.36, 2.03)), 'redlight')
    n.add(xf(bm_rbox(2.1, 0.2, 0.2, 0.06), (0, 0.02, -2.12)), 'metal')
    n.add(xf(bm_rbox(2.1, 0.2, 0.2, 0.06), (0, 0.02, 2.1)), 'metal')
    finish('monster', n)


def buggy():
    """Dune buggy. Wheels r 0.42, w 0.34 at x ±0.86, rest centre y -0.26, z -1.15 / 1.1."""
    n = Node('buggy_mesh')
    n.add(xf(bm_rbox(1.2, 0.07, 2.5, 0.02), (0, -0.2, 0)), 'darkmetal')                           # floor pan
    nose = [(-1.6, -0.18), (-1.62, 0.0), (-1.3, 0.2), (-0.7, 0.28), (-0.6, -0.18)]
    n.add(bevel(bm_profile(nose, 1.1), 0.04, 2), 'main')
    for x in (-1, 1):                                                                            # side pods
        n.add(xf(bm_rbox(0.18, 0.28, 1.3, 0.06), (x * 0.62, -0.05, 0.05)), 'main')
    n.add(xf(bm_rbox(0.9, 0.42, 0.7, 0.06), (0, 0.05, 1.05)), 'main')                            # engine cover
    for i in range(5):                                                                           # engine vents
        n.add(xf(bm_box(0.7, 0.015, 0.05), (0, 0.265, 0.84 + i * 0.09)), 'trim')
    for x in (-0.25, 0.25):
        n.add(bm_tube((x, 0.2, 1.4), (x * 1.2, 0.35, 1.6), 0.04, 10), 'metal')                    # exhausts
    # roll cage
    cage = [((-0.6, -0.15, -0.55), (-0.5, 0.95, -0.2)), ((0.6, -0.15, -0.55), (0.5, 0.95, -0.2)),
            ((-0.6, -0.15, 0.6), (-0.5, 0.95, 0.5)), ((0.6, -0.15, 0.6), (0.5, 0.95, 0.5)),
            ((-0.5, 0.95, -0.2), (0.5, 0.95, -0.2)), ((-0.5, 0.95, 0.5), (0.5, 0.95, 0.5)),
            ((-0.5, 0.95, -0.2), (-0.5, 0.95, 0.5)), ((0.5, 0.95, -0.2), (0.5, 0.95, 0.5)),
            ((-0.5, 0.95, 0.5), (-0.45, 0.25, 1.35)), ((0.5, 0.95, 0.5), (0.45, 0.25, 1.35)),
            ((-0.5, 0.95, -0.2), (-0.6, 0.15, -1.0)), ((0.5, 0.95, -0.2), (0.6, 0.15, -1.0)),
            ((-0.5, 0.95, 0.5), (0.5, 0.95, -0.2))]
    for a, b in cage:
        n.add(bm_tube(a, b, 0.035, 10), 'metal')
    for x in (-1, 1):                                                                            # suspension arms
        for z in (-1.15, 1.1):
            n.add(bm_tube((x * 0.45, -0.18, z - 0.12), (x * 0.78, -0.26, z), 0.025, 8), 'darkmetal')
            n.add(bm_tube((x * 0.45, -0.18, z + 0.12), (x * 0.78, -0.26, z), 0.025, 8), 'darkmetal')
            n.add(bm_tube((x * 0.5, 0.25, z * 0.85), (x * 0.74, -0.22, z), 0.035, 10), 'accent')  # coilovers
    n.add(xf(bm_rbox(0.26, 0.16, 0.06, 0.03), (-0.3, 0.12, -1.58), (0.5, 0, 0)), 'light')
    n.add(xf(bm_rbox(0.26, 0.16, 0.06, 0.03), (0.3, 0.12, -1.58), (0.5, 0, 0)), 'light')
    n.add(xf(bm_box(1.0, 0.1, 0.1), (0, 1.02, -0.2)), 'darkmetal')                                # light bar
    for x in (-0.3, 0.0, 0.3):
        n.add(xf(bm_cyl(0.05, 0.05, 0.05, 12), (x, 1.02, -0.26), (math.pi / 2, 0, 0)), 'light')
    n.add(bm_tube((0, 0.0, -0.45), (0, 0.32, -0.25), 0.018), 'darkmetal')                         # steering
    n.add(xf(bm_torus(0.13, 0.018, 20, 6), (0, 0.34, -0.23), (1.0, 0, 0)), 'trim')
    finish('buggy', n)


def sled():
    n = Node('sled_mesh')
    hull = [(-1.3, 0.0), (-1.32, 0.12), (-1.1, 0.34), (-0.7, 0.4), (0.4, 0.36), (1.2, 0.3), (1.22, 0.02)]
    body = bevel(bm_profile(hull, 1.1), 0.08, 3, 20)
    n.add(body, 'main')
    n.add(xf(bm_box(0.72, 0.1, 1.2), (0, 0.33, 0.25)), 'fabric')       # cockpit well
    for x in (-0.48, 0.48):  # runners
        n.add(bm_tube((x, -0.07, 1.2), (x, -0.07, -1.05), 0.03), 'metal')
        n.add(bm_tube((x, -0.07, -1.05), (x, 0.1, -1.3), 0.03), 'metal')
        for z in (-0.8, 0.0, 0.8):
            n.add(bm_tube((x, -0.07, z), (x * 0.9, 0.02, z), 0.02), 'darkmetal')
        n.add(xf(bm_box(0.012, 0.08, 1.8), (x * 1.16, 0.22, 0)), 'white')   # stripes
    n.add(xf(bm_rbox(0.06, 0.5, 0.55, 0.02), (0, 0.55, 1.0)), 'redlight')  # tail fin
    finish('sled', n)


# ---------------------------------------------------------------------------
# PLAYER AVATAR (feet at origin; nodes the game animates: head, legL, legR, gun)
# ---------------------------------------------------------------------------
def bm_beam(a, b, w, d=None):
    """Square-section box running from point a to point b (blocky limb / sleeve)."""
    a, b = Vector(a), Vector(b)
    v = b - a
    bm = bm_box(w, v.length, d or w)
    q = Vector((0, 1, 0)).rotation_difference(v.normalized())
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4(), verts=bm.verts)
    return bm


def avatar():
    """Blocky player character. 'main' = player color (shirt), 'skin', 'trim' = trousers / hair."""
    torso = Node('torso', (0, 1.08, 0))
    torso.add(xf(bm_box(0.46, 0.52, 0.25), (0, 1.13, 0)), 'main')                       # shirt block
    torso.add(xf(bm_box(0.47, 0.07, 0.26), (0, 0.86, 0)), 'darkmetal')                  # belt
    torso.add(xf(bm_box(0.3, 0.04, 0.02), (0, 1.36, -0.125)), 'trim')                   # collar line
    torso.add(xf(bm_box(0.13, 0.13, 0.13), (0, 1.43, 0.005)), 'skin')                   # neck (shirt top -> head)
    torso.add(xf(bm_box(0.42, 0.16, 0.23), (0, 0.79, 0)), 'trim')                       # hips (legs -> belt)
    for s_ in (-1, 1):   # arms held forward around the gun
        torso.add(bm_beam((s_ * 0.3, 1.34, 0.0), (s_ * 0.28, 1.1, -0.2), 0.13), 'main')
        torso.add(bm_beam((s_ * 0.28, 1.1, -0.2), (s_ * 0.08 + 0.12, 1.15, -0.42), 0.11), 'skin')
        torso.add(xf(bm_box(0.11, 0.11, 0.11), (s_ * 0.08 + 0.12, 1.15, -0.44)), 'skin')
    head = torso.child(Node('head', (0, 1.62, 0)))
    head.add(xf(bm_box(0.28, 0.3, 0.28), (0, 1.62, 0)), 'skin')
    # hair: a cap sitting on the head and a back panel, each a bit bigger than the head so no face is coplanar with it
    head.add(xf(bm_box(0.305, 0.07, 0.305), (0, 1.78, 0.0)), 'trim')                     # cap
    head.add(xf(bm_box(0.3, 0.22, 0.07), (0, 1.67, 0.12)), 'trim')                       # back
    for x in (-0.06, 0.06):
        head.add(xf(bm_box(0.04, 0.05, 0.01), (x, 1.64, -0.143)), 'trim')                   # eyes
    head.add(xf(bm_box(0.08, 0.018, 0.01), (0, 1.55, -0.143)), 'trim')                     # mouth
    legs = []
    for side, nm in ((-1, 'legL'), (1, 'legR')):
        x = side * 0.12
        leg = Node(nm, (x, 0.72, 0))
        leg.add(xf(bm_box(0.19, 0.64, 0.2), (x, 0.42, 0)), 'trim')
        leg.add(xf(bm_box(0.2, 0.1, 0.3), (x, 0.05, -0.04)), 'darkmetal')                 # boot
        legs.append(leg)
    gun = Node('gun', (0.26, 1.18, -0.3))
    gun.add(xf(bm_box(0.09, 0.11, 0.36), (0.26, 1.18, -0.33)), 'darkmetal')
    finish('avatar', torso, *legs, gun)


# ---------------------------------------------------------------------------
# RAGDOLL PARTS: blocky people, each part in its physics body's local frame (sized to the colliders)
# ---------------------------------------------------------------------------
def ragdoll():
    p = Node('rd_pelvis_mesh')
    p.add(bm_box(0.36, 0.22, 0.22), 'main')
    p.add(xf(bm_box(0.37, 0.05, 0.23), (0, 0.08, 0)), 'darkmetal')                        # belt
    p.add(xf(bm_box(0.06, 0.04, 0.01), (0, 0.08, -0.117)), 'metal')                        # buckle
    finish('rd_pelvis', p)

    # ---- torsos: 'main' = shirt color, 'second' = vest / coat / armor color ----
    def torso_base(name):
        t = Node(name + '_mesh')
        t.add(bm_box(0.4, 0.48, 0.24), 'main')
        t.add(xf(bm_box(0.14, 0.03, 0.2), (0, 0.245, 0)), 'main')                          # neck base
        return t

    t = torso_base('rd_torso')
    t.add(xf(bm_box(0.16, 0.05, 0.01), (0, 0.19, -0.122)), 'trim')                         # collar
    for y in (0.1, 0.0, -0.1):
        t.add(xf(bm_box(0.018, 0.018, 0.01), (0, y, -0.122)), 'trim')                      # buttons
    finish('rd_torso', t)

    t = torso_base('rd_torso_vest')                                                        # hi-vis work vest
    t.add(xf(bm_box(0.42, 0.4, 0.26), (0, -0.03, 0)), 'second')
    for y in (-0.12, 0.02):
        t.add(xf(bm_box(0.43, 0.035, 0.27), (0, y, 0)), 'white')                           # reflective bands
    t.add(xf(bm_box(0.012, 0.4, 0.262), (0, -0.03, 0)), 'trim')
    finish('rd_torso_vest', t)

    t = torso_base('rd_torso_coat')                                                        # lab coat + tie
    t.add(xf(bm_box(0.42, 0.5, 0.26), (0, -0.01, 0)), 'main')
    t.add(xf(bm_box(0.1, 0.2, 0.01), (0, 0.1, -0.131)), 'second')
    t.add(xf(bm_box(0.03, 0.17, 0.01), (0, 0.07, -0.135)), 'trim')
    for s_ in (-1, 1):
        t.add(xf(bm_box(0.19, 0.2, 0.026), (s_ * 0.105, -0.34, -0.12)), 'main')            # coat tails
        t.add(xf(bm_box(0.08, 0.07, 0.012), (s_ * 0.11, -0.13, -0.132)), 'main')
    t.add(xf(bm_box(0.4, 0.2, 0.026), (0, -0.34, 0.12)), 'main')
    finish('rd_torso_coat', t)

    t = torso_base('rd_torso_police')                                                      # uniform shirt
    for s_ in (-1, 1):
        t.add(xf(bm_box(0.09, 0.08, 0.015), (s_ * 0.1, 0.08, -0.124)), 'main')              # chest pockets
        t.add(xf(bm_box(0.12, 0.025, 0.2), (s_ * 0.15, 0.235, 0)), 'second')                # epaulettes
    t.add(xf(bm_box(0.05, 0.06, 0.01), (-0.1, 0.15, -0.126)), 'second')                    # badge
    t.add(xf(bm_box(0.05, 0.1, 0.035), (0.1, 0.18, -0.13)), 'darkmetal')                   # radio
    t.add(xf(bm_box(0.012, 0.44, 0.01), (0, -0.01, -0.123)), 'trim')
    finish('rd_torso_police', t)

    t = torso_base('rd_torso_armor')                                                       # plate carrier
    t.add(xf(bm_box(0.36, 0.36, 0.3), (0, 0.02, 0)), 'second')
    for x in (-0.11, 0.0, 0.11):
        t.add(xf(bm_box(0.09, 0.11, 0.05), (x, -0.08, -0.165)), 'darkmetal')                # mag pouches
    for s_ in (-1, 1):
        t.add(xf(bm_box(0.07, 0.04, 0.3), (s_ * 0.13, 0.215, 0)), 'second')                # shoulder straps
    t.add(xf(bm_box(0.2, 0.05, 0.02), (0, 0.12, -0.155)), 'trim')                          # name tape
    finish('rd_torso_armor', t)

    # ---- heads (cubes): 'main' = skin, 'hair' = hair, 'second' = hat / mask color ----
    def head_base(name, hair='short', eyes='trim'):
        hd = Node(name + '_mesh')
        hd.add(bm_box(0.24, 0.26, 0.24), 'main')
        hd.add(xf(bm_box(0.11, 0.06, 0.11), (0, -0.15, 0.005)), 'main')                    # neck
        if hair in ('short', 'long'):
            # cap + back panel, each a little bigger than the head so no hair face lies flush on a head face
            hd.add(xf(bm_box(0.262, 0.065, 0.262), (0, 0.12, 0.0)), 'hair')
            hd.add(xf(bm_box(0.256, 0.17, 0.06), (0, 0.05, 0.1)), 'hair')
            for s_ in (-1, 1):
                hd.add(xf(bm_box(0.02, 0.1, 0.12), (s_ * 0.123, 0.06, 0.04)), 'hair')         # sideburns
        if hair == 'long':
            hd.add(xf(bm_box(0.25, 0.3, 0.06), (0, -0.07, 0.115)), 'hair')
            hd.add(xf(bm_box(0.07, 0.14, 0.07), (0, -0.2, 0.15)), 'hair')                    # ponytail
        for x in (-0.05, 0.05):
            hd.add(xf(bm_box(0.035, 0.04, 0.012), (x, 0.015, -0.121)), eyes)
            if hair != 'none':
                hd.add(xf(bm_box(0.05, 0.012, 0.012), (x, 0.055, -0.121)), 'hair')          # brows
        hd.add(xf(bm_box(0.03, 0.045, 0.03), (0, -0.02, -0.125)), 'main')                 # nose
        hd.add(xf(bm_box(0.07, 0.015, 0.012), (0, -0.075, -0.121)), 'trim')                # mouth
        return hd

    finish('rd_head', head_base('rd_head', 'short'))
    finish('rd_head_long', head_base('rd_head_long', 'long'))

    hd = head_base('rd_head_bald', 'none')
    hd.add(xf(bm_box(0.2, 0.08, 0.06), (0, -0.1, -0.11)), 'hair')                          # beard
    for x in (-0.05, 0.05):
        hd.add(xf(bm_box(0.05, 0.012, 0.012), (x, 0.055, -0.121)), 'hair')
    finish('rd_head_bald', hd)

    hd = head_base('rd_head_hat', 'short')                                                  # hard hat
    hd.add(xf(bm_box(0.27, 0.1, 0.27), (0, 0.16, 0)), 'second')
    hd.add(xf(bm_box(0.3, 0.02, 0.33), (0, 0.115, -0.02)), 'second')
    finish('rd_head_hat', hd)

    hd = head_base('rd_head_glasses', 'short')
    for x in (-0.05, 0.05):
        hd.add(xf(bm_box(0.055, 0.045, 0.01), (x, 0.015, -0.13)), 'darkmetal')
        hd.add(xf(bm_box(0.04, 0.03, 0.01), (x, 0.015, -0.133)), 'glass')
    hd.add(xf(bm_box(0.04, 0.01, 0.01), (0, 0.02, -0.13)), 'darkmetal')
    finish('rd_head_glasses', hd)

    hd = head_base('rd_head_zombie', 'none', eyes='redlight')
    for p_ in ((0.05, 0.13, 0.02), (-0.06, 0.13, 0.06), (0.0, 0.13, -0.05)):
        hd.add(xf(bm_box(0.07, 0.03, 0.07), p_), 'hair')                                    # hair tufts
    hd.add(xf(bm_box(0.08, 0.04, 0.012), (0.01, -0.08, -0.121)), 'trim')                   # open mouth
    hd.add(xf(bm_box(0.06, 0.05, 0.01), (-0.07, -0.03, -0.121)), 'red')                    # wound
    finish('rd_head_zombie', hd)

    hd = head_base('rd_head_dummy', 'none')
    for x in (-1, 1):
        hd.add(xf(bm_box(0.01, 0.08, 0.08), (x * 0.122, 0.02, 0)), 'second')                # target marks
        hd.add(xf(bm_box(0.012, 0.012, 0.09), (x * 0.123, 0.02, 0)), 'trim')
    finish('rd_head_dummy', hd)

    hd = head_base('rd_head_cap', 'short')                                                  # police cap
    hd.add(xf(bm_box(0.27, 0.08, 0.27), (0, 0.15, 0)), 'second')
    hd.add(xf(bm_box(0.25, 0.015, 0.1), (0, 0.115, -0.16)), 'trim')                        # visor
    hd.add(xf(bm_box(0.05, 0.05, 0.01), (0, 0.155, -0.137)), 'metal')                      # badge
    finish('rd_head_cap', hd)

    hd = Node('rd_head_mask_mesh')                                                          # raider: balaclava, goggles, helmet
    hd.add(bm_box(0.24, 0.26, 0.24), 'second')
    hd.add(xf(bm_box(0.11, 0.06, 0.11), (0, -0.15, 0.005)), 'second')
    hd.add(xf(bm_box(0.2, 0.06, 0.01), (0, 0.015, -0.121)), 'main')                        # skin around the eyes
    hd.add(xf(bm_box(0.22, 0.055, 0.02), (0, 0.02, -0.13)), 'visor')                       # goggles
    hd.add(xf(bm_box(0.27, 0.11, 0.27), (0, 0.15, 0.005)), 'darkmetal')                    # helmet
    hd.add(xf(bm_box(0.06, 0.04, 0.03), (0, 0.18, -0.14)), 'trim')                         # NVG mount
    finish('rd_head_mask', hd)

    ua = Node('rd_uarm_mesh'); ua.add(bm_box(0.13, 0.32, 0.13), 'main'); finish('rd_uarm', ua)
    fa = Node('rd_farm_mesh')
    fa.add(xf(bm_box(0.11, 0.26, 0.11), (0, 0.02, 0)), 'main')
    fa.add(xf(bm_box(0.12, 0.1, 0.13), (0, -0.16, 0)), 'main')                            # hand
    finish('rd_farm', fa)
    th = Node('rd_thigh_mesh'); th.add(bm_box(0.16, 0.4, 0.16), 'main'); finish('rd_thigh', th)
    sh = Node('rd_shin_mesh')
    sh.add(xf(bm_box(0.14, 0.34, 0.14), (0, 0.02, 0)), 'main')
    sh.add(xf(bm_box(0.15, 0.09, 0.25), (0, -0.19, -0.045)), 'trim')                       # boot
    finish('rd_shin', sh)


# ---------------------------------------------------------------------------
# WORLD DECOR (low-poly on purpose; placed by the map themes) + shipping container prop
# ---------------------------------------------------------------------------
def pine(name='pine', snow=False):
    n = Node(name + '_mesh')
    n.add(xf(bm_cyl(0.22, 0.16, 2.4, 7), (0, 1.2, 0)), 'wood')
    for r, h, y in ((2.1, 2.8, 2.0), (1.65, 2.4, 3.5), (1.15, 2.0, 4.9), (0.7, 1.5, 6.1)):
        n.add(xf(bm_cyl(r, 0.0, h, 7), (0, y + h / 2, 0)), 'main')
        if snow:
            n.add(xf(bm_cyl(r * 0.55, 0.0, h * 0.55, 7), (0, y + h * 0.72 + 0.03, 0)), 'white')
    finish(name, n)


def pine_snow():
    pine('pine_snow', True)


def rock():
    import random
    rnd = random.Random(3)
    n = Node('rock_mesh')
    bm = bm_sphere(1.0, 7, 5)
    for v in bm.verts:
        v.co *= 0.75 + rnd.random() * 0.5
    bmesh.ops.scale(bm, vec=(1.2, 0.7, 1.0), verts=bm.verts)
    n.add(bm, 'main')
    finish('rock', n)


def palm():
    n = Node('palm_mesh')
    pts = [(0, 0, 0), (0.15, 1.6, 0), (0.45, 3.2, 0), (0.9, 4.6, 0), (1.3, 5.6, 0)]
    for i, (a, b) in enumerate(zip(pts, pts[1:])):
        n.add(bm_beam(a, b, 0.32 - i * 0.04), 'wood')
    top = Vector(pts[-1])
    for i in range(7):
        ang = i / 7 * TAU
        d = Vector((math.cos(ang), 0, math.sin(ang)))
        mid, tip = top + d * 1.4 + Vector((0, 0.35, 0)), top + d * 2.8 + Vector((0, -0.6, 0))
        n.add(bm_beam(top, mid, 0.5, 0.05), 'main')
        n.add(bm_beam(mid, tip, 0.38, 0.04), 'main')
    finish('palm', n)


def container():
    """Shipping container, 6.0 x 2.6 x 2.44 (x = length). 'main' = paint color."""
    n = Node('container_mesh')
    L, H, W = 6.0, 2.6, 2.44
    n.add(bm_box(L - 0.1, H - 0.1, W - 0.08), 'main')
    for i in range(22):                                                                       # corrugated sides
        x = -L / 2 + 0.3 + i * (L - 0.6) / 21
        for z in (-1, 1):
            n.add(xf(bm_box(0.12, H - 0.3, 0.05), (x, 0, z * (W / 2 - 0.02))), 'main')
    for x in (-1, 1):                                                                         # frame posts + rails
        for z in (-1, 1):
            n.add(xf(bm_box(0.16, H, 0.16), (x * (L / 2 - 0.08), 0, z * (W / 2 - 0.08))), 'darkmetal')
    for y in (-1, 1):
        for z in (-1, 1):
            n.add(xf(bm_box(L, 0.14, 0.14), (0, y * (H / 2 - 0.07), z * (W / 2 - 0.07))), 'darkmetal')
    for z in (-0.55, -0.2, 0.2, 0.55):                                                        # door lock bars
        n.add(xf(bm_box(0.04, H - 0.4, 0.04), (L / 2 + 0.01, 0, z)), 'metal')
    n.add(xf(bm_box(0.02, H - 0.3, 0.02), (L / 2 + 0.005, 0, 0)), 'darkmetal')              # door split
    finish('container', n)


# ---------------------------------------------------------------------------
# WEAPONS (first-person space: origin = where the game places the weapon in front of the camera,
# barrel toward -Z). Each model also gets a "<name>_hand" node (glove + sleeve) that the game
# shows in first person and hides on third-person avatars. Slot 'sleeve' = player color.
# ---------------------------------------------------------------------------
def lathe_z(profile, seg=24):
    """profile (radius, t) with t measured forward along -Z."""
    return xf(bm_lathe(profile, seg), rot=(-math.pi / 2, 0, 0))


def ring_z(R, r, z, seg=24, rseg=8):
    return xf(bm_torus(R, r, seg, rseg), (0, 0, z), (-math.pi / 2, 0, 0))


def cyl_z(r, length, z, y=0.0, x=0.0, seg=16):
    return xf(bm_cyl(r, r, length, seg), (x, y, z), (math.pi / 2, 0, 0))


def hand_node(name, grip, tilt=0.25):
    """Blocky first-person hand + sleeve ('sleeve' = player color)."""
    h = Node(name + '_hand')
    gx, gy, gz = grip
    h.add(xf(bm_box(0.075, 0.1, 0.1), (gx, gy, gz + 0.005), (tilt, 0, 0)), 'skin')                    # hand block around the grip
    h.add(xf(bm_box(0.028, 0.035, 0.07), (gx - 0.045, gy + 0.03, gz - 0.02), (0.2, 0.3, 0)), 'skin')  # thumb
    wrist = Vector((gx + 0.005, gy - 0.03, gz + 0.05))
    elbow = wrist + Vector((0.07, -0.2, 0.33))
    h.add(bm_beam(wrist, elbow, 0.085), 'sleeve')
    h.add(bm_beam(wrist + Vector((0, 0, 0.0)), wrist + (elbow - wrist) * 0.12, 0.092), 'trim')       # cuff
    return h


def physgun():
    n = Node('wp_physgun_mesh')
    body = [(0.0, -0.22), (0.042, -0.22), (0.052, -0.19), (0.054, 0.1), (0.066, 0.14), (0.066, 0.23), (0.05, 0.26), (0.032, 0.28), (0.0, 0.28)]
    n.add(lathe_z(body, 28), 'main')
    n.add(cyl_z(0.047, 0.03, 0.225), 'darkmetal')                                           # rear cap
    for z in (0.02, -0.04, -0.1):                                                           # energy coils
        n.add(ring_z(0.058, 0.009, z, 24, 6), 'accent')
    for i in range(4):                                                                      # top heat-sink fins
        n.add(xf(bm_box(0.004, 0.028, 0.16), (-0.021 + i * 0.014, 0.064, 0.03)), 'darkmetal')
    for i in range(3):                                                                      # emitter claws
        a = math.pi / 2 + i * TAU / 3
        c, s_ = math.cos(a), math.sin(a)
        p0, p1, p2 = (c * 0.058, s_ * 0.058, -0.25), (c * 0.08, s_ * 0.08, -0.33), (c * 0.045, s_ * 0.045, -0.42)
        n.add(bm_tube(p0, p1, 0.008, 8), 'metal')
        n.add(bm_tube(p1, p2, 0.007, 8), 'metal')
        n.add(xf(bm_sphere(0.009, 8, 6), p1), 'metal')
    n.add(xf(bm_sphere(0.028, 16, 10), (0, 0, -0.31)), 'accent')                            # emitter orb
    n.add(xf(bm_rbox(0.04, 0.12, 0.055, 0.015), (0, -0.09, 0.09), (0.25, 0, 0)), 'trim')      # grip
    n.add(xf(bm_rbox(0.012, 0.03, 0.012, 0.004), (0, -0.05, 0.035)), 'darkmetal')            # trigger
    n.add(bm_tube((0.045, -0.035, 0.17), (0.05, -0.045, -0.12), 0.007, 8), 'trim')           # hose
    finish('wp_physgun', n, hand_node('wp_physgun', (0, -0.09, 0.09)))


def toolgun():
    n = Node('wp_toolgun_mesh')
    n.add(xf(bm_rbox(0.085, 0.11, 0.28, 0.02), (0, 0.005, -0.03)), 'main')
    for x in (-0.044, 0.044):
        n.add(xf(bm_box(0.004, 0.02, 0.2), (x, 0.0, -0.04)), 'trim')                          # side stripes
    hp, rot = (0, 0.095, 0.1), (-0.5, 0, 0)
    n.add(xf(bm_rbox(0.1, 0.075, 0.05, 0.015), hp, rot), 'trim')                             # screen housing
    n.add(xf(bm_box(0.08, 0.055, 0.004), (0, 0.1075, 0.1228), rot), 'accent')               # screen (faces the player)
    n.add(cyl_z(0.02, 0.12, -0.22), 'darkmetal')                                           # barrel
    n.add(ring_z(0.022, 0.006, -0.27, 16, 6), 'accent')
    n.add(xf(bm_cyl(0.016, 0.006, 0.04, 14), (0, 0, -0.3), (-math.pi / 2, 0, 0)), 'metal')   # emitter tip
    n.add(xf(bm_rbox(0.045, 0.13, 0.06, 0.016), (0, -0.1, 0.05), (0.3, 0, 0)), 'trim')        # grip
    n.add(bm_tube((0, -0.05, 0.005), (0, -0.085, -0.005), 0.005, 8), 'darkmetal')           # trigger guard
    n.add(bm_tube((0, -0.085, -0.005), (0, -0.09, 0.04), 0.005, 8), 'darkmetal')
    n.add(bm_tube((0.03, 0.06, 0.1), (0.035, 0.14, 0.13), 0.004, 6), 'darkmetal')           # antenna
    n.add(xf(bm_sphere(0.008, 8, 6), (0.035, 0.143, 0.131)), 'redlight')
    finish('wp_toolgun', n, hand_node('wp_toolgun', (0, -0.1, 0.05), 0.3))


def pistol():
    n = Node('wp_pistol_mesh')
    n.add(xf(bm_rbox(0.032, 0.034, 0.2, 0.006), (0, 0.02, -0.045)), 'main')                  # slide
    for i in range(5):
        for x in (-0.0165, 0.0165):
            n.add(xf(bm_box(0.002, 0.026, 0.003), (x, 0.02, 0.02 + i * 0.007)), 'trim')     # serrations
    n.add(xf(bm_rbox(0.028, 0.024, 0.17, 0.005), (0, -0.006, -0.035)), 'darkmetal')          # frame
    n.add(xf(bm_rbox(0.03, 0.1, 0.045, 0.01), (0, -0.06, 0.03), (0.25, 0, 0)), 'trim')        # grip
    n.add(bm_tube((0, -0.018, -0.055), (0, -0.045, -0.045), 0.004, 6), 'darkmetal')          # trigger guard
    n.add(bm_tube((0, -0.045, -0.045), (0, -0.045, -0.002), 0.004, 6), 'darkmetal')
    n.add(xf(bm_rbox(0.006, 0.022, 0.008, 0.002), (0, -0.03, -0.02), (0.3, 0, 0)), 'metal')   # trigger
    n.add(xf(bm_box(0.005, 0.01, 0.01), (0, 0.042, -0.135)), 'darkmetal')                   # front sight
    for x in (-0.009, 0.009):
        n.add(xf(bm_box(0.006, 0.01, 0.008), (x, 0.042, 0.045)), 'darkmetal')               # rear sight
    n.add(cyl_z(0.009, 0.01, -0.147, 0.018), 'trim')                                        # muzzle
    finish('wp_pistol', n, hand_node('wp_pistol', (0, -0.06, 0.03)))


def rifle():
    n = Node('wp_rifle_mesh')
    n.add(xf(bm_rbox(0.05, 0.07, 0.3, 0.01), (0, 0, -0.05)), 'main')                         # receiver
    n.add(xf(bm_rbox(0.055, 0.056, 0.25, 0.012), (0, 0.004, -0.32)), 'trim')                 # handguard
    for i in range(5):
        for x in (-0.028, 0.028):
            n.add(xf(bm_box(0.004, 0.018, 0.028), (x, 0.004, -0.23 - i * 0.042)), 'darkmetal')  # vents
    n.add(cyl_z(0.011, 0.17, -0.52), 'darkmetal')                                          # barrel
    n.add(cyl_z(0.018, 0.055, -0.62), 'darkmetal')                                         # muzzle brake
    for x in (-0.018, 0.018):
        n.add(xf(bm_box(0.004, 0.02, 0.012), (x, 0, -0.62)), 'trim')
    n.add(xf(bm_rbox(0.034, 0.14, 0.07, 0.01), (0, -0.1, -0.12), (-0.18, 0, 0)), 'trim')      # magazine
    n.add(xf(bm_rbox(0.035, 0.1, 0.045, 0.012), (0, -0.075, 0.04), (0.3, 0, 0)), 'trim')      # pistol grip
    n.add(bm_tube((0, -0.035, 0.0), (0, -0.06, -0.03), 0.004, 6), 'darkmetal')
    n.add(xf(bm_rbox(0.04, 0.085, 0.22, 0.02), (0, -0.018, 0.2)), 'main')                    # stock
    n.add(xf(bm_rbox(0.042, 0.09, 0.02, 0.008), (0, -0.018, 0.315)), 'rubber')              # butt pad
    n.add(cyl_z(0.02, 0.13, -0.06, 0.08), 'darkmetal')                                     # optic
    n.add(cyl_z(0.024, 0.02, -0.13, 0.08), 'darkmetal')
    n.add(cyl_z(0.017, 0.004, -0.141, 0.08), 'glass')
    for z in (-0.1, -0.02):
        n.add(xf(bm_box(0.02, 0.03, 0.02), (0, 0.05, z)), 'darkmetal')                      # optic mounts
    n.add(xf(bm_rbox(0.006, 0.018, 0.05, 0.003), (0.028, 0.012, -0.02)), 'darkmetal')        # ejection port cover
    finish('wp_rifle', n, hand_node('wp_rifle', (0, -0.075, 0.04), 0.3))


def grenade():
    n = Node('wp_grenade_mesh')
    egg = [(0.0, -0.058), (0.028, -0.054), (0.044, -0.03), (0.048, 0.0), (0.045, 0.028), (0.033, 0.048), (0.0, 0.055)]
    n.add(bm_lathe(egg, 24), 'main')
    for y in (-0.02, 0.0, 0.02):
        n.add(xf(bm_torus(0.0475, 0.0035, 24, 5), (0, y, 0)), 'trim')                        # grip grooves
    n.add(xf(bevel(bm_cyl(0.017, 0.017, 0.028, 14), 0.004, 1), (0, 0.062, 0)), 'metal')      # fuse
    n.add(xf(bm_rbox(0.02, 0.1, 0.008, 0.003), (0, 0.02, 0.05), (0.18, 0, 0)), 'metal')       # spoon
    n.add(xf(bm_torus(0.016, 0.0028, 16, 5), (0.03, 0.07, 0), (0, 0, math.pi / 2)), 'metal')  # pin ring
    finish('wp_grenade', n, hand_node('wp_grenade', (0, -0.01, 0.045), 0.1))


def crowbar():
    n = Node('wp_crowbar_mesh')
    pts = [Vector(p) for p in ((0, -0.03, 0.16), (0, 0.11, -0.45), (0, 0.16, -0.51), (0, 0.22, -0.51), (0, 0.245, -0.47), (0, 0.235, -0.43))]
    for a, b in zip(pts, pts[1:]):
        n.add(bm_tube(a, b, 0.012, 10), 'main')
    for p in pts[1:-1]:
        n.add(xf(bm_sphere(0.012, 10, 6), tuple(p)), 'main')
    for x in (-0.006, 0.006):                                                               # split claw
        n.add(bm_tube((x, 0.235, -0.43), (x * 1.5, 0.215, -0.405), 0.005, 6), 'main')
    n.add(xf(bm_rbox(0.03, 0.008, 0.055, 0.003), (0, -0.036, 0.19), (0.2, 0, 0)), 'main')    # chisel end
    n.add(bm_tube((0, -0.02, 0.1), (0, 0.015, -0.05), 0.016, 12), 'rubber')                  # grip wrap
    finish('wp_crowbar', n, hand_node('wp_crowbar', (0, 0.0, 0.03), 0.23))


# ---------------------------------------------------------------------------
# MORE PROPS (authored at their collider size, centred on the collider; furniture fronts face +Z,
# i.e. toward the player who spawned it)
# ---------------------------------------------------------------------------
def closed_ring(r0, r1, y0, y1):
    """lathe profile for a solid ring (no hole filling)."""
    return [(r0, y0), (r1, y0), (r1, y1), (r0, y1), (r0, y0)]


def propane():
    n = Node('propane_mesh')
    n.add(bm_lathe(closed_ring(0.125, 0.16, -0.4, -0.33), 32), 'darkmetal')                      # foot ring
    tank = [(0.0, -0.345), (0.1, -0.338), (0.155, -0.3), (0.178, -0.22), (0.18, -0.15), (0.18, 0.13), (0.175, 0.2), (0.15, 0.25), (0.1, 0.28), (0.04, 0.292), (0.0, 0.293)]
    n.add(bm_lathe(tank, 32), 'main')
    n.add(bm_lathe(closed_ring(0.181, 0.183, -0.04, 0.09), 32), 'white')                          # label band
    n.add(bm_lathe(closed_ring(0.098, 0.112, 0.26, 0.4), 28), 'main')                             # collar
    for a in (0, math.pi):                                                                        # handle cut-outs
        n.add(xf(bm_rbox(0.06, 0.03, 0.02, 0.008, 1), (math.cos(a) * 0.11, 0.365, math.sin(a) * 0.11), (0, a, 0)), 'trim')
    n.add(xf(bm_cyl(0.022, 0.022, 0.07, 12), (0, 0.32, 0)), 'metal')                                # valve body
    n.add(xf(bm_torus(0.032, 0.007, 16, 6), (0, 0.37, 0)), 'red')                                 # hand wheel
    n.add(xf(bm_cyl(0.012, 0.012, 0.05, 8), (0.035, 0.31, 0), (0, 0, math.pi / 2)), 'metal')        # outlet
    finish('propane', n)


def balloon():
    n = Node('balloon_mesh')
    body = [(0.0, -0.345), (0.05, -0.33), (0.16, -0.27), (0.27, -0.14), (0.335, 0.01), (0.35, 0.12), (0.325, 0.24), (0.25, 0.33), (0.13, 0.385), (0.0, 0.4)]
    n.add(bm_lathe(body, 32), 'main')
    n.add(xf(bm_cyl(0.03, 0.012, 0.05, 12), (0, -0.365, 0)), 'main')                                # knot
    pts = [(0, -0.39, 0), (0.02, -0.55, 0.01), (-0.015, -0.72, 0.0), (0.01, -0.9, -0.01)]
    for a, b in zip(pts, pts[1:]):
        n.add(bm_tube(a, b, 0.004, 5), 'white')                                                    # string
    n.add(xf(bm_sphere(0.05, 10, 6), (-0.13, 0.2, 0.26), scale=(0.6, 1, 0.3)), 'white')           # highlight decal
    finish('balloon', n)


def trampoline():
    n = Node('trampoline_mesh')
    n.add(xf(bm_torus(0.87, 0.028, 48, 8), (0, 0.15, 0)), 'metal')                                # frame ring
    n.add(xf(bm_cyl(0.72, 0.72, 0.012, 48), (0, 0.155, 0)), 'trim')                               # jumping mat
    n.add(bm_lathe(closed_ring(0.7, 0.93, 0.165, 0.2), 48), 'main')                              # safety pad
    for i in range(6):                                                                            # W legs
        a = i / 6 * TAU
        p = []
        for da in (-0.13, 0.13):
            x, z = math.cos(a + da) * 0.87, math.sin(a + da) * 0.87
            n.add(bm_tube((x, 0.15, z), (x, -0.185, z), 0.022, 10), 'metal')
            p.append((x, -0.185, z))
        n.add(bm_tube(p[0], p[1], 0.022, 10), 'metal')
        for q in p:
            n.add(xf(bm_sphere(0.022, 8, 6), q), 'metal')
    finish('trampoline', n)


def melon():
    n = Node('melon_mesh')
    sc = (0.2, 0.23, 0.2)
    for stripe in (False, True):
        bm = bm_sphere(1.0, 28, 16)
        dele = []
        for f in bm.faces:
            c = f.calc_center_median()
            k = int(((math.atan2(c.z, c.x) + math.pi) / TAU * 28)) % 4
            if (k == 0) != stripe:
                dele.append(f)
        bmesh.ops.delete(bm, geom=dele, context='FACES')
        bmesh.ops.scale(bm, vec=sc, verts=bm.verts)
        n.add(bm, 'second' if stripe else 'main')
    n.add(xf(bm_cyl(0.008, 0.006, 0.03, 6), (0, 0.235, 0)), 'trim')          # stem
    finish('melon', n)


def pin():
    n = Node('pin_mesh')
    prof = [(0.0, -0.19), (0.03, -0.19), (0.044, -0.16), (0.057, -0.1), (0.06, -0.05), (0.053, 0.015), (0.035, 0.065), (0.025, 0.1), (0.027, 0.13), (0.032, 0.158), (0.028, 0.18), (0.016, 0.19), (0.0, 0.193)]
    n.add(bm_lathe(prof, 28), 'main')
    for y0, y1, r in ((0.072, 0.082, 0.0335), (0.092, 0.1, 0.0265)):
        n.add(bm_lathe(closed_ring(r - 0.004, r + 0.0015, y0, y1), 28), 'red')
    finish('pin', n)


def chair():
    n = Node('chair_mesh')
    n.add(bm_rbox(0.46, 0.05, 0.44, 0.012), 'main')                                              # seat
    for x in (-0.19, 0.19):
        for z in (-0.18, 0.18):
            top = 0.52 if z < 0 else -0.02
            n.add(xf(bm_rbox(0.045, top + 0.475, 0.045, 0.008, 1), (x, (top - 0.475) / 2, z)), 'main')   # legs / back posts
        n.add(xf(bm_box(0.025, 0.03, 0.34), (x, -0.36, 0)), 'main')                                  # side stretchers
    n.add(xf(bm_box(0.36, 0.03, 0.025), (0, -0.36, 0.18)), 'main')
    for y in (0.2, 0.32, 0.44):                                                                    # back slats
        n.add(xf(bm_rbox(0.36, 0.06 if y == 0.44 else 0.035, 0.022, 0.006, 1), (0, y, -0.19), (-0.06, 0, 0)), 'main')
    finish('chair', n)


def table():
    n = Node('table_mesh')
    W, H, D = 1.6, 0.76, 0.9
    n.add(xf(bm_rbox(W, 0.05, D, 0.015), (0, H / 2 - 0.025, 0)), 'main')                          # top
    for x in (-1, 1):
        for z in (-1, 1):
            n.add(xf(bm_rbox(0.06, H - 0.05, 0.06, 0.008, 1), (x * (W / 2 - 0.08), -0.025, z * (D / 2 - 0.08))), 'main')
    for z in (-1, 1):                                                                              # aprons
        n.add(xf(bm_box(W - 0.2, 0.08, 0.025), (0, H / 2 - 0.09, z * (D / 2 - 0.08))), 'main')
    for x in (-1, 1):
        n.add(xf(bm_box(0.025, 0.08, D - 0.2), (x * (W / 2 - 0.08), H / 2 - 0.09, 0)), 'main')
    finish('table', n)


def couch():
    n = Node('couch_mesh')
    n.add(xf(bm_rbox(1.84, 0.24, 0.84, 0.04), (0, -0.2, 0)), 'main')                              # base
    for i in range(3):                                                                             # seat cushions
        n.add(xf(bm_rbox(0.585, 0.16, 0.62, 0.06), (-0.6 + i * 0.6, 0.0, 0.08)), 'main')
    for i in range(3):                                                                             # back cushions
        n.add(xf(bm_rbox(0.585, 0.46, 0.2, 0.08), (-0.6 + i * 0.6, 0.18, -0.3), (-0.12, 0, 0)), 'main')
    n.add(xf(bm_rbox(1.84, 0.62, 0.14, 0.05), (0, 0.1, -0.38)), 'main')                           # back frame
    for x in (-0.93, 0.93):                                                                        # armrests
        n.add(xf(bm_rbox(0.14, 0.48, 0.86, 0.06), (x, -0.08, 0)), 'main')
    for x in (-0.88, 0.88):
        for z in (-0.36, 0.36):
            n.add(xf(bm_cyl(0.025, 0.018, 0.1, 10), (x, -0.375, z)), 'trim')                        # feet
    finish('couch', n)


def fridge():
    n = Node('fridge_mesh')
    n.add(xf(bm_rbox(0.8, 1.74, 0.7, 0.03), (0, 0.03, -0.025)), 'main')                            # cabinet
    n.add(xf(bm_box(0.76, 0.06, 0.66), (0, -0.87, -0.02)), 'trim')                                # kick plate
    for y0, y1 in ((0.36, 0.9), (-0.84, 0.34)):                                                     # doors
        n.add(xf(bm_rbox(0.78, y1 - y0, 0.05, 0.015), (0, (y0 + y1) / 2, 0.35)), 'main')
    n.add(xf(bm_box(0.72, 0.012, 0.02), (0, 0.35, 0.37)), 'trim')                                  # door gap
    n.add(bm_tube((0.3, 0.45, 0.4), (0.3, 0.75, 0.4), 0.014, 10), 'metal')                         # handles
    n.add(bm_tube((0.3, -0.05, 0.4), (0.3, 0.25, 0.4), 0.014, 10), 'metal')
    for y in (0.45, 0.75, -0.05, 0.25):
        n.add(bm_tube((0.3, y, 0.375), (0.3, y, 0.4), 0.01, 8), 'metal')
    n.add(xf(bm_box(0.14, 0.06, 0.006), (-0.22, 0.75, 0.378)), 'accent')                            # little display
    finish('fridge', n)


def vending():
    n = Node('vending_mesh')
    W, H, D = 1.0, 1.9, 0.85
    n.add(xf(bm_rbox(W, H, D - 0.05, 0.03), (0, 0, -0.025)), 'main')                              # cabinet
    n.add(xf(bm_box(0.62, 1.05, 0.02), (-0.14, 0.28, 0.4)), 'trim')                               # window recess
    for r in range(5):                                                                             # product rows
        y = -0.12 + r * 0.19
        n.add(xf(bm_box(0.58, 0.012, 0.02), (-0.14, y - 0.07, 0.4)), 'metal')
        for c in range(5):
            slot = ('second', 'red', 'white', 'accent', 'second')[(r + c) % 5] if r % 2 == 0 else ('red', 'white', 'second', 'white', 'red')[c]
            n.add(xf(bm_cyl(0.035, 0.035, 0.12, 10), (-0.38 + c * 0.12, y, 0.39)), slot if slot != 'accent' else 'book2')
    n.add(xf(bm_box(0.6, 1.02, 0.01), (-0.14, 0.28, 0.418)), 'glass')                             # glass
    n.add(xf(bm_rbox(0.24, 0.55, 0.04, 0.01), (0.33, 0.35, 0.405)), 'trim')                        # keypad panel
    n.add(xf(bm_box(0.16, 0.06, 0.01), (0.33, 0.55, 0.43)), 'accent')                               # display
    for r in range(4):
        for c in range(3):
            n.add(xf(bm_rbox(0.035, 0.03, 0.015, 0.004, 1), (0.285 + c * 0.045, 0.44 - r * 0.045, 0.43)), 'metal')
    n.add(xf(bm_box(0.03, 0.08, 0.012), (0.33, 0.19, 0.43)), 'darkmetal')                           # coin slot
    n.add(xf(bm_box(0.6, 0.17, 0.03), (-0.14, -0.62, 0.41)), 'trim')                               # pickup flap
    n.add(xf(bm_box(0.9, 0.18, 0.02), (0, 0.84, 0.405)), 'light')                                 # lit header
    n.add(xf(bm_box(0.92, 0.04, D), (0, -0.93, -0.02)), 'trim')
    finish('vending', n)


def tv():
    n = Node('tv_mesh')
    n.add(xf(bm_rbox(1.1, 0.62, 0.05, 0.012), (0, 0.05, 0)), 'trim')                               # bezel/back
    n.add(xf(bm_box(1.04, 0.56, 0.01), (0, 0.055, 0.027)), 'visor')                                # screen
    n.add(xf(bm_rbox(0.3, 0.2, 0.04, 0.01), (0, 0.02, -0.04)), 'trim')                             # back bump
    n.add(xf(bm_rbox(0.06, 0.12, 0.03, 0.008), (0, -0.3, -0.01)), 'trim')                          # neck
    n.add(xf(bm_rbox(0.44, 0.02, 0.24, 0.008), (0, -0.35, 0)), 'darkmetal')                        # foot
    n.add(xf(bm_box(0.012, 0.008, 0.004), (0.5, -0.235, 0.027)), 'light')                           # power LED
    finish('tv', n)


def bookshelf():
    import random
    rnd = random.Random(7)
    n = Node('bookshelf_mesh')
    W, H, D = 1.0, 1.8, 0.35
    for x in (-1, 1):
        n.add(xf(bm_box(0.03, H, D), (x * (W / 2 - 0.015), 0, 0)), 'main')                           # sides
    n.add(xf(bm_box(W - 0.06, H, 0.012), (0, 0, -D / 2 + 0.006)), 'main')                           # back
    shelves = [-H / 2 + 0.05 + i * (H - 0.08) / 4 for i in range(5)]
    for y in shelves:
        n.add(xf(bm_box(W - 0.06, 0.03, D), (0, y, 0)), 'main')
    n.add(xf(bm_box(W, 0.03, D), (0, H / 2 - 0.015, 0)), 'main')                                    # top
    for si, y in enumerate(shelves[:-1]):
        x = -W / 2 + 0.04
        gap = shelves[si + 1] - y - 0.03
        while x < W / 2 - 0.08:
            bw = rnd.uniform(0.03, 0.06)
            if rnd.random() < 0.08:
                x += 0.07
                continue
            bh = gap * rnd.uniform(0.62, 0.88)
            bd = D * rnd.uniform(0.6, 0.8)
            tilt = rnd.uniform(-0.08, 0.08) if rnd.random() < 0.15 else 0
            slot = rnd.choice(['book1', 'book2', 'book3', 'book4', 'white'])
            n.add(xf(bm_rbox(bw, bh, bd, 0.004, 1), (x + bw / 2, y + 0.015 + bh / 2, -D / 2 + 0.02 + bd / 2), (0, 0, tilt)), slot)
            x += bw + 0.004
    finish('bookshelf', n)


def dumpster():
    n = Node('dumpster_mesh')
    W, H, D = 1.9, 1.25, 1.1
    n.add(xf(bm_rbox(W - 0.06, 1.0, D - 0.1, 0.03), (0, -0.05, 0)), 'main')                        # bin
    n.add(xf(bm_rbox(W, 0.08, D, 0.02), (0, 0.46, 0)), 'main')                                   # rim
    for x in (-0.47, 0.47):                                                                        # lids
        n.add(xf(bm_rbox(0.9, 0.05, D - 0.04, 0.02), (x, 0.52, 0.01), (0.05, 0, 0)), 'trim')
        n.add(bm_tube((x - 0.3, 0.55, 0.47), (x + 0.3, 0.55, 0.47), 0.012, 8), 'trim')
    for x in (-0.7, -0.35, 0, 0.35, 0.7):                                                          # ribs
        for z in (-1, 1):
            n.add(xf(bm_box(0.05, 0.9, 0.03), (x, -0.05, z * (D / 2 - 0.035))), 'main')
    for x in (-1, 1):                                                                              # lift pockets
        n.add(xf(bm_rbox(0.06, 0.14, 0.7, 0.01), (x * (W / 2 - 0.02), 0.2, 0)), 'darkmetal')
    for x in (-0.75, 0.75):                                                                        # casters
        for z in (-0.4, 0.4):
            n.add(xf(bm_box(0.08, 0.04, 0.08), (x, -0.57, z)), 'darkmetal')
            n.add(xf(bm_cyl(0.05, 0.05, 0.04, 12), (x, -0.575, z), (0, 0, math.pi / 2)), 'rubber')
    finish('dumpster', n)


def pallet():
    n = Node('pallet_mesh')
    for i in range(5):                                                                             # top deck
        n.add(xf(bm_rbox(1.2, 0.022, 0.15, 0.004, 1), (0, 0.059, -0.425 + i * 0.2125)), 'main')
    for x in (-0.53, 0, 0.53):                                                                     # blocks
        for z in (-0.42, 0, 0.42):
            n.add(xf(bm_rbox(0.14, 0.078, 0.14, 0.006, 1), (x, 0.009, z)), 'main')
    for x in (-0.53, 0, 0.53):                                                                     # bottom runners
        n.add(xf(bm_rbox(0.14, 0.022, 1.0, 0.004, 1), (x, -0.059, 0)), 'main')
    finish('pallet', n)


def barrier():
    n = Node('barrier_mesh')
    sec = [(-0.3, -0.4), (0.3, -0.4), (0.3, -0.3), (0.13, -0.2), (0.075, 0.4), (-0.075, 0.4), (-0.13, -0.2), (-0.3, -0.3)]
    body = bevel(bm_profile(sec, 2.0), 0.02, 2, 20)
    n.add(xf(body, rot=(0, math.pi / 2, 0)), 'main')
    for z in (-0.6, 0.6):                                                                          # forklift slots
        n.add(xf(bm_box(0.62, 0.08, 0.22), (0, -0.36, z)), 'trim')
    for s in (-1, 1):                                                                              # reflectors
        n.add(xf(bm_box(0.01, 0.06, 0.18), (s * 0.103, 0.12, 0), (0, 0, s * 0.07)), 'light')
    finish('barrier', n)


def rocket():
    n = Node('rocket_mesh')
    n.add(lathe_z([(0.0, -0.26), (0.042, -0.26), (0.045, -0.22), (0.045, 0.12), (0.0, 0.12)], 16), 'main')  # body (t = forward)
    n.add(lathe_z([(0.045, 0.12), (0.03, 0.22), (0.0, 0.3)], 16), 'darkmetal')                              # nose
    n.add(lathe_z([(0.03, -0.26), (0.036, -0.31), (0.024, -0.31), (0.018, -0.27), (0.03, -0.26)], 12), 'darkmetal')  # nozzle
    for i in range(4):
        a = i / 4 * TAU + math.pi / 4
        n.add(xf(xf(bm_box(0.004, 0.07, 0.09), (0, 0.075, 0.2)), rot=(0, 0, a)), 'darkmetal')
    n.add(lathe_z(closed_ring(0.045, 0.047, -0.05, 0.0), 16), 'red')
    finish('rocket', n)


# ---------------------------------------------------------------------------
# MORE WEAPONS
# ---------------------------------------------------------------------------
def shotgun():
    n = Node('wp_shotgun_mesh')
    n.add(xf(bm_rbox(0.05, 0.075, 0.24, 0.01), (0, 0.0, -0.03)), 'main')                           # receiver
    n.add(xf(bm_box(0.004, 0.03, 0.08), (0.026, 0.01, -0.02)), 'trim')                               # ejection port
    n.add(cyl_z(0.014, 0.5, -0.4, 0.022), 'darkmetal')                                             # barrel
    n.add(cyl_z(0.012, 0.42, -0.36, -0.008), 'darkmetal')                                          # magazine tube
    n.add(cyl_z(0.0145, 0.02, -0.64, -0.008), 'darkmetal')                                         # mag cap
    n.add(xf(bm_rbox(0.048, 0.05, 0.16, 0.014), (0, -0.01, -0.33)), 'wood')                         # pump
    for i in range(6):
        for x in (-0.024, 0.024):
            n.add(xf(bm_box(0.003, 0.034, 0.006), (x, -0.01, -0.39 + i * 0.024)), 'trim')
    n.add(xf(bm_sphere(0.005, 8, 6), (0, 0.04, -0.635)), 'metal')                                  # bead sight
    n.add(xf(bm_rbox(0.04, 0.1, 0.05, 0.012), (0, -0.07, 0.07), (0.3, 0, 0)), 'wood')               # grip
    n.add(xf(bm_rbox(0.042, 0.085, 0.24, 0.02), (0, -0.045, 0.21), (0.1, 0, 0)), 'wood')            # stock
    n.add(xf(bm_rbox(0.044, 0.095, 0.022, 0.008), (0, -0.057, 0.335), (0.1, 0, 0)), 'rubber')       # butt pad
    n.add(bm_tube((0, -0.037, 0.0), (0, -0.06, -0.03), 0.004, 6), 'darkmetal')
    n.add(bm_tube((0, -0.06, -0.03), (0, -0.065, 0.04), 0.004, 6), 'darkmetal')
    finish('wp_shotgun', n, hand_node('wp_shotgun', (0, -0.07, 0.07), 0.3))


def sniper():
    n = Node('wp_sniper_mesh')
    n.add(xf(bm_rbox(0.05, 0.065, 0.32, 0.01), (0, 0, -0.03)), 'main')                             # receiver/chassis
    n.add(xf(bm_rbox(0.056, 0.06, 0.3, 0.012), (0, -0.004, -0.33)), 'main')                        # forend
    n.add(cyl_z(0.012, 0.36, -0.62, 0.008), 'darkmetal')                                           # barrel
    n.add(cyl_z(0.02, 0.07, -0.83, 0.008), 'darkmetal')                                            # muzzle brake
    for z in (-0.815, -0.845):
        for x in (-0.02, 0.02):
            n.add(xf(bm_box(0.004, 0.024, 0.012), (x, 0.008, z)), 'trim')
    n.add(cyl_z(0.022, 0.24, -0.06, 0.085), 'darkmetal')                                           # scope tube
    n.add(xf(lathe_z([(0.022, 0.0), (0.03, 0.04), (0.03, 0.07), (0.026, 0.07)], 20), (0, 0.085, -0.18)), 'darkmetal')   # objective bell
    n.add(xf(lathe_z([(0.022, 0.0), (0.027, -0.03), (0.027, -0.06), (0.024, -0.06)], 20), (0, 0.085, 0.06)), 'darkmetal')  # eyepiece
    n.add(cyl_z(0.027, 0.004, -0.252, 0.085), 'glass')
    n.add(xf(bm_cyl(0.012, 0.012, 0.025, 10), (0, 0.117, -0.06)), 'darkmetal')                      # turrets
    n.add(xf(bm_cyl(0.012, 0.012, 0.025, 10), (0.032, 0.085, -0.06), (0, 0, math.pi / 2)), 'darkmetal')
    for z in (-0.13, 0.0):
        n.add(xf(bm_box(0.028, 0.05, 0.022), (0, 0.05, z)), 'darkmetal')                             # rings
    n.add(bm_tube((0.026, 0.01, 0.06), (0.06, -0.01, 0.07), 0.005, 8), 'metal')                     # bolt handle
    n.add(xf(bm_sphere(0.011, 10, 6), (0.062, -0.012, 0.07)), 'metal')
    n.add(xf(bm_rbox(0.034, 0.08, 0.06, 0.01), (0, -0.07, -0.1)), 'trim')                           # magazine
    n.add(xf(bm_rbox(0.035, 0.1, 0.045, 0.012), (0, -0.075, 0.06), (0.3, 0, 0)), 'trim')            # grip
    n.add(bm_tube((0, -0.033, 0.02), (0, -0.058, -0.01), 0.004, 6), 'darkmetal')
    n.add(xf(bm_rbox(0.04, 0.03, 0.26, 0.01), (0, -0.01, 0.23)), 'main')                           # stock spine
    n.add(xf(bm_rbox(0.04, 0.11, 0.05, 0.012), (0, -0.05, 0.34)), 'main')                          # butt
    n.add(xf(bm_rbox(0.042, 0.115, 0.018, 0.006), (0, -0.05, 0.372)), 'rubber')
    n.add(xf(bm_rbox(0.03, 0.03, 0.12, 0.01), (0, 0.035, 0.24)), 'rubber')                         # cheek rest
    n.add(bm_tube((0, -0.02, 0.32), (0, -0.11, 0.3), 0.009, 8), 'main')                            # lower butt strut
    for x in (-0.012, 0.012):                                                                      # folded bipod
        n.add(bm_tube((x, -0.04, -0.44), (x * 1.5, -0.045, -0.25), 0.005, 6), 'darkmetal')
    finish('wp_sniper', n, hand_node('wp_sniper', (0, -0.075, 0.06), 0.3))


def rocket_launcher():
    n = Node('wp_rocket_mesh')
    n.add(cyl_z(0.058, 0.78, -0.15, 0.06, seg=24), 'main')                                          # launch tube
    n.add(xf(lathe_z(closed_ring(0.055, 0.075, 0.0, 0.08), 24), (0, 0.06, -0.54)), 'darkmetal')    # front flare
    n.add(xf(lathe_z(closed_ring(0.055, 0.07, 0.0, 0.06), 24), (0, 0.06, 0.3)), 'darkmetal')       # rear flare
    for z in (-0.35, 0.05):
        n.add(xf(lathe_z(closed_ring(0.058, 0.064, 0.0, 0.02), 24), (0, 0.06, z)), 'darkmetal')     # bands
    n.add(xf(lathe_z([(0.0, -0.06), (0.03, -0.02), (0.048, 0.04), (0.048, 0.06), (0.0, 0.06)], 16), (0, 0.06, -0.56)), 'darkmetal')  # loaded warhead
    n.add(xf(bm_sphere(0.012, 8, 6), (0, 0.06, -0.625)), 'red')
    n.add(xf(bm_rbox(0.04, 0.1, 0.05, 0.012), (0, -0.04, 0.02), (0.25, 0, 0)), 'trim')              # grip
    n.add(xf(bm_rbox(0.04, 0.09, 0.045, 0.012), (0, -0.03, -0.24), (0.1, 0, 0)), 'trim')            # fore grip
    n.add(xf(bm_box(0.03, 0.03, 0.2), (0, 0.0, -0.1)), 'darkmetal')                                  # tube-to-grip rail
    n.add(xf(bm_rbox(0.05, 0.06, 0.1, 0.01), (-0.07, 0.1, -0.1)), 'darkmetal')                       # sight box
    n.add(cyl_z(0.018, 0.01, -0.152, 0.1, -0.07), 'glass')
    n.add(bm_tube((0, 0.0, -0.01), (0, -0.02, -0.04), 0.004, 6), 'darkmetal')
    finish('wp_rocket', n, hand_node('wp_rocket', (0, -0.04, 0.02), 0.25))


def prop_cannon():
    n = Node('wp_propcannon_mesh')
    n.add(lathe_z([(0.0, -0.16), (0.06, -0.16), (0.07, -0.1), (0.07, 0.12), (0.055, 0.2), (0.0, 0.2)], 24), 'main')   # body
    n.add(lathe_z([(0.05, 0.14), (0.05, 0.34), (0.085, 0.46), (0.09, 0.5), (0.07, 0.5), (0.068, 0.47), (0.04, 0.36), (0.04, 0.14), (0.05, 0.14)], 24), 'darkmetal')  # flared muzzle
    for z in (-0.2, -0.27):
        n.add(ring_z(0.052, 0.008, z, 24, 6), 'accent')
    n.add(xf(bm_rbox(0.1, 0.07, 0.14, 0.015), (0, 0.09, 0.02)), 'trim')                             # hopper
    n.add(xf(bm_rbox(0.06, 0.05, 0.06, 0.006), (0, 0.13, 0.02), (0, 0.4, 0)), 'second')             # tiny crate in hopper
    n.add(xf(bm_rbox(0.045, 0.12, 0.055, 0.015), (0, -0.1, 0.08), (0.28, 0, 0)), 'trim')             # grip
    n.add(xf(bm_rbox(0.05, 0.08, 0.05, 0.012), (0, -0.08, -0.12), (0.1, 0, 0)), 'trim')              # fore grip
    n.add(bm_tube((0.07, 0.0, 0.1), (0.075, 0.02, -0.1), 0.01, 8), 'red')                              # pressure line
    n.add(xf(bm_cyl(0.022, 0.022, 0.012, 14), (0.075, 0.04, 0.05), (0, 0, math.pi / 2)), 'white')     # gauge
    finish('wp_propcannon', n, hand_node('wp_propcannon', (0, -0.1, 0.08), 0.28))


for fn in (crate, metal_crate, barrel, xbarrel, cone, concrete_block, seat, wheel, car, kart, pickup, monster, buggy, sled, avatar, ragdoll, pine, pine_snow, rock, palm, container,
           physgun, toolgun, pistol, rifle, grenade, crowbar,
           propane, balloon, trampoline, melon, pin, chair, table, couch, fridge, vending, tv, bookshelf, dumpster, pallet, barrier, rocket,
           shotgun, sniper, rocket_launcher, prop_cannon):
    fn()

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True,
                          export_texcoords=True, export_normals=True, export_materials='EXPORT',
                          use_selection=False, export_cameras=False, export_lights=False, export_animations=False)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
print('MODELS_OK', OUT, 'tris=%d' % tris)
