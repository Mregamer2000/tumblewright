
/* ============================================================================
   6. PLAYERS (avatars, nameplates, character controller / prediction)
   ========================================================================== */
class Player {
  constructor(o) {
    this.id = o.id; this.name = o.name || 'Player'; this.color = o.color || '#ff9f43'; this.tier = o.tier || 'medium';
    this.idx = o.idx || 0; this.joinOrder = o.joinOrder || 0; this.isLocal = !!o.isLocal;
    this.hp = 100; this.dead = false; this.deadT = 0; this.seat = 0; this.weapon = 'physgun';
    this.pos = new V3(0, 0, 0); this.prevPos = new V3(); this.vel = new V3(); this.yaw = 0; this.pitch = 0;
    this.crouch = false; this.noclip = false; this.grounded = false;
    this.kills = 0; this.deaths = 0; this.ping = 0; this.muted = false; this.canEdit = false;
    this.held = new Set(); this.mv = { x: 0, y: 0 }; this.up = 0; this.grab = null; this.beamEnd = null; this.firing = false;
    this.buf = []; this.lastInputT = now(); this.walkPhase = 0; this.renderPos = new V3(); this.renderYaw = 0;
    this.avatar = null; this.plate = null; this.body = null; this.col = null;
  }
}
// where the cushion is (height above the seat's centre) and which way you face: vehicle seats face -Z, furniture +Z
const SIT_POSE = { seat: [0.07, 0], chair: [0.025, Math.PI], couch: [0.02, Math.PI] };
const Players = {
  map: new Map(), local: null, cc: null,
  init() {
    const cc = this.cc = Phys.world.createCharacterController(0.02);
    cc.setUp({ x: 0, y: 1, z: 0 }); cc.setMaxSlopeClimbAngle(50 * Math.PI / 180); cc.setMinSlopeSlideAngle(60 * Math.PI / 180);
    cc.enableAutostep(0.45, 0.15, true); cc.enableSnapToGround(0.35); cc.setApplyImpulsesToDynamicBodies(true); cc.setCharacterMass(1.2); cc.setSlideEnabled(true);
  },
  add(o) {
    let p = this.map.get(o.id);
    if (!p) { p = new Player(o); this.map.set(o.id, p); this.makeBody(p); this.makeAvatar(p); this.makePlate(p); }
    else { p.name = o.name ?? p.name; p.color = o.color ?? p.color; p.tier = o.tier ?? p.tier; if (o.idx != null) p.idx = o.idx; if (o.joinOrder != null) p.joinOrder = o.joinOrder; this.refreshLook(p); }
    if (o.canEdit != null) p.canEdit = o.canEdit; if (o.muted != null) p.muted = o.muted;
    if (o.kills != null) p.kills = o.kills; if (o.deaths != null) p.deaths = o.deaths;
    if (o.isLocal) { p.isLocal = true; this.local = p; }
    if (p.avatar) p.avatar.visible = !p.isLocal;
    return p;
  },
  remove(id) {
    const p = this.map.get(id); if (!p) return;
    if (p.body) { Phys.colMap.delete(p.col.handle); Phys.world.removeRigidBody(p.body); Phys.qDirty = true; }
    if (p.avatar) R.scene.remove(p.avatar);
    if (p.plate) p.plate.remove();
    this.map.delete(id);
    if (this.local === p) this.local = null;
  },
  clearRemote() { for (const id of [...this.map.keys()]) if (!this.map.get(id).isLocal) this.remove(id); },
  byIdx(i) { for (const p of this.map.values()) if (p.idx === i) return p; return null; },
  makeBody(p) {
    p.body = Phys.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.pos.x, p.pos.y + CFG.capHalf + CFG.capR, p.pos.z));
    p.col = Phys.world.createCollider(RAPIER.ColliderDesc.capsule(CFG.capHalf, CFG.capR).setFriction(0.0), p.body);
    Phys.colMap.set(p.col.handle, 'p:' + p.id);
  },
  makeAvatar(p) {
    if (Models.has('avatar')) {
      const g = Models.instance('avatar', 'plastic', p.color);
      const blob = new THREE.Mesh(Geo.get('av_blob', () => new THREE.CircleGeometry(0.42, 24).rotateX(-Math.PI / 2)), Players.blobMat || (Players.blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })));
      Players.blobMat.userData.outlineParameters = { visible: false }; blob.position.y = 0.03; blob.name = 'blob'; blob.renderOrder = 1;
      g.add(blob);
      p.avatar = g; g.visible = !p.isLocal; R.scene.add(g);
      return;
    }
    const g = new THREE.Group();
    const torso = matMesh(Geo.get('av_t', () => new THREE.CapsuleGeometry(0.27, 0.5, 6, 16)), 'plastic', p.color); torso.position.y = 1.08;
    const head = matMesh(Geo.get('av_h', () => new THREE.SphereGeometry(0.21, 24, 16)), 'plastic', p.color); head.position.y = 1.62;
    const visor = matMesh(Geo.get('av_v', () => new RoundedBoxGeometry(0.3, 0.13, 0.12, 2, 0.04)), 'metal', '#1b1f27'); visor.position.set(0, 1.64, -0.15);
    const pack = matMesh(Geo.get('av_p', () => new RoundedBoxGeometry(0.34, 0.4, 0.16, 2, 0.04)), 'plastic', '#2a2c31'); pack.position.set(0, 1.12, 0.26);
    const legL = matMesh(Geo.get('av_l', () => new THREE.CapsuleGeometry(0.09, 0.42, 4, 10).translate(0, -0.3, 0)), 'plastic', '#2a2c31'); legL.position.set(-0.12, 0.66, 0);
    const legR = legL.clone(); legR.position.x = 0.12;
    const gun = matMesh(Geo.get('av_g', () => new RoundedBoxGeometry(0.1, 0.12, 0.42, 2, 0.02)), 'metal', '#5b6270'); gun.position.set(0.26, 1.18, -0.3);
    head.name = 'head'; legL.name = 'legL'; legR.name = 'legR'; gun.name = 'gun'; torso.name = 'torso';
    // soft blob shadow so players stay grounded on the Low (no shadow-map) tier
    const blob = new THREE.Mesh(Geo.get('av_blob', () => new THREE.CircleGeometry(0.42, 24).rotateX(-Math.PI / 2)), Players.blobMat || (Players.blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })));
    Players.blobMat.userData.outlineParameters = { visible: false }; blob.position.y = 0.03; blob.name = 'blob'; blob.renderOrder = 1;
    g.add(torso, head, visor, pack, legL, legR, gun, blob);
    p.avatar = g; g.visible = !p.isLocal; R.scene.add(g);
  },
  refreshLook(p) {
    if (!p.avatar) return;
    for (const n of ['torso', 'head', 'legL', 'legR']) { const m = p.avatar.getObjectByName(n); if (m && (n !== 'head' || !m.parent || m.parent.name !== 'torso')) Models.recolor(m, 'plastic', n.startsWith('leg') && !Models.has('avatar') ? '#2a2c31' : p.color); }
    this.updatePlate(p, true);
  },
  makePlate(p) {
    const el = h('div', { class: 'nameplate' }); el.innerHTML = '<div class="nm"></div><div class="hb"><i></i></div>';
    $('#nameplates').append(el); p.plate = el; this.updatePlate(p, true);
  },
  updatePlate(p, full) {
    if (!p.plate) return;
    if (full || p._plateKey !== p.name + p.tier + p.color + (Net.hostId === p.id) + p.muted) {
      p._plateKey = p.name + p.tier + p.color + (Net.hostId === p.id) + p.muted;
      p.plate.querySelector('.nm').innerHTML = `${Net.hostId === p.id ? '👑' : ''}<span style="color:${esc(p.color)}">${esc(p.name)}</span>${tierBadge(p.tier)}${p.muted ? '🔇' : ''}`;
    }
    const hb = p.plate.querySelector('.hb i'); hb.style.width = p.hp + '%'; hb.style.background = p.hp > 50 ? '#4ade80' : p.hp > 25 ? '#fbbf24' : '#ef4444';
  },
  eyePos(p, out) { return out.set(p.renderPos.x, p.renderPos.y + (p.crouch ? CFG.eye - 0.5 : CFG.eye), p.renderPos.z); },
  aimDir(p, out) { const cp = Math.cos(p.pitch); return out.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp); },
  // ---- local movement (client-side prediction; host validates) ------------
  simLocal(p, dt, inp) {
    p.prevPos.copy(p.pos);
    if (p.dead || p.seat) { p.vel.set(0, 0, 0); return; }
    const fwdX = -Math.sin(p.yaw), fwdZ = -Math.cos(p.yaw), rX = Math.cos(p.yaw), rZ = -Math.sin(p.yaw);
    if (p.noclip) {
      const sp = (inp.sprint ? 22 : 9) * clamp(Settings.flySpeed || 1, 0.25, 5) * dt, cp = Math.cos(p.pitch), sy = Math.sin(p.pitch);   // Settings.flySpeed: wheel / settings
      p.pos.x += (fwdX * cp * inp.my + rX * inp.mx) * sp; p.pos.z += (fwdZ * cp * inp.my + rZ * inp.mx) * sp;
      p.pos.y += (sy * inp.my + inp.up) * sp; p.vel.set(0, 0, 0);
      p.body.setNextKinematicTranslation({ x: p.pos.x, y: p.pos.y + CFG.capHalf + CFG.capR, z: p.pos.z });
      return;
    }
    const speed = (inp.sprint ? CFG.sprint : CFG.walk) * (p.crouch ? CFG.crouchMul : 1);
    const wx = (fwdX * inp.my + rX * inp.mx) * speed, wz = (fwdZ * inp.my + rZ * inp.mx) * speed;
    const acc = p.grounded ? 14 : 3.5, k = 1 - Math.exp(-acc * dt);
    p.vel.x += (wx - p.vel.x) * k; p.vel.z += (wz - p.vel.z) * k;
    p.vel.y -= CFG.gravity * dt;
    if (p.grounded && inp.jump) { p.vel.y = CFG.jump; p.grounded = false; Audio.play('cloth', 0.7); }
    if (p.kb) { p.vel.add(p.kb); p.kb = null; }
    const des = { x: p.vel.x * dt, y: p.vel.y * dt, z: p.vel.z * dt }, vy0 = p.vel.y;
    Phys.sync(); this.cc.computeColliderMovement(p.col, des, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const mv = this.cc.computedMovement();
    const wasGrounded = p.grounded;
    p.grounded = this.cc.computedGrounded();
    p.pos.x += mv.x; p.pos.y += mv.y; p.pos.z += mv.z;
    if (p.grounded && !wasGrounded && vy0 < -2.5) {   // landed on a trampoline: bounce (hold jump to gain height)
      const h = Phys.cast(_v1.set(p.pos.x, p.pos.y + 0.1, p.pos.z), _v2.set(0, -1, 0), 0.4, p.body);
      const e = h && typeof h.id === 'number' ? World.ents.get(h.id) : null;
      if (e && e.d.bnc) { p.vel.y = Math.min(24, -vy0 * 0.88 + (inp.jump ? 3.2 : 0)); p.grounded = false; Audio.at('boing', p.pos); }
    }
    if (p.grounded && p.vel.y < 0) p.vel.y = wasGrounded ? -0.5 : 0;
    if (des.y > 0 && mv.y < des.y * 0.5) p.vel.y = Math.min(p.vel.y, 0);
    p.body.setNextKinematicTranslation({ x: p.pos.x, y: p.pos.y + CFG.capHalf + CFG.capR, z: p.pos.z });
    if (p.pos.y < CFG.killY) Game.localFellOut();
  },
  setPos(p, v) { p.pos.copy(v); p.prevPos.copy(v); p.renderPos.copy(v); p.vel.set(0, 0, 0); if (p.body) p.body.setTranslation({ x: v.x, y: v.y + CFG.capHalf + CFG.capR, z: v.z }, true); },
  // remote players: kinematic capsule follows reported/interpolated position
  driveRemote(p, pos) {
    if (!p.body) return;
    p.col.setEnabled(!p.dead && !p.seat && !p.noclip);
    p.body.setNextKinematicTranslation({ x: pos.x, y: pos.y + CFG.capHalf + CFG.capR, z: pos.z });
  },
  updateAvatar(p, dt) {
    const a = p.avatar; if (!a) return;
    const se = p.seat ? World.ents.get(p.seat) : null, seated = !!(se && se.mesh);
    a.visible = (!p.isLocal || seated) && !p.dead;   // your own body shows in the third-person vehicle camera
    if (!a.visible) { if (p.plate && !p.isLocal) p.plate.style.display = 'none'; return; }
    a.getObjectByName('blob').visible = R.path === 'ps1' && !seated;
    const head = a.getObjectByName('head'); head.rotation.x = p.pitch * 0.6;
    const gun = a.getObjectByName('gun'); gun.visible = !seated;
    if (seated) {   // sitting on the seat (hips on the cushion), turned and tilted with the vehicle, legs forward
      const sp = SIT_POSE[se.d.vis] || SIT_POSE[se.d.sh && se.d.sh.t] || SIT_POSE.seat;
      a.quaternion.copy(se.mesh.quaternion); if (sp[1]) a.quaternion.multiply(_q3.setFromAxisAngle(UP, sp[1]));
      a.position.copy(_v1.set(0, sp[0] + 0.08 - 0.72, 0.03).applyQuaternion(a.quaternion).add(se.mesh.position));
      a.getObjectByName('legL').rotation.x = 1.4; a.getObjectByName('legR').rotation.x = 1.4;
      return;
    }
    a.position.copy(p.renderPos); if (p.crouch) a.position.y -= 0.3;
    a.rotation.set(0, p.renderYaw, 0);
    const spd = Math.hypot(p.vel.x, p.vel.z);
    p.walkPhase += dt * spd * 2.2;
    const sw = Math.sin(p.walkPhase) * Math.min(1, spd / 4) * 0.6;
    a.getObjectByName('legL').rotation.x = sw; a.getObjectByName('legR').rotation.x = -sw;
    gun.rotation.x = p.pitch;
    const wcol = { physgun: '#4dd0e1', toolgun: '#fed330', pistol: '#5b6270', rifle: '#3d4a32', grenade: '#3d4a32', crowbar: '#c0392b' }[p.weapon] || '#5b6270';
    if (gun.userData.w !== p.weapon) {
      gun.userData.w = p.weapon;
      const W = WEAPON_MODEL[p.weapon], mk = 'wp_' + ((W && W.model) || p.weapon);
      if (W && Models.has(mk) && Models.has('avatar')) {
        // swap in the held weapon's model (its first-person hand is hidden; the avatar has its own hands)
        if (gun.userData.wm) gun.remove(gun.userData.wm);
        else gun.traverse(o => { if (o.isMesh) o.visible = false; });
        const wm = Models.instance(mk, W.t, W.c), hand = wm.getObjectByName(mk + '_hand');
        if (hand) hand.visible = false;
        wm.position.set(0, 0.03, -0.12); gun.add(wm); gun.userData.wm = wm;
      } else Models.recolor(gun, 'metal', wcol);
    }
  },
  updatePlates() {
    const cam = R.camera, W = innerWidth, H = innerHeight;
    for (const p of this.map.values()) {
      if (!p.plate) continue;
      if (p.isLocal || p.dead) { p.plate.style.display = 'none'; continue; }
      _v1.copy(p.renderPos); _v1.y += 2.05;
      const dist = _v1.distanceTo(cam.position);
      _v1.project(cam);
      if (_v1.z > 1 || dist > 180) { p.plate.style.display = 'none'; continue; }
      p.plate.style.display = '';
      const sc = clamp(1.2 - dist / 120, 0.6, 1);
      p.plate.style.transform = `translate(${(_v1.x * 0.5 + 0.5) * W}px,${(-_v1.y * 0.5 + 0.5) * H}px) translate(-50%,-100%) scale(${sc})`;
      p.plate.style.left = '0'; p.plate.style.top = '0';
      this.updatePlate(p);
    }
  },
};

