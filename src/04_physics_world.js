
/* ============================================================================
   4. PHYSICS (Rapier world, fixed 60 Hz step, colliders)
   ========================================================================== */
const Phys = {
  world: null, ground: null, colMap: new Map(), ray: null,
  async init() {
    await RAPIER.init();
    const w = this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    w.timestep = CFG.dt;
    w.integrationParameters.numSolverIterations = 6;
    this.ground = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    // infinite floor plane at y = 0. A huge cuboid loses precision in shape queries (players sank through it on the diagonals)
    const gc = w.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setFriction(0.9), this.ground);
    this.colMap.set(gc.handle, 0);
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  },
  colliderDescs(d) {
    const s = d.sh, C = RAPIER.ColliderDesc; let out = [];
    switch (s.t) {
      case 'box': out = [C.cuboid(s.s[0] / 2, s.s[1] / 2, s.s[2] / 2)]; break;
      case 'ramp': out = [C.convexHull(wedgePoints(s.s[0], s.s[1], s.s[2]))]; break;
      case 'ball': out = [C.ball(s.r)]; break;
      case 'cyl': out = [C.cylinder(s.h / 2, s.r)]; break;
      case 'cap': out = [C.capsule(s.h / 2, s.r)]; break;
      case 'cone': out = [C.cone(s.h / 2, s.r)]; break;
      case 'wheel': { const q = new QT().setFromUnitVectors(UP, _v1.fromArray(s.ax).normalize()); out = [C.cylinder(s.w / 2, s.r).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })]; break; }
      case 'seat': out = [C.cuboid(0.31, 0.07, 0.3), C.cuboid(0.31, 0.31, 0.06).setTranslation(0, 0.36, 0.26)]; break;
      case 'light': out = [C.ball(0.2)]; break;
      case 'spawn': out = [C.ball(0.6).setSensor(true)]; break;
      case 'nade': out = [C.ball(0.09)]; break;
      case 'rocket': out = [C.ball(0.08)]; break;
      case 'multi': out = s.b.map(b => { const c = C.cuboid(b[0] / 2, b[1] / 2, b[2] / 2).setTranslation(b[3], b[4], b[5]); c._dm = b[6] || 1; return c; }); break;   // [w,h,d, x,y,z, densityMul]
      case 'chair': out = [C.cuboid(0.23, 0.025, 0.22), C.cuboid(0.23, 0.25, 0.02).setTranslation(0, 0.275, -0.2), ...[[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]].map(([x, z]) => C.cuboid(0.0225, 0.225, 0.0225).setTranslation(x, -0.25, z))]; break;
      case 'table': { const [w, hh, dd] = s.s; out = [C.cuboid(w / 2, 0.025, dd / 2).setTranslation(0, hh / 2 - 0.025, 0), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => C.cuboid(0.03, (hh - 0.05) / 2, 0.03).setTranslation(x * (w / 2 - 0.08), -0.025, z * (dd / 2 - 0.08)))]; break; }
      default: out = [C.cuboid(0.25, 0.25, 0.25)];
    }
    const D = MATDEFS[d.m] || MATDEFS.plastic;
    const den = d.den || D.density;
    return out.filter(Boolean).map(c => {
      c.setDensity(den * (c._dm || 1)).setFriction(d.fr ?? (s.t === 'wheel' ? 1.4 : D.fr)).setRestitution(d.re ?? D.re);
      if (d.re != null) c.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);   // trampolines bounce whatever lands on them
      return c;
    });
  },
  makeBody(e) {
    const d = e.d, auth = Net.auth(), B = RAPIER.RigidBodyDesc;
    let desc;
    if (d.k === 'map') desc = B.fixed();
    else if (!auth) desc = B.kinematicPositionBased();
    else if (d.fz) desc = B.fixed();
    else {
      desc = B.dynamic().setLinearDamping(d.k === 'part' ? 0.12 : 0.04).setAngularDamping(d.k === 'part' ? 1.4 : 0.15);
      // ragdoll parts use soft (predictive) CCD: hard CCD fights the joints at speed and blows the ragdoll apart
      if (d.k === 'nade') desc.setCcdEnabled(true);
      else if (d.k === 'rocket') desc.setCcdEnabled(true).lockRotations();
      else if (d.k === 'part') desc.setSoftCcdPrediction(0.5);
      if (d.gs != null) desc.setGravityScale(d.gs);      // balloons float, rockets fly straight
      if (d.ld != null) desc.setLinearDamping(d.ld);
      if (d.v) desc.setLinvel(d.v[0], d.v[1], d.v[2]);
      if (d.w) desc.setAngvel({ x: d.w[0], y: d.w[1], z: d.w[2] });
    }
    desc.setTranslation(d.p[0], d.p[1], d.p[2]).setRotation({ x: d.q[0], y: d.q[1], z: d.q[2], w: d.q[3] });
    e.body = this.world.createRigidBody(desc);
    e.cols = [];
    for (const cd of this.colliderDescs(d)) {
      const c = this.world.createCollider(cd, e.body); this.colMap.set(c.handle, e.id); e.cols.push(c);
      // ragdoll parts report hard contacts (more than ~6 g of deceleration) for impact injuries
      if (d.k === 'part') { c.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS); c.setContactForceEventThreshold(Math.max(0.002, c.mass()) * 9.81 * 6); }
    }
  },
  removeBody(e) {
    if (!e.body) return;
    for (const c of e.cols) this.colMap.delete(c.handle);
    this.world.removeRigidBody(e.body); e.body = null; e.cols = []; this.qDirty = true;
  },
  // Rapier only rebuilds its query structure (raycasts, the character controller, car wheels) during step(). A query
  // between a removal and the next step can touch the removed collider and panic, so refresh first when needed.
  qDirty: false,
  sync() { if (this.qDirty) { this.qDirty = false; this.world.updateSceneQueries(); } },
  // cast a ray, return {id (ent id / 0 world / 'p:<peer>'), point, normal, dist} or null
  cast(o, dir, max, excludeBody, predicate) {
    this.sync();
    const r = this.ray; r.origin = { x: o.x, y: o.y, z: o.z }; r.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRayAndGetNormal(r, max, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, excludeBody || undefined, predicate);
    if (!hit) return null;
    const id = this.colMap.get(hit.collider.handle);
    return { id: id === undefined ? null : id, handle: hit.collider.handle, point: new V3(o.x + dir.x * hit.timeOfImpact, o.y + dir.y * hit.timeOfImpact, o.z + dir.z * hit.timeOfImpact), normal: new V3(hit.normal.x, hit.normal.y, hit.normal.z), dist: hit.timeOfImpact };
  },
  // contact force events from NPC parts (see makeBody) = real impacts, used by the host for slam / crush injuries
  impacts: [],
  step() {
    if (!this.evq) this.evq = new RAPIER.EventQueue(true);
    this.world.step(this.evq); this.qDirty = false;
    this.impacts.length = 0;
    this.evq.drainContactForceEvents(ev => { this.impacts.push([ev.collider1(), ev.collider2(), ev.totalForceMagnitude()]); });
    this.evq.drainCollisionEvents(() => { });
  },
};

