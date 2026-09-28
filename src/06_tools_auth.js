
/* ============================================================================
   7. TOOLS (client side: physgun, tool gun, weapons, dupes, beams)
   ========================================================================== */
const WEAPONS = [
  { id: 'physgun', name: 'Physics Gun', icon: '🧲', desc: 'Grab, move, rotate and freeze objects.' },
  { id: 'toolgun', name: 'Tool Gun', icon: '🔧', desc: '' },
  { id: 'pistol', name: 'Pistol', icon: '🔫', desc: 'Semi-automatic. Knocks props around.', rate: 0.22, dmg: 22, imp: 1.2, dv: 8, spread: 0.004, range: 300 },
  { id: 'shotgun', name: 'Shotgun', icon: '💥', desc: 'Pump action, 8 pellets. Devastating up close.', rate: 0.85, dmg: 11, imp: 0.9, dv: 2, spread: 0.055, pellets: 8, range: 120, push: 2 },
  { id: 'rifle', name: 'Rifle', icon: '🎯', desc: 'Automatic rifle.', rate: 0.09, dmg: 13, imp: 0.7, dv: 5, spread: 0.011, auto: true, range: 300 },
  { id: 'sniper', name: 'Sniper Rifle', icon: '🔭', desc: 'Hold alt-fire to scope in. Inaccurate from the hip.', rate: 1.2, dmg: 95, imp: 4, dv: 16, spread: 0, hipSpread: 0.03, zoom: 1, range: 800, push: 3 },
  { id: 'rocket', name: 'Rocket Launcher', icon: '🚀', desc: 'Rockets explode on impact. Rocket-jump if you dare.', rate: 1.0, proj: 'rocket' },
  { id: 'grenade', name: 'Grenade', icon: '💣', desc: 'Throw it. It explodes after 2.5 s. One every 2.5 s.', rate: 2.5 },
  { id: 'crowbar', name: 'Crowbar', icon: '🪓', desc: 'Melee. Great for smashing ragdolls.', rate: 0.42, dmg: 34, imp: 3, dv: 10, range: 2.4, push: 4 },
  { id: 'propcannon', name: 'Prop Cannon', icon: '📦', desc: 'Fires random props. They vanish after 30 s.', rate: 0.35, proj: 'prop' },
  { id: 'deleter', name: 'Delete Gun', icon: '🗑️', desc: 'Deletes whatever you shoot: props, NPCs, map pieces, trees, rocks and containers. Map and world objects need edit permission.', rate: 0.2 },
];
// random cone spread around a direction
function jitter(v, s) { v.x += (Math.random() - 0.5) * s * 2; v.y += (Math.random() - 0.5) * s * 2; v.z += (Math.random() - 0.5) * s * 2; return v.normalize(); }
const CANNON_AMMO = ['crate_s', 'crate_s', 'barrel', 'melon', 'melon', 'bowling', 'tire', 'cone', 'beachball', 'cube', 'pin'];
const W_BY_ID = Object.fromEntries(WEAPONS.map((w, i) => [w.id, Object.assign({ idx: i }, w)]));
const TOOL_MODES = [
  { id: 'weld', name: 'Weld', icon: '🔗', desc: 'Click two objects to weld them. Click the ground second to weld to the world.', two: true },
  { id: 'rope', name: 'Rope', icon: '🪢', desc: 'Click two points to tie a rope (or elastic, if rigidity < 100%).', two: true },
  { id: 'thruster', name: 'Thruster', icon: '🚀', desc: 'Attach a thruster to a surface. Hold its key to fire it.' },
  { id: 'wheel', name: 'Wheel', icon: '🛞', desc: 'Attach a motorized wheel. A seat drives the wheels it is connected to.' },
  { id: 'seat', name: 'Seat', icon: '💺', desc: 'Attach a seat. Sit in it to drive the contraption.' },
  { id: 'remover', name: 'Remover', icon: '❌', desc: 'Remove an object. Alt-fire removes only its constraints.' },
  { id: 'paint', name: 'Painter', icon: '🎨', desc: 'Apply material + color. Alt-fire copies them from an object.' },
  { id: 'dupe', name: 'Duplicator', icon: '📋', desc: 'Fire copies a contraption. Alt-fire pastes it.' },
  { id: 'motor', name: 'Motor', icon: '⚙️', desc: 'Click the part that should spin, then what it spins on (another prop, or the ground for the world). Hold the motor key to turn it.', two: true },
  { id: 'heal', name: 'Medic', icon: '💉', desc: 'Patch up an NPC: stops the bleeding and restores health. Revives them if their head is still attached.' },
];
const Tools = {
  weapon: 'physgun', mode: 'weld', grab: null, first: null, cool: 0, rot: [0, 0], rotating: false, clipboard: null, marker: null, beam: null, kick: 0,
  opt: Object.assign({ ropeLen: 1.0, ropeRigid: 1.0, thrForce: 12, thrKey: 'KeyF', thrPad: 'Pad7', wheelR: 0.4, paintMat: 'metal', paintCol: '#ff5a5f', motSpd: 4, motKey: 'KeyM', motTog: false }, store.get('toolopt', {})),
  saveOpt() { store.set('toolopt', this.opt); },
  init() {
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfed330, depthTest: false }));
    this.marker.renderOrder = 999; this.marker.visible = false; this.marker.material.userData.outlineParameters = { visible: false };
    R.scene.add(this.marker);
    this.beam = new Beam(0x6fe3ff, 0.05);
  },
  setWeapon(id) { if (!W_BY_ID[id] || this.weapon === id) return; this.release(); this.weapon = id; this.first = null; Game.buildViewmodel(); UI.refreshTool(); Audio.play('draw'); },
  cycleWeapon(dir) { const i = W_BY_ID[this.weapon].idx; this.setWeapon(WEAPONS[(i + dir + WEAPONS.length) % WEAPONS.length].id); },
  setMode(id) { this.mode = id; this.first = null; UI.refreshTool(); },
  cycleMode(dir) { const i = TOOL_MODES.findIndex(m => m.id === this.mode); this.setMode(TOOL_MODES[(i + dir + TOOL_MODES.length) % TOOL_MODES.length].id); Audio.play('switch'); },
  release() { if (this.grab) { Net.toHost({ t: 'drop' }); this.grab = null; } this.rotating = false; },
  onEntRemoved(id) { if (this.grab && this.grab.e === id) this.grab = null; if (this.first && this.first.e === id) this.first = null; },
  aim(o, d) { R.camera.getWorldPosition(o); R.camera.getWorldDirection(d); return { o, d }; },
  cast(max) { const o = new V3(), d = new V3(); this.aim(o, d); const p = Players.local; return Phys.cast(o, d, max, p ? p.body : null); },
  localPoint(e, wp) { return wp.clone().sub(e.mesh.position).applyQuaternion(_q1.copy(e.mesh.quaternion).invert()); },
  hitInfo(hit) {
    const id = typeof hit.id === 'number' ? hit.id : null; if (id === null) return null;
    const e = id ? World.ents.get(id) : null;
    return { e: id, lp: a3(e ? this.localPoint(e, hit.point) : hit.point), n: a3(hit.normal), pt: a3(hit.point), ent: e };
  },
  update(dt) {
    const p = Players.local;
    this.cool -= dt; this.kick = Math.max(0, this.kick - dt * 6);
    if (!p || p.dead || p.seat) { this.release(); return; }
    const W = W_BY_ID[this.weapon];
    if (this.weapon === 'physgun') this.updPhysgun(dt);
    else if (this.weapon === 'toolgun') this.updToolgun(dt);
    else if (this.weapon === 'grenade') { if (Input.hit('fire') && this.cool <= 0) { this.cool = W.rate; const o = new V3(), d = new V3(); this.aim(o, d); Net.toHost({ t: 'nade', o: a3(o), d: a3(d) }); this.kick = 1; Audio.play('pin', 0.8); Audio.play('throw', 1, { delay: 0.12 }); } }
    else if (this.weapon === 'deleter') { if (Input.hit('fire') && this.cool <= 0) { this.cool = W.rate; this.fireDelete(); } }
    else if ((W.auto ? Input.down('fire') : Input.hit('fire')) && this.cool <= 0) this.fireGun(W);
    this.marker.visible = !!this.first && this.weapon === 'toolgun';
    if (this.first) World.anchorWorld(this.first.e, this.first.lp, this.marker.position);
  },
  updPhysgun(dt) {
    this.rotating = false;
    if (!this.grab) {
      if (Input.hit('fire')) {
        const h = this.cast(90), hi = h && this.hitInfo(h);
        if (hi && hi.ent && hi.ent.d.k !== 'map') { this.grab = { e: hi.e, lp: hi.lp, dist: h.dist }; Net.toHost({ t: 'grab', e: hi.e, lp: hi.lp, dist: h.dist }); Audio.play('pg_grab'); }
        else if (hi && hi.ent && hi.ent.d.k === 'map') UI.toast('Map pieces are moved in Edit mode');
      }
      if (Input.hit('reload')) {
        const h = this.cast(90), hi = h && this.hitInfo(h);
        if (hi && hi.ent && hi.ent.d.fz) { Net.toHost({ t: 'unfreeze', e: hi.e }); UI.toast('Unfrozen'); Audio.play('unfreeze'); }
      }
      return;
    }
    if (!World.ents.has(this.grab.e)) { this.grab = null; return; }
    const g = this.grab;
    if (Input.wheel) g.dist = clamp(g.dist - Input.wheel * 0.9, 1.2, 90);
    if (Input.padDown(PAD.UP)) g.dist = clamp(g.dist + 9 * dt, 1.2, 90);
    if (Input.padDown(PAD.DOWN)) g.dist = clamp(g.dist - 9 * dt, 1.2, 90);
    if (Input.down('reload')) {
      this.rotating = true;
      this.rot[0] += Input.dx * 0.006 + Input.axes[2] * 3.2 * dt;
      this.rot[1] += Input.dy * 0.006 + Input.axes[3] * 3.2 * dt;
    }
    if (Input.hit('alt')) { Net.toHost({ t: 'freeze' }); this.grab = null; Audio.play('freeze'); UI.toast('Frozen'); return; }
    if (!Input.down('fire')) { Net.toHost({ t: 'drop' }); this.grab = null; Audio.play('pg_drop'); }
  },
  updToolgun() {
    if (Input.hit('reload')) this.cycleMode(1);
    if (Input.hit('fire') && this.cool <= 0) {
      this.cool = 0.18;
      const h = this.cast(150); if (!h) return;
      const hi = this.hitInfo(h); if (!hi) return;
      this.toolFire(hi); FX.zap(this.muzzle(), h.point); Audio.play('tool_zap'); this.kick = 0.6;
    }
    if (Input.hit('alt')) this.toolAlt();
  },
  toolFire(hi) {
    const e = hi.ent, isProp = e && e.d.k !== 'map', o = this.opt, M = this.mode;
    const strip = x => ({ e: x.e, lp: x.lp, n: x.n, pt: x.pt });
    if (M === 'weld' || M === 'rope' || M === 'motor') {
      if (!this.first) { if (!isProp) return UI.toast('Select an object first'); this.first = strip(hi); if (M === 'motor') UI.toast('Now click what it spins on'); return; }
      if (hi.e === this.first.e && M !== 'rope') return UI.toast('Pick a different object');
      Net.toHost({ t: 'tool', m: M, a: this.first, b: strip(hi), o: { len: o.ropeLen, rigid: o.ropeRigid, spd: o.motSpd, key: o.motKey, tog: o.motTog } });
      this.first = null; return;
    }
    if (M === 'thruster' || M === 'wheel') { if (!isProp) return UI.toast('Aim at a prop'); Net.toHost({ t: 'tool', m: M, a: strip(hi), o: { f: o.thrForce, key: o.thrKey, pad: o.thrPad, r: o.wheelR } }); return; }
    if (M === 'seat') { Net.toHost({ t: 'tool', m: 'seat', a: strip(hi), yaw: Players.local.yaw }); return; }
    if (M === 'remover') { if (!isProp) return UI.toast(e ? 'Use Edit mode to delete map pieces' : 'Nothing to remove'); Net.toHost({ t: 'tool', m: 'remover', a: strip(hi) }); FX.poof(e.mesh.position); return; }
    if (M === 'paint') { if (!e) return; Net.toHost({ t: 'tool', m: 'paint', a: strip(hi), o: { m: o.paintMat, c: o.paintCol } }); return; }
    if (M === 'dupe') { if (!isProp) return UI.toast('Aim at a contraption'); this.copyDupe(hi.e); return; }
    if (M === 'heal') { if (!e || !e.d.g) return UI.toast('Aim at an NPC'); Net.toHost({ t: 'tool', m: 'heal', a: strip(hi) }); return; }
  },
  toolAlt() {
    const M = this.mode;
    if (M === 'weld' || M === 'rope' || M === 'motor') { if (this.first) { this.first = null; UI.toast('Selection cleared'); } return; }
    const h = this.cast(150), hi = h && this.hitInfo(h);
    if (M === 'remover') { if (hi && hi.ent) { Net.toHost({ t: 'tool', m: 'unconstrain', a: { e: hi.e } }); UI.toast('Constraints removed'); } return; }
    if (M === 'paint') { if (hi && hi.ent) { this.opt.paintMat = hi.ent.d.m || 'plastic'; this.opt.paintCol = hi.ent.d.c || MATDEFS[this.opt.paintMat].tint; this.saveOpt(); UI.toast('Picked ' + MATDEFS[this.opt.paintMat].name); UI.refreshTool(); } return; }
    if (M === 'dupe') { this.pasteDupe(this.clipboard, h); return; }
  },
  copyDupe(id) {
    const set = World.connected(id);
    for (const i of [...set]) { const e = World.ents.get(i); if (e && e.d.g && World.groups.has(e.d.g)) for (const pid of World.groups.get(e.d.g).parts) set.add(pid); }
    const list = [...set].map(i => World.ents.get(i)).filter(e => e && e.d.k !== 'map' && e.d.k !== 'nade');
    if (!list.length) return;
    const p = Players.local, yaw = p.yaw, qInv = new QT().setFromAxisAngle(UP, -yaw);
    const origin = list[0].mesh.position.clone();
    const idx = new Map(); list.forEach((e, i) => idx.set(e.id, i + 1));
    const ents = list.map(e => {
      const d = JSON.parse(JSON.stringify(World.liveDesc(e)));
      d.id = idx.get(e.id); delete d.v; delete d.w; delete d.o; delete d.g;
      d.p = a3(new V3().fromArray(d.p).sub(origin).applyQuaternion(qInv)); d.q = a4(qInv.clone().multiply(new QT().fromArray(d.q)));
      return d;
    });
    const cons = [];
    for (const c of World.cons.values()) {
      const ia = idx.get(c.a), ib = idx.get(c.b);
      if (ia && ib) { const o = World.conDesc(c); o.a = ia; o.b = ib; o.id = 1000 + cons.length; delete o.o; cons.push(o); }
    }
    const groups = [];
    for (const g of World.groups.values()) if (g.parts.every(x => idx.has(x))) groups.push({ id: 2000 + groups.length, t: g.t, parts: g.parts.map(x => idx.get(x)), hp: 100, alive: 1, brain: g.brain, n: g.n });
    this.clipboard = { name: list[0].d.n || (groups[0] && groups[0].n) || 'Contraption', ents, cons, groups };
    UI.toast(`Copied ${ents.length} object${ents.length > 1 ? 's' : ''}`); Audio.play('tool_zap');
  },
  pasteDupe(dupe, hit) {
    if (!dupe) return UI.toast('Clipboard is empty. Copy something with the Duplicator first.');
    const p = Players.local; if (!p) return;
    let pt;
    if (hit) pt = hit.point; else { const o = new V3(), d = new V3(); this.aim(o, d); pt = o.addScaledVector(d, 6); }
    Net.toHost({ t: 'dupe', data: dupe, p: a3(pt), yaw: p.yaw });
  },
  fireDelete() {
    const h = this.cast(250), mz = this.muzzle(); this.kick = 0.8; Audio.play('delete_zap');
    if (!h) { const o = new V3(), d = new V3(); this.aim(o, d); FX.beam(mz, o.addScaledVector(d, 60), 0xff4a3d, 0.12, 0.03); return; }
    FX.beam(mz, h.point, 0xff4a3d, 0.15, 0.035);
    if (typeof h.id === 'number' && h.id > 0) Net.toHost({ t: 'del', e: h.id });
    else if (h.id === 0 && Env.colItem && Env.colItem.has(h.handle)) Net.toHost({ t: 'del', env: Env.colItem.get(h.handle) });
  },
  muzzle() { const vm = Game.viewmodel; const m = vm && vm.getObjectByName('muzzle'); return m ? m.getWorldPosition(new V3()) : R.camera.position.clone(); },
  fireGun(W) {
    this.cool = W.rate; this.kick = W.pellets || W.proj || W.zoom ? 1.5 : 1;
    const o = new V3(), d = new V3(); this.aim(o, d);
    const spread = W.zoom && !Game.zoomed ? W.hipSpread : W.spread;
    if (spread && !W.pellets) jitter(d, spread);
    if (W.proj === 'rocket') Audio.play('rocket_fire'); else if (W.proj) Audio.play('propcannon'); else if (W.id === 'crowbar') Audio.play('swing'); else Audio.gun(W.id, R.camera.position, true);
    if (W.zoom) Game.shake = Math.max(Game.shake, 0.12);
    if (!W.proj) {   // hitscan: predicted tracers + sparks (the host does the real hits)
      const p = Players.local, n = W.pellets || 1;
      for (let i = 0; i < n; i++) {
        const dd = n > 1 ? jitter(d.clone(), W.spread) : d, h = Phys.cast(o, dd, W.range, p.body);
        if (W.id === 'crowbar') { if (h) { FX.spark(h.point, h.normal); const s = Audio.surfaceAt(h), b = HIT_OF[s] || 'hit_metal'; Audio.at(s === 'body' ? 'punch' : SND[b + '_h'] ? b + '_h' : b, h.point); } }
        else { const end = h ? h.point : o.clone().addScaledVector(dd, W.range); FX.tracer(this.muzzle(), end); if (h) { FX.spark(h.point, h.normal, null, n > 1 ? 4 : 10); if (i < 3) Audio.bulletHit(o, h.point, h.normal); } }
        if (h && typeof h.id === 'string' && Rules.combat) UI.hitmarker();
      }
    }
    Net.toHost({ t: 'fire', w: W.id, o: a3(o), d: a3(d) });
  },
  // beams for every player grabbing something (local one is predicted)
  updateBeams() {
    Beam.frame();
    const lp = Players.local;
    for (const p of Players.map.values()) {
      let end = null;
      if (p.isLocal && this.grab && this.weapon === 'physgun') {
        const o = new V3(), d = new V3(); this.aim(o, d); end = o.addScaledVector(d, this.grab.dist);
        const e = World.ents.get(this.grab.e); const gp = e ? World.anchorWorld(e.id, this.grab.lp, new V3()) : end;
        Beam.draw(this.muzzle(), end, gp, 0x6fe3ff);
      } else if (!p.isLocal && p.beamEnd && !p.dead && p !== lp) {
        const start = Players.eyePos(p, new V3()); start.y -= 0.35;
        const d = Players.aimDir(p, new V3()); start.addScaledVector(d, 0.5);
        const mid = start.clone().addScaledVector(d, start.distanceTo(p.beamEnd) * 0.6);
        Beam.draw(start, mid, p.beamEnd, 0x6fe3ff);
      }
    }
    Beam.end();
  },
};
/* ---------------------------------------------------------------------------
   Raycast vehicles (host simulates; everyone draws the wheels)
   ------------------------------------------------------------------------- */