/* ---------------------------------------------------------------------------
   Prefabs & spawn catalog. Prefab format == dupe format:
   { ents:[desc with id = local index (1..n)], cons:[{..., a/b local index, 0 = world}], groups:[{..., parts:[local]}] }
   positions are relative to the spawn point, "forward" is -Z.
   ------------------------------------------------------------------------- */
function weldFrames(pA, qA, pB, qB) {
  const iq = qA.clone().invert();
  return { pa: a3(pB.clone().sub(pA).applyQuaternion(iq)), fa: a4(iq.clone().multiply(qB)), pb: [0, 0, 0], fb: [0, 0, 0, 1] };
}
function single(d) { return { ents: [Object.assign({ id: 1, p: [0, 0, 0], q: [0, 0, 0, 1] }, d)], cons: [], groups: [] }; }
// ---- NPC types & randomized appearance -------------------------------------
const NPC_SKIN = ['#f2c6a0', '#e8b48c', '#d49a6a', '#b07a4f', '#8a5a3a', '#5e3b26'];
const NPC_HAIR = ['#1f1a17', '#3b2716', '#5a3a1f', '#8a5a2b', '#c9a15e', '#e3cf8e', '#8c8c8c', '#a33b22'];
const NPC_SHIRT = ['#4b7bec', '#e74c3c', '#27ae60', '#f39c12', '#8e44ad', '#16a085', '#ecf0f1', '#34495e', '#e84393', '#fdcb6e'];
const NPC_PANTS = ['#2d3436', '#34495e', '#3b5b8c', '#6d5a45', '#a4907c', '#1e272e'];
const pickOne = a => a[(Math.random() * a.length) | 0];
const NPC_TYPES = {
  // fac: civ (flees trouble), law (armed; fights raiders, zombies and anyone who attacks civilians or police),
  //      raider (armed; hostile to everyone else), mutant (zombies; attack everyone, victims turn)
  citizen: { name: 'Citizen', brain: 'wander', fac: 'civ' }, worker: { name: 'Worker', brain: 'wander', fac: 'civ' }, scientist: { name: 'Scientist', brain: 'idle', fac: 'civ' },
  jogger: { name: 'Jogger', brain: 'jog', fac: 'civ' }, prisoner: { name: 'Prisoner', brain: 'wander', fac: 'civ' }, zombie: { name: 'Zombie', brain: 'zombie', fac: 'mutant' },
  police: { name: 'Police Officer', brain: 'guard', fac: 'law', gun: 'pistol' }, raider: { name: 'Raider', brain: 'raider', fac: 'raider', gun: 'rifle' },
  dummy: { name: 'Crash Test Dummy', brain: 'none' }, ragdoll: { name: 'Ragdoll', brain: 'none' },
};
function npcLook(type) {
  const L = { skin: pickOne(NPC_SKIN), shirt: pickOne(NPC_SHIRT), pants: pickOne(NPC_PANTS), hair: pickOne(NPC_HAIR), head: pickOne(['rd_head', 'rd_head', 'rd_head_long', 'rd_head_bald']), torso: 'rd_torso', hat: null, torso2: null, shorts: false };
  switch (type) {
    case 'worker': L.head = 'rd_head_hat'; L.hat = pickOne(['#fed330', '#ff9f43', '#f5f6fa']); L.torso = 'rd_torso_vest'; L.torso2 = pickOne(['#ff7f11', '#b8e000', '#ffd32a']); L.shirt = pickOne(['#7f8c8d', '#2c3e50', '#3b5b8c']); L.pants = '#2f3b52'; break;
    case 'scientist': L.head = 'rd_head_glasses'; L.torso = 'rd_torso_coat'; L.shirt = '#eef1f4'; L.torso2 = pickOne(['#74b9ff', '#dfe6e9', '#ffeaa7']); L.pants = pickOne(['#2d3436', '#34495e']); break;
    case 'jogger': L.head = pickOne(['rd_head_long', 'rd_head']); L.shirt = pickOne(['#ff4757', '#2ed573', '#1e90ff', '#ffa502']); L.pants = '#222831'; L.shorts = true; break;
    case 'zombie': L.head = 'rd_head_zombie'; L.skin = pickOne(['#8fa37a', '#9aa98a', '#7d8f6b']); L.hair = '#3b3226'; L.shirt = pickOne(['#6b5b4b', '#5a6b5a', '#6e5050']); L.pants = pickOne(['#3d3a33', '#403a45']); break;
    case 'prisoner': L.shirt = L.pants = pickOne(['#e0701f', '#d8661a', '#e87d2b']); L.head = pickOne(['rd_head', 'rd_head_bald', 'rd_head']); break;
    case 'police': L.head = 'rd_head_cap'; L.hat = '#1b2438'; L.torso = 'rd_torso_police'; L.shirt = pickOne(['#2c4a7a', '#34507e']); L.torso2 = '#d9b44a'; L.pants = '#1c2433'; break;
    case 'raider': L.head = 'rd_head_mask'; L.hat = pickOne(['#1d1f22', '#2b2d27', '#3a3326']); L.torso = 'rd_torso_armor'; L.shirt = pickOne(['#3b4231', '#2e3033', '#4a4238']); L.torso2 = pickOne(['#26282b', '#3c4232', '#51493a']); L.pants = pickOne(['#2a2c2e', '#3a3c30']); break;
    case 'dummy': L.head = 'rd_head_dummy'; L.skin = L.shirt = '#fed330'; L.pants = '#2d3436'; L.hat = '#f5f6fa'; break;
  }
  return L;
}
// Ragdoll joints: name -> [parent part, child part, anchor on parent, anchor on child, limits].
// Shared by the prefab (joint creation) and the gore system (which joint a destroyed part tears off at, stump positions).
const NPC_JOINTS = {
  waist: [0, 1, [0, 0.1, 0], [0, -0.25, 0], [-0.5, 0.7]], neck: [1, 2, [0, 0.25, 0], [0, -0.14, 0], [-0.6, 0.5]],
  shL: [1, 3, [-0.25, 0.2, 0], [0, 0.14, 0], [-2.8, 0.9]], shR: [1, 4, [0.25, 0.2, 0], [0, 0.14, 0], [-2.8, 0.9]],
  elL: [3, 5, [0, -0.14, 0], [0, 0.14, 0], [-2.4, 0]], elR: [4, 6, [0, -0.14, 0], [0, 0.14, 0], [-2.4, 0]],
  hipL: [0, 7, [-0.1, -0.1, 0], [0, 0.2, 0], [-1.7, 0.5]], hipR: [0, 8, [0.1, -0.1, 0], [0, 0.2, 0], [-1.7, 0.5]],
  knL: [7, 9, [0, -0.2, 0], [0, 0.21, 0], [0, 2.4]], knR: [8, 10, [0, -0.2, 0], [0, 0.21, 0], [0, 2.4]],
};
// per-part health (pelvis, torso, head, upper arms, forearms, thighs, shins), how much of a hit reaches overall health,
// and which joint a part tears off at when it's destroyed
const PART_HP = [110, 140, 70, 55, 55, 45, 45, 80, 80, 65, 65];
const PART_DMG = [1.0, 1.2, 2.2, 0.55, 0.55, 0.45, 0.45, 0.7, 0.7, 0.55, 0.55];
const PART_JOINT = [null, 'waist', 'neck', 'shL', 'shR', 'elL', 'elR', 'hipL', 'hipR', 'knL', 'knR'];
const JOINT_PART = { waist: 1, neck: 2, shL: 3, shR: 4, elL: 5, elR: 6, hipL: 7, hipR: 8, knL: 9, knR: 10 };
// Articulated ragdoll: 11 bodies, hinge joints with limits (motor-driven by the NPC brain).
// Part order (group.parts): pelvis, torso, head, upperArmL/R, forearmL/R, thighL/R, shinL/R.
function npcPrefab(type, look) {
  const T = NPC_TYPES[type] || NPC_TYPES.citizen, L = look || npcLook(type);
  const P = (id, sh, p, c, vis, extra) => Object.assign({ id, k: 'part', sh, m: 'plastic', c, p, q: [0, 0, 0, 1], den: 1.4, vis }, extra || {});
  const ents = [
    P(1, { t: 'box', s: [0.34, 0.2, 0.2] }, [0, 1.0, 0], L.pants, 'rd_pelvis'),
    P(2, { t: 'box', s: [0.38, 0.46, 0.22] }, [0, 1.35, 0], L.shirt, L.torso, L.torso2 ? { c2: L.torso2 } : null),
    P(3, { t: 'ball', r: 0.13 }, [0, 1.74, 0], L.skin, L.head, { hc: L.hair, c2: L.hat || undefined }),
    P(4, { t: 'cap', r: 0.06, h: 0.2 }, [-0.25, 1.41, 0], L.shirt, 'rd_uarm'), P(5, { t: 'cap', r: 0.06, h: 0.2 }, [0.25, 1.41, 0], L.shirt, 'rd_uarm'),
    P(6, { t: 'cap', r: 0.05, h: 0.2 }, [-0.25, 1.13, 0], L.skin, 'rd_farm'), P(7, { t: 'cap', r: 0.05, h: 0.2 }, [0.25, 1.13, 0], L.skin, 'rd_farm', T.gun ? { wpn: T.gun } : null),
    P(8, { t: 'cap', r: 0.08, h: 0.24 }, [-0.1, 0.7, 0], L.pants, 'rd_thigh'), P(9, { t: 'cap', r: 0.08, h: 0.24 }, [0.1, 0.7, 0], L.pants, 'rd_thigh'),
    P(10, { t: 'cap', r: 0.065, h: 0.26 }, [-0.1, 0.29, 0], L.shorts ? L.skin : L.pants, 'rd_shin'), P(11, { t: 'cap', r: 0.065, h: 0.26 }, [0.1, 0.29, 0], L.shorts ? L.skin : L.pants, 'rd_shin'),
  ];
  const X = [-1, 0, 0];   // bodies face -Z: turning about -X makes +knee bend back and -shoulder raise the arm forward
  const C = (a, b, pa, pb, lim) => ({ a, b, t: 'hinge', pa, pb, ax: X, lim });
  const cons = Object.values(NPC_JOINTS).map(([a, b, pa, pb, lim]) => C(a + 1, b + 1, pa, pb, lim));   // part index -> local id
  cons.forEach((c, i) => c.id = 100 + i);
  return { ents, cons, groups: [{ id: 1, t: 'npc', parts: ents.map(e => e.id), hp: 100, alive: 1, brain: T.brain, kind: type, n: T.name, fac: T.fac, gun: T.gun }] };
}
function ragdollPrefab(color, brain, name) { const pf = npcPrefab('ragdoll'); pf.groups[0].brain = brain || 'none'; pf.groups[0].n = name || 'Ragdoll'; if (color) pf.ents[2].c = color; return pf; }
// ---- raycast vehicles ---------------------------------------------------------------
// The chassis is ONE body with a compound collider ('multi' boxes: [w, h, d, x, y, z, densityMul]).
// Wheels are simulated by a Rapier raycast vehicle controller (suspension, steering, tyre grip) and
// drawn on the chassis. w: [x, y, z, steers] = wheel centre at rest in chassis space (forward = -Z).
// Tuning: accel / brake in m/s^2, top / rev in m/s, steer = max lock (rad), slip = tyre grip limit.
const VEH = {
  car: {
    name: 'Sports Car', c: '#d63031', m: 'metal', den: 1, r: 0.42, wd: 0.3, rest: 0.26, stiff: 58, damp: [4.2, 5.2], slip: 3.2, grip: 1.0,
    accel: 12, top: 36, rev: 9, brake: 10, steer: 0.5, drive: 'rwd', boost: 1.6, cam: [7, 1.5],
    col: [[1.52, 0.5, 3.3, 0, 0.1, 0], [1.0, 0.55, 0.12, 0, 0.62, 0.66], [1.3, 0.1, 2.6, 0, -0.1, 0, 10]],
    w: [[-0.88, -0.2, -0.98, 1], [0.88, -0.2, -0.98, 1], [-0.88, -0.2, 1.0, 0], [0.88, -0.2, 1.0, 0]], seats: [[0, 0.23, 0.28]],
  },
  kart: {
    name: 'Go-Kart', c: '#fed330', m: 'plastic', den: 1.4, r: 0.27, wd: 0.22, rest: 0.12, stiff: 90, damp: [6, 7], slip: 4.2, grip: 1.1, sfall: 10,
    accel: 13, top: 26, rev: 7, brake: 12, steer: 0.62, drive: 'rwd', boost: 1.5, cam: [5, 1.1],
    col: [[1.0, 0.18, 1.9, 0, 0.03, -0.05], [0.8, 0.06, 1.6, 0, -0.03, 0, 10]],
    w: [[-0.64, -0.07, -0.66, 1], [0.64, -0.07, -0.66, 1], [-0.64, -0.07, 0.68, 0], [0.64, -0.07, 0.68, 0]], seats: [[0, 0.13, 0.25, '#fed330']],
  },
  pickup: {
    name: 'Pickup Truck', c: '#2e86de', m: 'metal', den: 1, r: 0.45, wd: 0.32, rest: 0.34, stiff: 45, damp: [3.8, 4.6], slip: 2.9, grip: 1.0,
    accel: 10, top: 30, rev: 8, brake: 9, steer: 0.5, drive: 'awd', boost: 1.5, cam: [8.5, 1.9],
    col: [[1.9, 0.66, 4.4, 0, 0.11, 0], [1.85, 0.64, 1.3, 0, 0.74, 0.1], [1.6, 0.1, 3.6, 0, -0.12, 0, 10]],
    w: [[-0.86, -0.36, -1.42, 1], [0.86, -0.36, -1.42, 1], [-0.86, -0.36, 1.3, 0], [0.86, -0.36, 1.3, 0]],
    seats: [[-0.42, 0.25, 0.2], [0.42, 0.25, 0.2], [-0.45, 0.53, 1.35], [0.45, 0.53, 1.35]],
  },
  monster: {
    name: 'Monster Truck', c: '#8e44ad', m: 'metal', den: 1, r: 0.8, wd: 0.6, rest: 0.6, stiff: 36, damp: [3.2, 3.8], slip: 3.4, grip: 1.1,
    accel: 10, top: 28, rev: 8, brake: 8, steer: 0.48, drive: 'awd', boost: 1.5, cam: [10.5, 2.6],
    col: [[2.0, 0.6, 4.1, 0, 0.32, 0], [1.9, 0.68, 1.4, 0, 0.94, 0.11], [1.2, 0.3, 3.6, 0, -0.2, 0, 10]],
    w: [[-1.22, -0.55, -1.4, 1], [1.22, -0.55, -1.4, 1], [-1.22, -0.55, 1.4, 0], [1.22, -0.55, 1.4, 0]], seats: [[0, 0.72, 0.2]],
    rearSteer: 1,
  },
  buggy: {
    name: 'Dune Buggy', c: '#ff9f43', m: 'metal', den: 0.9, r: 0.42, wd: 0.34, rest: 0.45, stiff: 34, damp: [3.0, 3.6], slip: 2.8, grip: 0.95,
    accel: 13, top: 33, rev: 8, brake: 9, steer: 0.55, drive: 'rwd', boost: 1.6, cam: [7, 1.6],
    col: [[1.3, 0.35, 3.1, 0, -0.05, -0.05], [1.1, 0.08, 0.8, 0, 0.96, 0.15], [1.0, 0.08, 2.2, 0, -0.18, 0, 10]],
    w: [[-0.86, -0.26, -1.15, 1], [0.86, -0.26, -1.15, 1], [-0.86, -0.26, 1.1, 0], [0.86, -0.26, 1.1, 0]], seats: [[0, -0.08, 0.1]],
  },
};
function rayVehiclePrefab(kind) {
  const V = VEH[kind], ents = [], cons = [];
  const ch = { id: 1, k: 'prop', sh: { t: 'multi', b: V.col }, m: V.m, c: V.c, p: [0, 0, 0], q: [0, 0, 0, 1], veh: kind, vis: kind, n: V.name, den: V.den };
  ents.push(ch);
  V.seats.forEach((st, i) => {
    const d = { id: 2 + i, k: 'prop', sh: { t: 'seat' }, m: 'plastic', c: st[3] || '#2a2c31', p: [st[0], st[1], st[2]], q: [0, 0, 0, 1], seat: 1 };
    if (i) d.pas = 1;   // passenger seats don't drive
    ents.push(d);
    cons.push(Object.assign({ id: 500 + i, t: 'weld', a: 1, b: d.id }, weldFrames(new V3(), new QT(), new V3().fromArray(d.p), new QT())));
  });
  return { ents, cons, groups: [] };
}
function vehiclePrefab(kind) {
  const ents = [], cons = [];
  let n = 0;
  const E = (d) => { d.id = ++n; d.q = d.q || [0, 0, 0, 1]; d.k = d.k || 'prop'; ents.push(d); return d; };
  const weld = (a, b) => { const A = ents[a.id - 1], B = ents[b.id - 1]; const f = weldFrames(new V3().fromArray(A.p), new QT().fromArray(A.q), new V3().fromArray(B.p), new QT().fromArray(B.q)); cons.push(Object.assign({ id: 500 + cons.length, t: 'weld', a: a.id, b: b.id }, f)); };
  const wheel = (ch, pos, r, w) => {
    const side = Math.sign(pos[0]) || 1;
    const wd = E({ sh: { t: 'wheel', r, w, ax: [1, 0, 0] }, m: 'rubber', c: '#26282d', p: pos, wheel: 1 });
    cons.push({ id: 500 + cons.length, t: 'wheel', a: ch.id, b: wd.id, pa: [pos[0] - ch.p[0], pos[1] - ch.p[1], pos[2] - ch.p[2]], pb: [0, 0, 0], ax: [1, 0, 0], side });
  };
  if (kind === 'car') {
    const body = '#d63031';
    const ch = E({ sh: { t: 'box', s: [1.5, 0.3, 2.9] }, m: 'metal', c: body, p: [0, 0.62, 0], n: 'Car', vis: 'car' });
    const hood = E({ sh: { t: 'box', s: [1.44, 0.3, 0.85] }, m: 'metal', c: body, p: [0, 0.92, -0.98] });
    const trunk = E({ sh: { t: 'box', s: [1.44, 0.34, 0.6] }, m: 'metal', c: body, p: [0, 0.94, 1.12] });
    const wind = E({ sh: { t: 'box', s: [1.36, 0.62, 0.05] }, m: 'glass', c: null, p: [0, 1.28, -0.42], q: a4(new QT().setFromEuler(new THREE.Euler(0.55, 0, 0))) });
    const bump = E({ sh: { t: 'box', s: [1.56, 0.16, 0.14] }, m: 'metal', c: '#c9ced6', p: [0, 0.6, -1.5] });
    const seat = E({ sh: { t: 'seat' }, m: 'plastic', c: '#2a2c31', p: [0, 0.85, 0.28], seat: 1 });
    const lamp1 = E({ sh: { t: 'box', s: [0.3, 0.1, 0.04] }, m: 'neon', c: '#fff3c4', p: [-0.5, 0.92, -1.42] });
    const lamp2 = E({ sh: { t: 'box', s: [0.3, 0.1, 0.04] }, m: 'neon', c: '#fff3c4', p: [0.5, 0.92, -1.42] });
    for (const x of [hood, trunk, wind, bump, lamp1, lamp2]) x.vis = 'none';   // their shapes are part of the car model
    for (const x of [hood, trunk, wind, bump, seat, lamp1, lamp2]) weld(ch, x);
    for (const [x, z] of [[-0.93, -0.98], [0.93, -0.98], [-0.93, 1.0], [0.93, 1.0]]) wheel(ch, [x, 0.42, z], 0.42, 0.3);
  } else if (kind === 'kart') {
    const ch = E({ sh: { t: 'box', s: [1.0, 0.12, 1.8] }, m: 'plastic', c: '#fed330', p: [0, 0.34, 0], n: 'Kart', vis: 'kart' });
    const seat = E({ sh: { t: 'seat' }, m: 'plastic', c: '#fed330', p: [0, 0.47, 0.25], seat: 1 });
    const nose = E({ sh: { t: 'box', s: [0.9, 0.18, 0.4] }, m: 'plastic', c: '#fed330', p: [0, 0.48, -0.78], vis: 'none' });
    weld(ch, seat); weld(ch, nose);
    for (const [x, z] of [[-0.64, -0.66], [0.64, -0.66], [-0.64, 0.68], [0.64, 0.68]]) wheel(ch, [x, 0.27, z], 0.27, 0.22);
  } else if (kind === 'sled') {
    const ch = E({ sh: { t: 'box', s: [1.2, 0.1, 2.4] }, m: 'metal', c: '#45aaf2', p: [0, 0.2, 0], n: 'Rocket Sled', vis: 'sled' });
    ch.thr = [{ id: 1, p: [-0.4, 0.05, 1.2], d: [0, 0, -1], f: 14, key: 'Space', pad: 'Pad0' }, { id: 2, p: [0.4, 0.05, 1.2], d: [0, 0, -1], f: 14, key: 'Space', pad: 'Pad0' }];
    const seat = E({ sh: { t: 'seat' }, m: 'plastic', c: '#2a2c31', p: [0, 0.32, 0.2], seat: 1 });
    const fin = E({ sh: { t: 'box', s: [0.06, 0.5, 0.5] }, m: 'metal', c: '#ff5a5f', p: [0, 0.5, 1.0], vis: 'none' });
    weld(ch, seat); weld(ch, fin);
  } else if (kind === 'catapult') {
    const base = E({ sh: { t: 'box', s: [1.4, 0.3, 2.4] }, m: 'wood', p: [0, 0.15, 0], n: 'Catapult' });
    const arm = E({ sh: { t: 'box', s: [0.2, 0.15, 2.6] }, m: 'wood', p: [0, 0.9, 0.3] });
    const cup = E({ sh: { t: 'box', s: [0.6, 0.1, 0.6] }, m: 'wood', p: [0, 0.95, -0.95] });
    const post = E({ sh: { t: 'box', s: [0.2, 0.6, 0.2] }, m: 'wood', p: [0, 0.55, 0.3] });
    const ball = E({ sh: { t: 'ball', r: 0.25 }, m: 'concrete', p: [0, 1.3, -0.95] });
    weld(base, post); weld(arm, cup);
    cons.push({ id: 500 + cons.length, t: 'hinge', a: post.id, b: arm.id, pa: [0, 0.35, 0], pb: [0, -0.0, 0], ax: [1, 0, 0] });
    cons.push({ id: 500 + cons.length, t: 'spring', a: base.id, b: arm.id, pa: [0, 0.15, 1.1], pb: [0, 0, 1.25], len: 0.1, st: 90, dm: 1 });
    void ball;
  }
  return { ents, cons, groups: [] };
}
// ---- multi-object sets ------------------------------------------------------
function multi(list) { return { ents: list.map((d, i) => Object.assign({ id: i + 1, q: [0, 0, 0, 1] }, d)), cons: [], groups: [] }; }
const PIN = { k: 'prop', sh: { t: 'cyl', r: 0.06, h: 0.38 }, m: 'plastic', c: '#f5f5f5', vis: 'pin', den: 1.2, n: 'Bowling Pin' };
function pinSet() {   // classic 10-pin triangle, head pin toward the player
  const L = [];
  for (let row = 0; row < 4; row++) for (let i = 0; i <= row; i++) L.push(Object.assign({}, PIN, { p: [(i - row / 2) * 0.3, 0.19, -row * 0.26] }));
  return multi(L);
}
function brickWall() {   // running bond, 6 courses
  const L = [];
  for (let r = 0; r < 6; r++) for (let i = 0; i < (r % 2 ? 5 : 6); i++)
    L.push({ k: 'prop', sh: { t: 'box', s: [0.4, 0.2, 0.2] }, m: 'concrete', c: ['#b5523b', '#a84a35', '#bf5d43'][(r + i) % 3], p: [(i - 2.5) * 0.41 + (r % 2 ? 0.205 : 0), 0.1 + r * 0.201, 0] });
  return multi(L);
}
function dominoRun() {   // S-curve away from the player
  const L = [];
  for (let i = 0; i < 26; i++) {
    const t = i / 25, x = Math.sin(t * Math.PI * 2) * 1.6, z = -t * 9;
    const yaw = Math.atan2(-Math.cos(t * Math.PI * 2) * 1.6 * Math.PI * 2, 9);
    L.push({ k: 'prop', sh: { t: 'box', s: [0.5, 1.0, 0.12] }, m: 'plastic', c: i % 2 ? '#2a2c31' : '#f5f5f5', p: [x, 0.5, z], q: a4(new QT().setFromAxisAngle(UP, yaw)) });
  }
  return multi(L);
}
const BALLOON_COLORS = ['#ff5a5f', '#fed330', '#45aaf2', '#26de81', '#a55eea', '#ff9f43', '#f368e0'];
const COUCH_COLORS = ['#7d6f8f', '#5a7d9a', '#8a5a44', '#4f6b4f', '#b5835a', '#6d7580'];
// ---- building pieces: walls, floors, stairs, doors, destructibles ----------------------------
// Structural pieces spawn frozen so they stay where you put them (physics gun + R unfreezes). Destructibles have hp:
// bullets chip them down, explosions break them outright, and they burst into debris (see Auth.shatter).
const BRICK = '#9c4f3c', CONC = '#b9bcc0';
const door = (frame, doorPos, hinge, n) => ({   // frame (frozen, multi boxes) + a hinged door panel; E opens / closes it
  ents: [
    Object.assign({ id: 1, k: 'prop', p: [0, 0, 0], q: [0, 0, 0, 1], fz: 1 }, frame),
    { id: 2, k: 'prop', sh: { t: 'multi', b: [[1.06, 2.16, 0.06, 0, 0, 0], [0.06, 0.06, 0.1, 0.4, 0, 0, 0.5]] }, m: 'wood', c: '#8a5a3a', p: doorPos, q: [0, 0, 0, 1], door: 1, n },
  ],
  cons: [{ id: 3, t: 'hinge', a: 1, b: 2, pa: hinge, pb: [-0.54, 0, 0], ax: [0, 1, 0], lim: [-1.9, 1.9], door: 1 }], groups: [],
});
const stairs = () => { const b = []; for (let i = 0; i < 8; i++) b.push([1.4, (i + 1) * 0.25, 0.35, 0, -1 + (i + 1) * 0.125, -1.225 + i * 0.35]); return b; };
const CATALOG = {
  building: [
    { key: 'b_wall', name: 'Wall', icon: '🧱', desc: '4 × 3 m concrete wall', pf: () => single({ k: 'prop', sh: { t: 'box', s: [4, 3, 0.2] }, m: 'concrete', c: CONC, fz: 1, n: 'Wall' }) },
    { key: 'wall_half', name: 'Half Wall', icon: '🧱', desc: '4 × 1.2 m', pf: () => single({ k: 'prop', sh: { t: 'box', s: [4, 1.2, 0.2] }, m: 'concrete', c: CONC, fz: 1, n: 'Half Wall' }) },
    { key: 'wall_window', name: 'Wall with Window', icon: '🪟', desc: 'The glass breaks', pf: () => ({ ents: [
      { id: 1, k: 'prop', sh: { t: 'multi', b: [[1.3, 3, 0.2, -1.35, 0, 0], [1.3, 3, 0.2, 1.35, 0, 0], [1.4, 1.0, 0.2, 0, -1.0, 0], [1.4, 0.6, 0.2, 0, 1.2, 0]] }, m: 'concrete', c: CONC, fz: 1, p: [0, 0, 0], q: [0, 0, 0, 1], n: 'Wall' },
      { id: 2, k: 'prop', sh: { t: 'box', s: [1.4, 1.4, 0.05] }, m: 'glass', brk: 'glass', fz: 1, p: [0, 0.2, 0], q: [0, 0, 0, 1], n: 'Window' }], cons: [], groups: [] }) },
    { key: 'wall_door', name: 'Wall with Door', icon: '🚪', desc: 'Press E on the door to open it', pf: () => door({ sh: { t: 'multi', b: [[1.45, 3, 0.2, -1.275, 0, 0], [1.45, 3, 0.2, 1.275, 0, 0], [1.1, 0.8, 0.2, 0, 1.1, 0]] }, m: 'concrete', c: CONC, n: 'Wall' }, [0, -0.41, 0], [-0.54, -0.41, 0], 'Door') },
    { key: 'door', name: 'Door', icon: '🚪', desc: 'Door in a frame. Press E to open it', pf: () => door({ sh: { t: 'multi', b: [[0.1, 2.3, 0.14, -0.6, 0, 0], [0.1, 2.3, 0.14, 0.6, 0, 0], [1.3, 0.1, 0.14, 0, 1.1, 0]] }, m: 'wood', c: '#5e4330', n: 'Door Frame' }, [0, -0.07, 0], [-0.54, -0.07, 0], 'Door') },
    { key: 'b_floor', name: 'Floor', icon: '⬜', desc: '4 × 4 m slab', pf: () => single({ k: 'prop', sh: { t: 'box', s: [4, 0.2, 4] }, m: 'concrete', c: '#a7aaae', fz: 1, n: 'Floor' }) },
    { key: 'stairs', name: 'Stairs', icon: '🪜', desc: '2 m rise, 8 steps', pf: () => single({ k: 'prop', sh: { t: 'multi', b: stairs() }, m: 'concrete', c: CONC, fz: 1, n: 'Stairs' }) },
    { key: 'b_pillar', name: 'Pillar', icon: '🏛️', desc: '3 m column', pf: () => single({ k: 'prop', sh: { t: 'box', s: [0.45, 3, 0.45] }, m: 'concrete', c: CONC, fz: 1, n: 'Pillar' }) },
    { key: 'fence', name: 'Wooden Fence', icon: '🚧', pf: () => single({ k: 'prop', sh: { t: 'multi', b: [[0.1, 1.1, 0.1, -0.95, 0, 0], [0.1, 1.1, 0.1, 0.95, 0, 0], [2, 0.1, 0.05, 0, 0.3, 0.05], [2, 0.1, 0.05, 0, -0.2, 0.05]] }, m: 'wood', c: '#7a5a3c', fz: 1, brk: 'wood', hp: 30, n: 'Fence' }) },
    { key: 'railing', name: 'Metal Railing', icon: '➖', pf: () => single({ k: 'prop', sh: { t: 'multi', b: [[0.06, 1.0, 0.06, -0.97, 0, 0], [0.06, 1.0, 0.06, 0, 0, 0], [0.06, 1.0, 0.06, 0.97, 0, 0], [2, 0.06, 0.06, 0, 0.47, 0], [2, 0.04, 0.04, 0, 0.05, 0]] }, m: 'metal', c: '#4a505a', fz: 1, n: 'Railing' }) },
    { key: 'b_brickwall', name: 'Brick Wall', icon: '🧱', desc: 'Breakable: bursts into bricks', pf: () => single({ k: 'prop', sh: { t: 'box', s: [2.4, 1.8, 0.24] }, m: 'concrete', c: BRICK, fz: 1, brk: 'brick', hp: 110, n: 'Brick Wall' }) },
    { key: 'woodwall', name: 'Wooden Boards', icon: '🪵', desc: 'Breakable: splinters apart', pf: () => single({ k: 'prop', sh: { t: 'box', s: [2.4, 2, 0.1] }, m: 'wood', c: '#9b7148', fz: 1, brk: 'wood', hp: 55, n: 'Wooden Boards' }) },
    { key: 'cslab', name: 'Concrete Slab', icon: '🪨', desc: 'Breakable: cracks into chunks', pf: () => single({ k: 'prop', sh: { t: 'box', s: [2, 2, 0.3] }, m: 'concrete', c: '#8f9296', fz: 1, brk: 'concrete', hp: 180, n: 'Concrete Slab' }) },
    { key: 'crate_brk', name: 'Breakable Crate', icon: '📦', desc: 'Smashes into planks', pf: () => single({ k: 'prop', sh: { t: 'box', s: [0.8, 0.8, 0.8] }, m: 'wood', vis: 'crate', brk: 'wood', hp: 35, n: 'Breakable Crate' }) },
    { key: 'glass_big', name: 'Big Glass Window', icon: '🪟', desc: 'Shatters', pf: () => single({ k: 'prop', sh: { t: 'box', s: [3, 2.2, 0.05] }, m: 'glass', brk: 'glass', fz: 1, n: 'Glass' }) },
    { key: 'billboard', name: 'Billboard', icon: '🖼️', desc: 'Press E to paint it. Everyone sees your art.', pf: () => single({ k: 'prop', sh: { t: 'multi', b: [[0.15, 3, 0.15, -1.9, 0, 0], [0.15, 3, 0.15, 1.9, 0, 0], [4.2, 2.2, 0.12, 0, 2.5, 0]] }, m: 'metal', c: '#3a3f4b', fz: 1, board: 1, n: 'Billboard' }) },
  ],
  props: [
    { key: 'crate', name: 'Wooden Crate', icon: '📦', pf: () => single({ k: 'prop', sh: { t: 'box', s: [0.8, 0.8, 0.8] }, m: 'wood', vis: 'crate' }) },
    { key: 'crate_s', name: 'Small Crate', icon: '📦', pf: () => single({ k: 'prop', sh: { t: 'box', s: [0.5, 0.5, 0.5] }, m: 'wood', vis: 'crate' }) },
    { key: 'crate_l', name: 'Large Crate', icon: '📦', pf: () => single({ k: 'prop', sh: { t: 'box', s: [1.6, 1.6, 1.6] }, m: 'wood', vis: 'crate' }) },
    { key: 'mcrate', name: 'Metal Crate', icon: '🧊', pf: () => single({ k: 'prop', sh: { t: 'box', s: [1, 1, 1] }, m: 'metal', c: '#7a8591', vis: 'mcrate' }) },
    { key: 'barrel', name: 'Red Barrel', icon: '🛢️', pf: () => single({ k: 'prop', sh: { t: 'cyl', r: 0.34, h: 1.0, ribs: 1 }, m: 'metal', c: '#c0392b', vis: 'barrel' }) },
    { key: 'drum', name: 'Blue Drum', icon: '🛢️', pf: () => single({ k: 'prop', sh: { t: 'cyl', r: 0.3, h: 0.9, ribs: 1 }, m: 'metal', c: '#2e6fd8', vis: 'barrel' }) },
    { key: 'plank', name: 'Plank', icon: '🪵', pf: () => single({ k: 'prop', sh: { t: 'box', s: [0.35, 0.08, 3] }, m: 'wood' }) },
    { key: 'beam', name: 'Steel Beam', icon: '➖', pf: () => single({ k: 'prop', sh: { t: 'box', s: [0.2, 0.2, 4] }, m: 'metal' }) },
    { key: 'cblock', name: 'Concrete Block', icon: '🧱', pf: () => single({ k: 'prop', sh: { t: 'box', s: [1.2, 0.6, 0.6] }, m: 'concrete', vis: 'cblock' }) },
    { key: 'glass', name: 'Glass Pane', icon: '🪟', desc: 'Shatters when shot or blown up.', pf: () => single({ k: 'prop', sh: { t: 'box', s: [2, 1.5, 0.05] }, m: 'glass', brk: 'glass' }) },
    { key: 'plate', name: 'Metal Plate', icon: '⬜', pf: () => single({ k: 'prop', sh: { t: 'box', s: [2, 0.06, 2] }, m: 'metal' }) },
    { key: 'cube', name: 'Plastic Cube', icon: '🟦', pf: () => single({ k: 'prop', sh: { t: 'box', s: [1, 1, 1] }, m: 'plastic', c: '#45aaf2' }) },
    { key: 'domino', name: 'Domino', icon: '🁢', pf: () => single({ k: 'prop', sh: { t: 'box', s: [0.5, 1.0, 0.12] }, m: 'plastic', c: '#f5f5f5' }) },
    { key: 'ball', name: 'Rubber Ball', icon: '🔴', pf: () => single({ k: 'prop', sh: { t: 'ball', r: 0.4 }, m: 'rubber', c: '#ff5a5f' }) },
    { key: 'beachball', name: 'Beach Ball', icon: '🟡', pf: () => single({ k: 'prop', sh: { t: 'ball', r: 0.6 }, m: 'plastic', c: '#fed330', den: 0.03 }) },
    { key: 'bowling', name: 'Bowling Ball', icon: '🎳', pf: () => single({ k: 'prop', sh: { t: 'ball', r: 0.22 }, m: 'metal', c: '#2a2c31', den: 6 }) },
    { key: 'cone', name: 'Traffic Cone', icon: '🚧', pf: () => single({ k: 'prop', sh: { t: 'cone', r: 0.24, h: 0.7 }, m: 'plastic', c: '#ff7f11', vis: 'cone' }) },
    { key: 'pipe', name: 'Pipe', icon: '🔩', pf: () => single({ k: 'prop', sh: { t: 'cyl', r: 0.12, h: 3 }, m: 'metal' }) },
    { key: 'tire', name: 'Tire', icon: '🛞', pf: () => single({ k: 'prop', sh: { t: 'wheel', r: 0.42, w: 0.3, ax: [1, 0, 0] }, m: 'rubber', c: '#26282d' }) },
    { key: 'seat', name: 'Seat', icon: '💺', pf: () => single({ k: 'prop', sh: { t: 'seat' }, m: 'plastic', c: '#3a3f4b', seat: 1 }) },
    { key: 'neonbar', name: 'Neon Bar', icon: '💡', pf: () => single({ k: 'prop', sh: { t: 'box', s: [1.5, 0.1, 0.1] }, m: 'neon', c: '#f368e0' }) },
    { key: 'ramp_p', name: 'Wooden Ramp', icon: '📐', pf: () => single({ k: 'prop', sh: { t: 'ramp', s: [1.4, 0.7, 1.8] }, m: 'wood' }) },
    { key: 'pallet', name: 'Pallet', icon: '🪵', pf: () => single({ k: 'prop', sh: { t: 'box', s: [1.2, 0.14, 1.0] }, m: 'wood', vis: 'pallet' }) },
    { key: 'barrier', name: 'Jersey Barrier', icon: '🚧', pf: () => single({ k: 'prop', sh: { t: 'box', s: [0.6, 0.8, 2.0] }, m: 'concrete', vis: 'barrier' }) },
    { key: 'container', name: 'Shipping Container', icon: '🚛', pf: () => single({ k: 'prop', sh: { t: 'box', s: [6.0, 2.6, 2.44] }, m: 'metal', c: pickOne(['#a8452f', '#2f6aa0', '#3f7a4a', '#c28a2c', '#6d6f72']), vis: 'container', den: 0.25, n: 'Container' }) },
    { key: 'brick', name: 'Brick', icon: '🧱', pf: () => single({ k: 'prop', sh: { t: 'box', s: [0.4, 0.2, 0.2] }, m: 'concrete', c: '#b5523b' }) },
  ],
  furniture: [
    { key: 'chair', name: 'Wooden Chair', icon: '🪑', desc: 'Press E on it to sit down.', pf: () => single({ k: 'prop', sh: { t: 'chair' }, m: 'wood', vis: 'chair', seat: 1, pas: 1 }) },
    { key: 'table', name: 'Table', icon: '🟫', pf: () => single({ k: 'prop', sh: { t: 'table', s: [1.6, 0.76, 0.9] }, m: 'wood', vis: 'table' }) },
    { key: 'couch', name: 'Couch', icon: '🛋️', desc: 'Press E on it to sit down.', pf: () => single({ k: 'prop', sh: { t: 'box', s: [2.0, 0.85, 0.9] }, m: 'fabric', c: pickOne(COUCH_COLORS), vis: 'couch', seat: 1, pas: 1 }) },
    { key: 'fridge', name: 'Fridge', icon: '🧊', pf: () => single({ k: 'prop', sh: { t: 'box', s: [0.8, 1.8, 0.75] }, m: 'plastic', c: '#eef1f4', vis: 'fridge', den: 0.8 }) },
    { key: 'vending', name: 'Vending Machine', icon: '🥤', pf: () => single({ k: 'prop', sh: { t: 'box', s: [1.0, 1.9, 0.85] }, m: 'metal', c: '#c0392b', vis: 'vending', den: 1.1, c2: '#fed330' }) },
    { key: 'tv', name: 'Flat-screen TV', icon: '📺', pf: () => single({ k: 'prop', sh: { t: 'box', s: [1.1, 0.72, 0.25] }, m: 'plastic', c: '#2a2c31', vis: 'tv' }) },
    { key: 'bookshelf', name: 'Bookshelf', icon: '📚', pf: () => single({ k: 'prop', sh: { t: 'box', s: [1.0, 1.8, 0.35] }, m: 'wood', vis: 'bookshelf' }) },
    { key: 'dumpster', name: 'Dumpster', icon: '🗑️', pf: () => single({ k: 'prop', sh: { t: 'box', s: [1.9, 1.25, 1.1] }, m: 'metal', c: '#2e7d4f', vis: 'dumpster', den: 1.2 }) },
  ],
  fun: [
    { key: 'xbarrel', name: 'Explosive Barrel', icon: '💥', desc: 'Explodes when shot or caught in a blast. Chain reactions welcome.', pf: () => single({ k: 'prop', sh: { t: 'cyl', r: 0.34, h: 1.0, ribs: 1 }, m: 'metal', c: '#c0392b', c2: '#fed330', vis: 'xbarrel', xp: 1.25, n: 'Explosive Barrel' }) },
    { key: 'propane', name: 'Propane Tank', icon: '🧯', desc: 'Smaller, but still goes bang.', pf: () => single({ k: 'prop', sh: { t: 'cyl', r: 0.18, h: 0.8 }, m: 'metal', c: '#e9eef2', vis: 'propane', xp: 0.8, n: 'Propane Tank' }) },
    { key: 'balloon', name: 'Balloon', icon: '🎈', desc: 'Floats up. Rope it to things to lift them. Pops when shot.', pf: () => single({ k: 'prop', sh: { t: 'ball', r: 0.35 }, m: 'plastic', c: pickOne(BALLOON_COLORS), vis: 'balloon', gs: -2.5, ld: 8, den: 0.6, brk: 'pop', n: 'Balloon' }) },
    { key: 'trampoline', name: 'Trampoline', icon: '🤸', desc: 'Bounces players, props and NPCs. Hold jump to go higher.', pf: () => single({ k: 'prop', sh: { t: 'cyl', r: 0.9, h: 0.4 }, m: 'plastic', c: '#2e86de', vis: 'trampoline', re: 0.95, bnc: 1, den: 1.5, n: 'Trampoline' }) },
    { key: 'melon', name: 'Watermelon', icon: '🍉', desc: 'Splatters when shot.', pf: () => single({ k: 'prop', sh: { t: 'ball', r: 0.2 }, m: 'plastic', c: '#3f8a3a', c2: '#23501f', vis: 'melon', den: 1.0, brk: 'melon', n: 'Watermelon' }) },
    { key: 'pin', name: 'Bowling Pin', icon: '🎳', desc: 'One pin.', pf: () => single(Object.assign({}, PIN)) },
    { key: 'pinset', name: 'Bowling Pins (10)', icon: '🎳', desc: 'A full rack. Bring the bowling ball.', pf: pinSet },
    { key: 'brickwall', name: 'Brick Wall', icon: '🧱', desc: 'Loose bricks stacked into a wall. Knock it down.', pf: brickWall },
    { key: 'dominorun', name: 'Domino Run', icon: '▮', desc: 'An S-curve of 26 dominoes. Tip the first one.', pf: dominoRun },
    { key: 'wreckball', name: 'Wrecking Ball', icon: '⚫', desc: 'Very heavy steel ball. Rope it up and swing it.', pf: () => single({ k: 'prop', sh: { t: 'ball', r: 0.6 }, m: 'metal', c: '#2a2c31', den: 8, n: 'Wrecking Ball' }) },
  ],
  npcs: [
    { key: 'npc', name: 'Citizen', icon: '🚶', desc: 'Wanders around, looks at you, runs from gunfire.', pf: () => npcPrefab('citizen') },
    { key: 'worker', name: 'Construction Worker', icon: '👷', desc: 'Hard hat and hi-vis vest. Wanders the site.', pf: () => npcPrefab('worker') },
    { key: 'scientist', name: 'Scientist', icon: '🧪', desc: 'Mostly stands around observing — and watches you.', pf: () => npcPrefab('scientist') },
    { key: 'jogger', name: 'Jogger', icon: '🏃', desc: 'Runs laps around the map.', pf: () => npcPrefab('jogger') },
    { key: 'zombie', name: 'Zombie', icon: '🧟', desc: 'Attacks NPCs, and players when combat is on. Its victims get back up as zombies.', pf: () => npcPrefab('zombie') },
    { key: 'police', name: 'Police Officer', icon: '👮', desc: 'Armed. Fights raiders and zombies, and anyone who hurts civilians or police.', pf: () => npcPrefab('police') },
    { key: 'raider', name: 'Raider', icon: '💀', desc: 'Armed and hostile to everyone else. Shoots players when combat is on.', pf: () => npcPrefab('raider') },
    { key: 'prisoner', name: 'Prisoner', icon: '🟧', desc: 'Orange jumpsuit. Wanders around and runs from trouble.', pf: () => npcPrefab('prisoner') },
    { key: 'dummy', name: 'Crash Test Dummy', icon: '🧍', desc: 'Limp test dummy. Built for impact.', pf: () => npcPrefab('dummy') },
    { key: 'npc_blue', name: 'Ragdoll (limp)', icon: '🫠', desc: 'A limp ragdoll with a random look.', pf: () => npcPrefab('ragdoll') },
  ],
  vehicles: [
    { key: 'car', name: 'Sports Car', icon: '🚗', desc: 'Fast and grippy. Rear-wheel drive, so the handbrake slides the tail out.', pf: () => rayVehiclePrefab('car') },
    { key: 'kart', name: 'Go-Kart', icon: '🏎️', desc: 'Small, twitchy and quick to turn.', pf: () => rayVehiclePrefab('kart') },
    { key: 'pickup', name: 'Pickup Truck', icon: '🛻', desc: 'Four-wheel drive, 4 seats (two in the bed).', pf: () => rayVehiclePrefab('pickup') },
    { key: 'monster', name: 'Monster Truck', icon: '🚙', desc: 'Huge tyres, long suspension, four-wheel steering. Drives over anything.', pf: () => rayVehiclePrefab('monster') },
    { key: 'buggy', name: 'Dune Buggy', icon: '🏁', desc: 'Light, long-travel suspension, loves jumps.', pf: () => rayVehiclePrefab('buggy') },
    { key: 'sled', name: 'Rocket Sled', icon: '🚀', pf: () => vehiclePrefab('sled') },
    { key: 'catapult', name: 'Catapult', icon: '🏹', pf: () => vehiclePrefab('catapult') },
  ],
  map: [
    { key: 'block', name: 'Block', icon: '⬛', d: { sh: { t: 'box', s: [4, 1, 4] }, m: 'dev' } },
    { key: 'floor', name: 'Big Floor', icon: '▭', d: { sh: { t: 'box', s: [12, 0.4, 12] }, m: 'dev' } },
    { key: 'wall', name: 'Wall', icon: '▮', d: { sh: { t: 'box', s: [4, 3, 0.3] }, m: 'dev' } },
    { key: 'platform', name: 'Platform', icon: '▬', d: { sh: { t: 'box', s: [6, 0.3, 6] }, m: 'concrete' } },
    { key: 'pillar', name: 'Pillar', icon: '▯', d: { sh: { t: 'box', s: [0.8, 4, 0.8] }, m: 'concrete' } },
    { key: 'ramp', name: 'Ramp', icon: '◢', d: { sh: { t: 'ramp', s: [4, 1.5, 5] }, m: 'dev' } },
    { key: 'ramp_s', name: 'Steep Ramp', icon: '◣', d: { sh: { t: 'ramp', s: [3, 2.5, 3] }, m: 'dev' } },
    { key: 'light', name: 'Light', icon: '💡', d: { sh: { t: 'light' }, m: 'metal', light: { c: '#ffd9a0', i: 25, r: 18 } } },
    { key: 'spawn', name: 'Spawn Point', icon: '📍', d: { sh: { t: 'spawn' }, m: 'neon' } },
  ],
};
const ITEM_INDEX = {}; for (const cat in CATALOG) for (const it of CATALOG[cat]) ITEM_INDEX[it.key] = Object.assign({ cat }, it);

function shapeHalfY(sh) {
  switch (sh.t) { case 'box': case 'ramp': return sh.s[1] / 2; case 'ball': return sh.r; case 'cyl': case 'cone': return sh.h / 2; case 'cap': return sh.h / 2 + sh.r; case 'wheel': return sh.r; case 'seat': return 0.07; case 'chair': return 0.475; case 'multi': return Math.max(...sh.b.map(b => b[1] / 2 - b[4])); case 'table': return sh.s[1] / 2; case 'rocket': return 0.08; case 'light': return 0.2; case 'spawn': return 0.05; default: return 0.25; }
}
function prefabBottom(pf) {
  let m = Infinity;
  for (const d of pf.ents) {
    m = Math.min(m, d.p[1] - shapeHalfY(d.sh));
    const V = d.veh && VEH[d.veh]; if (V) for (const w of V.w) m = Math.min(m, d.p[1] + w[1] - V.r);   // tyres touch the ground
  }
  return m === Infinity ? 0 : m;
}