/* ============================================================================
   5. WORLD & ENTITIES (props, map pieces, ragdoll parts, constraints, groups)
   ========================================================================== */
// Entity descriptor (also the save format):
// { id, k:'prop'|'map'|'part'|'nade', sh:{t,...}, m:material, c:color|null, o:owner, p:[3], q:[4], fz:0/1,
//   seat?:1, thr?:[{id,p,d,f,key}], light?:{c,i,r}, g?:groupId, den?:density, n?:label }
const GROUP_RUNTIME = ['lv', 'stun', 'wT', 'wYaw', 'walk', 'ph', 'state', 'gu', 'flee', 'fx', 'fz', 'atk', 'swing', 'groan', 'limp'];
class Ent {
  constructor(d) {
    this.d = d; this.id = d.id; this.body = null; this.cols = []; this.mesh = null;
    this.buf = []; this.prevP = new V3().fromArray(d.p); this.curP = this.prevP.clone(); this.prevQ = new QT().fromArray(d.q); this.curQ = this.prevQ.clone();
    this.sentP = new V3(1e9, 0, 0); this.sentQ = new QT(); this.sleep = false; this.lastPush = 0;
  }
}
const World = {
  ents: new Map(), cons: new Map(), groups: new Map(), rockets: new Set(), vehicles: new Set(), nextId: 1, consVer: 0, groundMesh: null,
  initStatic() {
    const gm = this.groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400, 175, 175).rotateX(-Math.PI / 2), Mats.get('ground'));
    const uv = gm.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 350, uv.getY(i) * 350);
    gm.userData.mt = 'ground'; gm.receiveShadow = true; R.scene.add(gm);
  },
  allocId() { for (let i = 0; i < 65000; i++) { const id = this.nextId++; if (this.nextId > 65000) this.nextId = 1; if (!this.ents.has(id) && !this.cons.has(id) && !this.groups.has(id)) return id; } return 0; },
  create(d) {
    if (this.ents.has(d.id)) this.remove(d.id);
    if (d.id >= this.nextId) this.nextId = d.id + 1;
    const e = new Ent(d);
    Phys.makeBody(e);
    e.mesh = buildVisual(d); e.mesh.position.fromArray(d.p); e.mesh.quaternion.fromArray(d.q);
    if (e.mesh.userData.editOnly) e.mesh.visible = Editor.active;
    R.scene.add(e.mesh);
    this.ents.set(d.id, e);
    if (d.k === 'rocket') this.rockets.add(d.id);
    if (d.veh) this.vehicles.add(d.id);
    return e;
  },
  remove(id) {
    const e = this.ents.get(id); if (!e) return;
    for (const c of [...this.cons.values()]) if (c.a === id || c.b === id) this.removeCon(c.id);
    Vehicles.drop(id);
    Phys.removeBody(e);
    if (e.mesh) { R.scene.remove(e.mesh); }
    this.ents.delete(id); this.rockets.delete(id); this.vehicles.delete(id);
    if (Tools.onEntRemoved) Tools.onEntRemoved(id);
  },
  addCon(c) {
    if (this.cons.has(c.id)) this.removeCon(c.id);
    if (c.id >= this.nextId) this.nextId = c.id + 1;
    this.cons.set(c.id, c);
    if (Net.auth()) this.makeJoint(c);
    if (c.t === 'rope' || c.t === 'spring') this.makeRopeVis(c);
    this.consVer++;
  },
  makeJoint(c) {
    const A = c.a ? (this.ents.get(c.a) || {}).body : Phys.ground, B = c.b ? (this.ents.get(c.b) || {}).body : Phys.ground;
    if (!A || !B || A === B) return;
    const J = RAPIER.JointData, v = a => ({ x: a[0], y: a[1], z: a[2] }), q = a => ({ x: a[0], y: a[1], z: a[2], w: a[3] });
    let jd;
    switch (c.t) {
      case 'weld': jd = J.fixed(v(c.pa), q(c.fa), v(c.pb), q(c.fb)); break;
      case 'rope': jd = J.rope(c.len, v(c.pa), v(c.pb)); break;
      case 'spring': jd = J.spring(c.len, c.st, c.dm, v(c.pa), v(c.pb)); break;
      case 'wheel': case 'hinge': {
        // ragdoll joints always turn about -X (worlds saved before this fix stored +X, which bent knees and elbows backwards)
        const rag = c.t === 'hinge' && ((this.ents.get(c.a) || {}).d || {}).k === 'part' && ((this.ents.get(c.b) || {}).d || {}).k === 'part';
        jd = J.revolute(v(c.pa), v(c.pb), v(rag ? [-1, 0, 0] : c.ax));
      } if (c.lim) { jd.limitsEnabled = true; jd.limits = c.lim; } break;
      case 'ball': jd = J.spherical(v(c.pa), v(c.pb)); break;
      default: return;
    }
    c.j = Phys.world.createImpulseJoint(jd, A, B, true);
    if (c.t !== 'rope' && c.t !== 'spring') c.j.setContactsEnabled(false);
    if (c.t === 'wheel') c.j.configureMotorVelocity(0, 0.02);
    // Rapier 0.14 ignores JointData.limits for revolute joints; apply them on the created joint
    if (c.lim && c.j.setLimits) c.j.setLimits(c.lim[0], c.lim[1]);
  },
  removeCon(id) {
    const c = this.cons.get(id); if (!c) return;
    if (c.j) { try { if (Phys.world.impulseJoints.contains(c.j.handle)) Phys.world.removeImpulseJoint(c.j, true); } catch (e) { } c.j = null; }
    if (c.vis) { R.scene.remove(c.vis); c.vis = null; }
    this.cons.delete(id); this.consVer++;
  },
  makeRopeVis(c) {
    const g = new THREE.Group(), N = 12;
    const geo = Geo.get('ropeseg', () => new THREE.CylinderGeometry(1, 1, 1, 6, 1, true));
    for (let i = 0; i < N; i++) { const m = matMesh(geo, c.t === 'spring' ? 'metal' : 'rubber', c.t === 'spring' ? '#fed330' : '#3a3026'); m.castShadow = false; g.add(m); }
    g.userData.pts = Array.from({ length: N + 1 }, () => new V3());
    c.vis = g; R.scene.add(g);
  },
  anchorWorld(id, local, out) {
    if (!id) return out.fromArray(local);
    const e = this.ents.get(id); if (!e || !e.mesh) return out.fromArray(local);
    return out.fromArray(local).applyQuaternion(e.mesh.quaternion).add(e.mesh.position);
  },
  updateRopeVis() {
    const pA = _v1, pB = _v2, mid = _v3;
    for (const c of this.cons.values()) {
      if (!c.vis) continue;
      this.anchorWorld(c.a, c.pa, pA); this.anchorWorld(c.b, c.pb, pB);
      const dist = pA.distanceTo(pB), slack = c.t === 'rope' ? Math.max(0, c.len - dist) : 0;
      mid.addVectors(pA, pB).multiplyScalar(0.5); mid.y -= slack * 0.6;
      const pts = c.vis.userData.pts, N = pts.length - 1, rad = c.t === 'spring' ? 0.035 : 0.022;
      for (let i = 0; i <= N; i++) { const t = i / N, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, cc = t * t; pts[i].set(a * pA.x + b * mid.x + cc * pB.x, a * pA.y + b * mid.y + cc * pB.y, a * pA.z + b * mid.z + cc * pB.z); }
      for (let i = 0; i < N; i++) {
        const m = c.vis.children[i], p0 = pts[i], p1 = pts[i + 1];
        _v4.subVectors(p1, p0); const L = _v4.length() || 0.0001;
        m.position.addVectors(p0, p1).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(UP, _v4.divideScalar(L)); m.scale.set(rad, L, rad);
      }
    }
  },
  // Replace an entity's descriptor fields (painter, thrusters, freeze, map edits)
  patch(id, patch) {
    const e = this.ents.get(id); if (!e) return;
    const auth = Net.auth();
    if (auth && e.body && e.d.k !== 'map') { const t = e.body.translation(), r = e.body.rotation(); e.d.p = [t.x, t.y, t.z]; e.d.q = [r.x, r.y, r.z, r.w]; }
    Object.assign(e.d, patch);
    const structural = 'sh' in patch || (e.d.k === 'map' && ('p' in patch || 'q' in patch)) || 'm' in patch;
    if (structural) this.rebuildBody(e);
    else if ('fz' in patch && auth && e.body) e.body.setBodyType(e.d.fz ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic, true);
    // visual
    const pos = e.mesh.position.clone(), quat = e.mesh.quaternion.clone();
    R.scene.remove(e.mesh);
    e.mesh = buildVisual(e.d);
    if (e.d.k === 'map' || 'p' in patch) { e.mesh.position.fromArray(e.d.p); e.mesh.quaternion.fromArray(e.d.q); e.curP.fromArray(e.d.p); e.prevP.copy(e.curP); e.curQ.fromArray(e.d.q); e.prevQ.copy(e.curQ); }
    else { e.mesh.position.copy(pos); e.mesh.quaternion.copy(quat); }
    if (e.mesh.userData.editOnly) e.mesh.visible = Editor.active;
    R.scene.add(e.mesh);
    if (Editor.sel === id) Editor.reattach();
  },
  rebuildBody(e) {
    Vehicles.drop(e.id);
    const linked = [...this.cons.values()].filter(c => c.a === e.id || c.b === e.id);
    for (const c of linked) if (c.j) { try { Phys.world.removeImpulseJoint(c.j, true); } catch (err) { } c.j = null; }
    let lv = null, av = null;
    if (Net.auth() && e.body && e.body.isDynamic()) { lv = e.body.linvel(); av = e.body.angvel(); }
    Phys.removeBody(e); Phys.makeBody(e);
    if (lv) { e.body.setLinvel(lv, true); e.body.setAngvel(av, true); }
    if (Net.auth()) for (const c of linked) this.makeJoint(c);
  },
  // swap every entity's visual (e.g. PS1 low-poly models <-> normal models on a tier change)
  rebuildVisuals() {
    for (const e of this.ents.values()) {
      if (!e.mesh) continue;
      const m = buildVisual(e.d); m.position.copy(e.mesh.position); m.quaternion.copy(e.mesh.quaternion); m.visible = e.mesh.visible;
      R.scene.remove(e.mesh); R.scene.add(m); e.mesh = m; e._wounds = []; e._stumps = [];
    }
    for (const g of this.groups.values()) g._sevVis = 0;   // stumps get re-added by the gore pass
    if (Editor.sel) Editor.reattach();
  },
  clear() {
    for (const id of [...this.cons.keys()]) this.removeCon(id);
    for (const id of [...this.ents.keys()]) this.remove(id);
    this.groups.clear(); this.nextId = 1; this.consVer++;
  },
  // ---- authority transitions (host migration) -----------------------------
  promote() {
    for (const e of this.ents.values()) {
      if (e.d.k === 'map' || !e.body) continue;
      e.body.setBodyType(e.d.fz ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic, true);
      const b = e.buf;
      if (!e.d.fz && b.length >= 2) {
        const s0 = b[b.length - 2], s1 = b[b.length - 1], dt = Math.max(0.01, s1.t - s0.t);
        e.body.setLinvel({ x: (s1.p.x - s0.p.x) / dt, y: (s1.p.y - s0.p.y) / dt, z: (s1.p.z - s0.p.z) / dt }, true);
      }
      const t = e.body.translation(), r = e.body.rotation();
      e.curP.set(t.x, t.y, t.z); e.prevP.copy(e.curP); e.curQ.set(r.x, r.y, r.z, r.w); e.prevQ.copy(e.curQ);
      e.buf.length = 0;
    }
    for (const c of this.cons.values()) if (!c.j) this.makeJoint(c);
  },
  // ---- snapshots of descriptors with live pose -----------------------------
  liveDesc(e) {
    const d = Object.assign({}, e.d);
    if (e.body && e.d.k !== 'map') {
      if (Net.auth()) {
        const t = e.body.translation(), r = e.body.rotation(); d.p = [r4(t.x), r4(t.y), r4(t.z)]; d.q = [r4(r.x), r4(r.y), r4(r.z), r4(r.w)];
        if (e.body.isDynamic()) { const lv = e.body.linvel(), av = e.body.angvel(); d.v = [r4(lv.x), r4(lv.y), r4(lv.z)]; d.w = [r4(av.x), r4(av.y), r4(av.z)]; }
      } else { d.p = a3(e.mesh.position); d.q = a4(e.mesh.quaternion); delete d.v; delete d.w; }
    }
    return d;
  },
  conDesc(c) { const o = Object.assign({}, c); delete o.j; delete o.vis; return o; },
  serialize() {
    return {
      v: 1, game: GAME.name, nextId: this.nextId,
      ents: [...this.ents.values()].filter(e => e.d.k !== 'nade' && e.d.k !== 'rocket' && !e.d.tmp).map(e => this.liveDesc(e)),
      cons: [...this.cons.values()].map(c => this.conDesc(c)),
      // drop NPC brain runtime state (and cached '_' fields like joint handles / rest pose)
      groups: [...this.groups.values()].map(g => { const o = Object.assign({}, g); for (const k in o) if (k[0] === '_' || GROUP_RUNTIME.includes(k)) delete o[k]; return o; }),
    };
  },
  load(data) {
    this.clear();
    for (const d of data.ents || []) this.create(d);
    for (const c of data.cons || []) if ((!c.a || this.ents.has(c.a)) && (!c.b || this.ents.has(c.b))) this.addCon(c);
    for (const g of data.groups || []) this.groups.set(g.id, Object.assign({}, g));
    this.nextId = Math.max(this.nextId, data.nextId || 1);
  },
  countOwned(pid) { let n = 0; for (const e of this.ents.values()) if (e.d.o === pid && e.d.k !== 'map') n++; return n; },
  // bodies connected to `id` through constraints (for dupes / vehicles)
  connected(id) {
    const out = new Set([id]), stack = [id];
    const adj = new Map();
    for (const c of this.cons.values()) { if (!c.a || !c.b) continue; (adj.get(c.a) || adj.set(c.a, []).get(c.a)).push(c.b); (adj.get(c.b) || adj.set(c.b, []).get(c.b)).push(c.a); }
    while (stack.length) { const x = stack.pop(); for (const y of adj.get(x) || []) { const e = this.ents.get(y); if (!out.has(y) && e && e.d.k !== 'map') { out.add(y); stack.push(y); } } }
    return out;
  },
};