const Vehicles = {
  ctl: new Map(), n: 0,
  ensure(e) {
    let c = this.ctl.get(e.id);
    if (c && c.body === e.body) return c;
    if (c) this.drop(e.id);
    const V = VEH[e.d.veh]; if (!V || !e.body || !e.body.isDynamic() || !Net.auth()) return null;
    const vc = Phys.world.createVehicleController(e.body);
    V.w.forEach((w, i) => {
      vc.addWheel({ x: w[0], y: w[1] + V.rest * 0.72, z: w[2] }, { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, V.rest, V.r);
      vc.setWheelSuspensionStiffness(i, V.stiff); vc.setWheelSuspensionCompression(i, V.damp[0]); vc.setWheelSuspensionRelaxation(i, V.damp[1]);
      vc.setWheelMaxSuspensionTravel(i, V.rest); vc.setWheelFrictionSlip(i, V.slip); vc.setWheelSideFrictionStiffness(i, V.grip); vc.setWheelMaxSuspensionForce(i, 1e6);
    });
    c = { vc, body: e.body, V, steer: 0, speed: 0, drv: null };
    try { e.body.enableCcd(true); } catch (err) { }
    this.ctl.set(e.id, c);
    return c;
  },
  drop(id) { const c = this.ctl.get(id); if (!c) return; try { Phys.world.removeVehicleController(c.vc); } catch (err) { } this.ctl.delete(id); },
  step(dt) {
    const send = ++this.n % 4 === 0 && Net.online, out = [];
    for (const id of World.vehicles) {
      const e = World.ents.get(id); if (!e) continue;
      const c = this.ensure(e); if (!c) continue;
      const drv = c.drv, b = e.body, V = c.V, vc = c.vc; c.drv = null;
      if (!drv && b.isSleeping()) { c.speed = 0; continue; }
      const r = b.rotation(), q = _q1.set(r.x, r.y, r.z, r.w), fwd = _v1.set(0, 0, -1).applyQuaternion(q), lv = b.linvel();
      const speed = c.speed = lv.x * fwd.x + lv.y * fwd.y + lv.z * fwd.z, mass = b.mass();
      const thr = c.thr = drv ? drv.thr : 0, hand = !drv || drv.hand, boost = drv && drv.boost ? V.boost : 1;
      const top = Rules.carMph > 0 ? Rules.carMph * MPH : V.top, accel = V.accel * Math.max(1, Math.sqrt(top / V.top));
      // steering: smoothed, with less lock at speed so it stays stable
      const target = -(drv ? drv.steer : 0) * V.steer / (1 + Math.abs(speed) / (V.sfall || 15));
      c.steer += (target - c.steer) * Math.min(1, dt * 8);
      let engine = 0, brake = 0;
      if (thr > 0.05) { if (speed < -1) brake = thr; else engine = thr * accel * boost * clamp(1 - Math.pow(Math.max(0, speed) / (top * (boost > 1 ? 1.3 : 1)), 3), 0, 1); }   // full power until close to the top speed
      else if (thr < -0.05) { if (speed > 1) brake = -thr; else engine = thr * accel * 0.7 * clamp(1 + speed / V.rev, 0, 1); }
      else brake = 0.15;                                                      // rolling resistance / engine braking when coasting
      let nDrive = 0; for (const w of V.w) if (this.drives(V, w)) nDrive++;
      V.w.forEach((w, i) => {
        const rear = w[2] > 0, drive = this.drives(V, w);
        vc.setWheelSteering(i, w[3] ? c.steer : V.rearSteer && rear ? -c.steer * 0.6 : 0);
        vc.setWheelEngineForce(i, drive ? engine * mass / nDrive : 0);
        const bk = hand && rear ? (drv ? 1.4 : 3) : (drv ? brake : 3);        // parked = brakes on
        vc.setWheelBrake(i, bk * V.brake * mass * dt / V.w.length);
        vc.setWheelSideFrictionStiffness(i, drv && drv.hand && rear && Math.abs(speed) > 4 ? V.grip * 0.32 : V.grip);   // handbrake drift
      });
      vc.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
      let ground = 0; for (let i = 0; i < V.w.length; i++) if (vc.wheelIsInContact(i)) ground++;
      const up = _v2.set(0, 1, 0).applyQuaternion(q);
      if (ground) { const k = 0.004 * speed * speed * mass * dt; b.applyImpulse({ x: -up.x * k, y: -up.y * k, z: -up.z * k }, true); }   // downforce
      else if (drv && up.y > 0.2) {                                             // a little air control: steer = yaw, throttle = pitch
        const av = b.angvel(), rt = _v3.set(1, 0, 0).applyQuaternion(q);
        b.setAngvel({ x: av.x + (rt.x * thr * 1.5 - up.x * drv.steer * 1.8) * dt, y: av.y + (rt.y * thr * 1.5 - up.y * drv.steer * 1.8) * dt, z: av.z + (rt.z * thr * 1.5 - up.z * drv.steer * 1.8) * dt }, true);
      }
      if (send) { const a = [id, Math.round(c.steer * 1000)]; for (let i = 0; i < V.w.length; i++) a.push(Math.round(vc.wheelSuspensionLength(i) * 1000)); a.push(Math.round(thr * 1000)); out.push(a); }
    }
    if (send && out.length) Net.bcast({ t: 'vs', v: out });
  },
  drives(V, w) { return V.drive === 'awd' || (V.drive === 'rwd' ? w[2] > 0 : w[2] < 0); },
  // wheel suspension / steering / roll visuals (host reads the controller, clients use the last 'vs')
  updateVisuals(dt) {
    for (const id of World.vehicles) {
      const e = World.ents.get(id); if (!e || !e.mesh) continue;
      const V = VEH[e.d.veh]; if (!V) continue;
      const fwd = _v2.set(0, 0, -1).applyQuaternion(e.mesh.quaternion), c = this.ctl.get(id);
      // forward speed from the physics (host: the controller; clients: the last two snapshots)
      let vf = 0;
      if (c) vf = c.speed;
      else if (e.buf.length > 1) { const a = e.buf[e.buf.length - 2], b = e.buf[e.buf.length - 1]; vf = _v1.subVectors(b.p, a.p).divideScalar(Math.max(0.02, b.t - a.t)).dot(fwd); }
      e._spd = lerp(e._spd || 0, vf, Math.min(1, dt * 10));
      if (!e._wg || e._wgm !== e.mesh) { e._wg = V.w.map((w, i) => e.mesh.getObjectByName('vw' + i)); e._wgm = e.mesh; }
      V.w.forEach((w, i) => {
        const g = e._wg[i]; if (!g) return;
        let steer = 0, susp = V.rest * 0.72;
        if (c) { steer = c.vc.wheelSteering(i); susp = c.vc.wheelSuspensionLength(i); }
        else if (e.vs) { steer = w[3] ? e.vs[0] : V.rearSteer && w[2] > 0 ? -e.vs[0] * 0.6 : 0; susp = e.vs[1 + i] ?? susp; }
        g.position.y = lerp(g.position.y, w[1] + V.rest * 0.72 - susp, c ? 1 : Math.min(1, dt * 15));
        g.rotation.y = steer;
        g.children[0].rotation.x -= e._spd / V.r * dt;
      });
    }
  },
  recv(m) { for (const a of m.v || []) { const e = World.ents.get(a[0]); if (e) e.vs = a.slice(1).map(x => x / 1000); } },
};

// Camera-facing ribbon beams (same look on every tier)
class Beam {
  static frame() { this.i = 0; if (!this.pool) this.pool = []; }
  static draw(a, ctrl, b, color) {
    let bm = this.pool[this.i]; if (!bm) { bm = new Beam(color, 0.045); this.pool.push(bm); }
    this.i++; bm.set(a, ctrl, b); bm.mesh.visible = true;
  }
  static end() { for (let j = this.i; j < this.pool.length; j++) this.pool[j].mesh.visible = false; }
  constructor(color, width, segs = 20) {
    this.w = width; this.n = segs;
    const g = new THREE.BufferGeometry(); this.pos = new Float32Array((segs + 1) * 2 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const idx = []; for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.material.userData.outlineParameters = { visible: false };
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 5; R.scene.add(this.mesh);
  }
  set(a, c, b) {
    const cam = R.camera.position, n = this.n, P = this.pos, pt = _v1, tg = _v2, side = _v3;
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pt.set(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.y + 2 * u * t * c.y + t * t * b.y, u * u * a.z + 2 * u * t * c.z + t * t * b.z);
      tg.set(2 * u * (c.x - a.x) + 2 * t * (b.x - c.x), 2 * u * (c.y - a.y) + 2 * t * (b.y - c.y), 2 * u * (c.z - a.z) + 2 * t * (b.z - c.z)).normalize();
      side.subVectors(cam, pt).cross(tg).normalize().multiplyScalar(this.w * (0.6 + 0.4 * Math.sin(t * 3.14)));
      P.set([pt.x + side.x, pt.y + side.y, pt.z + side.z, pt.x - side.x, pt.y - side.y, pt.z - side.z], i * 6);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

/* ============================================================================
   9. HOST AUTHORITY (validation, physgun/thruster/vehicle/NPC simulation, combat)
   ========================================================================== */
// hinge motor [stiffness, damping] per joint (acceleration-based, so independent of body mass)
const NPC_MOTOR = { waist: [140, 14], neck: [60, 7], shL: [70, 8], shR: [70, 8], elL: [50, 6], elR: [50, 6], hipL: [190, 17], hipR: [190, 17], knL: [170, 15], knR: [170, 15] };
const SERVO_KEYS = ['neck', 'shL', 'shR', 'elL', 'elR'], _sq1 = new QT(), _sq2 = new QT(), _sq3 = new QT(), _sv1 = new V3();   // shoulders before elbows
const NPC_REST = { knL: 0.4, knR: 0.4, elL: -0.4, elR: -0.4, hipL: -0.3, hipR: -0.3 };
// Get-up animation. While an NPC gets up its parts are kinematic and follow these keyframes exactly (forward
// kinematics on the ragdoll's own joints), grounded so the lowest point rests on the floor, with a plant point
// (feet / hands / knee / pelvis) held still between keys so nothing slides. It blends in from however the ragdoll
// landed and hands back to physics once standing; any hit or grab drops it straight back into a ragdoll.
// pitch = pelvis pitch in degrees (0 upright, +90 face down, -90 on the back); P = joint angles in radians.
const GU_STAND = { hipL: -0.05, hipR: -0.05, knL: 0.1, knR: 0.1, shL: 0.06, shR: 0.06, elL: -0.25, elR: -0.25, waist: 0.04, neck: 0 };
const GETUP = {
  back: { bl: 0.3, keys: [   // on the back: curl up, sit, rock forward over the feet into a squat, stand
    { t: 0, pitch: -88, plant: 'pelvis', P: { hipL: -0.05, hipR: -0.05, knL: 0.12, knR: 0.12, shL: 0.15, shR: 0.15, elL: -0.2, elR: -0.2, waist: 0, neck: 0 } },
    { t: 0.45, pitch: -84, plant: 'pelvis', P: { hipL: -1.0, hipR: -0.9, knL: 1.6, knR: 1.5, shL: 0.55, shR: 0.55, elL: -0.3, elR: -0.3, waist: 0.55, neck: 0.5 } },
    { t: 0.95, pitch: -38, plant: 'pelvis', P: { hipL: -1.6, hipR: -1.55, knL: 2.15, knR: 2.1, shL: -0.7, shR: -0.6, elL: -0.45, elR: -0.4, waist: 0.95, neck: 0.2 } },
    { t: 1.45, pitch: 20, plant: 'feet', P: { hipL: -1.7, hipR: -1.7, knL: 2.3, knR: 2.3, shL: -1.0, shR: -0.95, elL: -0.35, elR: -0.35, waist: 0.32, neck: -0.15 } },
    { t: 1.9, pitch: 12, plant: 'feet', P: { hipL: -0.8, hipR: -0.8, knL: 1.0, knR: 1.0, shL: -0.4, shR: -0.4, elL: -0.4, elR: -0.4, waist: 0.2, neck: 0 } },
    { t: 2.35, pitch: 0, plant: 'feet', P: GU_STAND },
  ] },
  front: { bl: 0.3, keys: [  // face down: hands under the shoulders, push up, onto all fours, up on one knee, stand
    { t: 0, pitch: 88, plant: 'pelvis', P: { hipL: 0, hipR: 0, knL: 0.12, knR: 0.12, shL: 0.1, shR: 0.1, elL: -0.2, elR: -0.2, waist: 0, neck: 0 } },
    { t: 0.4, pitch: 88, plant: 'pelvis', P: { hipL: 0, hipR: 0, knL: 0.15, knR: 0.15, shL: 0.55, shR: 0.55, elL: -2.0, elR: -2.0, waist: 0, neck: -0.4 } },
    { t: 0.85, pitch: 84, plant: 'hands', P: { hipL: -0.1, hipR: -0.1, knL: 0.25, knR: 0.25, shL: -1.25, shR: -1.25, elL: -0.15, elR: -0.15, waist: -0.3, neck: -0.5 } },
    { t: 1.4, pitch: 86, plant: 'hands', P: { hipL: -1.5, hipR: -1.5, knL: 1.6, knR: 1.6, shL: -1.45, shR: -1.45, elL: -0.1, elR: -0.1, waist: 0.1, neck: -0.5 } },
    { t: 1.95, pitch: 6, plant: 'kneeR', P: { hipL: -1.45, hipR: 0.05, knL: 1.5, knR: 1.6, shL: -0.35, shR: -0.3, elL: -0.6, elR: -0.5, waist: 0.15, neck: 0 } },
    { t: 2.6, pitch: 0, plant: 'footL', P: GU_STAND },
  ] },
  quick: { bl: 0.5, keys: [  // knocked off balance but not flat: straighten up
    { t: 0.5, pitch: 0, plant: 'pelvis', P: GU_STAND },
  ] },
};
const GU_KEYS = Object.keys(GU_STAND);
// collision shapes of the ragdoll parts (matches npcPrefab): box half extents / ball radius / capsule [half height, radius]
const NPC_SHAPE = [['box', 0.17, 0.1, 0.1], ['box', 0.19, 0.23, 0.11], ['ball', 0.13], ['cap', 0.1, 0.06], ['cap', 0.1, 0.06], ['cap', 0.1, 0.05], ['cap', 0.1, 0.05], ['cap', 0.12, 0.08], ['cap', 0.12, 0.08], ['cap', 0.13, 0.065], ['cap', 0.13, 0.065]];
const NPC_CHAIN = Object.entries(NPC_JOINTS), _AX = new V3(1, 0, 0), _fq = new QT(), _fv = new V3();
const FKP = Array.from({ length: 11 }, () => new V3()), FKQ = Array.from({ length: 11 }, () => new QT());
// forward kinematics: pelvis at the origin facing -Z, pitched by `pitch` (rad); fills FKP / FKQ
function npcFK(pitch, P) {
  FKP[0].set(0, 0, 0); FKQ[0].setFromAxisAngle(_AX, -pitch);
  for (const [k, [a, b, pa, pb]] of NPC_CHAIN) {
    FKQ[b].copy(FKQ[a]).multiply(_fq.setFromAxisAngle(_AX, -(P[k] || 0)));
    FKP[b].fromArray(pa).applyQuaternion(FKQ[a]).add(FKP[a]).sub(_fv.fromArray(pb).applyQuaternion(FKQ[b]));
  }
}
// lowest world-y of part i in the current FK pose
function npcLow(i) {
  const s = NPC_SHAPE[i], p = FKP[i], q = FKQ[i];
  if (s[0] === 'ball') return p.y - s[1];
  if (s[0] === 'cap') { const dy = Math.abs(_fv.set(0, s[1], 0).applyQuaternion(q).y); return p.y - dy - s[2]; }
  let d = 0; for (const [ax, h] of [[[1, 0, 0], s[1]], [[0, 1, 0], s[2]], [[0, 0, 1], s[3]]]) d += Math.abs(_fv.fromArray(ax).applyQuaternion(q).y) * h;
  return p.y - d;
}
// a named contact point in the current FK pose (its horizontal position is what gets planted)
function npcPlant(name, out) {
  const at = (i, y) => _fv.set(0, y, 0).applyQuaternion(FKQ[i]).add(FKP[i]);
  switch (name) {
    case 'feet': out.copy(at(9, -0.195)); return out.add(at(10, -0.195)).multiplyScalar(0.5);
    case 'footL': return out.copy(at(9, -0.195));
    case 'hands': out.copy(at(5, -0.15)); return out.add(at(6, -0.15)).multiplyScalar(0.5);
    case 'kneeR': return out.copy(at(8, -0.2));
    default: return out.copy(FKP[0]);
  }
}
// per-key pelvis offsets so the plant point stays put from one key to the next (worked out once)
function guPrepare(A) {
  if (A.ready) return A;
  const D = Math.PI / 180, a = new V3(), b = new V3(); let ox = 0, oz = 0;
  A.keys.forEach((k, i) => {
    k.pr = k.pitch * D;
    if (i) { const pk = A.keys[i - 1]; npcFK(pk.pr, pk.P); npcPlant(k.plant, a); npcFK(k.pr, k.P); npcPlant(k.plant, b); ox += a.x - b.x; oz += a.z - b.z; }
    k.ox = ox; k.oz = oz;
  });
  A.T = Math.max(A.keys[A.keys.length - 1].t, A.bl); A.ready = true;
  return A;
}
// smooth (Hermite) sample of one channel across the keys
function guChan(K, t, f) {
  if (K.length === 1 || t <= K[0].t) return f(K[0]);
  let i = 0; while (i < K.length - 2 && t > K[i + 1].t) i++;
  const k0 = K[i], k1 = K[i + 1]; if (t >= k1.t) return f(k1);
  const h = k1.t - k0.t, s = (t - k0.t) / h, s2 = s * s, s3 = s2 * s;
  const tan = j => j <= 0 || j >= K.length - 1 ? 0 : (f(K[j + 1]) - f(K[j - 1])) / (K[j + 1].t - K[j - 1].t);
  return (2 * s3 - 3 * s2 + 1) * f(k0) + (s3 - 2 * s2 + s) * h * tan(i) + (-2 * s3 + 3 * s2) * f(k1) + (s3 - s2) * h * tan(i + 1);
}
const smooth01 = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const Rules = { combat: false, editPerm: 'all', propLimit: CFG.propLimit, allowNoclip: true, aimAssist: true, dismember: true, env: 'plains', envGone: [], mode: 'sandbox', bots: 3, carMph: 0, npcHp: 100 };   // npcHp: NPC health (100 = normal); damage to NPCs is scaled by 100 / npcHp
const npcDmgK = () => 100 / clamp(Rules.npcHp || 100, 10, 2000);   // carMph 0 = each vehicle's own top speed
const MPH = 0.44704;   // m/s per mph
// NPC firearms: damage per hit, seconds between shots, shots per burst, pause after a burst, spread
const NPC_GUNS = { pistol: { dmg: 13, rate: 0.45, burst: 1, pause: 0.65, spread: 0.03 }, rifle: { dmg: 10, rate: 0.11, burst: 4, pause: 0.95, spread: 0.035 } };
const npcFac = g => g.fac || (g.brain === 'zombie' ? 'mutant' : g.brain === 'none' ? null : 'civ');
function canEdit(p) { if (!p) return false; if (!Net.online || p.id === Net.hostId) return true; return Rules.editPerm === 'all' || (Rules.editPerm === 'list' && p.canEdit); }
function applyAdd(m) {
  for (const d of m.ents || []) World.create(d);
  for (const g of m.groups || []) World.groups.set(g.id, g);
  for (const c of m.cons || []) if ((!c.a || World.ents.has(c.a)) && (!c.b || World.ents.has(c.b))) World.addCon(c);
}
function applyRem(m) {
  for (const id of m.cons || []) World.removeCon(id);
  for (const id of m.ents || []) World.remove(id);
  for (const id of m.groups || []) World.groups.delete(id);
}
const Auth = {
  nades: [], rockets: [], fuses: [], activeThr: [], contraptions: new Map(), cVer: -1, corpses: [],
  broadcast(m) { Net.bcast(m); },
  // ---- entry point for every client request (host only) --------------------
  handle(pid, m) {
    const p = Players.map.get(pid); if (!p || !m || !m.t) return;
    switch (m.t) {
      case 'grab': return this.grab(p, m);
      case 'drop': if (p.grab) { const e = World.ents.get(p.grab.e); if (e && e.body) e.body.wakeUp(); } p.grab = null; p.beamEnd = null; return;
      case 'freeze': return this.freeze(p);
      case 'unfreeze': return this.setFrozen(World.ents.get(m.e), false);
      case 'tool': return this.tool(p, m);
      case 'spawn': return this.spawnItem(p, m);
      case 'dupe': return this.spawnDupe(p, m);
      case 'fire': return this.fire(p, m);
      case 'nade': return this.throwNade(p, m);
      case 'use': return this.use(p, m);
      case 'undo': return this.undo(p);
      case 'chat': return Net.hostChat(p, m.text);
      case 'tier': return Net.hostTier(p, m.tier);
      case 'edit': return Editor.hostEdit(p, m);
      case 'admin': return Admin.hostAction(p, m);
      case 'ownerHello': return Owner.hostHello(p);
      case 'ownerProof': return Owner.hostProof(p, m);
      case 'respawnme': if (!p.dead) this.respawn(p); return;
      case 'cleanme': { const ids = [...World.ents.values()].filter(e => e.d.o === p.id && e.d.k !== 'map').map(e => e.id); if (ids.length) this.removeEnts(ids); Net.notify(p.id, ids.length ? 'Your props were cleaned up' : 'You have no props to clean up'); return; }
      case 'flip': return this.flipVehicle(p);
      case 'del': return this.deleteGun(p, m);
      case 'door': return this.useDoor(p, m);
      case 'paint': return this.paintBoard(p, m);
    }
  },
  // ---- continuous input from a client (or the host's own player) ----------
  onInput(p, m) {
    const t = now();
    if (!p.isLocal && m.p) {
      const np = new V3().fromArray(m.p), dt = Math.max(0.03, t - p.lastInputT);
      const maxd = (m.n ? 120 : 24) * dt + 1.5;   // noclip can be sped up to 5x (110 m/s sprinting)
      if (p.tpGrace > t || p.dead || p.seat) { /* ignore client position during teleports */ }
      else if (np.distanceTo(p.pos) > maxd || !isFinite(np.x + np.y + np.z)) Net.sendTo(p.id, { t: 'tp', p: a3(p.pos) });
      else { p.vel.subVectors(np, p.pos).divideScalar(dt); p.pos.copy(np); }
    }
    p.yaw = +m.y || 0; p.pitch = clamp(+m.x || 0, -1.55, 1.55); p.crouch = !!m.c;
    p.noclip = !!m.n && Rules.allowNoclip && (!Rules.combat || canEdit(p));
    p.mv = { x: clamp(m.mv ? +m.mv[0] : 0, -1, 1), y: clamp(m.mv ? +m.mv[1] : 0, -1, 1) };
    p.held = new Set(Array.isArray(m.k) ? m.k.slice(0, 40) : []);
    if (W_BY_ID[m.w]) p.weapon = m.w; p.firing = !!m.f;
    p.vb = m.vb | 0; p.tr = Array.isArray(m.tr) ? [clamp(+m.tr[0] || 0, 0, 1), clamp(+m.tr[1] || 0, 0, 1)] : null;   // vehicle buttons / analog triggers
    if (p.grab) {
      if (m.gd) p.grab.dist = clamp(+m.gd, 1, 90);
      if (m.rd && (m.rd[0] || m.rd[1])) { const qy = _q1.setFromAxisAngle(UP, clamp(m.rd[0], -3, 3)), qx = _q2.setFromAxisAngle(_v1.set(1, 0, 0), clamp(m.rd[1], -3, 3)); p.grab.rq.premultiply(qx).premultiply(qy); }
    }
    p.lastInputT = t;
  },
  // ---- physgun ---------------------------------------------------------------
  grab(p, m) {
    const e = World.ents.get(m.e); if (!e || e.d.k === 'map' || !e.body) return;
    if (e.d.fz) this.setFrozen(e, false);
    for (const q of Players.map.values()) if (q.grab && q.grab.e === m.e) q.grab = null;
    const r = e.body.rotation();
    const rq = new QT().setFromAxisAngle(UP, p.yaw).invert().multiply(new QT(r.x, r.y, r.z, r.w));
    p.grab = { e: m.e, lp: new V3().fromArray(m.lp || [0, 0, 0]), dist: clamp(+m.dist || 3, 1, 90), rq };
    if (e.d.g) { const g = World.groups.get(e.d.g); if (g) g.stun = Math.max(g.stun || 0, 1); }
  },
  freeze(p) { if (!p.grab) return; this.setFrozen(World.ents.get(p.grab.e), true); p.grab = null; p.beamEnd = null; },
  setFrozen(e, fz) {
    if (!e || e.d.k === 'map' || !!e.d.fz === fz) return;
    World.patch(e.id, { fz: fz ? 1 : 0 }); this.broadcast({ t: 'upd', e: e.id, patch: { fz: fz ? 1 : 0 } });
  },
  stepPhysgun() {
    for (const p of Players.map.values()) {
      if (!p.grab) continue;
      const e = World.ents.get(p.grab.e); if (e && e.d.k === 'part') { this.wakePart(e); const hg = World.groups.get(e.d.g); if (hg) hg._heldT = now(); }
      if (!e || !e.body || !e.body.isDynamic() || p.dead || p.seat) { p.grab = null; p.beamEnd = null; continue; }
      const eye = _v1.set(p.pos.x, p.pos.y + (p.crouch ? CFG.eye - 0.5 : CFG.eye), p.pos.z);
      const cp = Math.cos(p.pitch), dir = _v2.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
      const target = eye.addScaledVector(dir, p.grab.dist);
      const t = e.body.translation(), r = e.body.rotation(); const q = _q1.set(r.x, r.y, r.z, r.w);
      const gp = _v3.copy(p.grab.lp).applyQuaternion(q).add(_v4.set(t.x, t.y, t.z));
      p.beamEnd = (p.beamEnd || new V3()).copy(gp);
      // rotation toward the held orientation (relative to the player's yaw)
      const qt = _q2.setFromAxisAngle(UP, p.yaw).multiply(p.grab.rq);
      const dq = _q3.copy(qt).multiply(q.clone().invert()); if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
      const ang = 2 * Math.acos(clamp(dq.w, -1, 1)), s = Math.sqrt(1 - dq.w * dq.w);
      const w = s > 1e-4 ? new V3(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(Math.min(ang * 14, 25)) : new V3();
      // linear: move grab point toward the target, compensating for spin
      const err = target.sub(gp); let v = err.multiplyScalar(14); if (v.length() > 50) v.setLength(50);
      const rr = gp.sub(_v4.set(t.x, t.y, t.z)); v.sub(new V3().crossVectors(w, rr));
      e.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true); e.body.setAngvel({ x: w.x, y: w.y, z: w.z }, true);
      if (e.d.g) { const g = World.groups.get(e.d.g); if (g) g.stun = Math.max(g.stun || 0, 0.8); }
    }
  },
  // ---- spawning ---------------------------------------------------------------
  canSpawn(p, n) {
    if (World.countOwned(p.id) + n > Rules.propLimit) { Net.notify(p.id, `Prop limit reached (${Rules.propLimit})`); return false; }
    let total = 0; for (const e of World.ents.values()) if (e.d.k !== 'map') total++;
    if (total + n > CFG.maxBodies) { Net.notify(p.id, 'Object limit reached. Remove some props first.'); return false; }
    return true;
  },
  spawnPrefab(pf, pos, yaw, owner, opts = {}) {
    const qy = new QT().setFromAxisAngle(UP, yaw), lift = opts.noLift ? 0 : -prefabBottom(pf) + 0.03;
    const idMap = new Map(), ents = [], cons = [], groups = [];
    for (const d0 of pf.ents) {
      const d = JSON.parse(JSON.stringify(d0)); const id = World.allocId(); idMap.set(d0.id, id);
      d.id = id; d.o = owner; if (!opts.keepVel) { delete d.v; delete d.w; } delete d.g;
      const p = new V3().fromArray(d0.p || [0, 0, 0]).applyQuaternion(qy).add(pos); p.y += lift;
      d.p = a3(p); d.q = a4(qy.clone().multiply(new QT().fromArray(d0.q || [0, 0, 0, 1])));
      if (opts.vel) d.v = opts.vel;
      ents.push(d);
    }
    for (const g0 of pf.groups || []) {
      const g = JSON.parse(JSON.stringify(g0)); g.id = World.allocId(); g.parts = g0.parts.map(x => idMap.get(x)).filter(Boolean); g.o = owner;
      if (opts.group) Object.assign(g, opts.group);
      for (const d of ents) if (g.parts.includes(d.id)) { d.g = g.id; if (g.c && !g0.parts) d.c = g.c; }
      groups.push(g);
    }
    for (const c0 of pf.cons || []) {
      const c = JSON.parse(JSON.stringify(c0)); c.id = World.allocId();
      c.a = c0.a ? idMap.get(c0.a) : 0; c.b = c0.b ? idMap.get(c0.b) : 0; c.o = owner;
      if (c.a === undefined || c.b === undefined) continue;
      cons.push(c);
    }
    const msg = { t: 'add', ents, cons, groups };
    applyAdd(msg); this.broadcast(msg);
    return { ents: ents.map(d => d.id), cons: cons.map(c => c.id) };
  },
  spawnPoint(p, m) {
    const pos = new V3().fromArray(m.p || [0, 0, 0]);
    if (!isFinite(pos.x + pos.y + pos.z) || pos.distanceTo(p.pos) > 150) return null;
    return pos;
  },
  spawnItem(p, m) {
    const it = ITEM_INDEX[m.item]; if (!it || !it.pf) return;
    const pos = this.spawnPoint(p, m); if (!pos) return;
    const pf = it.pf();
    if (!this.canSpawn(p, pf.ents.length)) return;
    const r = this.spawnPrefab(pf, pos, +m.yaw || 0, p.id);
    this.pushUndo(p, r);
  },
  spawnDupe(p, m) {
    const pf = m.data; if (!pf || !Array.isArray(pf.ents) || pf.ents.length > 300) return Net.notify(p.id, 'Dupe too large');
    const pos = this.spawnPoint(p, m); if (!pos) return;
    for (const d of pf.ents) if (!d || !d.sh || !Array.isArray(d.p) || !Array.isArray(d.q)) return Net.notify(p.id, 'Invalid dupe');
    for (const d of pf.ents) { if (d.k === 'map') d.k = 'prop'; if (MATDEFS[d.m] == null) d.m = 'plastic'; }
    if (!this.canSpawn(p, pf.ents.length)) return;
    const r = this.spawnPrefab(pf, pos, +m.yaw || 0, p.id);
    this.pushUndo(p, r);
    Net.sysChat(`${p.name} spawned dupe "${String(pf.name || 'Contraption').slice(0, 40)}" (${pf.ents.length} objects)`);
  },
  pushUndo(p, r) { (p.undo || (p.undo = [])).push(r); if (p.undo.length > 60) p.undo.shift(); },
  undo(p) {
    const u = p.undo && p.undo.pop(); if (!u) return Net.notify(p.id, 'Nothing to undo');
    const cons = (u.cons || []).filter(id => World.cons.has(id)), ents = (u.ents || []).filter(id => World.ents.has(id));
    if (!cons.length && !ents.length) return this.undo(p);
    if (ents.length) this.removeEnts(ents, cons); else { applyRem({ cons }); this.broadcast({ t: 'rem', cons }); }
    Net.notify(p.id, 'Undone');
  },
  removeEnts(ids, extraCons) {
    const all = new Set(ids), groups = new Set();
    for (const id of ids) { const e = World.ents.get(id); if (e && e.d.g && World.groups.has(e.d.g)) { groups.add(e.d.g); for (const x of World.groups.get(e.d.g).parts) all.add(x); } }
    const msg = { t: 'rem', ents: [...all].filter(id => World.ents.has(id)), groups: [...groups], cons: extraCons || [] };
    for (const p of Players.map.values()) if (p.seat && all.has(p.seat)) this.exitSeat(p);
    applyRem(msg); this.broadcast(msg);
  },
  // ---- Nextbot gamemode: flat faces that sprint at the nearest player and end them on contact -------------
  // Host-side ghosts (no physics body): they slide around walls / frozen props, ride floors and ramps, and are
  // sent to everyone 10x a second (Bots on the client draws them as camera-facing sprites with a drone).
  bots: [], botNetT: 0, botsSent: 0,
  stepBots(dt) {
    const want = Rules.mode === 'nextbot' ? clamp(Rules.bots | 0 || 3, 1, 8) : 0;
    if (this.bots.length > want) this.bots.length = want;
    while (this.bots.length < want) this.bots.push(this.newBot(this.bots.length));
    if (!want) { if (this.botsSent) { Net.bcastAll({ t: 'bots', b: [] }); this.botsSent = 0; } return; }
    for (const b of this.bots) this.moveBot(b, dt);
    if ((this.botNetT -= dt) <= 0) { this.botNetT = 0.1; this.botsSent = 1; Net.bcastAll({ t: 'bots', b: this.bots.map(b => [b.id, r4(b.x), r4(b.y), r4(b.z), b.face]) }); }
  },
  newBot(i) {
    const th = THEMES[Rules.env], sp = th && th.botSpawns;
    let x, z;
    if (sp) { const s = sp[i % sp.length]; x = s[0] + (Math.random() - 0.5) * 3; z = s[2] + (Math.random() - 0.5) * 3; }
    else { const a = Math.random() * Math.PI * 2, r = 45 + Math.random() * 25; x = Math.cos(a) * r; z = Math.sin(a) * r; }
    return { id: i + 1, face: i % 4, x, y: 0, z, vx: 0, vz: 0, wa: Math.random() * 6.28, chk: 2.5, lx: x, lz: z };
  },
  botSolid(c) { const id = Phys.colMap.get(c.handle); if (id === 0) return true; const e = typeof id === 'number' && World.ents.get(id); return !!(e && (e.d.k === 'map' || e.d.fz)); },   // walls, not loose props
  moveBot(b, dt) {
    let tgt = null, bd = Infinity;
    for (const p of Players.map.values()) { if (p.dead || p.noclip || p.seat) continue; const d = Math.hypot(p.pos.x - b.x, p.pos.z - b.z); if (d < bd) { bd = d; tgt = p; } }
    let dx, dz;
    if (tgt) { dx = tgt.pos.x - b.x; dz = tgt.pos.z - b.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L; }
    else { b.wa += (Math.random() - 0.5) * dt * 2; dx = Math.cos(b.wa); dz = Math.sin(b.wa); }
    const o = new V3(b.x, b.y + 1.0, b.z), dir = new V3(); let clear = false;
    for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.5, -1.5, 2.2, -2.2]) {           // steer around walls
      const ca = Math.cos(off), sa = Math.sin(off); dir.set(dx * ca - dz * sa, 0, dx * sa + dz * ca);
      if (!Phys.cast(o, dir, 2.4, null, c => this.botSolid(c))) { dx = dir.x; dz = dir.z; clear = true; break; }
    }
    const sp = CFG.sprint * 0.93 * (clear ? 1 : 0.35), k = 1 - Math.exp(-5 * dt);
    b.vx += (dx * sp - b.vx) * k; b.vz += (dz * sp - b.vz) * k; b.x += b.vx * dt; b.z += b.vz * dt;
    const gh = Phys.cast(new V3(b.x, b.y + 2.2, b.z), new V3(0, -1, 0), 10, null, c => this.botSolid(c));   // ride floors and ramps
    b.y += ((gh ? gh.point.y : 0) - b.y) * Math.min(1, 10 * dt);
    if ((b.chk -= dt) <= 0) { b.chk = 2.5; if (tgt && Math.hypot(b.x - b.lx, b.z - b.lz) < 1.5) { b.x += dx * 2.5; b.z += dz * 2.5; } b.lx = b.x; b.lz = b.z; }   // unstick
    if (tgt && bd < 1.15 && Math.abs(tgt.pos.y - b.y) < 2.2) { Net.sendTo(tgt.id, { t: 'fx', k: 'jumpscare', f: b.face }); this.kill(tgt, null, 'Nextbot'); }
  },
  // doors: E swings the door open (away from you) or shut; the hinge is servo-driven in stepDoors
  useDoor(p, m) {
    const d = World.ents.get(m.e); if (!d || !d.d.door || !d.body || p.dead) return;
    const t = d.body.translation(); if (p.pos.distanceTo(_v1.set(t.x, p.pos.y, t.z)) > 5) return;
    const c = [...World.cons.values()].find(c => c.door && c.b === d.id); if (!c) return;
    const f = World.ents.get(c.a), fq = f && f.body ? f.body.rotation() : { x: 0, y: 0, z: 0, w: 1 }, q = new QT(fq.x, fq.y, fq.z, fq.w);
    if (Math.abs(this.doorAngle(c) || 0) > 0.35) c.dT = 0;
    else { const side = _v2.set(p.pos.x - t.x, 0, p.pos.z - t.z).dot(_v3.set(0, 0, 1).applyQuaternion(q)); c.dT = side >= 0 ? 1.5 : -1.5; }   // swing away from the player
    d.body.wakeUp();
    Net.bcastAll({ t: 'fx', k: 'sfx', n: c.dT ? 'door_open' : 'door_close', p: [r4(t.x), r4(t.y), r4(t.z)] });
  },
  doorAngle(c) {
    const f = World.ents.get(c.a), d = World.ents.get(c.b); if (!d || !d.body) return null;
    const fr = f && f.body ? f.body.rotation() : { x: 0, y: 0, z: 0, w: 1 }, dr = d.body.rotation();
    const rel = _q2.set(fr.x, fr.y, fr.z, fr.w).invert().multiply(_q3.set(dr.x, dr.y, dr.z, dr.w));
    return 2 * Math.atan2(rel.y, rel.w);
  },
  stepDoors() {
    for (const c of World.cons.values()) {
      if (!c.door || c.dT == null) continue;
      const d = World.ents.get(c.b); if (!d || !d.body || !d.body.isDynamic()) continue;
      let ang = this.doorAngle(c); if (ang == null) continue; if (ang > Math.PI) ang -= Math.PI * 2; if (ang < -Math.PI) ang += Math.PI * 2;
      const f = World.ents.get(c.a), fr = f && f.body ? f.body.rotation() : { x: 0, y: 0, z: 0, w: 1 };
      const ax = _v4.set(0, 1, 0).applyQuaternion(_q2.set(fr.x, fr.y, fr.z, fr.w)), w = d.body.angvel(), fw = f && f.body ? f.body.angvel() : { x: 0, y: 0, z: 0 };
      const want = clamp((c.dT - ang) * 5, -3, 3), rel = (w.x - fw.x) * ax.x + (w.y - fw.y) * ax.y + (w.z - fw.z) * ax.z, dv = (want - rel) * 0.5;
      if (Math.abs(c.dT - ang) < 0.02 && Math.abs(rel) < 0.05) continue;
      d.body.setAngvel({ x: w.x + ax.x * dv, y: w.y + ax.y * dv, z: w.z + ax.z * dv }, true);
    }
  },
  // billboards: a painted image (data URL) stored on the prop, drawn on its face for everyone
  paintBoard(p, m) {
    const e = World.ents.get(m.e); if (!e || !e.d.board || typeof m.img !== 'string') return;
    const t = now(); if (p.paintT && t - p.paintT < 1.5) return Net.notify(p.id, 'Wait a moment before painting again'); p.paintT = t;
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(m.img) || m.img.length > 220000) return Net.notify(p.id, 'That picture is too big');
    World.patch(e.id, { img: m.img }); this.broadcast({ t: 'upd', e: e.id, patch: { img: m.img } });
  },
  // delete gun: props / NPCs (whole body) / map pieces / world decor (trees, rocks, containers)
  deleteGun(p, m) {
    const t = now(); if (p.dead || p.seat || (p.nextDel && t < p.nextDel)) return; p.nextDel = t + 0.15;
    if (m.env != null) {
      const id = m.env | 0, it = Env.items && Env.items[id]; if (!it) return;
      if (!canEdit(p)) return Net.notify(p.id, 'You are not allowed to edit the map');
      Rules.envGone = (Rules.envGone || []).concat(id); Net.sendRules();          // every peer hides it (Env.update)
      Net.bcastAll({ t: 'fx', k: 'delfx', p: it.pos, s: 2 }); return;
    }
    const e = World.ents.get(m.e); if (!e || e.d.k === 'nade') return;
    if (e.d.k === 'map' && !canEdit(p)) return Net.notify(p.id, 'You are not allowed to edit the map');
    const b = e.body && e.body.translation();
    this.removeEnts([e.id]);
    if (b) Net.bcastAll({ t: 'fx', k: 'delfx', p: [r4(b.x), r4(b.y), r4(b.z)], s: 1 });
  },
  // ---- tool gun ---------------------------------------------------------------
  pose(e) { if (!e) return { p: new V3(), q: new QT() }; const t = e.body.translation(), r = e.body.rotation(); return { p: new V3(t.x, t.y, t.z), q: new QT(r.x, r.y, r.z, r.w) }; },
  addCons(p, cons, ents) {
    const msg = { t: 'add', ents: ents || [], cons, groups: [] };
    applyAdd(msg); this.broadcast(msg);
    this.pushUndo(p, { ents: (ents || []).map(d => d.id), cons: cons.map(c => c.id) });
  },
  tool(p, m) {
    const A = m.a && m.a.e ? World.ents.get(m.a.e) : null;
    const Bv = arr => new V3().fromArray(arr || [0, 0, 0]);
    switch (m.m) {
      case 'weld': {
        if (!A || A.d.k === 'map' || !m.b) return;
        const B = m.b.e ? World.ents.get(m.b.e) : null; if (m.b.e && !B) return;
        const a = this.pose(A), b = this.pose(B);
        const c = Object.assign({ id: World.allocId(), t: 'weld', a: A.id, b: B ? B.id : 0, o: p.id }, weldFrames(a.p, a.q, b.p, b.q));
        this.addCons(p, [c]); Net.notify(p.id, B && B.d.k !== 'map' ? 'Welded' : 'Welded to the world'); return;
      }
      case 'rope': {
        if (!A || A.d.k === 'map' || !m.b) return;
        const B = m.b.e ? World.ents.get(m.b.e) : null; if (m.b.e && !B) return;
        const la = Bv(m.a.lp), lb = B ? Bv(m.b.lp) : Bv(m.b.pt);
        const pa = this.pose(A), wa = la.clone().applyQuaternion(pa.q).add(pa.p);
        const wb = B ? (() => { const pb = this.pose(B); return lb.clone().applyQuaternion(pb.q).add(pb.p); })() : lb.clone();
        const len = Math.max(0.2, wa.distanceTo(wb) * clamp(+m.o.len || 1, 0.3, 3)), rigid = clamp(+m.o.rigid, 0, 1);
        const mass = Math.max(0.05, A.body.mass());
        const c = rigid >= 0.95 ? { t: 'rope', len } : { t: 'spring', len, st: (6 + 150 * rigid) * mass, dm: (0.3 + 3 * rigid) * Math.sqrt(mass) };
        Object.assign(c, { id: World.allocId(), a: A.id, b: B ? B.id : 0, pa: a3(la), pb: a3(lb), o: p.id });
        this.addCons(p, [c]); return;
      }
      case 'motor': {   // two ball joints on the spin axis (any orientation), driven by stepMotors
        if (!A || A.d.k === 'map' || !m.b) return;
        const B = m.b.e ? World.ents.get(m.b.e) : null; if (m.b.e && !B) return; if (B === A) return;
        const pa = this.pose(A), pb = this.pose(B), n = Bv(m.a.n).normalize(), P1 = Bv(m.a.pt), P2 = P1.clone().addScaledVector(n, 0.3);
        const loc = (P, ps) => P.clone().sub(ps.p).applyQuaternion(ps.q.clone().invert());
        const b = B ? B.id : 0, o = m.o || {};
        this.addCons(p, [
          { id: World.allocId(), t: 'ball', a: A.id, b, pa: a3(loc(P1, pa)), pb: a3(loc(P1, pb)), o: p.id },
          { id: World.allocId(), t: 'ball', a: A.id, b, pa: a3(loc(P2, pa)), pb: a3(loc(P2, pb)), o: p.id },
          { id: World.allocId(), t: 'motor', a: A.id, b, ax: a3(n.clone().applyQuaternion(pa.q.clone().invert())), pv: a3(loc(P1, pa)), spd: clamp(+o.spd || 4, -30, 30), key: String(o.key || 'KeyM').slice(0, 20), tog: o.tog ? 1 : 0, o: p.id },
        ]);
        Net.notify(p.id, `Motor added. ${o.tog ? 'Press' : 'Hold'} ${keyLabel(o.key || 'KeyM')} to spin it.`); return;
      }
      case 'thruster': {
        if (!A || A.d.k === 'map') return;
        const thr = (A.d.thr || []).slice(); if (thr.length >= 8) return Net.notify(p.id, 'Max 8 thrusters per object');
        const q = this.pose(A).q, n = Bv(m.a.n).normalize();
        const dLocal = n.clone().negate().applyQuaternion(q.clone().invert());
        const lp = Bv(m.a.lp).addScaledVector(n.clone().applyQuaternion(q.clone().invert()), 0.0);
        thr.push({ id: (thr.reduce((x, t) => Math.max(x, t.id), 0) + 1), p: a3(lp), d: a3(dLocal), f: clamp(+m.o.f || 12, 1, 80), key: String(m.o.key || 'KeyF').slice(0, 20), pad: String(m.o.pad || '').slice(0, 6), o: p.id });
        World.patch(A.id, { thr }); this.broadcast({ t: 'upd', e: A.id, patch: { thr } });
        Net.notify(p.id, `Thruster added. Hold ${keyLabel(m.o.key)} to fire.`); return;
      }
      case 'wheel': {
        if (!A || A.d.k === 'map') return;
        if (!this.canSpawn(p, 1)) return;
        const pa = this.pose(A), n = Bv(m.a.n).normalize(), r = clamp(+m.o.r || 0.4, 0.15, 1.2), w = r * 0.6;
        const center = Bv(m.a.pt).addScaledVector(n, w / 2 + 0.03);
        const iq = pa.q.clone().invert(), axL = n.clone().applyQuaternion(iq);
        const d = { id: World.allocId(), k: 'prop', sh: { t: 'wheel', r, w, ax: a3(axL) }, m: 'rubber', c: '#26282d', p: a3(center), q: a4(pa.q), o: p.id, wheel: 1 };
        const c = { id: World.allocId(), t: 'wheel', a: A.id, b: d.id, pa: a3(center.clone().sub(pa.p).applyQuaternion(iq)), pb: [0, 0, 0], ax: a3(axL), o: p.id };
        this.addCons(p, [c], [d]); return;
      }
      case 'seat': {
        if (!this.canSpawn(p, 1)) return;
        const n = Bv(m.a.n).normalize(), up = n.y > 0.6 ? n.clone() : UP.clone();
        const f = new V3(-Math.sin(+m.yaw || 0), 0, -Math.cos(+m.yaw || 0)); f.addScaledVector(up, -f.dot(up)).normalize();
        const Z = f.clone().negate(), X = new V3().crossVectors(up, Z).normalize();
        const q = new QT().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, up, Z));
        const pos = Bv(m.a.pt).addScaledVector(up, 0.08);
        const d = { id: World.allocId(), k: 'prop', sh: { t: 'seat' }, m: 'plastic', c: '#3a3f4b', seat: 1, p: a3(pos), q: a4(q), o: p.id };
        const cons = [];
        if (A && A.d.k !== 'map') { const pa = this.pose(A); cons.push(Object.assign({ id: World.allocId(), t: 'weld', a: A.id, b: d.id, o: p.id }, weldFrames(pa.p, pa.q, pos, q))); }
        this.addCons(p, cons, [d]); return;
      }
      case 'remover': if (A && A.d.k !== 'map') this.removeEnts([A.id]); return;
      case 'heal': {
        const g = A && A.d.g && World.groups.get(A.d.g); if (!g || g.t !== 'npc') return Net.notify(p.id, 'Aim at an NPC');
        const fatal = (g.sev || []).some(j => j === 'neck' || j === 'waist');
        g.lh = PART_HP.slice(); g.bl = 0; g.hp = 100; g.stun = 0; g.state = 'down';
        if (!fatal && !g.alive && !g.corpse) g.alive = 1;
        this.broadcast({ t: 'grp', id: g.id, patch: { hp: 100, alive: g.alive, bl: 0 } });
        Net.bcastAll({ t: 'fx', k: 'heal', g: g.id });
        Net.notify(p.id, fatal ? 'Too late for this one' : g.alive ? `${g.n} patched up` : 'Patched up'); return;
      }
      case 'unconstrain': {
        if (!A) return; const ids = [...World.cons.values()].filter(c => (c.a === A.id || c.b === A.id) && !(A.d.g && c.a && World.ents.get(c.a) && World.ents.get(c.a).d.g === A.d.g)).map(c => c.id);
        const msg = { t: 'rem', cons: ids }; applyRem(msg); this.broadcast(msg); return;
      }
      case 'paint': {
        if (!A || !m.o || !MATDEFS[m.o.m]) return;
        if (A.d.k === 'map' && !canEdit(p)) return Net.notify(p.id, 'You are not allowed to edit the map');
        const patch = { m: m.o.m, c: /^#[0-9a-f]{6}$/i.test(m.o.c) ? m.o.c : null };
        World.patch(A.id, patch); this.broadcast({ t: 'upd', e: A.id, patch }); return;
      }
    }
  },
  // ---- seats & vehicles ---------------------------------------------------------
  use(p, m) {
    if (p.seat) return this.exitSeat(p);
    const e = World.ents.get(m.e); if (!e || !e.d.seat || p.dead) return;
    for (const q of Players.map.values()) if (q.seat === e.id) return Net.notify(p.id, 'Seat is taken');
    const t = e.body.translation(); if (p.pos.distanceTo(_v1.set(t.x, t.y, t.z)) > 7) return;
    p.seat = e.id; p.grab = null; this.cVer = -1;
    Net.bcastAll({ t: 'seat', pid: p.id, e: e.id });
  },
  exitSeat(p) {
    const e = World.ents.get(p.seat); p.seat = 0;
    let out = p.pos.clone();
    if (e && e.body) {
      const t = e.body.translation(), r = e.body.rotation(); const q = new QT(r.x, r.y, r.z, r.w); out = new V3(t.x, t.y, t.z).add(new V3(1.1, 0.4, 0).applyQuaternion(q)); out.y = Math.max(out.y, t.y + 0.3);
      // vehicles: step out beside the body (not inside a wheel), on whichever side is clear
      const c = this.contraption(e.id), ve = c.veh && World.ents.get(c.veh), V = ve && VEH[ve.d.veh];
      if (V && ve.body) {
        const ct = ve.body.translation(), cr = ve.body.rotation(), cq = new QT(cr.x, cr.y, cr.z, cr.w), cp = new V3(ct.x, ct.y, ct.z);
        const rel = new V3(t.x, t.y, t.z).sub(cp).applyQuaternion(cq.clone().invert());
        const hw = Math.max(...V.w.map(w => Math.abs(w[0]) + V.wd / 2), ...V.col.map(b => b[0] / 2)) + 0.6;
        const ownIds = c.set, excl = cc => !ownIds.has(Phys.colMap.get(cc.handle));
        for (const side of [-1, 1]) {
          const cand = new V3(side * hw, rel.y + 0.2, rel.z).applyQuaternion(cq).add(cp);
          const d = cand.clone().sub(new V3(t.x, t.y, t.z)), L = d.length();
          if (Phys.cast(new V3(t.x, t.y, t.z), d.normalize(), L, null, excl)) continue;   // blocked (wall, other car)
          const g = Phys.cast(cand.clone().add(new V3(0, 1, 0)), new V3(0, -1, 0), 6, null, excl);
          out = g ? g.point.clone().add(new V3(0, 0.05, 0)) : cand; break;
        }
      }
    }
    p.pos.copy(out); p.tpGrace = now() + 0.6;
    this.resetMotors(e ? e.id : 0);
    Net.bcastAll({ t: 'seat', pid: p.id, e: 0 });
    Net.sendTo(p.id, { t: 'tp', p: a3(out) });
  },
  contraption(seatId) {
    if (this.cVer !== World.consVer) { this.contraptions.clear(); this.cVer = World.consVer; }
    let c = this.contraptions.get(seatId);
    if (!c) {
      const set = World.connected(seatId); let mass = 0; const wheels = [];
      for (const id of set) { const e = World.ents.get(id); if (e && e.body) mass += e.body.mass(); }
      for (const con of World.cons.values()) if (con.t === 'wheel' && set.has(con.a) && set.has(con.b)) wheels.push(con);
      let veh = 0; for (const id of set) if (World.vehicles.has(id)) { veh = id; break; }
      c = { set, mass, wheels, veh }; this.contraptions.set(seatId, c);
    }
    return c;
  },
  resetMotors(seatId) { if (!seatId) return; const c = this.contraption(seatId); for (const w of c.wheels) if (w.j) w.j.configureMotorVelocity(0, 0.02); },
  stepVehicles(dt) {
    for (const p of Players.map.values()) {
      if (!p.seat) continue;
      const se = World.ents.get(p.seat); if (!se || !se.body) { p.seat = 0; Net.bcastAll({ t: 'seat', pid: p.id, e: 0 }); continue; }
      const c = this.contraption(p.seat);
      const thr = clamp(p.mv.y + (p.tr ? p.tr[1] - p.tr[0] : 0), -1, 1);
      if (se.d.pas) continue;                                                   // passenger seat
      if (c.veh) {                                                              // raycast vehicle: hand the input to its controller
        const ve = World.ents.get(c.veh), ctl = ve && Vehicles.ensure(ve);
        if (ctl) ctl.drv = { thr, steer: p.mv.x, hand: !!(p.vb & 1), boost: !!(p.vb & 2) };
        continue;
      }
      const r = se.body.rotation(), q = _q1.set(r.x, r.y, r.z, r.w);
      const f = _v1.set(0, 0, -1).applyQuaternion(q), rt = _v2.set(1, 0, 0).applyQuaternion(q), up = _v3.set(0, 1, 0).applyQuaternion(q);
      const st = se.body.translation();
      const my = thr, mx = p.mv.x;
      for (const w of c.wheels) {
        if (!w.j) continue;
        const A = World.ents.get(w.a), B = World.ents.get(w.b); if (!A || !B) continue;
        const ar = A.body.rotation(); const axW = _v4.fromArray(w.ax).applyQuaternion(_q2.set(ar.x, ar.y, ar.z, ar.w));
        const sign = Math.sign(new V3().crossVectors(axW, up).dot(f)) || 1;
        const bt = B.body.translation(); const side = Math.sign((bt.x - st.x) * rt.x + (bt.y - st.y) * rt.y + (bt.z - st.z) * rt.z) || 1;
        const S = clamp(22 / ((B.d.sh && B.d.sh.r) || 0.4), 12, 90);   // ~22 m/s top speed whatever the wheel size
        if (Math.abs(my) + Math.abs(mx) < 0.05) w.j.configureMotorVelocity(0, 0.25 * c.mass);
        else w.j.configureMotorVelocity(sign * S * clamp(my - mx * side * 0.7, -1, 1), 0.6 * c.mass);
        B.body.wakeUp();
      }
      if (Math.abs(mx) > 0.05) se.body.applyTorqueImpulse({ x: up.x * -mx * c.mass * 2.2 * dt, y: up.y * -mx * c.mass * 2.2 * dt, z: up.z * -mx * c.mass * 2.2 * dt }, true);
      if (!c.wheels.length && Math.abs(my) > 0.05) se.body.applyImpulse({ x: f.x * my * c.mass * 3 * dt, y: 0, z: f.z * my * c.mass * 3 * dt }, true);
    }
  },
  // put an upside-down contraption back on its wheels (R / RB while seated)
  flipVehicle(p) {
    if (!p.seat) return;
    const c = this.contraption(p.seat), pe = World.ents.get(c.veh || p.seat); if (!pe || !pe.body) return;
    const t = pe.body.translation(), r = pe.body.rotation(), q0 = new QT(r.x, r.y, r.z, r.w);
    // only when it's actually on its side / roof, and not again right away (mashing R used to lift it 1.2 m per press)
    if (new V3(0, 1, 0).applyQuaternion(q0).y > 0.55) return;
    const tn = now(); if (p.flipT && tn - p.flipT < 2) return; p.flipT = tn;
    const f = new V3(0, 0, -1).applyQuaternion(q0); const yaw = Math.atan2(-f.x, -f.z);
    const q1 = new QT().setFromAxisAngle(UP, Number.isFinite(yaw) ? yaw : 0), dq = q1.clone().multiply(q0.clone().invert());
    // lift just enough to clear the ground, measured from the ground under it
    const own = c.set, gh = Phys.cast(new V3(t.x, t.y + 2, t.z), new V3(0, -1, 0), 8, null, cc => !own.has(Phys.colMap.get(cc.handle)));
    const piv = new V3(t.x, t.y, t.z), lift = new V3(0, gh ? clamp(gh.point.y + 1.1 - t.y, 0, 1.2) : 0.6, 0);
    for (const id of c.set) {
      const e = World.ents.get(id); if (!e || !e.body || !e.body.isDynamic()) continue;
      const bt = e.body.translation(), br = e.body.rotation();
      const np = new V3(bt.x, bt.y, bt.z).sub(piv).applyQuaternion(dq).add(piv).add(lift), nq = dq.clone().multiply(new QT(br.x, br.y, br.z, br.w));
      e.body.setTranslation({ x: np.x, y: np.y, z: np.z }, true); e.body.setRotation({ x: nq.x, y: nq.y, z: nq.z, w: nq.w }, true);
      e.body.setLinvel({ x: 0, y: 0, z: 0 }, true); e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  },
  // motors: spin the part about its axis (relative to what it's mounted on) while the key is held / toggled on
  stepMotors() {
    for (const c of World.cons.values()) {
      if (c.t !== 'motor') continue;
      const A = World.ents.get(c.a); if (!A || !A.body) continue;
      let held = false;
      for (const p of Players.map.values()) {
        if (!p.held.has(c.key)) continue;
        if ((p.id === c.o && !p.seat) || (p.seat && this.contraption(p.seat).set.has(A.id))) { held = true; break; }
      }
      if (c.tog) { if (held && !c._was) c._on = !c._on; c._was = held; } else c._on = held;
      if (!c._on) continue;
      // an NPC on either end goes limp while the motor runs (its balance / pose controllers would fight the spin)
      const B = c.b && World.ents.get(c.b), gA = A.d.g && World.groups.get(A.d.g), gB = B && B.d.g && World.groups.get(B.d.g);
      for (const g of [gA, gB]) if (g && g.t === 'npc') { if (g._kin) this.unkin(g); g.stun = Math.max(g.stun || 0, 0.5); g._heldT = now(); }
      if (!A.body.isDynamic()) continue;
      const r = A.body.rotation(), qa = _q2.set(r.x, r.y, r.z, r.w), ax = _v4.fromArray(c.ax).applyQuaternion(qa).normalize();
      const wb = B && B.body ? B.body.angvel() : { x: 0, y: 0, z: 0 }, wa = A.body.angvel();
      const rel = (wa.x - wb.x) * ax.x + (wa.y - wb.y) * ax.y + (wa.z - wb.z) * ax.z, dv = (c.spd - rel) * 0.35;
      if (gA && gA.t === 'npc') {   // spinning an NPC: turn the whole ragdoll rigidly about the axle, not just the clicked limb
        const t = A.body.translation(), pv = c.pv ? new V3().fromArray(c.pv).applyQuaternion(qa).add(t) : new V3(t.x, t.y, t.z), d = new V3(), dvl = new V3();
        for (const id of gA.parts) {
          const e = World.ents.get(id); if (!e || !e.body || !e.body.isDynamic() || (B && id === B.id)) continue;
          const pt = e.body.translation(), w = e.body.angvel(), v = e.body.linvel();
          dvl.crossVectors(ax, d.set(pt.x - pv.x, pt.y - pv.y, pt.z - pv.z)).multiplyScalar(dv);
          e.body.setAngvel({ x: w.x + ax.x * dv, y: w.y + ax.y * dv, z: w.z + ax.z * dv }, true);
          e.body.setLinvel({ x: v.x + dvl.x, y: v.y + dvl.y, z: v.z + dvl.z }, true);
        }
      } else A.body.setAngvel({ x: wa.x + ax.x * dv, y: wa.y + ax.y * dv, z: wa.z + ax.z * dv }, true);
    }
  },
  stepThrusters(dt) {
    this.activeThr.length = 0;
    const drivers = [];
    for (const p of Players.map.values()) if (p.seat) drivers.push([p, this.contraption(p.seat).set]);
    for (const e of World.ents.values()) {
      if (!e.d.thr || !e.body || !e.body.isDynamic()) continue;
      let q = null, t = null;
      for (const th of e.d.thr) {
        let on = false;
        for (const p of Players.map.values()) {
          if (!(p.held.has(th.key) || (th.pad && p.held.has(th.pad)))) continue;
          if (p.id === (th.o || e.d.o) && !p.seat) { on = true; break; }
          if (p.seat && drivers.some(([dp, set]) => dp === p && set.has(e.id))) { on = true; break; }
        }
        if (!on) continue;
        if (!q) { const r = e.body.rotation(), tt = e.body.translation(); q = new QT(r.x, r.y, r.z, r.w); t = new V3(tt.x, tt.y, tt.z); }
        const F = new V3().fromArray(th.d).applyQuaternion(q).multiplyScalar(th.f * dt), P = new V3().fromArray(th.p).applyQuaternion(q).add(t);
        e.body.applyImpulseAtPoint({ x: F.x, y: F.y, z: F.z }, { x: P.x, y: P.y, z: P.z }, true);
        this.activeThr.push(e.id, th.id);
      }
    }
  },
  // ---- combat ---------------------------------------------------------------
  fire(p, m) {
    const W = W_BY_ID[m.w]; if (!W || !(W.range || W.proj) || p.dead || p.seat) return;
    const t = now(); if (p.nextFire && t < p.nextFire - 0.05) return; p.nextFire = t + W.rate;
    const o = new V3().fromArray(m.o), d = new V3().fromArray(m.d).normalize();
    if (!isFinite(o.x + o.y + o.z + d.x + d.y + d.z) || o.distanceTo(p.pos) > 4) return;
    if (W.proj === 'rocket') return this.launchRocket(p, o, d);
    if (W.proj === 'prop') return this.launchProp(p, o, d);
    const n = W.pellets || 1, ends = []; let last = null;
    for (let i = 0; i < n; i++) { const r = this.hitscan(p, W, o, n > 1 ? jitter(d.clone(), W.spread) : d); ends.push(a3(r.end)); if (r.h) last = r; }
    if (W.id !== 'crowbar') Net.bcastExcept(p.id, { t: 'fx', k: 'shot', o: a3(o.clone().addScaledVector(d, 0.6)), e: n > 1 ? ends : ends[0], w: W.id, n: n === 1 && last ? a3(last.h.normal) : null });
    else if (last) Net.bcastExcept(p.id, { t: 'fx', k: 'spark', e: a3(last.end), n: a3(last.h.normal) });
    this.scare(last ? last.end : o.clone().addScaledVector(d, 30), 9); this.scare(o, 6);
  },
  // one hitscan ray: knock the prop, hurt the NPC / player, set off explosives, break breakables
  hitscan(p, W, o, d) {
    const h = Phys.cast(o, d, W.range, p.body);
    const end = h ? h.point : o.clone().addScaledVector(d, W.range);
    if (!h) return { h, end };
    if (typeof h.id === 'number' && h.id > 0) {
      const e = World.ents.get(h.id); if (e && e.d.k === 'part') this.wakePart(e);
      if (e && e.body && e.body.isDynamic()) {
        const imp = Math.min(W.imp, e.body.mass() * W.dv);
        e.body.applyImpulseAtPoint({ x: d.x * imp, y: d.y * imp, z: d.z * imp }, { x: h.point.x, y: h.point.y, z: h.point.z }, true);
      }
      const g = e && e.d.g && World.groups.get(e.d.g);
      if (g && g.t === 'npc') this.hurtPart(g, g.parts.indexOf(e.id), W.dmg, { kind: W.id === 'crowbar' ? 'blunt' : 'bullet', point: h.point, normal: h.normal, dir: d, stun: W.id === 'crowbar' ? 1.5 : W.zoom ? 2 : 0.7, by: 'p:' + p.id });
      else if (e && e.d.g) this.damageGroup(e.d.g, W.dmg, 0.7);
      if (e) this.propHit(e, p.id, W.dmg);
    } else if (typeof h.id === 'string') {
      const victim = Players.map.get(h.id.slice(2));
      if (victim) { const head = h.point.y > victim.pos.y + 1.42; this.damagePlayer(victim, W.dmg * (head ? 1.8 : 1), p, W.name, d.clone().multiplyScalar(W.push || 1.2), { p: h.point, head }); if (Rules.combat) Net.bcastAll({ t: 'fx', k: 'gore', p: a3(h.point), d: a3(d), s: 0.6, w: 'bullet' }); }
    }
    return { h, end };
  },
  propHit(e, owner, dmg) {
    if (e.d.xp) this.ignite(e, owner, 0.04 + Math.random() * 0.08);
    else if (e.d.brk) {
      if (e.d.hp) { e.hpLeft = (e.hpLeft ?? e.d.hp) - (dmg || 20); if (e.hpLeft > 0) return; }   // walls / crates take a few hits
      this.shatter(e);
    }
  },
  ignite(e, owner, delay) { if (e.lit) return; e.lit = 1; this.fuses.push({ id: e.id, t: delay, owner }); },
  // glass shatters into shards, melons splatter, balloons pop (debris cleans itself up)
  shatter(e) {
    if (!e.body || e.gone) return; e.gone = 1;
    const t = e.body.translation(), r = e.body.rotation(), c = new V3(t.x, t.y, t.z), q = new QT(r.x, r.y, r.z, r.w), lv = e.body.linvel(), kind = e.d.brk;
    this.removeEnts([e.id]);
    Net.bcastAll({ t: 'fx', k: 'burst', p: a3(c), n: kind, c: e.d.c || '#cdeeff' });
    if (kind === 'pop') return;
    const ents = [], rnd = (a, b) => a + Math.random() * (b - a);
    const piece = (sh, m, col, lp, spd) => {
      const wp = lp.clone().applyQuaternion(q).add(c), out = lp.clone().applyQuaternion(q).normalize();
      const v = out.multiplyScalar(spd).add(new V3(lv.x + rnd(-1, 1), lv.y + rnd(0.5, 2), lv.z + rnd(-1, 1)));
      ents.push({ id: ents.length + 1, k: 'prop', sh, m, c: col, p: a3(wp), q: a4(q.clone().multiply(new QT().setFromEuler(new THREE.Euler(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1))))), v: a3(v), w: [rnd(-6, 6), rnd(-6, 6), rnd(-6, 6)], tmp: 1 });
    };
    const S = e.d.sh.s || [0.8, 0.8, 0.8], col = e.d.c || null, shade = (hex, k) => '#' + new THREE.Color(hex || '#999999').multiplyScalar(k).getHexString();
    if (kind === 'brick') {         // a grid of bricks, pushed out a little
      const nx = clamp(Math.round(S[0] / 0.42), 1, 7), ny = clamp(Math.round(S[1] / 0.22), 1, 9), bw = S[0] / nx, bh = S[1] / ny;
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        if (nx * ny > 36 && Math.random() < 0.35) continue;
        piece({ t: 'box', s: [+(bw * 0.94).toFixed(2), +(bh * 0.9).toFixed(2), +(S[2] * 0.9).toFixed(2)] }, 'concrete', shade(col, 0.8 + Math.random() * 0.35), new V3(-S[0] / 2 + bw * (x + 0.5), -S[1] / 2 + bh * (y + 0.5), 0), rnd(0.5, 2.5));
      }
    } else if (kind === 'wood') {   // planks and splinters
      for (let i = 0; i < 9; i++) piece({ t: 'box', s: [+rnd(S[0] * 0.15, S[0] * 0.5).toFixed(2), +rnd(0.05, Math.max(0.08, S[1] * 0.2)).toFixed(2), +Math.max(0.03, S[2] * 0.8).toFixed(2)] }, 'wood', shade(col || '#9b7148', 0.85 + Math.random() * 0.3), new V3(rnd(-S[0] / 3, S[0] / 3), rnd(-S[1] / 3, S[1] / 3), 0), rnd(1, 4));
    } else if (kind === 'concrete') {   // chunky rubble
      for (let i = 0; i < 12; i++) { const k = rnd(0.12, 0.3) * Math.min(S[0], S[1]); piece({ t: 'box', s: [+(k * rnd(0.8, 1.6)).toFixed(2), +(k * rnd(0.6, 1.2)).toFixed(2), +Math.min(S[2], k).toFixed(2)] }, 'concrete', shade(col, 0.8 + Math.random() * 0.3), new V3(rnd(-S[0] / 2.5, S[0] / 2.5), rnd(-S[1] / 2.5, S[1] / 2.5), 0), rnd(0.5, 3)); }
    } else if (kind === 'glass') {
      const [w, hh] = e.d.sh.s, n = Math.round(clamp(w * hh * 4, 6, 14));
      for (let i = 0; i < n; i++) piece({ t: 'box', s: [+rnd(w * 0.12, w * 0.3).toFixed(2), +rnd(hh * 0.12, hh * 0.3).toFixed(2), 0.03] }, 'glass', e.d.c || null, new V3(rnd(-w / 2.5, w / 2.5), rnd(-hh / 2.5, hh / 2.5), 0), rnd(0.5, 2));
    } else {
      for (let i = 0; i < 7; i++) {
        const flesh = i < 4, dir = new V3(rnd(-1, 1), rnd(-0.3, 1), rnd(-1, 1)).normalize();
        piece({ t: 'box', s: flesh ? [0.1, 0.09, 0.1] : [0.14, 0.04, 0.11] }, 'plastic', flesh ? '#e8413c' : '#3f8a3a', dir.multiplyScalar(0.08), rnd(2, 4.5));
      }
    }
    const r2 = this.spawnPrefab({ ents, cons: [], groups: [] }, new V3(), 0, 'sys', { noLift: true, keepVel: true });
    this.corpses.push({ ents: r2.ents, t: ['brick', 'wood', 'concrete'].includes(kind) ? 25 : 12 });   // debris cleans itself up
  },
  launchRocket(p, o, d) {
    const pos = o.clone().addScaledVector(d, 0.9), q = new QT().setFromUnitVectors(new V3(0, 0, -1), d);
    const r = this.spawnPrefab(single({ k: 'rocket', sh: { t: 'rocket' }, m: 'metal', c: '#55653f', vis: 'rocket', gs: 0, den: 2, q: a4(q) }), pos, 0, p.id, { noLift: true, vel: a3(d.clone().multiplyScalar(34)) });
    if (r.ents[0]) this.rockets.push({ id: r.ents[0], owner: p.id, t: 6 });
    Net.bcastExcept(p.id, { t: 'fx', k: 'sfx', n: 'rocket_fire', p: a3(o) });
  },
  launchProp(p, o, d) {
    const pf = ITEM_INDEX[pickOne(CANNON_AMMO)].pf();
    if (!this.canSpawn(p, pf.ents.length)) return;
    const e0 = pf.ents[0]; e0.tmp = 1; e0.w = [(Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8];
    const v = d.clone().multiplyScalar(30).addScaledVector(p.vel, 0.5);
    const r = this.spawnPrefab(pf, o.clone().addScaledVector(d, 1.4), p.yaw, p.id, { noLift: true, vel: a3(v), keepVel: true });
    this.corpses.push({ ents: r.ents, t: 30 });
    Net.bcastExcept(p.id, { t: 'fx', k: 'sfx', n: 'propcannon', p: a3(o) });
  },
  stepRockets(dt) {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const rk = this.rockets[i], e = World.ents.get(rk.id);
      if (!e || !e.body) { this.rockets.splice(i, 1); continue; }
      rk.t -= dt;
      const t = e.body.translation(), v = e.body.linvel(), sp = Math.hypot(v.x, v.y, v.z), owner = Players.map.get(rk.owner);
      let hit = null;
      if (sp > 0.5) {
        const dir = new V3(v.x / sp, v.y / sp, v.z / sp);
        const h = Phys.cast(new V3(t.x, t.y, t.z), dir, sp * dt + 0.25, owner && rk.t > 5.7 ? owner.body : null, c => Phys.colMap.get(c.handle) !== rk.id);
        if (h) hit = h.point.clone().addScaledVector(h.normal, 0.15);
      }
      if (!hit && (rk.t <= 0 || sp < 12)) hit = new V3(t.x, t.y, t.z);   // timed out, or it hit something and slowed down
      if (hit) { this.rockets.splice(i, 1); this.removeEnts([rk.id]); this.explode(hit, rk.owner, 'Rocket', 1.1); }
    }
  },
  throwNade(p, m) {
    const t = now(); if (p.dead || p.seat || (p.nextNade && t < p.nextNade)) return; p.nextNade = t + 2.3;
    const o = new V3().fromArray(m.o), d = new V3().fromArray(m.d).normalize(); if (o.distanceTo(p.pos) > 4) return;
    const pos = o.addScaledVector(d, 0.7), v = d.multiplyScalar(15).add(p.vel.clone().multiplyScalar(0.5)); v.y += 2;
    const r = this.spawnPrefab(single({ k: 'nade', sh: { t: 'nade' }, m: 'metal', c: '#3d4a32', den: 3 }), pos, 0, p.id, { noLift: true, vel: a3(v) });
    this.nades.push({ id: r.ents[0], t: 2.5, owner: p.id });
  },
  explode(pos, owner, wname = 'Grenade', sc = 1) {
    const R0 = 7.5 * Math.sqrt(sc), hitGroups = new Map(), breaks = [];
    for (const e of World.ents.values()) {
      if (!e.body || e.d.k === 'map') continue;
      const t = e.body.translation(), dv = _v1.set(t.x - pos.x, t.y - pos.y, t.z - pos.z), dist = dv.length();
      if (dist > R0) continue;
      const s = 1 - dist / R0;
      if (e.d.xp && dist < R0 * 0.75) this.ignite(e, owner, 0.12 + Math.random() * 0.22);   // chain reaction
      else if (e.d.brk && s > 0.25) { breaks.push(e); continue; }
      if (e.d.fz && s > 0.6 && e.d.k !== 'part') continue;
      if (e.d.k === 'part') this.wakePart(e);
      if (!e.body.isDynamic()) continue;
      dv.normalize(); dv.y += 0.35; dv.normalize();
      const imp = Math.min(e.body.mass() * 18 * s, 40 * s) * sc;
      e.body.applyImpulse({ x: dv.x * imp, y: dv.y * imp, z: dv.z * imp }, true);
      e.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * imp * 0.2, y: (Math.random() - 0.5) * imp * 0.2, z: (Math.random() - 0.5) * imp * 0.2 }, true);
      if (e.d.g) {
        hitGroups.set(e.d.g, Math.max(hitGroups.get(e.d.g) || 0, s));
        const g = World.groups.get(e.d.g);
        if (g && g.t === 'npc' && s > 0.2) { g._blastT = now(); this.hurtPart(g, g.parts.indexOf(e.id), 75 * s * s * sc * (0.55 + Math.random() * 0.7), { kind: 'blast', point: new V3(t.x, t.y, t.z), dir: dv.clone(), overall: false, quiet: s < 0.45, by: owner ? 'p:' + owner : null }); }
      }
    }
    for (const [gid, s] of hitGroups) {   // once per NPC, not per body part
      const g = World.groups.get(gid), wasAlive = g && g.alive, dmg = 95 * s * s * sc;
      this.damageGroup(gid, dmg, 1.5 + 2 * s);
      if (owner && g && g.t === 'npc' && wasAlive) { const e = World.ents.get(g.parts[1]); if (e && e.body) this.dmgNum(owner, e.body.translation(), dmg, 'g' + gid, false, !g.alive); }
    }
    for (const e of breaks) this.shatter(e);
    const att = Players.map.get(owner);
    for (const p of Players.map.values()) {
      if (p.dead) continue;
      const dv = new V3(p.pos.x - pos.x, p.pos.y + 1 - pos.y, p.pos.z - pos.z), dist = dv.length(); if (dist > R0) continue;
      const s = 1 - dist / R0; dv.normalize(); dv.y = Math.max(dv.y, 0.3);
      if (!p.seat) Net.sendTo(p.id, { t: 'kb', v: a3(dv.multiplyScalar(14 * s * Math.min(sc, 1.2))) });
      this.damagePlayer(p, 115 * s * sc, att, wname);
    }
    this.scare(pos, 18);
    const msg = { t: 'fx', k: 'boom', p: a3(pos), s: sc }; FX.boom(pos, sc); Net.bcast(msg);
  },
  damageGroup(gid, dmg, stun, scaled) {
    const g = World.groups.get(gid); if (!g) return;
    if (!scaled) dmg *= npcDmgK();
    if (stun !== 0) g.stun = Math.max(g.stun || 0, stun || 1.5);   // 0 = no knockdown (the NPC staggers instead)
    if (!g.alive) return;
    g.hp = Math.max(0, (g.hp ?? 100) - dmg);
    if (g.hp <= 0) { g.alive = 0; this.npcSay(g, 'death'); this.broadcast({ t: 'grp', id: gid, patch: { alive: 0, hp: 0 } }); }
  },
  // floating damage number for the player who dealt it (pid), at world point p
  dmgNum(pid, p, dmg, tgt, head, kill) {
    if (!pid || !(dmg > 0)) return;
    Net.sendTo(pid, { t: 'dn', p: [r4(p.x), r4(p.y), r4(p.z)], v: Math.max(1, Math.round(dmg)), g: tgt, h: head ? 1 : 0, k: kill ? 1 : 0 });
  },
  damagePlayer(v, dmg, att, wname, push, at) {
    if (!Rules.combat || v.dead || dmg <= 0) return;
    const hp0 = v.hp;
    v.hp = Math.max(0, Math.round(v.hp - dmg));
    if (att && att !== v) this.dmgNum(att.id, at ? at.p : { x: v.pos.x, y: v.pos.y + 1.5, z: v.pos.z }, hp0 - v.hp || dmg, 'p' + v.id, at && at.head, v.hp <= 0);
    if (push && !v.seat) Net.sendTo(v.id, { t: 'kb', v: a3(push) });
    Net.sendTo(v.id, { t: 'hurt', hp: v.hp });
    if (att && att !== v) Net.sendTo(att.id, { t: 'hm' });
    if (v.hp <= 0) this.kill(v, att, wname);
  },
  kill(v, att, wname) {
    v.dead = true; v.deadT = CFG.respawn; v.deaths++; v.grab = null;
    if (v.seat) this.exitSeat(v);
    if (att && att !== v) att.kills++;
    // leave a ragdoll corpse in the player's colors
    const pf = npcPrefab('ragdoll');
    pf.groups[0].n = v.name;
    for (const i of [1, 3, 4]) pf.ents[i].c = v.color;   // shirt + sleeves in the player's color
    const r = this.spawnPrefab(pf, v.pos.clone(), v.yaw, 'sys', { noLift: true, group: { alive: 0, hp: 0, corpse: 1 } });
    this.corpses.push({ ents: r.ents, t: 15 });
    for (const id of r.ents) { const e = World.ents.get(id); if (e && e.body) e.body.setLinvel({ x: v.vel.x * 0.5, y: 1, z: v.vel.z * 0.5 }, true); }
    const msg = { t: 'kill', v: v.id, a: att ? att.id : null, w: wname || '' };
    Net.bcastAll(msg);
    Net.sendPlayers();
  },
  respawn(p) {
    const sp = this.pickSpawn();
    p.dead = false; p.hp = 100; p.pos.copy(sp); p.tpGrace = now() + 0.6; p.vel.set(0, 0, 0);
    Net.sendTo(p.id, { t: 'tp', p: a3(sp), respawn: 1 });
  },
  pickSpawn() {
    const sps = [...World.ents.values()].filter(e => e.d.sh.t === 'spawn');
    if (sps.length) { const e = sps[(Math.random() * sps.length) | 0]; return new V3().fromArray(e.d.p).add(new V3(0, 0.1, 0)); }
    const th = THEMES[Rules.env]; if (th && th.spawns) { const s = th.spawns[(Math.random() * th.spawns.length) | 0]; return new V3(s[0] + (Math.random() - 0.5) * 1.5, s[1], s[2] + (Math.random() - 0.5) * 1.5); }
    const a = Math.random() * Math.PI * 2; return new V3(Math.cos(a) * 3, 0.2, 6 + Math.sin(a) * 3);
  },
  // ---- NPC brains: active ragdolls ---------------------------------------------
  // Hinge motors drive a procedural pose (walk/run cycle, idle breathing, zombie reach),
  // while upright torques + a pelvis support force keep the body balanced. Knocked-over
  // NPCs go limp, then get back up. Everything runs on the host; clients just see the bodies.
  npcJoints(g) {
    if (g._J && g._jv === World.consVer) return g._J;
    const idx = new Map(g.parts.map((id, i) => [id, i])), J = {};
    for (const c of World.cons.values()) { const ia = idx.get(c.a), ib = idx.get(c.b); if (ia !== undefined && ib !== undefined) J[ia + '-' + ib] = c; }
    g._J = { waist: J['0-1'], neck: J['1-2'], shL: J['1-3'], shR: J['1-4'], elL: J['3-5'], elR: J['4-6'], hipL: J['0-7'], hipR: J['0-8'], knL: J['7-9'], knR: J['8-10'] };
    g._jv = World.consVer;
    return g._J;
  },
  npcPose(g, P, tone) {
    const J = this.npcJoints(g);
    for (const k in J) {
      const c = J[k]; if (!c || !c.j || c.t !== 'hinge' || !c.j.configureMotorPosition) continue;
      const S = NPC_MOTOR[k], pi = JOINT_PART[k];
      const t2 = g.lh && pi ? tone * clamp(g.lh[pi] / PART_HP[pi] * 1.7, 0.04, 1) : tone;   // damaged limbs lose strength
      if (!P || t2 <= 0) c.j.configureMotorPosition(0, 0, 0.02);
      else c.j.configureMotorPosition(P[k] || 0, S[0] * t2, S[1] * Math.sqrt(t2));
    }
    // the motors are too soft to lift these very light limbs (arms sagged, guns pointed at the floor), so arms and neck
    // are also steered at the velocity level: spin the child about its hinge (-X of the parent) toward the target angle
    if (P && tone > 0.15) for (const k of SERVO_KEYS) {
      const c = J[k], ea = c && World.ents.get(c.a), eb = c && World.ents.get(c.b);
      if (!ea || !eb || !ea.body || !eb.body || !eb.body.isDynamic()) continue;
      const pi = JOINT_PART[k], t2 = g.lh ? tone * clamp(g.lh[pi] / PART_HP[pi] * 1.7, 0.04, 1) : tone;
      const ra = ea.body.rotation(), rb = eb.body.rotation(), qa = _sq1.set(ra.x, ra.y, ra.z, ra.w);
      const qr = _sq2.copy(qa).invert().multiply(_sq3.set(rb.x, rb.y, rb.z, rb.w)), ang = -2 * Math.atan2(qr.x, qr.w);
      const w = clamp(((P[k] || 0) - ang) * 14, -12, 12), ax = _sv1.set(-1, 0, 0).applyQuaternion(qa), wa = ea.body.angvel(), wb = eb.body.angvel(), f = 0.6 * t2;
      eb.body.setAngvel({ x: wb.x + (wa.x + ax.x * w - wb.x) * f, y: wb.y + (wa.y + ax.y * w - wb.y) * f, z: wb.z + (wa.z + ax.z * w - wb.z) * f }, true);
    }
  },
  // ---- factions: targets, gunfire, infection ------------------------------------------
  npcTarget(g, pt, dt) {
    const fac = npcFac(g); if (!fac) return null;
    const T = g._tgt, alive = T && (T.p ? !T.p.dead && Players.map.has(T.p.id) : T.g.alive && World.groups.has(T.g.id));
    if (T && alive) {   // keep the target's position fresh every step
      if (T.p) T.pos.set(T.p.pos.x, T.p.pos.y + 1.25, T.p.pos.z); else { const e = World.ents.get(T.g.parts[1]); if (e && e.body) { const t = e.body.translation(); T.pos.set(t.x, t.y, t.z); } }
      T.d = Math.hypot(T.pos.x - pt.x, T.pos.z - pt.z);
    } else g._tgt = null;
    g._tt = (g._tt || 0) - dt; if (g._tt > 0) return g._tgt;
    g._tt = 0.35 + Math.random() * 0.2;
    const t = now(), range = fac === 'mutant' ? 35 : 55;
    let best = null, bd = range, threat = null, td = 12;
    if (Rules.combat) for (const p of Players.map.values()) {
      if (p.dead || p.noclip) continue;
      if (!(fac === 'mutant' || fac === 'raider' || (fac === 'law' && p.aggroT && t - p.aggroT < 45))) continue;
      const d = Math.hypot(p.pos.x - pt.x, p.pos.z - pt.z); if (d < bd) { bd = d; best = { p, pos: new V3(p.pos.x, p.pos.y + 1.25, p.pos.z), d }; }
    }
    for (const o of World.groups.values()) {
      if (o === g || o.t !== 'npc' || !o.alive) continue;
      const of = npcFac(o); if (!of) continue;
      const e = World.ents.get(o.parts[1]); if (!e || !e.body) continue;
      const tp = e.body.translation(), d = Math.hypot(tp.x - pt.x, tp.z - pt.z);
      if (fac === 'civ') { if ((of === 'mutant' || of === 'raider') && d < td) { td = d; threat = tp; } continue; }
      const hostile = fac === 'mutant' ? of !== 'mutant' : fac === 'raider' ? of !== 'raider' : (of === 'raider' || of === 'mutant' || (o.aggroT && t - o.aggroT < 45));
      if (hostile && d < bd) { bd = d; best = { g: o, pos: new V3(tp.x, tp.y, tp.z), d }; }
    }
    if (threat && fac === 'civ') { g.flee = 3 + Math.random() * 2; g.fx = threat.x; g.fz = threat.z; }
    if (best && fac !== 'mutant') {   // line of sight from the head
      const hd = World.ents.get(g.parts[2]).body.translation(), o = new V3(hd.x, hd.y, hd.z), dir = best.pos.clone().sub(o), L = dir.length(); dir.divideScalar(L);
      const h = Phys.cast(o, dir, L, null, c => { const id = Phys.colMap.get(c.handle); return !(typeof id === 'number' && g.parts.includes(id)); });
      best.los = !h || h.dist > L - 0.8 || (best.p ? h.id === 'p:' + best.p.id : (typeof h.id === 'number' && best.g.parts.includes(h.id)));
    }
    return (g._tgt = best);
  },
  npcFire(g, parts, T, dt, yawErr) {
    g.fireT = (g.fireT || 0) - dt;
    if (!T.los || yawErr > 0.3 || g.fireT > 0 || T.d > 60 || !g.gun) return;
    const W = NPC_GUNS[g.gun] || NPC_GUNS.pistol;
    g.burst = (g.burst || 0) + 1;
    if (g.burst >= W.burst) { g.burst = 0; g.fireT = W.pause * (0.8 + Math.random() * 0.5); } else g.fireT = W.rate;
    const hb = parts[6].body, ht = hb.translation(), hr = hb.rotation();
    const o = new V3(0, -0.45, 0).applyQuaternion(new QT(hr.x, hr.y, hr.z, hr.w)).add(new V3(ht.x, ht.y, ht.z));   // muzzle, roughly
    const d = T.pos.clone().sub(o).normalize(); jitter(d, W.spread + 0.004 * T.d / 10);
    const h = Phys.cast(o, d, 150, null, c => { const id = Phys.colMap.get(c.handle); return !(typeof id === 'number' && g.parts.includes(id)); });
    const end = h ? h.point : o.clone().addScaledVector(d, 150);
    Net.bcastAll({ t: 'fx', k: 'shot', o: a3(o), e: a3(end), w: g.gun === 'rifle' ? 'ak' : 'm1911', n: h ? a3(h.normal) : null });
    this.scare(end, 8); this.scare(o, 12);
    if (!h) return;
    if (typeof h.id === 'number' && h.id > 0) {
      const e = World.ents.get(h.id), g2 = e && e.d.g && World.groups.get(e.d.g); if (e && e.d.k === 'part') this.wakePart(e);
      if (e && e.body && e.body.isDynamic()) { const imp = Math.min(0.8, e.body.mass() * 5); e.body.applyImpulseAtPoint({ x: d.x * imp, y: d.y * imp, z: d.z * imp }, h.point, true); }
      if (g2 && g2.t === 'npc') this.hurtPart(g2, g2.parts.indexOf(e.id), W.dmg, { kind: 'bullet', point: h.point, normal: h.normal, dir: d, stun: 0.7, by: 'g:' + g.id });
      else if (e) this.propHit(e, null, W.dmg);
    } else if (typeof h.id === 'string') {
      const v = Players.map.get(h.id.slice(2));
      if (v) { this.damagePlayer(v, W.dmg * (h.point.y > v.pos.y + 1.42 ? 1.6 : 1), null, g.n, d.clone().multiplyScalar(1)); if (Rules.combat) Net.bcastAll({ t: 'fx', k: 'gore', p: a3(h.point), d: a3(d), s: 0.5, w: 'bullet' }); }
    }
  },
  zombify(g) {
    g._bitten = 0; g.infectT = 0;
    if ((g.sev || []).some(j => j === 'neck' || j === 'waist')) return;
    const skin = pickOne(['#8fa37a', '#9aa98a', '#7d8f6b']);
    const patch = (i, pt) => { const e = World.ents.get(g.parts[i]); if (!e) return; World.patch(e.id, pt); this.broadcast({ t: 'upd', e: e.id, patch: pt }); };
    patch(2, { c: skin, vis: 'rd_head_zombie', hc: '#3b3226' }); patch(5, { c: skin }); patch(6, { c: skin, wpn: null });
    Object.assign(g, { alive: 1, hp: 70, brain: 'zombie', kind: 'zombie', fac: 'mutant', n: 'Zombie', bl: 0, lh: PART_HP.slice(), stun: 0.3, state: 'down', gun: null, _tgt: null });
    this.broadcast({ t: 'grp', id: g.id, patch: { alive: 1, hp: 70, brain: 'zombie', kind: 'zombie', fac: 'mutant', n: 'Zombie', bl: 0, gun: null } });
    const t = World.ents.get(g.parts[1]).body.translation(); Net.bcastAll({ t: 'fx', k: 'sfx', n: 'z_groan', p: [r4(t.x), r4(t.y), r4(t.z)] });
  },
  // ---- get-up animation (keyframed, see GETUP) --------------------------------------------
  beginGetup(g, parts, tq, up, tilt) {
    const chest = _v4.set(0, 0, -1).applyQuaternion(tq), hx = up.x, hz = up.z, hl = Math.hypot(hx, hz);
    let kind = tilt < 0.7 ? 'quick' : chest.y > 0 ? 'back' : 'front';
    // heading after standing: facing the feet when getting up off the back, the head direction when face down
    let yaw;
    if (kind === 'quick' || hl < 0.2) { const f = _v4.set(0, 0, -1).applyQuaternion(tq); yaw = Math.atan2(-f.x, -f.z); if (kind !== 'quick' && hl < 0.2) kind = chest.y > 0 ? 'back' : 'front'; }
    else yaw = kind === 'back' ? Math.atan2(hx, hz) : Math.atan2(-hx, -hz);
    const excl = c => { const id = Phys.colMap.get(c.handle); return !(typeof id === 'number' && g.parts.includes(id)); };
    const pt = parts[0].body.translation(), hit = Phys.cast(new V3(pt.x, pt.y + 0.3, pt.z), new V3(0, -1, 0), 3, null, excl);
    const p0 = [], q0 = [];
    for (const e of parts) {
      const t = e.body.translation(), r = e.body.rotation(); p0.push(new V3(t.x, t.y, t.z)); q0.push(new QT(r.x, r.y, r.z, r.w));
      e.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    }
    g._gu = { kind, yaw, t: 0, x: pt.x, z: pt.z, gy: hit ? hit.point.y : Math.min(0, pt.y - 0.2), p0, q0 };
    g._kin = 1; g.state = 'getup'; g.wYaw = yaw; g.stag = 0; g.lv = null;
  },
  // only get up off the ground: not while held by a physics gun, in the air or still sliding
  canGetUp(g, parts, t) {
    if (g._heldT && t - g._heldT < 0.6) return false;
    for (const i of [0, 1]) { const v = parts[i].body.linvel(); if (Math.hypot(v.x, v.y, v.z) > 1.2) return false; }
    const pt = parts[0].body.translation(), excl = c => { const id = Phys.colMap.get(c.handle); return !(typeof id === 'number' && g.parts.includes(id)); };
    return !!Phys.cast(new V3(pt.x, pt.y, pt.z), new V3(0, -1, 0), 0.75, null, excl);
  },
  // back to a physics ragdoll (finished standing, or interrupted); keeps the animation's momentum
  unkin(g) {
    if (!g._kin) return; g._kin = 0; g._gu = null; g.lv = null;
    for (const id of g.parts) {
      const e = World.ents.get(id); if (!e || !e.body || !e.body.isKinematic()) continue;
      e.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      const v = e._kv; e.body.setLinvel(v ? { x: v.x, y: v.y, z: v.z } : { x: 0, y: 0, z: 0 }, true); e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  },
  // something touched an NPC part mid get-up (shot, blast, physgun): drop it back into a ragdoll right away
  wakePart(e) {
    const g = e && e.d.g && World.groups.get(e.d.g);
    if (g && g._kin) { this.unkin(g); g.stun = Math.max(g.stun || 0, 1.2); g.state = 'down'; }
  },
  stepGetup(g, parts, dt) {
    const G = g._gu, A = guPrepare(GETUP[G.kind]); G.t += dt;
    const t = Math.min(G.t, A.T), K = A.keys, P = {};
    for (const k of GU_KEYS) P[k] = guChan(K, t, f => f.P[k] ?? 0);
    npcFK(guChan(K, t, f => f.pr), P);
    const ox = guChan(K, t, f => f.ox), oz = guChan(K, t, f => f.oz);
    let low = Infinity; for (let i = 0; i < 11; i++) low = Math.min(low, npcLow(i));
    const lift = 0.01 + 0.055 * smooth01((t - (A.T - 0.45)) / 0.45);   // ends at the standing brain's hover height
    const qh = _q2.setFromAxisAngle(UP, G.yaw), k = smooth01(G.t / A.bl), qa = new QT(), p = new V3();
    for (let i = 0; i < 11; i++) {
      p.set(FKP[i].x + ox, 0, FKP[i].z + oz).applyQuaternion(qh);
      p.x += G.x; p.z += G.z; p.y = G.gy + FKP[i].y - low + lift;
      qa.copy(qh).multiply(FKQ[i]);
      if (k < 1) { p.lerpVectors(G.p0[i], p.clone(), k); qa.copy(G.q0[i]).slerp(_q1.copy(qh).multiply(FKQ[i]), k); }
      const b = parts[i].body, c = b.translation();
      (parts[i]._kv || (parts[i]._kv = new V3())).set((p.x - c.x) / dt, (p.y - c.y) / dt, (p.z - c.z) / dt);
      b.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z }); b.setNextKinematicRotation({ x: qa.x, y: qa.y, z: qa.z, w: qa.w });
    }
    if (G.t >= A.T + dt) {   // standing: physics takes over, holding the pose with the joint motors
      this.unkin(g); this.npcPose(g, GU_STAND, 1);
      g.state = 'up'; g.stun = 0; g.wT = 0.4 + Math.random() * 0.8;
    }
  },
  // an NPC's voice for everyone: pain / death / scream / attack; male or female by look, zombies growl
  npcSay(g, kind) {
    const e = World.ents.get(g.parts[2]) || World.ents.get(g.parts[1]); if (!e || !e.body) return;
    const t = e.body.translation(), z = g.brain === 'zombie' || g.kind === 'zombie', f = e.d.vis === 'rd_head_long';
    const n = z ? (kind === 'attack' ? 'z_attack' : 'z_pain') : kind === 'scream' ? (f ? 'pain_f' : 'scream') : kind === 'attack' ? null : (kind === 'death' ? 'death_' : 'pain_') + (f ? 'f' : 'm');
    if (n) Net.bcastAll({ t: 'fx', k: 'sfx', n, p: [r4(t.x), r4(t.y), r4(t.z)] });
  },
  // make nearby civilians run away from gunfire / explosions
  scare(pos, radius) {
    for (const g of World.groups.values()) {
      if (g.t !== 'npc' || !g.alive || !['wander', 'idle', 'jog'].includes(g.brain)) continue;
      const e = World.ents.get(g.parts[0]); if (!e || !e.body) continue;
      const t = e.body.translation();
      if (Math.hypot(t.x - pos.x, t.z - pos.z) < radius) { if (!(g.flee > 0) && Math.random() < 0.5 && (!g._scrT || now() - g._scrT > 5)) { g._scrT = now(); this.npcSay(g, 'scream'); } g.flee = 4 + Math.random() * 3; g.fx = pos.x; g.fz = pos.z; }
    }
  },
  stepNPCs(dt) {
    const tNow = now();
    for (const g of World.groups.values()) {
      if (g.t !== 'npc') continue;
      if (g.stun > 0) g.stun -= dt;
      const parts = g.parts.map(id => World.ents.get(id));
      if (g._kin && (parts.length < 11 || parts.some(e => !e || !e.body) || g.stun > 0 || !g.alive || !g.brain || g.brain === 'none')) { this.unkin(g); if (g.state === 'getup') g.state = 'down'; }
      if (parts.length < 11 || parts.some(e => !e || !e.body || !(e.body.isDynamic() || (g._kin && e.body.isKinematic())))) continue;
      if (!g.alive && g._bitten && !g.corpse) { if (!g.infectT) g.infectT = tNow + 6; else if (tNow > g.infectT) this.zombify(g); }
      if (!g.alive || !g.brain || g.brain === 'none') { if (!g.limp) { this.npcPose(g, null, 0); g.limp = 1; } continue; }
      g.limp = 0;
      const pelvis = parts[0].body, torso = parts[1].body, head = parts[2].body;
      const lv = torso.linvel();
      if (g.lv && !g._kin) {   // shoves: small ones make them stagger, big ones knock them over
        const dvx = lv.x - g.lv.x, dvy = lv.y - g.lv.y, dvz = lv.z - g.lv.z, dvm = Math.hypot(dvx, dvy, dvz);
        if (dvm > 7) g.stun = Math.max(g.stun || 0, 2.5);
        else if (dvm > 2.2 && (!g.state || g.state === 'up')) this.stagger(g, _v4.set(dvx, 0, dvz), dvm * 0.6);
      }
      g.lv = { x: lv.x, y: lv.y, z: lv.z };
      if (!g.pace) g.pace = 0.88 + Math.random() * 0.24;                                           // each NPC walks a little differently
      const tr = torso.rotation(), tq = _q1.set(tr.x, tr.y, tr.z, tr.w);
      const up = _v1.set(0, 1, 0).applyQuaternion(tq), tilt = Math.acos(clamp(up.y, -1, 1));
      if ((!g.state || g.state === 'up') && tilt > 1.1 && !(g.stun > 0)) g.stun = 1.2;   // fell over while standing
      const sev = g.sev || [], legless = sev.some(j => j[0] === 'h' || j[0] === 'k'), hpNow = g.hp ?? 100;
      if (legless || hpNow < 15) g.stun = Math.max(g.stun || 0, 0.3);                           // can't stand / passed out
      if (g.stun > 0) {                                                                           // limp; badly hurt NPCs writhe
        if (g.state !== 'down') {   // just went over: remember which way we're falling so the arms can brace
          const ch = _v4.set(0, 0, -1).applyQuaternion(tq); ch.y = 0; ch.normalize();
          g.fallT = 0; g.braceBack = lv.x * ch.x + lv.z * ch.z < -0.3; g.stag = 0;
        }
        g.fallT = (g.fallT || 0) + dt;
        if (g.fallT < 0.9 && hpNow >= 15 && !legless && (g.bl || 0) <= 1.5) {                      // brace with the arms while falling
          const k = 1 - g.fallT / 0.9, sh = g.braceBack ? 0.85 : -1.35;
          this.npcPose(g, { shL: sh, shR: sh, elL: -0.35, elR: -0.35, hipL: -0.35, hipR: -0.2, knL: 0.55, knR: 0.35, waist: g.braceBack ? 0.35 : 0.1, neck: g.braceBack ? 0.4 : -0.2 }, 0.1 + 0.35 * k);
        } else if ((legless || (g.bl || 0) > 1.5) && hpNow >= 15) {
          const w = tNow * 3.1 + g.id;
          this.npcPose(g, { shL: -1.2 + Math.sin(w) * 0.9, shR: -0.9 + Math.sin(w * 1.3 + 1) * 0.9, elL: -1.4 + Math.sin(w * 1.7) * 0.6, elR: -1.1 + Math.cos(w * 1.2) * 0.6,
            hipL: -0.6 + Math.sin(w * 0.9) * 0.5, hipR: -0.4 + Math.cos(w * 1.1) * 0.5, knL: 0.9 + Math.sin(w) * 0.5, knR: 0.8 + Math.cos(w) * 0.5, waist: 0.3, neck: 0.3 }, 0.22);
        } else this.npcPose(g, NPC_REST, 0.08);
        g.state = 'down'; continue;
      }
      if (g.state === 'down') {
        if (this.canGetUp(g, parts, tNow)) this.beginGetup(g, parts, tq, up, tilt);
        else { g.stun = 0.25; this.npcPose(g, NPC_REST, 0.08); continue; }   // still held, flying or tumbling: stay limp
      }
      if (g.state === 'getup') { if (g._kin) { this.stepGetup(g, parts, dt); continue; } g.state = 'up'; }
      const rec = 1;
      // ---- behaviour: pick heading + speed -------------------------------------------
      const pt = pelvis.translation();
      let speed = 0, yaw = g.wYaw || 0, mode = g.brain, lookAt = null, attack = false;
      g.wT = (g.wT || 0) - dt;
      if (g.flee > 0 && !['zombie', 'guard', 'raider'].includes(mode)) { g.flee -= dt; mode = 'flee'; }
      const T = this.npcTarget(g, pt, dt); let aim = null;
      let nearest = null, nd = Infinity;
      for (const p of Players.map.values()) { if (p.dead) continue; const d = Math.hypot(p.pos.x - pt.x, p.pos.z - pt.z); if (d < nd) { nd = d; nearest = p; } }
      switch (mode) {
        case 'flee': yaw = Math.atan2(-(pt.x - g.fx), -(pt.z - g.fz)); speed = 3.0; break;
        case 'jog': if (g.wT <= 0) { g.wT = 3 + Math.random() * 4; g.wYaw = yaw + (Math.random() - 0.5) * 1.6; } yaw = g.wYaw; speed = 2.4; break;
        case 'idle':
          if (g.wT <= 0) { g.wT = 3 + Math.random() * 6; g.walk = Math.random() < 0.25; g.wYaw = yaw + (Math.random() - 0.5) * 2.5; }
          yaw = g.wYaw; speed = g.walk ? 0.8 : 0;
          if (nearest && nd < 7 && !g.walk) { lookAt = nearest; yaw = Math.atan2(-(nearest.pos.x - pt.x), -(nearest.pos.z - pt.z)); }
          break;
        case 'guard': case 'raider':   // armed: close in, stop at range and shoot; otherwise patrol
          if (T) { yaw = Math.atan2(-(T.pos.x - pt.x), -(T.pos.z - pt.z)); aim = T; speed = !T.los || T.d > 22 ? 2.6 : 0; }
          else { if (g.wT <= 0) { g.wT = 3 + Math.random() * 5; g.wYaw = Math.random() * Math.PI * 2; g.walk = Math.random() < 0.6; } yaw = g.wYaw; speed = g.walk ? 0.9 : 0; }
          break;
        case 'zombie':
          if (T && !T.p) {   // an NPC: shamble over and maul it
            yaw = Math.atan2(-(T.pos.x - pt.x), -(T.pos.z - pt.z));
            if (T.d < 1.25) { speed = 0; g.atk = (g.atk || 0) - dt; if (g.atk <= 0) { g.atk = 1.3; g.swing = 0.45; if (Math.random() < 0.5) this.npcSay(g, 'attack'); const dx = T.pos.x - pt.x, dz = T.pos.z - pt.z, L = Math.hypot(dx, dz) || 1; this.hurtPart(T.g, 1, 18, { kind: 'blunt', dir: new V3(dx / L, 0.2, dz / L), stun: 1.2, by: 'g:' + g.id, bite: 1 }); } }
            else speed = T.d < 16 ? 2.7 : 1.3;   // lunges at nearby prey, faster than a fleeing civilian
            if ((g.groan = (g.groan || 3) - dt) <= 0) { g.groan = 4 + Math.random() * 6; Net.bcastAll({ t: 'fx', k: 'sfx', n: 'z_groan', p: [r4(pt.x), r4(pt.y), r4(pt.z)] }); }
          } else if (nearest && nd < 35 && (!T || T.p)) {
            yaw = Math.atan2(-(nearest.pos.x - pt.x), -(nearest.pos.z - pt.z)); lookAt = nearest;
            if (nd < 1.3) { attack = true; speed = 0; g.atk = (g.atk || 0) - dt; if (g.atk <= 0) { g.atk = 1.3; g.swing = 0.45; if (Math.random() < 0.5) this.npcSay(g, 'attack'); const dx = nearest.pos.x - pt.x, dz = nearest.pos.z - pt.z, L = Math.hypot(dx, dz) || 1; this.damagePlayer(nearest, 12, null, 'Zombie', new V3(dx / L * 3, 1.5, dz / L * 3)); } }
            else speed = nd < 12 ? 2.0 : 1.2;
            if ((g.groan = (g.groan || 3) - dt) <= 0) { g.groan = 4 + Math.random() * 6; Net.bcastAll({ t: 'fx', k: 'sfx', n: 'z_groan', p: [r4(pt.x), r4(pt.y), r4(pt.z)] }); }
          } else { if (g.wT <= 0) { g.wT = 4 + Math.random() * 5; g.wYaw = Math.random() * Math.PI * 2; } yaw = g.wYaw; speed = 0.45; }
          break;
        default: // wander
          if (g.wT <= 0) { g.wT = 2.5 + Math.random() * 5; g.wYaw = Math.random() * Math.PI * 2; g.walk = Math.random() < 0.7; }
          yaw = g.wYaw; speed = g.walk ? 1.1 : 0;
          if (!g.walk && nearest && nd < 5) { lookAt = nearest; yaw = Math.atan2(-(nearest.pos.x - pt.x), -(nearest.pos.z - pt.z)); }
      }
      if (Math.hypot(pt.x, pt.z) > 150) yaw = Math.atan2(pt.x, pt.z);   // head back toward the middle of the map
      if (mode === 'flee' || mode === 'jog' || mode === 'wander') g.wYaw = yaw;
      let moveYaw = yaw;
      if (g.stag > 0) { g.stag -= dt; moveYaw = g.stagYaw; speed = g.stagSpd * (0.4 + g.stag); }     // stagger a few steps with the push
      else speed *= g.pace;
      if (g.lh && (g.lh[7] < 40 || g.lh[8] < 40 || g.lh[9] < 32 || g.lh[10] < 32)) speed = Math.min(speed, 0.7);   // limping
      speed *= clamp(hpNow / 60, 0.45, 1);                                                          // weak from blood loss
      // ---- balance: upright + heading torques on torso/pelvis, gentler on the head ----
      const fwd = _v2.set(0, 0, -1).applyQuaternion(tq), curYaw = Math.atan2(-fwd.x, -fwd.z);
      let yawErr = yaw - curYaw; while (yawErr > Math.PI) yawErr -= Math.PI * 2; while (yawErr < -Math.PI) yawErr += Math.PI * 2;
      const ax = _v3.crossVectors(up, UP), kUp = 9 * rec, lean = mode === 'zombie' ? 0.25 : 0;
      for (const b of [torso, pelvis, head]) {
        const av = b.angvel();
        let tx = ax.x * kUp, tz = ax.z * kUp;
        if (b === head) { const hr = b.rotation(), hu = _v4.set(0, 1, 0).applyQuaternion(_q2.set(hr.x, hr.y, hr.z, hr.w)), hax = _v4.crossVectors(hu, UP); tx = hax.x * 6 * rec; tz = hax.z * 6 * rec; }
        const ty = yawErr * 2.4 * rec;
        b.setAngvel({ x: av.x + (tx - av.x) * 0.3, y: av.y + (ty - av.y) * 0.3, z: av.z + (tz - av.z) * 0.3 }, true);
      }
      // ---- support + propulsion ----
      const excl = c => { const id = Phys.colMap.get(c.handle); return !(typeof id === 'number' && g.parts.includes(id)); };
      const hit = Phys.cast(_v4.set(pt.x, pt.y, pt.z), new V3(0, -1, 0), 1.7, null, excl);
      const pv = pelvis.linvel(), hs = Math.hypot(pv.x, pv.z);
      const turning = speed < 0.3 && Math.abs(yawErr) > 0.35;                                    // step around instead of pivoting like a statue
      const a = clamp(Math.max(hs, speed * 0.6, turning ? 0.45 : 0) / 1.3, 0, 1.5);           // gait amplitude
      if (hs > 0.08 || speed > 0 || turning) g.ph = (g.ph || 0) + dt * Math.PI * 2 * (0.55 + 0.35 * Math.min(hs, 3.5)) * (g.pace || 1);
      if (hit) {
        const hgt = pt.y - hit.point.y;
        const want = 0.97 - 0.05 * Math.min(1, hs / 3) + 0.018 * Math.cos((g.ph || 0) * 2) * Math.min(1, a) - (mode === 'zombie' ? 0.03 : 0);
        let mass = 0; for (const e of parts) mass += e.body.mass();
        const lift = (9.81 + (want - hgt) * 60 - pv.y * 8) * mass * dt * (g.state === 'getup' ? 0.45 + 0.75 * rec : 1);
        // steer horizontally first — setting the velocity after the lift impulse would cancel the lift
        const dx = -Math.sin(moveYaw) * speed, dz = -Math.cos(moveYaw) * speed, k = (g.stag > 0 ? 0.2 : 0.12) * rec;
        pelvis.setLinvel({ x: pv.x + (dx - pv.x) * k, y: pv.y, z: pv.z + (dz - pv.z) * k }, true);
        pelvis.applyImpulse({ x: 0, y: Math.max(0, lift * 0.55), z: 0 }, true);
        torso.applyImpulse({ x: 0, y: Math.max(0, lift * 0.45), z: 0 }, true);
      }
      // ---- pose: procedural gait / idle / zombie ----
      const s = Math.sin(g.ph || 0), c = Math.cos(g.ph || 0), run = hs > 1.8 || mode === 'flee' || mode === 'jog';
      const breathe = Math.sin(tNow * 1.8 + g.id) * 0.04;
      const P = {
        hipL: -0.5 * a * s - 0.05 * a, hipR: 0.5 * a * s - 0.05 * a,
        knL: 0.06 + 0.12 * a + a * 0.95 * Math.max(0, c), knR: 0.06 + 0.12 * a + a * 0.95 * Math.max(0, -c),
        shL: (run ? 0.8 : 0.45) * a * s + 0.06 + (a < 0.1 ? breathe : 0), shR: -(run ? 0.8 : 0.45) * a * s + 0.06 + (a < 0.1 ? breathe : 0),
        elL: run ? -1.35 : -0.2 - 0.3 * Math.min(1, a), elR: run ? -1.35 : -0.2 - 0.3 * Math.min(1, a),
        waist: 0.03 + 0.1 * Math.min(1, a) + (run ? 0.1 : 0) + (a < 0.1 ? breathe * 0.4 : 0), neck: -0.05 * a,
      };
      if (a < 0.1) {   // idle: slow weight shift from foot to foot
        const ws = Math.sin(tNow * 0.55 + g.id * 1.7);
        P.hipL += 0.05 * ws; P.hipR -= 0.05 * ws; P.knL += 0.1 * Math.max(0, ws); P.knR += 0.1 * Math.max(0, -ws);
      }
      if (g.stag > 0) { const k = Math.min(1, g.stag / 0.3); P.shL -= 0.5 * k; P.shR -= 0.7 * k; P.elL -= 0.6 * k; P.elR -= 0.5 * k; P.waist += 0.15 * k; }   // arms out for balance
      if (lookAt) { const eyeY = head.translation().y; P.neck += clamp(Math.atan2((lookAt.pos.y + 1.5) - eyeY, Math.max(0.5, nd)), -0.5, 0.45) * -1; }
      if (aim) {   // raise the weapon at the target (negative shoulder = arm up / forward)
        const hy = head.translation().y, elev = Math.atan2(aim.pos.y - hy, Math.max(0.5, aim.d)), a2 = -1.55 - elev;
        if (g.gun === 'rifle') { P.shR = a2 + 0.08; P.elR = -0.12; P.shL = a2 + 0.3; P.elL = -0.95; } else { P.shR = a2; P.elR = -0.05; P.shL = a2 + 0.05; P.elL = -0.3; }
        P.waist = 0.06; P.neck = clamp(-elev, -0.5, 0.45);
        this.npcFire(g, parts, aim, dt, Math.abs(yawErr));
      }
      if (mode === 'zombie') {
        P.shL = P.shR = -1.45 + 0.08 * s; P.elL = P.elR = -0.2; P.waist = 0.25 + lean; P.neck = 0.2;
        P.hipL *= 0.7; P.hipR *= 0.7; P.knR = 0.1 + 0.3 * P.knR;                               // stiff dragging leg
        if (g.swing > 0) { g.swing -= dt; const k = Math.sin((0.45 - g.swing) / 0.45 * Math.PI); P.shL = -1.45 - 1.0 * k; P.shR = -1.45 + 0.6 * k; P.elL = P.elR = -0.9 * k; }
      }
      this.npcPose(g, P, rec);
    }
  },
  // ---- per fixed step (host) ---------------------------------------------------
  step(dt) {
    this.stepBots(dt); this.stepPhysgun(); this.stepThrusters(dt); this.stepMotors(); this.stepDoors(); this.stepVehicles(dt); Phys.sync(); Vehicles.step(dt); this.stepNPCs(dt); this.stepGore(dt); this.stepRockets(dt);
    for (let i = this.fuses.length - 1; i >= 0; i--) {
      const f = this.fuses[i]; f.t -= dt; if (f.t > 0) continue;
      this.fuses.splice(i, 1);
      const e = World.ents.get(f.id); if (!e || !e.body) continue;
      const t = e.body.translation(), sc = e.d.xp || 1; this.removeEnts([f.id]); this.explode(new V3(t.x, t.y, t.z), f.owner, e.d.n || 'Explosion', sc);
    }
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i]; n.t -= dt;
      if (n.t <= 0) { const e = World.ents.get(n.id); this.nades.splice(i, 1); if (e && e.body) { const t = e.body.translation(); this.removeEnts([n.id]); this.explode(new V3(t.x, t.y, t.z), n.owner); } }
    }
    for (let i = this.corpses.length - 1; i >= 0; i--) { const c = this.corpses[i]; c.t -= dt; if (c.t <= 0) { this.corpses.splice(i, 1); const ids = c.ents.filter(id => World.ents.has(id)); if (ids.length) this.removeEnts(ids); } }
    for (const p of Players.map.values()) if (p.dead) { p.deadT -= dt; if (p.deadT <= 0) this.respawn(p); }
  },
  // ---- ragdoll safety net ----------------------------------------------------------
  // Clamp ragdoll part speeds, and if the joints ever get torn apart anyway (huge impacts,
  // a limb yanked through a wall) put the body back together where it was last intact.
  guardRagdolls() {
    for (const g of World.groups.values()) {
      if (g.t !== 'npc') continue;
      const parts = g.parts.map(id => World.ents.get(id));
      if (parts.some(e => !e || !e.body || !e.body.isDynamic())) continue;
      const p0 = parts[0].body.translation(); let bad = !isFinite(p0.x + p0.y + p0.z);
      const att = this.attached(g);
      for (let i = 0; i < parts.length; i++) {
        if (bad) break;
        const e = parts[i], b = e.body, t = b.translation(), v = b.linvel(), w = b.angvel();
        if (!isFinite(t.x + t.y + t.z + v.x + v.y + v.z + w.x + w.y + w.z) || (att.has(i) && Math.hypot(t.x - p0.x, t.y - p0.y, t.z - p0.z) > 2.6)) { bad = true; break; }
        const sv = Math.hypot(v.x, v.y, v.z); if (sv > 60) b.setLinvel({ x: v.x * 60 / sv, y: v.y * 60 / sv, z: v.z * 60 / sv }, true);
        const sw = Math.hypot(w.x, w.y, w.z); if (sw > 45) b.setAngvel({ x: w.x * 45 / sw, y: w.y * 45 / sw, z: w.z * 45 / sw }, true);
      }
      if (bad) { this.reassemble(g, parts); continue; }
      if (!g._rest) {   // body layout relative to the pelvis, captured while intact (normally right after spawn)
        const r0 = parts[0].body.rotation(), qi = new QT(r0.x, r0.y, r0.z, r0.w).invert();
        g._rest = parts.map(e => { const t = e.body.translation(), r = e.body.rotation(); return { p: new V3(t.x - p0.x, t.y - p0.y, t.z - p0.z).applyQuaternion(qi), q: qi.clone().multiply(new QT(r.x, r.y, r.z, r.w)) }; });
      }
      g._safe = [p0.x, p0.y, p0.z];
    }
  },
  // part indices still connected to the pelvis through joints (cached per constraint change)
  attached(g) {
    if (g._att && g._attV === World.consVer) return g._att;
    const idx = new Map(g.parts.map((id, i) => [id, i])), adj = g.parts.map(() => []);
    for (const c of World.cons.values()) { const a = idx.get(c.a), b = idx.get(c.b); if (a !== undefined && b !== undefined) { adj[a].push(b); adj[b].push(a); } }
    const out = new Set([0]), st = [0]; while (st.length) { const x = st.pop(); for (const y of adj[x]) if (!out.has(y)) { out.add(y); st.push(y); } }
    g._att = out; g._attV = World.consVer; return out;
  },
  // ---- gore: per-part damage, dismemberment, bleeding, impact injuries -----------------
  // hit: { kind: bullet|blunt|blast|crush, point, normal, dir, stun, overall (default true), quiet }
  hurtPart(g, i, dmg, hit) {
    if (i < 0 || !(dmg > 0)) return;
    const raw = dmg; dmg *= npcDmgK();   // host's NPC health setting: tougher NPCs take proportionally less from every hit (limbs too)
    if (!g.lh) g.lh = PART_HP.slice();
    if (hit.kind === 'bullet' || hit.kind === 'blunt') g._blastT = now();   // the hit's own shove isn't an impact injury
    const was = g.lh[i]; g.lh[i] = Math.max(-50, g.lh[i] - dmg);
    // small arm / torso hits make them stagger; leg and head hits (or a burst of damage) knock them down
    let stun = hit.stun, t0 = now();
    g._acc = (t0 - (g._accT || 0) < 0.3 ? g._acc || 0 : 0) + dmg; g._accT = t0;
    if (hit.kind === 'bullet' && g._acc < 45 && g.state !== 'down') {
      if (i === 2) stun = 1.2; else if (i >= 7) stun = Math.random() < 0.6 ? 0.9 : 0; else stun = 0;
      if (!stun && hit.dir) this.stagger(g, hit.dir, 0.8 + dmg / 30);
    }
    const wasAlive = g.alive;
    if (hit.overall !== false) this.damageGroup(g.id, dmg * PART_DMG[i], stun, true);
    else g.stun = Math.max(g.stun || 0, hit.stun || 1.5);
    if (hit.by && hit.by[0] === 'p' && hit.overall !== false) {   // blasts report once per NPC from explode()
      const e0 = World.ents.get(g.parts[i]), t0p = hit.point || (e0 && e0.body ? e0.body.translation() : null);
      if (t0p) this.dmgNum(hit.by.slice(2), t0p, raw * PART_DMG[i], 'g' + g.id, i === 2, wasAlive && !g.alive);
    }
    const k = hit.kind, bleed = ({ bullet: 0.6, blunt: 0.2, blast: 0.45, crush: 0.3 }[k] || 0.4) * clamp(dmg / 25, 0.3, 2);
    this.setBleed(g, (g.bl || 0) + bleed);
    const e = World.ents.get(g.parts[i]);
    if (e && e.body && !hit.quiet) {   // wound + blood spray for everyone (host sends where on the part it hit)
      const t = e.body.translation(), r = e.body.rotation(), qi = new QT(r.x, r.y, r.z, r.w).invert();
      const pt = hit.point || new V3(t.x, t.y, t.z), n = hit.normal || (hit.dir ? hit.dir.clone().negate() : new V3(0, 1, 0));
      Net.bcastAll({ t: 'fx', k: 'gore', e: e.id, lp: a3(pt.clone().sub(_v1.set(t.x, t.y, t.z)).applyQuaternion(qi)), ln: a3(n.clone().applyQuaternion(qi)), p: a3(pt), d: a3(hit.dir || n), s: r4(clamp(dmg / 30, 0.3, 2)), w: k });
    }
    if (g.alive && (!g._painT || now() - g._painT > 0.7) && !hit.quiet) { g._painT = now(); this.npcSay(g, 'pain'); }
    if (g.lh[i] <= 0 && was > 0 && Rules.dismember !== false) this.sever(g, i, hit);
    // pulverised: heads burst from a hard enough blow, limbs of a body that's already dead get smashed apart
    if (g.lh[i] <= -35 && i >= 1 && (k === 'crush' || k === 'blast') && Rules.dismember !== false && (i === 2 || !g.alive || dmg > 70)) return this.gib(g, i, hit);   // torso: organs spill out
    // who did it: police remember aggressors, zombie bites infect
    if (hit.by) {
      const vf = npcFac(g), t1 = now();
      if (hit.by[0] === 'p') { const pl = Players.map.get(hit.by.slice(2)); if (pl && (vf === 'civ' || vf === 'law')) pl.aggroT = t1; }
      else { const A = World.groups.get(+hit.by.slice(2)); if (A && npcFac(A) !== 'law' && (vf === 'civ' || vf === 'law')) A.aggroT = t1; }
      if (hit.bite && vf !== 'mutant') g._bitten = 1;
      g._tt = 0;   // armed NPCs re-pick a target right away
    }
    if (g.alive && g.brain && !['zombie', 'none', 'guard', 'raider'].includes(g.brain) && e) { const t = e.body.translation(); g.flee = 5; g.fx = t.x - (hit.dir ? hit.dir.x : 0) * 5; g.fz = t.z - (hit.dir ? hit.dir.z : 0) * 5; }
  },
  stagger(g, dir, k) {
    if (g.state === 'down' || g.state === 'getup') return;
    const L = Math.hypot(dir.x, dir.z); if (L < 0.1) return;
    g.stag = 0.55; g.stagYaw = Math.atan2(-dir.x / L, -dir.z / L); g.stagSpd = clamp(k, 0.6, 2.6);
  },
  sever(g, i, hit) {
    const jn = PART_JOINT[i]; if (!jn) return;
    g.sev = g.sev || []; if (g.sev.includes(jn)) return;
    const c = this.npcJoints(g)[jn]; if (!c) return;
    g.sev.push(jn);
    const msg = { t: 'rem', cons: [c.id] }; applyRem(msg); this.broadcast(msg);
    const e = World.ents.get(g.parts[i]);
    if (e && e.body && hit.dir) { const m = e.body.mass() * (hit.kind === 'blast' ? 6 : 3); e.body.applyImpulse({ x: hit.dir.x * m, y: Math.abs(hit.dir.y) * m + m * 0.5, z: hit.dir.z * m }, true); }
    if (jn === 'neck' || jn === 'waist') { g.hp = 0; if (g.alive) g.alive = 0; }
    this.setBleed(g, (g.bl || 0) + 3);
    this.broadcast({ t: 'grp', id: g.id, patch: { sev: g.sev.slice(), alive: g.alive, hp: g.hp } });
    Net.bcastAll({ t: 'fx', k: 'sever', g: g.id, j: jn });
  },
  gib(g, i, hit) {
    const e = World.ents.get(g.parts[i]); if (!e || !e.body || !Settings) return;
    const t = e.body.translation(), dir = hit.dir || new V3(0, 1, 0);
    this.sever(g, i, hit);                                                          // tear it off where it attaches
    for (const [jn, J] of Object.entries(NPC_JOINTS)) if (J[0] === i && !(g.sev || []).includes(jn)) this.sever(g, J[1], { dir });   // and let go of what hangs from it
    const vis = e.d.vis || '', col = i === 2 ? e.d.c : e.d.c;
    Net.bcastAll({ t: 'fx', k: 'gib', p: [r4(t.x), r4(t.y), r4(t.z)], d: a3(dir), c: col, c2: i === 2 ? (e.d.hc || e.d.c) : null, h: i === 2 ? 1 : 0, o: i === 1 ? 1 : 0 });
    const msg = { t: 'rem', ents: [e.id] }; applyRem(msg); this.broadcast(msg);
    if (i === 2 && g.alive) { g.alive = 0; g.hp = 0; this.broadcast({ t: 'grp', id: g.id, patch: { alive: 0, hp: 0 } }); }
    this.setBleed(g, (g.bl || 0) + 4);
  },
  setBleed(g, v) {
    v = clamp(v, 0, 10); const old = g.bl || 0; g.bl = v;
    if (Math.round(v * 2) !== Math.round(old * 2) || (v === 0) !== (old === 0)) this.broadcast({ t: 'grp', id: g.id, patch: { bl: r4(v) } });
  },
  stepGore(dt) {
    const t = now();
    // NPCs held by a physics gun: the gun sets their velocity directly, which isn't an impact
    for (const p of Players.map.values()) if (p.grab) { const e = World.ents.get(p.grab.e), g = e && e.d.g && World.groups.get(e.d.g); if (g) g._heldT = t; }
    for (const g of World.groups.values()) {
      if (g.t !== 'npc') continue;
      // bleeding: drains health, stops on its own eventually
      if (g.bl > 0) {
        if (g.alive) {
          g.hp = Math.max(0, (g.hp ?? 100) - g.bl * 0.45 * dt * npcDmgK());
          if (g.hp <= 0) { g.alive = 0; this.npcSay(g, 'death'); this.broadcast({ t: 'grp', id: g.id, patch: { alive: 0, hp: 0 } }); }
        }
        this.setBleed(g, g.bl - dt * (g.alive ? 0.05 : 0.09));
      }
    }
    // impact injuries (slammed with the physics gun, thrown, hit by a car, long falls): real contact forces from the
    // physics step. A physics gun waving a body around in the air makes no contacts, so it doesn't count.
    const dtS = CFG.dt;
    for (const [h1, h2, F] of Phys.impacts) {
      const i1 = Phys.colMap.get(h1), i2 = Phys.colMap.get(h2);
      for (const [a, b] of [[i1, i2], [i2, i1]]) {
        const e = typeof a === 'number' ? World.ents.get(a) : null; if (!e || e.d.k !== 'part' || !e.body || !e.body.isDynamic()) continue;
        const g = World.groups.get(e.d.g); if (!g || g.t !== 'npc') continue;
        const o = typeof b === 'number' ? World.ents.get(b) : null; if (o && o.d.g === e.d.g) continue;   // its own limbs
        if (e._impT && t - e._impT < 0.18) continue;
        // how hard: velocity change from the contact, capped by how fast it was actually closing on the other body
        const pv = e._pv || { x: 0, y: 0, z: 0 }, ov = o && o.body && !o.body.isFixed() ? o.body.linvel() : { x: 0, y: 0, z: 0 };
        const rel = Math.hypot(pv.x - ov.x, pv.y - ov.y, pv.z - ov.z), dv = Math.min(F * dtS / Math.max(1e-4, e.body.mass()), rel * 1.3);
        if (dv < 7.5) continue;
        e._impT = t;
        const i = g.parts.indexOf(e.id), tt = e.body.translation(), vd = new V3(pv.x - ov.x, pv.y - ov.y, pv.z - ov.z);
        if (vd.lengthSq() < 0.01) vd.set(0, -1, 0); vd.normalize();
        if (dv > 10) Net.bcastAll({ t: 'fx', k: 'slam', p: [r4(tt.x), r4(tt.y), r4(tt.z)], d: a3(vd), s: r4(clamp((dv - 8) / 10, 0.3, 2)) });
        this.hurtPart(g, i, (dv - 7.5) * 4.5, { kind: 'crush', point: new V3(tt.x, tt.y, tt.z), dir: vd, stun: 2, quiet: true });
      }
    }
    // remember each part's velocity for the next step's impacts
    for (const g of World.groups.values()) {
      if (g.t !== 'npc') continue;
      for (const id of g.parts) { const e = World.ents.get(id); if (!e || !e.body || !e.body.isDynamic()) continue; const v = e.body.linvel(); (e._pv || (e._pv = {})).x = v.x; e._pv.y = v.y; e._pv.z = v.z; }
    }
  },
  reassemble(g, parts) {
    for (const e of parts) { e.body.setLinvel({ x: 0, y: 0, z: 0 }, true); e.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
    if (!g._rest || !g._safe) return;
    const s = g._safe, qy = new QT().setFromAxisAngle(UP, g.wYaw || 0);
    const excl = c => { const id = Phys.colMap.get(c.handle); return !(typeof id === 'number' && g.parts.includes(id)); };
    const hit = Phys.cast(_v4.set(s[0], s[1] + 1.5, s[2]), new V3(0, -1, 0), 6, null, excl);
    const P = new V3(s[0], hit ? hit.point.y + 1.02 : Math.max(s[1], 1.02), s[2]);
    const att = this.attached(g);
    parts.forEach((e, i) => {
      if (!att.has(i)) return;   // severed limbs stay where they are
      e._pv = null;
      const r = g._rest[i], t = r.p.clone().applyQuaternion(qy).add(P), q = qy.clone().multiply(r.q);
      e.body.setTranslation({ x: t.x, y: t.y, z: t.z }, true); e.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    });
    g.stun = Math.max(g.stun || 0, 1); g.lv = null;   // flop down, then get back up
  },
  postStep() {
    this.guardRagdolls();
    // kill plane & world bounds
    let dead = null;
    for (const e of World.ents.values()) {
      if (e.d.k === 'map' || !e.body) continue;
      const t = e.body.translation();
      if (t.y < CFG.killY || t.y > 600 || Math.abs(t.x) > CFG.worldHalf || Math.abs(t.z) > CFG.worldHalf || !isFinite(t.x)) (dead || (dead = [])).push(e.id);
    }
    if (dead) this.removeEnts(dead);
  },
};