// ---- snapshot interpolation buffers (clients) ------------------------------
function pushSample(buf, t, p, q) {
  const last = buf[buf.length - 1];
  if (last && t <= last.t) return;
  if (last && t - last.t > 0.2) buf.push({ t: t - 1 / CFG.snapRate, p: last.p.clone(), q: last.q.clone() });
  buf.push({ t, p, q });
  while (buf.length > 24) buf.shift();
}
function sampleBuf(buf, t, outP, outQ) {
  const n = buf.length; if (!n) return false;
  if (t <= buf[0].t) { outP.copy(buf[0].p); outQ.copy(buf[0].q); return true; }
  const last = buf[n - 1];
  if (t >= last.t) {
    // brief extrapolation (max 100 ms) to hide late packets
    if (n >= 2 && t - last.t < 0.1) { const pr = buf[n - 2], k = (t - last.t) / Math.max(0.001, last.t - pr.t); outP.copy(last.p).addScaledVector(_v4.subVectors(last.p, pr.p), Math.min(k, 1)); }
    else outP.copy(last.p);
    outQ.copy(last.q); return true;
  }
  for (let i = n - 2; i >= 0; i--) {
    const a = buf[i]; if (a.t <= t) { const b = buf[i + 1], k = (t - a.t) / (b.t - a.t); outP.lerpVectors(a.p, b.p, k); outQ.slerpQuaternions(a.q, b.q, k); return true; }
  }
  return false;
}
