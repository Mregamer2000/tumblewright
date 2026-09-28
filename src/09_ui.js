
/* ============================================================================
   12. UI (lobby, HUD, spawn menu, radial, scoreboard, menus, chat, admin,
       gamepad menu navigation, spawn-menu thumbnails)
   ========================================================================== */
const Thumbs = {
  urls: {},
  // render one object into a data URL (used for the lobby character preview)
  snap(obj, dir, size = 150, fill = 1) {
    const r = R.renderer, pr = r.getPixelRatio(), H = r.domElement.height;
    if (H < size * pr || r.domElement.width < size * pr) return null;
    const sc = new THREE.Scene(); sc.environment = R.envTex;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
    const l = new THREE.DirectionalLight(0xffffff, 2.6); l.position.set(3, 6, -4); sc.add(l, new THREE.HemisphereLight(0xffffff, 0x888888, 0.9));
    sc.add(obj); obj.updateMatrixWorld(true);
    const box = new THREE.Box3(); obj.traverseVisible(o => { if (o.isMesh) box.expandByObject(o); });
    const ctr = box.getCenter(new V3()), sz = box.getSize(new V3());
    const rad = Math.max(sz.length() * 0.5, 0.05), dist = rad / Math.sin(THREE.MathUtils.degToRad(15)) * fill;
    cam.position.copy(ctr).add(dir.clone().normalize().multiplyScalar(dist)); cam.lookAt(ctr); cam.near = dist / 50; cam.far = dist * 4; cam.updateProjectionMatrix();
    r.setScissorTest(true); r.setViewport(0, 0, size, size); r.setScissor(0, 0, size, size); r.setClearColor(0x000000, 0); r.clear(); r.render(sc, cam);
    const cv = document.createElement('canvas'); cv.width = cv.height = size; cv.getContext('2d').drawImage(r.domElement, 0, H - size * pr, size * pr, size * pr, 0, 0, size, size);
    r.setScissorTest(false); r.setClearColor(0x000000, 1); R.resize(); sc.remove(obj);
    return cv.toDataURL('image/png');
  },
  generate() {
    const r = R.renderer, size = 112, pr = r.getPixelRatio(), H = r.domElement.height;
    if (H < size * pr || r.domElement.width < size * pr) return;
    const sc = new THREE.Scene(); sc.environment = R.envTex;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
    const l = new THREE.DirectionalLight(0xffffff, 2.6); l.position.set(3, 6, 4); sc.add(l, new THREE.HemisphereLight(0xffffff, 0x888888, 0.9));
    const cv = document.createElement('canvas'); cv.width = cv.height = size; const ctx = cv.getContext('2d');
    r.setScissorTest(true); r.setViewport(0, 0, size, size); r.setScissor(0, 0, size, size); r.setClearColor(0x000000, 0);
    const box = new THREE.Box3(), ctr = new V3(), sz = new V3();
    for (const cat of ['building', 'props', 'furniture', 'fun', 'npcs', 'vehicles', 'map']) for (const it of CATALOG[cat]) {
      const g = new THREE.Group();
      if (it.pf) for (const d of it.pf().ents) { const v = buildVisual(d); v.position.fromArray(d.p); v.quaternion.fromArray(d.q); g.add(v); }
      else { const d = Object.assign({ k: 'map', p: [0, 0, 0], q: [0, 0, 0, 1] }, JSON.parse(JSON.stringify(it.d))); if (d.sh.t === 'spawn') g.userData.x = 1; const v = buildVisual(d); v.visible = true; g.add(v); }
      sc.add(g); g.updateMatrixWorld(true);
      box.setFromObject(g); box.getCenter(ctr); box.getSize(sz);
      const rad = Math.max(sz.length() * 0.5, 0.2), dist = rad / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05;
      cam.position.copy(ctr).add(new V3(0.9, 0.75, 1.1).normalize().multiplyScalar(dist)); cam.lookAt(ctr); cam.near = dist / 50; cam.far = dist * 4; cam.updateProjectionMatrix();
      r.clear(); r.render(sc, cam);
      ctx.clearRect(0, 0, size, size); ctx.drawImage(r.domElement, 0, H - size * pr, size * pr, size * pr, 0, 0, size, size);
      this.urls[it.key] = cv.toDataURL('image/png');
      sc.remove(g);
    }
    for (const w of WEAPONS) {   // weapon thumbnails (without the first-person hand)
      const mk = 'wp_' + w.id, W = WEAPON_MODEL[w.id]; if (!Models.has(mk)) continue;
      const g = Models.instance(mk, W.t, W.c), hand = g.getObjectByName(mk + '_hand'); if (hand) hand.visible = false;
      sc.add(g); g.updateMatrixWorld(true);
      box.makeEmpty(); g.traverseVisible(o => { if (o.isMesh) box.expandByObject(o); }); box.getCenter(ctr); box.getSize(sz);
      const rad = Math.max(sz.length() * 0.5, 0.05), dist = rad / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05;
      cam.position.copy(ctr).add(new V3(1.2, 0.45, -0.35).normalize().multiplyScalar(dist)); cam.lookAt(ctr); cam.near = dist / 50; cam.far = dist * 4; cam.updateProjectionMatrix();
      r.clear(); r.render(sc, cam);
      ctx.clearRect(0, 0, size, size); ctx.drawImage(r.domElement, 0, H - size * pr, size * pr, size * pr, 0, 0, size, size);
      this.urls[mk] = cv.toDataURL('image/png');
      sc.remove(g);
    }
    r.setScissorTest(false); r.setClearColor(0x000000, 1); R.resize();
  },
};

// ---- gamepad navigation inside menus -------------------------------------------
const Nav = {
  cur: null, rep: 0,
  root() { const o = UI.open; if (!o || o === 'radial' || o === 'chat') return Game.state === 'lobby' && !o ? $('#lobby') : null; return { spawn: $('#spawnMenu'), pause: $('#pause'), settings: $('#settings'), admin: $('#admin'), saveload: $('#saveload'), help: $('#help'), hostleft: $('#hostLeft') }[o] || null; },
  items(root) { return [...root.querySelectorAll('button,input,select,.item,[data-nav]')].filter(e => e.offsetParent !== null && !e.disabled && e.type !== 'file'); },
  focus(el) { if (this.cur) this.cur.classList.remove('navfocus'); this.cur = el; if (el) { el.classList.add('navfocus'); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } },
  update(dt) {
    if (Input.device !== 'pad') { if (this.cur) { this.cur.classList.remove('navfocus'); this.cur = null; } return; }
    const root = this.root(); if (!root) return;
    const items = this.items(root); if (!items.length) return;
    if (!this.cur || !items.includes(this.cur)) this.focus(items[0]);
    let dx = 0, dy = 0;
    if (Input.padHit(PAD.LEFT)) dx = -1; if (Input.padHit(PAD.RIGHT)) dx = 1; if (Input.padHit(PAD.UP)) dy = -1; if (Input.padHit(PAD.DOWN)) dy = 1;
    const ax = Input.axes[0], ay = Input.axes[1];
    this.rep -= dt;
    if (!dx && !dy && (Math.abs(ax) > 0.6 || Math.abs(ay) > 0.6)) { if (this.rep <= 0) { this.rep = 0.2; if (Math.abs(ax) > Math.abs(ay)) dx = Math.sign(ax); else dy = Math.sign(ay); } }
    else if (Math.abs(ax) < 0.3 && Math.abs(ay) < 0.3) this.rep = 0;
    const c = this.cur;
    if (dx && c.tagName === 'INPUT' && c.type === 'range') { c.value = +c.value + dx * (+c.step || 1) * (Math.abs(+c.max - +c.min) > 50 ? 5 : 1); c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); dx = 0; }
    else if (dx && c.tagName === 'SELECT') { c.selectedIndex = clamp(c.selectedIndex + dx, 0, c.options.length - 1); c.dispatchEvent(new Event('change', { bubbles: true })); dx = 0; }
    if (dx || dy) this.move(items, dx, dy);
    if (Input.padHit(PAD.A)) { if (c.tagName === 'INPUT' && (c.type === 'text' || c.type === 'number')) c.focus(); else c.click(); }
    if (Input.padHit(PAD.B)) UI.back();
    if (Input.padHit(PAD.LB) || Input.padHit(PAD.RB)) {
      const tabs = [...root.querySelectorAll('.tabs button, #smCats .cat')]; const i = tabs.findIndex(t => t.classList.contains('act'));
      if (tabs.length) { const n = tabs[(i + (Input.padHit(PAD.RB) ? 1 : -1) + tabs.length) % tabs.length]; n.click(); }
    }
  },
  move(items, dx, dy) {
    const a = this.cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bs = Infinity;
    for (const el of items) {
      if (el === this.cur) continue;
      const b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2, vx = bx - ax, vy = by - ay;
      const along = vx * dx + vy * dy; if (along <= 4) continue;
      const perp = Math.abs(vx * dy) + Math.abs(vy * dx), s = along + perp * 2.2;
      if (s < bs) { bs = s; best = el; }
    }
    if (best) this.focus(best);
  },
};

// ---- hotbar: 12 slots (keys 1-9, 0, -, =) the player fills from the inventory with weapons, tool-gun modes or spawnable items ----
const HOTBAR_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
const HOTBAR_LABEL = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
const Hotbar = {
  sel: 0,
  def() { return ['physgun', 'toolgun', 'pistol', 'shotgun', 'rifle', 'sniper', 'rocket', 'grenade', 'crowbar', 'propcannon', 'deleter', null].map(w => w && { w }); },
  get() { let s = Settings.hotbar; if (!Array.isArray(s) || s.length !== 12) { s = Settings.hotbar = this.def(); saveSettings(); } return s; },
  set(i, e) { const s = this.get(); s[i] = e ? Object.assign({}, e) : null; saveSettings(); UI.buildSlots(); },
  valid(e) { return !!e && (e.w ? !!W_BY_ID[e.w] && (!e.m || TOOL_MODES.some(m => m.id === e.m)) : !!(e.i && ITEM_INDEX[e.i] && ITEM_INDEX[e.i].pf)); },
  // what a slot shows: name, small label, thumbnail / icon
  info(e) {
    if (!this.valid(e)) return null;
    if (e.i) { const it = ITEM_INDEX[e.i]; return { name: it.name || e.i, sub: 'Spawn', url: Thumbs.urls[e.i], icon: it.icon || '📦' }; }
    const W = W_BY_ID[e.w], M = e.m && TOOL_MODES.find(m => m.id === e.m);
    return { name: M ? M.name : W.name, sub: M ? 'Tool gun' : '', url: M ? null : Thumbs.urls['wp_' + W.id], icon: M ? ic(TOOL_ICON[M.id], M.icon) : W.icon, html: !!M };
  },
  active(i) { const e = this.get()[i]; if (!this.valid(e) || e.i) return false; return e.w === Tools.weapon && (!e.m || e.m === Tools.mode) && (e.m || !this.get().some((o, j) => j !== i && o && o.w === e.w && o.m === Tools.mode && e.w === 'toolgun')); },
  use(i) {
    const e = this.get()[i]; if (!this.valid(e)) return;
    this.sel = i;
    if (e.i) { Game.spawnItem(e.i); return; }
    Tools.setWeapon(e.w); if (e.m && Tools.mode !== e.m) { Tools.setMode(e.m); Audio.play('switch'); }
    UI.refreshTool();
  },
  // mouse wheel / d-pad: next filled weapon or tool slot (spawn-item slots are skipped, they start placing)
  cycle(dir) {
    const s = this.get(); let cur = s.findIndex((e, i) => this.active(i)); if (cur < 0) cur = this.sel;
    for (let k = 1; k <= 12; k++) { const i = (cur + dir * k + 144) % 12; if (this.valid(s[i]) && !s[i].i) { this.use(i); return; } }
  },
};
const TOOL_ICON = { heal: 'medical_services', weld: 'link', rope: 'cable', thruster: 'rocket_launch', wheel: 'tire_repair', seat: 'chair', remover: 'delete', paint: 'format_paint', dupe: 'content_copy' };
const TOAST_ICONS = { '❄': 'ac_unit', '💾': 'save', '📋': 'content_copy', '🔒': 'lock', '⚠': 'warning', '🎮': 'sports_esports', '🕊': 'flight', '✏': 'edit', '🧹': 'mop', '👢': 'person_remove', '🔗': 'link', '⚔': 'swords', '👑': 'workspace_premium', '🔇': 'volume_off', '🌍': 'public' };
const TOAST_WORDS = [[/^Graphics/i, 'tune'], [/noclip/i, 'flight'], [/frozen|freeze/i, 'ac_unit'], [/unfrozen/i, 'water_drop'], [/welded/i, 'link'], [/thruster/i, 'rocket_launch'], [/limit/i, 'block'], [/copied/i, 'content_copy'], [/undo/i, 'undo'], [/snap/i, 'grid_4x4'], [/controller/i, 'sports_esports'], [/not allowed|disabled/i, 'lock']];
const UI = {
  open: null, smTab: 'props', smQuery: '', setTab: 'graphics', slTab: 'worlds', rad: { page: 0, sel: -1, vx: 0, vy: 0 }, hintKey: '', fpsAcc: 0, fpsN: 0, fpsT: 0,
  init() {
    // ---- lobby ----
    const nm = $('#inName'); nm.value = Settings.name || '';
    nm.addEventListener('change', () => { Settings.name = nm.value.trim().slice(0, 18); saveSettings(); });
    const sw = $('#swatches');
    for (const c of PLAYER_COLORS) sw.append(h('button', { class: 'swatch' + (c === Settings.color ? ' sel' : ''), style: `background:${c}`, title: c, 'data-c': c, onclick: e => { Settings.color = c; saveSettings(); $$('.swatch').forEach(s => s.classList.toggle('sel', s.dataset.c === c)); this.refreshLobbyAvatar(); } }));
    $('#btnCreate').onclick = () => Game.createRoom();
    $('#btnSolo').onclick = () => Game.startSolo();
    $('#btnJoin').onclick = () => Game.joinRoom($('#inCode').value);
    $('#inCode').addEventListener('keydown', e => { if (e.code === 'Enter') Game.joinRoom($('#inCode').value); });
    $('#btnLobbySettings').onclick = () => this.openMenu('settings');
    $('#btnLobbyLoad').onclick = () => { this.slTab = 'worlds'; this.openMenu('saveload'); };
    $('#btnLobbyHelp').onclick = () => this.openMenu('help');
    $('#btnLobbyAddons').onclick = () => this.openMenu('addons');
    const pub = $('#chkPublic'); pub.checked = Settings.publicRoom !== false; pub.onchange = () => { Settings.publicRoom = pub.checked; saveSettings(); Online.updateRoom(); };
    Online.onRooms = () => this.renderRooms(); Online.watchRooms(); this.renderRooms();
    const m = location.hash.match(/room=([A-Z0-9]{6})/i);
    if (m) { $('#inCode').value = fmtCode(m[1].toUpperCase()); this.lobbyStatus('Joining from invite link…'); const t0 = now(), go = () => { if (Game.state === 'lobby') Game.joinRoom(m[1]); else if (Game.state === 'loading' && now() - t0 < 30) setTimeout(go, 300); }; setTimeout(go, 300); }
    Net.relayServers();   // fetch relay credentials ahead of time so creating / joining a room doesn't wait on it
    // ---- chat ----
    const ci = $('#chatInput');
    ci.addEventListener('keydown', e => {
      if (e.code === 'Enter') { e.preventDefault(); this.closeChat(true); }
      else if (e.code === 'Escape') { e.preventDefault(); this.closeChat(false); }
      e.stopPropagation();
    });
    $('#smClose').onclick = () => this.closeMenu();
    $('#smSearch').addEventListener('input', e => { this.smQuery = e.target.value.trim().toLowerCase(); this.buildSpawn(); });
    $('#btnCopyCode').onclick = () => this.copyInvite();
    try { document.fonts.load('20px "Material Symbols Rounded"').then(f => { if (f && f.length) document.body.classList.add('ms-ok'); }).catch(() => { }); } catch (e) { }
    Input.onDevice = () => { this.hintKey = ''; this.refreshTool(); if (this.open === 'help') this.buildHelp(); if (this.open === 'spawn') this.buildSpawn(); this.refreshEdit(); };
    Input.onLockChange = locked => { if (!locked && Game.state === 'playing' && !this.open && !Editor.active && Input.device === 'kbm' && !Game.lockReleaseOk) this.openMenu('pause'); Game.lockReleaseOk = false; };
    this.buildSlots();
  },
  // ---- auto-update status (driven by the loader at the end of the file) ----------------------
  initUpdates() { window.addEventListener('tw-update', () => this.refreshUpdate()); this.refreshUpdate(); },
  updText(U) {
    return { off: '', idle: '', checking: 'checking for updates…', downloading: `downloading v${U.latest}…`, latest: 'up to date', offline: 'offline',
      error: 'update check failed', ready: U.ready ? `v${U.ready.version} ready to install` : '' }[U.status] || '';
  },
  refreshUpdate() {
    const U = window.TWUpdate || { status: 'off' }, t = this.updText(U);
    $('#verLabel').textContent = `Tumblewright v${GAME.version}` + (t ? ' · ' + t : '');
    const bar = $('#updateBar'), ready = U.status === 'ready' && U.ready;
    bar.classList.toggle('hidden', !ready);
    if (ready && bar.dataset.v !== U.ready.version) {
      bar.dataset.v = U.ready.version; bar.innerHTML = '';
      bar.append(h('div', { html: ic('system_update', '⬆') }), h('div', { class: 't' }, h('b', { text: `Update v${U.ready.version} is ready` }), h('span', { text: U.ready.notes || 'Restart to install it.' })),
        h('button', { class: 'primary small', text: 'Restart now', onclick: () => U.restart() }));
    }
    if (ready && Game.state === 'playing' && this._updToast !== U.ready.version) { this._updToast = U.ready.version; this.toast(`Update v${U.ready.version} downloaded. It installs the next time you start the game.`, 'system_update'); }
    if (U.lastError && !this._updErr) { this._updErr = 1; this.toast(U.lastError, 'warning'); }
    if (this.open === 'settings' && this.setTab === 'network') this.buildSettings();
  },
  lobbyStatus(t, bad) { const s = $('#lobbyStatus'); s.textContent = t || ''; s.style.color = bad ? 'var(--bad)' : ''; },
  onTierChanged(k) {
    const d = Game.detected;
    $('#lobbyTier').innerHTML = `Graphics ${tierBadge(k)}${d && d.tier === k ? ' <span>auto</span>' : ''}`;
    if (this.open === 'settings') this.buildSettings();
    for (const p of Players.map.values()) Players.updatePlate(p, true);
  },
  // ---- generic menus -----------------------------------------------------------
  menus: ['spawn', 'pause', 'settings', 'admin', 'saveload', 'help', 'radial', 'hostleft', 'paint', 'cleanup', 'addons', 'inventory', 'owner'],
  el(name) { return { spawn: '#spawnMenu', pause: '#pause', settings: '#settings', admin: '#admin', saveload: '#saveload', help: '#help', radial: '#radial', hostleft: '#hostLeft', paint: '#paintMenu', cleanup: '#cleanupMenu', addons: '#addonsMenu', inventory: '#inventoryMenu', owner: '#ownerMenu' }[name]; },
  openMenu(name) {
    if (this.open === 'chat') this.closeChat(false);
    for (const n of this.menus) $(this.el(n)).classList.add('hidden');
    this.open = name;
    if (name !== 'radial') { Game.lockReleaseOk = true; if (document.pointerLockElement) document.exitPointerLock(); Tools.release(); }
    const b = { owner: () => this.buildOwner(), inventory: () => this.buildInventory(), cleanup: () => this.buildCleanup(), addons: () => this.buildAddons(), spawn: () => this.buildSpawn(), pause: () => this.buildPause(), settings: () => this.buildSettings(), admin: () => this.buildAdmin(), saveload: () => this.buildSaveLoad(), help: () => this.buildHelp(), radial: () => this.buildRadial(), hostleft: () => this.buildHostLeft() }[name];
    if (b) b();
    $(this.el(name)).classList.remove('hidden');
    Nav.focus(null);
    Audio.play('ui');
  },
  closeMenu() {
    if (!this.open) return;
    if (this.open !== 'chat') $(this.el(this.open)).classList.add('hidden');
    this.open = null; Nav.focus(null);
    if (Game.state === 'playing' && !Editor.active) Game.lock();
  },
  back() {
    const o = this.open;
    if (o === 'settings' || o === 'admin' || o === 'saveload' || o === 'help' || o === 'cleanup' || o === 'addons' || o === 'inventory' || o === 'owner') { if (Game.state === 'playing') this.openMenu('pause'); else this.closeMenu(); }
    else if (o === 'hostleft') return;
    else this.closeMenu();
  },
  // public rooms (lobby): live list from the presence channel
  renderRooms() {
    const el = $('#roomList'); if (!el) return;
    const rooms = [...Online.rooms.values()].sort((a, b) => (b.n || 0) - (a.n || 0));
    el.innerHTML = '';
    el.append(h('div', { class: 'rl-h', html: `<span>PUBLIC ROOMS</span><span>${rooms.length ? rooms.length + ' open' : ''}</span>` }));
    if (!rooms.length) { el.append(h('div', { class: 'muted', style: 'font-size:12px', text: GAME.supa ? 'No public rooms right now. Create one and your friends will see it here.' : 'Room list unavailable in this copy.' })); return; }
    for (const r of rooms) {
      const same = r.v === GAME.version, full = (r.n || 0) >= (r.max || 10);
      el.append(h('div', { class: 'rl' },
        h('div', { class: 'nm', html: `<b>${esc(r.host)}'s room</b><br><small>${esc(r.map)} · ${esc(r.mode)} · ${r.n}/${r.max}${same ? '' : ' · v' + esc(r.v)}</small>` }),
        h('button', { class: 'small' + (same && !full ? ' primary' : ''), text: full ? 'Full' : same ? 'Join' : 'Update', disabled: full, title: same ? '' : 'Different game version: joining will update you first if you can', onclick: () => Game.joinRoom(r.code) })));
    }
  },
  // cleanup: props grouped by who spawned them
  buildCleanup() {
    const s = $('#cleanupMenu'); s.innerHTML = '';
    s.append(h('h2', { text: 'Clean up props' }));
    const counts = new Map(), groups = new Set();
    for (const e of World.ents.values()) {
      if (e.d.k === 'map' || !e.d.o) continue;
      if (e.d.g) { if (groups.has(e.d.g)) continue; groups.add(e.d.g); }
      counts.set(e.d.o, (counts.get(e.d.o) || 0) + 1);
    }
    const me = Players.local, host = Net.isHost;
    for (const p of Players.map.values()) {
      const n = counts.get(p.id) || 0, mine = p === me;
      s.append(h('div', { class: 'row', style: 'justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--line)' },
        h('span', { html: `<span style="color:${esc(p.color)}">${esc(p.name)}</span>${mine ? ' <span class="muted">(you)</span>' : ''} · <b>${n}</b> object${n === 1 ? '' : 's'}` }),
        h('div', { class: 'row', style: 'gap:6px' },
          mine ? h('button', { class: 'small', text: 'Undo last', onclick: () => { Net.toHost({ t: 'undo' }); setTimeout(() => this.buildCleanup(), 250); } }) : null,
          mine ? h('button', { class: 'small danger', text: 'Remove mine', disabled: !n, onclick: () => { Net.toHost({ t: 'cleanme' }); setTimeout(() => this.buildCleanup(), 250); } })
            : host ? h('button', { class: 'small danger', text: 'Remove theirs', disabled: !n, onclick: () => { Admin.req('clearPlayer', { id: p.id }); setTimeout(() => this.buildCleanup(), 250); } }) : null)));
    }
    const orphans = [...counts.entries()].filter(([o]) => !Players.map.has(o)).reduce((a, [, n]) => a + n, 0);
    if (orphans) s.append(h('p', { class: 'muted', text: `${orphans} object${orphans === 1 ? '' : 's'} from players who left.` }));
    if (host) s.append(h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'danger', text: 'Remove all props', onclick: () => { if (confirm('Remove every prop in the world?')) { Admin.req('clearAll', {}); setTimeout(() => this.buildCleanup(), 250); } } })));
    s.append(h('div', { class: 'btns' }, h('button', { class: 'primary', text: 'Done', onclick: () => this.back() })));
  },
  // community addons: browse / get / upload dupes and worlds
  buildAddons(tab) {
    tab = tab || this.adTab || 'browse'; this.adTab = tab;
    const s = $('#addonsMenu'); s.innerHTML = '';
    s.append(h('h2', { text: 'Community addons' }));
    const tabs = h('div', { class: 'row', style: 'gap:6px' });
    for (const [k, l] of [['browse', 'Browse'], ['upload', 'Upload']]) tabs.append(h('button', { class: 'small' + (tab === k ? ' primary' : ''), text: l, onclick: () => this.buildAddons(k) }));
    s.append(tabs);
    const body = h('div'); s.append(body);
    if (tab === 'browse') {
      const q = h('input', { type: 'text', placeholder: 'Search by name…', value: this.adQ || '', style: 'flex:1' }), sort = h('select', {}, h('option', { value: 'new', text: 'Newest' }), h('option', { value: 'popular', text: 'Most downloaded', selected: this.adSort === 'popular' }));
      const list = h('div', { class: 'addon-list' }, h('div', { class: 'muted', text: 'Loading…' }));
      const load = async () => {
        this.adQ = q.value.trim(); this.adSort = sort.value;
        try {
          const rows = await Online.addons(this.adQ, this.adSort); list.innerHTML = '';
          if (!rows.length) list.append(h('div', { class: 'muted', text: this.adQ ? 'Nothing matches that.' : 'No addons yet. Be the first to upload one!' }));
          for (const a of rows) list.append(h('div', { class: 'addon' },
            h('b', { text: a.name }), h('div', { class: 'meta', text: `${a.kind === 'world' ? 'World' : 'Contraption'} · ${a.objects} objects · by ${a.author} · ${a.downloads} download${a.downloads === 1 ? '' : 's'}` }),
            a.description ? h('div', { class: 'ds', text: a.description }) : null,
            h('button', { class: 'small primary', text: a.kind === 'world' ? (Game.state === 'playing' && !Net.isHost ? 'Save world' : 'Load world') : 'Get', onclick: e => this.getAddon(a, e.target) })));
        } catch (err) { list.innerHTML = ''; list.append(h('div', { class: 'muted', text: 'Could not load addons (' + (err.message || err) + ')' })); }
      };
      q.onkeydown = e => { if (e.key === 'Enter') load(); }; sort.onchange = load;
      body.append(h('div', { class: 'row', style: 'gap:8px;margin-top:10px' }, q, sort, h('button', { class: 'small', text: 'Search', onclick: load })), list);
      load();
    } else {
      const dupes = Save.dupes(), src = h('select', {});
      if (Tools.clipboard) src.append(h('option', { value: 'clip', text: 'Duplicator clipboard: ' + (Tools.clipboard.name || 'contraption') }));
      for (const n of Object.keys(dupes)) src.append(h('option', { value: 'dupe:' + n, text: 'Saved dupe: ' + n }));
      if (Game.state === 'playing' && Net.isHost) src.append(h('option', { value: 'world', text: 'This whole world' }));
      const name = h('input', { type: 'text', maxlength: 40, placeholder: 'Name (2-40 characters)' }), desc = h('textarea', { maxlength: 240, rows: 3, placeholder: 'Description (optional)', style: 'width:100%;resize:vertical' });
      const msg = h('div', { class: 'muted', style: 'min-height:18px' });
      if (!src.options.length) body.append(h('p', { class: 'muted', text: 'Copy a contraption with the Duplicator tool (or save a dupe) first. The host can also upload the whole world.' }));
      else body.append(h('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-top:10px' }, src, name, desc, h('div', { class: 'muted', style: 'font-size:12px', text: `Uploading as "${Settings.name}". Everyone can see and download it. Keep names and descriptions friendly: slurs are blocked.` }), msg,
        h('button', { class: 'primary', text: 'Publish', onclick: async e => {
          const v = src.value, kind = v === 'world' ? 'world' : 'dupe';
          const data = v === 'clip' ? Tools.clipboard : v === 'world' ? Object.assign(World.serialize(), { rules: Object.assign({}, Rules), name: name.value.trim() }) : dupes[v.slice(5)];
          const nm = name.value.trim(), ds = desc.value.trim(), au = String(Settings.name || 'Player').slice(0, 18);
          if (nm.length < 2) return msg.textContent = 'Give it a name.';
          if (![nm, ds, au].every(cleanText)) return msg.textContent = 'That name or description isn\'t allowed.';
          if (kind === 'dupe' ? !Save.validDupe(data) : !Save.validWorld(data)) return msg.textContent = 'That doesn\'t look like a valid ' + kind + '.';
          const json = JSON.stringify(data); if (json.length > 650000) return msg.textContent = 'Too big to upload (try something smaller).';
          e.target.disabled = true; msg.textContent = 'Uploading…';
          try { await Online.upload({ name: nm, author: au, description: ds, kind, data: JSON.parse(json), objects: clamp(data.ents.length, 1, 900), game_version: GAME.version }); this.toast('Uploaded "' + nm + '"', 'cloud_upload'); this.buildAddons('browse'); }
          catch (err) { msg.textContent = err.message || String(err); e.target.disabled = false; }
        } })));
    }
    s.append(h('div', { class: 'btns' }, h('button', { class: 'primary', text: 'Done', onclick: () => this.back() })));
  },
  async getAddon(a, btn) {
    btn.disabled = true; btn.textContent = '…';
    try {
      const r = await Online.addonData(a.id), d = Object.assign({}, r.data, { name: a.name });
      if (a.kind === 'dupe') {
        if (!Save.validDupe(d)) throw new Error('broken addon');
        Save.saveDupe(a.name, d); Tools.clipboard = d; btn.textContent = 'Saved to Dupes';
        this.toast(`"${a.name}" is in your Dupes and on the Duplicator clipboard (alt-fire to paste)`, 'content_copy');
      } else {
        if (!Save.validWorld(d)) throw new Error('broken addon');
        if (Game.state === 'playing' && !Net.isHost) { const all = Save.worlds(); all[a.name] = d; store.set('worlds', all); btn.textContent = 'Saved'; this.toast('World saved to Save / load', 'folder'); }
        else Game.loadWorldChoice(d);
      }
    } catch (err) { btn.disabled = false; btn.textContent = 'Retry'; this.toast('Download failed: ' + (err.message || err), 'error'); }
  },
  // billboard painter: 512 × 256 canvas (the board is 2:1), brush / eraser / fill / text, saved as a small image
  openPaint(e) {
    this.paintEnt = e; this.openMenu('paint');
    const s = $('#paintMenu'); s.innerHTML = '';
    const W = 512, H2 = 256, cv = h('canvas', { width: W, height: H2, style: 'width:100%;aspect-ratio:2/1;background:#fff;border-radius:6px;cursor:crosshair;touch-action:none;display:block' });
    const x = cv.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H2);
    if (e.d.img) { const im = new Image(); im.onload = () => x.drawImage(im, 0, 0, W, H2); im.src = e.d.img; }
    let col = '#1a1a1a', size = 10, erase = false, drawing = false, last = null;
    const pos = ev => { const r = cv.getBoundingClientRect(); return [(ev.clientX - r.left) / r.width * W, (ev.clientY - r.top) / r.height * H2]; };
    const line = (a, b) => { x.strokeStyle = erase ? '#ffffff' : col; x.lineWidth = size; x.lineCap = x.lineJoin = 'round'; x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); };
    cv.onpointerdown = ev => { drawing = true; last = pos(ev); line(last, last); cv.setPointerCapture(ev.pointerId); };
    cv.onpointermove = ev => { if (!drawing) return; const p = pos(ev); line(last, p); last = p; };
    cv.onpointerup = cv.onpointercancel = () => { drawing = false; };
    const sw = h('div', { class: 'colors' }), pick = h('input', { type: 'color', value: col, oninput: () => { col = pick.value; erase = false; er.classList.remove('primary'); } });
    for (const c of ['#1a1a1a', '#ffffff', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e84393', '#795548', '#7f8c8d'])
      sw.append(h('button', { style: `background:${c}`, title: c, onclick: () => { col = c; pick.value = c; erase = false; er.classList.remove('primary'); } }));
    const er = h('button', { class: 'small', text: 'Eraser', onclick: () => { erase = !erase; er.classList.toggle('primary', erase); } });
    const sz = h('input', { type: 'range', min: 2, max: 60, value: size, oninput: () => { size = +sz.value; } });
    const close = () => { this.paintEnt = null; this.closeMenu(); };
    s.append(h('h2', { text: 'Paint billboard' }), cv,
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center' }, sw, pick, h('label', { text: 'Size' }), sz, er,
        h('button', { class: 'small', text: 'Fill', onclick: () => { x.fillStyle = col; x.fillRect(0, 0, W, H2); } }),
        h('button', { class: 'small', text: 'Text', onclick: () => { const t = prompt('Text to add (it goes in the middle; draw over it to move things around)'); if (!t) return; x.fillStyle = erase ? '#ffffff' : col; let fs = 90; x.font = `bold ${fs}px sans-serif`; while (fs > 14 && x.measureText(t).width > W - 30) { fs -= 4; x.font = `bold ${fs}px sans-serif`; } x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(t, W / 2, H2 / 2); } }),
        h('button', { class: 'small danger', text: 'Clear', onclick: () => { x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H2); } })),
      h('div', { class: 'btns' },
        h('button', { text: 'Cancel', onclick: close }),
        h('button', { class: 'primary', text: 'Put it up', onclick: () => {
          let url = cv.toDataURL('image/webp', 0.85); if (!url.startsWith('data:image/webp') || url.length > 200000) url = cv.toDataURL('image/jpeg', 0.75);
          if (url.length > 200000) return this.toast('Too detailed to send. Try fewer colours or clear some of it.', 'error');
          if (this.paintEnt) Net.toHost({ t: 'paint', e: this.paintEnt.id, img: url }); close(); this.toast('Billboard updated', 'brush');
        } })));
  },
  toast(text, icon) {
    text = String(text);
    let iconName = icon;
    if (!iconName) {
      const lead = text.match(/^([^\w\s"'(]+)\s*/u);
      iconName = (lead && TOAST_ICONS[lead[1].replace(/️/g, '')]) || TOAST_WORDS.find(([re]) => re.test(text))?.[1] || 'info';
      if (lead && TOAST_ICONS[lead[1].replace(/️/g, '')]) text = text.slice(lead[0].length);
    }
    const box = $('#notify'); const t = h('div', { class: 'toast panel', html: ic(iconName, '•') + '<span>' + esc(text) + '</span>' });
    box.append(t); while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, 2600);
  },
  async copyReport() {
    const txt = await Net.report();
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => this.toast('Network report copied. Paste it to whoever is helping you.', 'content_copy'), () => prompt('Network report:', txt));
  },
  copyInvite() {
    const url = (/^https?:$/.test(location.protocol) ? location.origin + location.pathname : GAME.site) + '#room=' + Net.code;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => this.toast('Invite link copied', 'link'), () => prompt('Invite link:', url));
  },
  // ---- chat ---------------------------------------------------------------------
  chat(m) {
    const log = $('#chatLog');
    const line = h('div', { class: 'msg' + (m.sys ? ' ' + (m.cls || 'sys') : '') });
    if (m.sys) line.textContent = m.text; else line.innerHTML = `<b style="color:${esc(m.color || '#fff')}">${esc(m.name)}</b>: ${esc(m.text)}`;
    log.append(line); while (log.children.length > 80) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    setTimeout(() => line.classList.add('faded'), 12000);
    if (!m.sys) Audio.play('chat');
  },
  openChat() {
    if (this.open) return;
    this.open = 'chat'; Game.lockReleaseOk = true; if (document.pointerLockElement) document.exitPointerLock();
    $('#chat').classList.add('open'); const ci = $('#chatInput'); ci.classList.remove('hidden'); ci.value = ''; setTimeout(() => ci.focus(), 0);
  },
  closeChat(send) {
    const ci = $('#chatInput'); const text = ci.value.trim();
    if (send && text) Net.toHost({ t: 'chat', text });
    ci.blur(); ci.classList.add('hidden'); $('#chat').classList.remove('open');
    if (this.open === 'chat') { this.open = null; if (Game.state === 'playing' && !Editor.active) Game.lock(); }
  },
  // ---- HUD ----------------------------------------------------------------------
  buildSlots() {
    const s = $('#slots'); s.innerHTML = '';
    Hotbar.get().forEach((e, i) => {
      const f = Hotbar.info(e); if (!f) return;
      const pic = f.url ? `<img src="${f.url}" alt="${esc(f.name)}">` : f.html ? `<span class="emo">${f.icon}</span>` : `<span class="emo">${esc(f.icon)}</span>`;
      s.append(h('div', { class: 'slot' + (Hotbar.active(i) ? ' act' : '') + (e.i ? ' item' : ''), 'data-i': i, title: f.name, html: `<b>${HOTBAR_LABEL[i]}</b>` + pic + (f.sub ? `<i class="snm">${esc(f.name)}</i>` : '') }));
    });
  },
  refreshTool() {
    const W = W_BY_ID[Tools.weapon]; if (!W) return;
    const prev = this._slotW; this._slotW = Tools.weapon;
    $$('#slots .slot').forEach(s => s.classList.toggle('act', Hotbar.active(+s.dataset.i)));
    if (prev && prev !== Tools.weapon) { const sn = $('#slotName'); sn.textContent = W.name; sn.classList.add('show'); clearTimeout(this._sn); this._sn = setTimeout(() => sn.classList.remove('show'), 1100); }
    const M = TOOL_MODES.find(m => m.id === Tools.mode), me = Players.local, thumb = Thumbs.urls['wp_' + W.id];
    let name = W.name, mode = '', desc = W.desc, icon = thumb ? `<img src="${thumb}" alt="">` : ic('build', W.icon), chips = '';
    if (Tools.weapon === 'toolgun') {
      mode = M.name; desc = M.desc;
      chips = TOOL_MODES.map(m => `<span class="mchip${m.id === Tools.mode ? ' on' : ''}">${ic(TOOL_ICON[m.id], m.icon)}${esc(m.name)}</span>`).join('');
    }
    if (Editor.active) { name = 'Map Editor'; icon = ic('architecture', '🧱'); mode = Editor.piece ? 'Placing: ' + ITEM_INDEX[Editor.piece].name : (Editor.sel ? 'Piece selected' : 'Select or place pieces'); desc = ''; chips = ''; }
    const sitting = me && me.seat && (World.ents.get(me.seat) || { d: {} }).d.pas;   // chairs, couches, passenger seats
    if (me && me.seat) { name = sitting ? 'Sitting' : 'Driving'; icon = ic(sitting ? 'chair' : 'directions_car', '💺'); mode = ''; desc = sitting ? 'Relax. Press E to stand up.' : 'Wheels and thrusters connected to this seat respond to you.'; chips = ''; }
    $('#toolIcon').innerHTML = icon; $('#toolName').textContent = name; $('#toolMode').textContent = mode; $('#toolDesc').textContent = desc; $('#toolModes').innerHTML = chips;
    this.hintKey = ''; this.refreshHints();
    const tag = $('#modeTag');
    tag.classList.toggle('hidden', !Editor.active && !Rules.combat);
    tag.innerHTML = Editor.active ? ic('architecture', '✏') + ' EDIT MODE' : ic('swords', '⚔') + ' COMBAT ON';
    tag.style.color = Editor.active ? 'var(--acc2)' : 'var(--bad)';
  },
  refreshHints() {
    const me = Players.local, pad = Input.device === 'pad';
    const ctx = Tools.weapon + Tools.mode + (Tools.grab ? 'g' : '') + (Tools.first ? 'f' : '') + (me && me.seat ? 's' : '') + Editor.active + Editor.piece + Editor.sel + Editor.padMode + Input.device + Input.padType + (Game.aimSeat ? 'A' : '') + (Game.placing ? 'P' : '') + Settings.showHints + (me && me.noclip ? 'n' : '');
    if (ctx === this.hintKey) return; this.hintKey = ctx;
    const H = [];
    const hint = (g, t) => H.push(`<div class="hint">${g}${esc(t)}</div>`);
    if (Editor.active) {
      if (pad) { hint(glyph(PAD.RT), Editor.piece ? 'Place piece' : 'Select piece'); hint(glyph(PAD.LT), Editor.piece ? 'Cancel placing' : 'Delete'); hint(glyph(PAD.RB), 'Rotate'); hint(glyph(PAD.X), 'D-pad mode: ' + Editor.padMode); hint(glyph(PAD.Y), 'Piece palette'); hint(glyph(PAD.A) + glyph(PAD.B), 'Fly up / down'); }
      else { hint(glyph('Mouse0'), Editor.piece ? 'Place piece' : 'Select / drag gizmo'); hint(glyph('Mouse2'), 'Hold to look around'); hint('<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>', 'Move / Rotate / Scale'); hint('<kbd>R</kbd>', 'Rotate 15° / 90°'); hint(glyph('snap'), 'Grid snap'); hint('<kbd>Del</kbd>', 'Delete'); hint('<kbd>Ctrl</kbd><kbd>Z</kbd>/<kbd>Y</kbd>', 'Undo / Redo'); }
      hint(glyph('editMode'), 'Exit edit mode');
    } else if (me && me.seat) {
      if ((World.ents.get(me.seat) || { d: {} }).d.pas) hint(glyph('use'), 'Stand up');
      else if (Game.seatVeh()) {
        hint(pad ? glyph(PAD.RT) + glyph(PAD.LT) : '<kbd>W</kbd><kbd>S</kbd>', 'Throttle / brake & reverse');
        hint(pad ? '<span class="glyph pad">LS</span>' : '<kbd>A</kbd><kbd>D</kbd>', 'Steer');
        hint(glyph('jump'), 'Handbrake (drift)'); hint(pad ? glyph(PAD.B) : glyph('sprint'), 'Boost'); hint(glyph('reload'), 'Flip upright'); hint(glyph('use'), 'Exit seat');
      } else { hint(pad ? '<span class="glyph pad">LS</span>' : '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>', 'Drive / steer'); hint(glyph('use'), 'Exit seat'); hint(pad ? glyph(PAD.A) + glyph(PAD.RT) : '<kbd>Space</kbd><kbd>F</kbd>', 'Thrusters (as bound)'); hint(glyph('reload'), 'Flip upright'); }
    } else {
      const w = Tools.weapon;
      if (w === 'physgun') {
        if (Tools.grab) { hint(glyph('alt'), 'Freeze'); hint(glyph('reload'), 'Hold + look to rotate'); hint(pad ? glyph(PAD.UP) + glyph(PAD.DOWN) : glyph('Wheel'), 'Push / pull'); }
        else { hint(glyph('fire'), 'Grab object'); hint(glyph('reload'), 'Unfreeze aimed object'); }
      } else if (w === 'toolgun') { hint(glyph('fire'), Tools.first ? 'Pick second point' : 'Use tool'); hint(glyph('alt'), { weld: 'Clear selection', rope: 'Clear selection', remover: 'Remove constraints', paint: 'Pick material', dupe: 'Paste contraption' }[Tools.mode] || 'Alt'); hint(glyph('reload'), 'Next tool mode'); }
      else if (w === 'grenade') hint(glyph('fire'), 'Throw');
      else if (w === 'sniper') { hint(glyph('fire'), 'Shoot'); hint(glyph('alt'), 'Hold to scope in'); }
      else hint(glyph('fire'), { crowbar: 'Swing', rocket: 'Fire rocket', propcannon: 'Launch a prop' }[w] || 'Shoot');
      if (me && me.noclip && !pad) hint(glyph('Wheel'), 'Fly speed');
      if (Game.placing) { H.length = 0; hint(glyph('fire'), 'Place (stays selected)'); hint(glyph('reload'), 'Rotate'); hint(glyph('alt'), 'Put away'); }
      else if (Game.aimSeat) hint(glyph('use'), Game.aimSeatName ? (Game.aimSeatDrive ? 'Drive' : 'Ride') : 'Sit in seat');
      hint(glyph('spawnMenu'), 'Spawn menu'); hint(glyph('radial'), 'Radial menu');
      if (!pad) hint('<kbd>1</kbd>–<kbd>0</kbd>', 'Weapons'); else hint(glyph(PAD.LEFT) + glyph(PAD.RIGHT), 'Switch weapon');
    }
    if (!pad) H.push(`<div class="hint more">${glyph('hints')}${Settings.showHints ? 'Hide hints' : 'Show controls'}</div>`);
    const el = $('#hints'); el.innerHTML = H.join(''); el.classList.toggle('collapsed', !Settings.showHints && !pad);
  },
  refreshRoom() {
    $('#roomCode').textContent = Net.online ? fmtCode(Net.code) : 'SOLO';
    $('#playerCount').textContent = Players.map.size;
    $('#hostTag').classList.toggle('hidden', !Net.isHost || !Net.online);
    $('#btnCopyCode').classList.toggle('hidden', !Net.online);
    if (this.open === 'admin') this.buildAdmin();
    if (this.open === 'pause') this.buildPause();
  },
  showDeath() { $('#deathScreen').classList.remove('hidden'); },
  hideDeath() { $('#deathScreen').classList.add('hidden'); },
  damageFlash() { const hud = $('#hud'); hud.style.boxShadow = 'inset 0 0 140px rgba(255,30,30,.55)'; clearTimeout(this._df); this._df = setTimeout(() => hud.style.boxShadow = '', 180); if (!this._hurtT || now() - this._hurtT > 0.45) { this._hurtT = now(); Audio.play('pain_m', 0.55); Audio.play('punch', 0.35); } },
  hitmarker() { Audio.play('hitmark'); const hm = $('#hitmarker'); hm.style.opacity = 1; clearTimeout(this._hm); this._hm = setTimeout(() => hm.style.opacity = 0, 140); },
  killfeed(m) {
    const v = Players.map.get(m.v), a = m.a ? Players.map.get(m.a) : null;
    const nm = p => `<span style="color:${esc(p ? p.color : '#fff')}">${esc(p ? p.name : '?')}</span>`;
    const d = h('div', { class: 'panel', html: a && a !== v ? `${nm(a)} ${ic('skull', '☠')} <span class="muted">${esc(m.w)}</span> ${nm(v)}` : `${ic('skull', '☠')} ${nm(v)} <span class="muted">died</span>` });
    $('#killfeed').prepend(d); setTimeout(() => d.remove(), 6000);
  },
  update(dt) {
    const me = Players.local;
    if (me) { $('#hpText').textContent = Math.round(me.hp); $('#hpFill').style.width = me.hp + '%'; $('#hpFill').style.background = me.hp > 50 ? 'linear-gradient(90deg,#4ade80,#a3e635)' : me.hp > 25 ? '#fbbf24' : '#ef4444'; }
    $('#hpBox').style.display = Rules.combat ? '' : 'none';
    // nextbot gamemode: how long you've survived since your last death, and your best
    const bh = $('#botHud'), nb = Rules.mode === 'nextbot' && me;
    bh.classList.toggle('hidden', !nb);
    if (nb) {
      if (me.dead) this.survT0 = null; else if (this.survT0 == null) this.survT0 = now();
      const sv = this.survT0 == null ? 0 : now() - this.survT0, best = Math.max(store.get('botBest', 0), sv); if (sv > store.get('botBest', 0) + 1) store.set('botBest', Math.floor(sv));
      const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
      const txt = `<b>NEXTBOTS</b> · ${me.dead ? 'CAUGHT' : 'Survive ' + fmt(sv)} · Best ${fmt(best)} · ${Bots.list.size} hunting`;
      if (bh.innerHTML !== txt) bh.innerHTML = txt;
    }
    const ping = me ? Math.round(me.ping || 0) : 0; $('#pingVal').textContent = Net.isHost ? '0' : ping;
    $('#pingDot').className = Net.isHost || ping < 80 ? '' : ping < 160 ? 'mid' : 'bad';
    // crosshair reacts to what you aim at: grabbable / usable / NPC or player
    const w = Tools.weapon, ae = Game.aimEnt; let cls = '', label = '';
    if (!Editor.active && me && !me.seat) {
      if (Game.aimSeat || Game.aimUse) cls = 'use';
      else if (ae && ((w === 'physgun' && ae.d.k !== 'map' && Game.aimDist < 90) || w === 'toolgun')) cls = 'aim';
      else if (w !== 'physgun' && w !== 'toolgun') cls = Game.aimHot ? 'hot' : 'gun';
      if (Game.aimUse) label = `${keyLabel(Settings.binds.use || 'KeyE')}  ${Game.aimUse.d.door ? 'Open / close door' : 'Paint billboard'}`;
      else if (ae && Game.aimDist < 14) { const g = ae.d.g && World.groups.get(ae.d.g); if (g && g.t === 'npc') label = g.n + (g.alive ? (g.bl > 0.5 ? ' · bleeding' : '') : ' (down)'); else if (ae.d.n) label = ae.d.n; }
    }
    const ch = $('#crosshair'); if (ch.className !== cls) ch.className = cls;
    ch.style.display = (Editor.active && Input.device === 'kbm') || Game.zoomed ? 'none' : '';
    const al = $('#aimLabel'); if (al.textContent !== label) al.textContent = label;
    this.refreshHints();
    // fps + net stats
    this.fpsAcc += dt; this.fpsN++; this.fpsT += dt;
    if (this.fpsT > 0.5) {
      const fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; this.fpsT = 0;
      $('#fpsBox').classList.toggle('hidden', !Settings.showFps); $('#fpsBox').textContent = `${fps} FPS · ${TIERS[R.tier].label} · ${Math.round(R.drs.scale * 100)}% res`;
      const ns = $('#netStats'); ns.classList.toggle('hidden', !Settings.showNet);
      if (Settings.showNet) {
        const s = Net.stats; let bodies = 0, awake = 0; for (const e of World.ents.values()) if (e.d.k !== 'map') { bodies++; if (Net.isHost && e.body && e.body.isDynamic() && !e.body.isSleeping()) awake++; }
        ns.textContent = `NETWORK ${Net.online ? (Net.isHost ? '(host)' : '(client)') : '(offline)'}\n` +
          `ping        ${Net.isHost ? '—' : ping + ' ms'}\n` + `in          ${(s.inRate / 1024).toFixed(1)} KB/s\n` + `out         ${(s.outRate / 1024).toFixed(1)} KB/s\n` +
          `snapshots   ${Net.isHost ? CFG.snapRate + '/s sent' : s.snapRate.toFixed(0) + '/s'}\n` + `interp      ${Math.round(Net.interp * 1000)} ms\n` + `jitter      ${(s.jitter * 1000).toFixed(1)} ms\n` +
          `bodies      ${bodies}${Net.isHost ? ' (' + awake + ' awake)' : ''}\n` + `last snap   ${s.bodies} bodies\n` + `peers       ${Net.peers.size}\n` + `render      ${Math.round(R.drs.scale * 100)}% · ${R.renderer.info.render.calls} draws`;
      }
      if (this.open === 'settings') { const rs = $('#rsVal'); if (rs) rs.textContent = Math.round(R.drs.scale * 100) + '%'; }
    }
    // speedometer
    const sp = $('#speedo'), ve = me && me.seat ? Game.seatVeh() : null;
    sp.classList.toggle('hidden', !ve);
    if (ve) { const km = Settings.speedUnit === 'kmh', kmh = String(Math.round(Math.abs(ve._spd || 0) * (km ? 3.6 : 1 / MPH))); if (sp.firstChild.textContent !== kmh) sp.firstChild.textContent = kmh; sp.lastChild.textContent = km ? 'KM/H' : 'MPH'; sp.classList.toggle('boost', !!(Input.down('sprint') || Input.pb[PAD.B])); }
    // seat hint
    const sh = $('#seatHint');
    if (me && me.seat) sh.classList.add('hidden');
    else if (Game.aimSeat) { sh.classList.remove('hidden'); const t = Game.aimSeatName ? (Game.aimSeatDrive ? 'Drive ' : 'Ride in ') + Game.aimSeatName : 'Sit'; if (sh.dataset.t !== t) { sh.dataset.t = t; sh.innerHTML = glyph('use') + ' ' + esc(t); } }
    else if (Game.aimFull) { sh.classList.remove('hidden'); if (sh.dataset.t !== 'full') { sh.dataset.t = 'full'; sh.innerHTML = '<span class="muted">All seats taken</span>'; } }
    else sh.classList.add('hidden');
    if (this.open === 'radial') this.updateRadial(dt);
    Nav.update(dt);
  },
  // ---- spawn menu -----------------------------------------------------------------
  spawnCats() {
    return [['favs', 'Favorites', 'star', '⭐', store.get('favs', []).filter(k => ITEM_INDEX[k]).length], ['building', 'Building', 'domain', '🧱', CATALOG.building.length], ['props', 'Props', 'inventory_2', '📦', CATALOG.props.length], ['furniture', 'Furniture', 'chair', '🛋️', CATALOG.furniture.length], ['fun', 'Fun & Explosive', 'celebration', '🎉', CATALOG.fun.length], ['npcs', 'NPCs', 'person', '🧍', CATALOG.npcs.length], ['vehicles', 'Vehicles', 'directions_car', '🚗', CATALOG.vehicles.length],
      ['weapons', 'Weapons', 'swords', '🔫', WEAPONS.length], ['tools', 'Tool Gun', 'build', '🔧', TOOL_MODES.length], ['dupes', 'Dupes', 'content_copy', '📋', Object.keys(Save.dupes()).length], ['map', 'Map Pieces', 'foundation', '🧱', CATALOG.map.length]];
  },
  spawnCard(o) {
    const url = o.key && Thumbs.urls[o.key];
    const el = h('div', { class: 'item', tabindex: 0, title: o.desc || o.name, onclick: o.onclick },
      url ? h('img', { src: url, alt: '' }) : h('div', { class: 'ph', text: o.icon || '•' }), h('div', { text: o.name }), o.sub ? h('div', { class: 'desc', text: o.sub }) : null);
    if (o.tag) el.append(h('span', { class: 'tag' + (o.tagCls ? ' ' + o.tagCls : ''), text: o.tag }));
    if (o.key && ITEM_INDEX[o.key] && ITEM_INDEX[o.key].pf && o.cat !== 'map') {   // star to add to Favorites
      const favs = store.get('favs', []), on = favs.includes(o.key);
      el.style.position = 'relative';
      el.append(h('button', { class: 'fav', text: on ? '★' : '☆', title: on ? 'Remove from favorites' : 'Add to favorites', onclick: e => { e.stopPropagation(); const f = store.get('favs', []); store.set('favs', on ? f.filter(k => k !== o.key) : [o.key, ...f].slice(0, 60)); this.buildSpawn(); } }));
    }
    return el;
  },
  spawnEntries(cat) {
    const close = () => { if (Input.device === 'kbm') this.closeMenu(); };
    if (['building', 'props', 'furniture', 'fun', 'npcs', 'vehicles'].includes(cat)) return CATALOG[cat].map(it => ({
      key: it.key, name: it.name, icon: it.icon, desc: it.desc, cat,
      sub: cat === 'vehicles' ? 'Sit to drive' : it.desc ? it.desc : (() => { const d = it.pf().ents[0]; return (MATDEFS[d.m] ? MATDEFS[d.m].name : ''); })(),
      tag: it.key === 'zombie' ? 'HOSTILE' : ['xbarrel', 'propane'].includes(it.key) ? 'EXPLOSIVE' : null, tagCls: 'hostile', onclick: () => { Game.spawnItem(it.key); close(); } }));
    if (cat === 'weapons') return WEAPONS.map((w, i) => ({ key: 'wp_' + w.id, name: w.name, icon: w.icon, sub: w.desc, tag: 'SLOT ' + ((i + 1) % 10), cat, onclick: () => { Tools.setWeapon(w.id); this.closeMenu(); } }));
    if (cat === 'tools') return TOOL_MODES.map(m => ({ name: m.name, icon: m.icon, sub: m.desc, cat, onclick: () => { Tools.setWeapon('toolgun'); Tools.setMode(m.id); this.buildSpawn(); } }));
    if (cat === 'map') return CATALOG.map.map(it => ({ key: it.key, name: it.name, icon: it.icon, sub: 'Edit mode', cat, onclick: () => { if (!Editor.active) Editor.toggle(true); if (Editor.active) { Editor.arm(it.key); this.closeMenu(); this.toast('Click to place ' + it.name + (Input.device === 'pad' ? ' (RT)' : ''), 'architecture'); } } }));
    return [];
  },
  buildSpawn() {
    const cats = $('#smCats'); cats.innerHTML = '';
    for (const [k, l, icn, em, n] of this.spawnCats())
      cats.append(h('button', { class: 'cat' + (this.smTab === k && !this.smQuery ? ' act' : ''), html: ic(icn, em) + `<span class="lbl">${l}</span><small>${n}</small>`, onclick: () => { this.smTab = k; this.smQuery = ''; $('#smSearch').value = ''; this.buildSpawn(); } }));
    const g = $('#smGrid'); g.innerHTML = '';
    const sec = (icn, em, t) => g.append(h('div', { class: 'sm-sec', html: ic(icn, em) + esc(t) }));
    const q = this.smQuery;
    if (q) {
      let n = 0;
      for (const [k, l, icn, em] of this.spawnCats()) {
        if (k === 'dupes') continue;
        const hits = this.spawnEntries(k).filter(e => (e.name + ' ' + (e.sub || '') + ' ' + (e.desc || '')).toLowerCase().includes(q));
        if (!hits.length) continue;
        sec(icn, em, l); hits.forEach(e => g.append(this.spawnCard(e))); n += hits.length;
      }
      if (!n) g.append(h('div', { class: 'sm-empty', text: `Nothing matches "${q}".` }));
      this.buildToolOptions(); return;
    }
    const tab = this.smTab;
    if (tab === 'dupes') {
      g.append(h('div', { style: 'grid-column:1/-1', class: 'row' },
        h('button', { class: 'primary', html: ic('save', '💾') + 'Save clipboard as dupe', onclick: () => { if (!Tools.clipboard) return this.toast('Use the Duplicator tool to copy something first', 'content_copy'); const n = prompt('Dupe name', Tools.clipboard.name) || Tools.clipboard.name; Save.saveDupe(n, Tools.clipboard); this.buildSpawn(); } }),
        h('button', { html: ic('upload_file', '📂') + 'Upload dupe', onclick: async () => { const d = await pickJSON(); if (!Save.validDupe(d)) return this.toast('Not a valid dupe file', 'error'); Save.saveDupe(d.name || 'Uploaded dupe', d); this.buildSpawn(); } }),
        Tools.clipboard ? h('button', { html: ic('content_paste', '📋') + 'Paste clipboard', onclick: () => { Tools.pasteDupe(Tools.clipboard, Tools.cast(80)); this.closeMenu(); } }) : null));
      const ds = Save.dupes(), names = Object.keys(ds);
      if (!names.length) g.append(h('div', { class: 'sm-empty', text: 'No saved dupes. Copy a contraption with the Duplicator tool, then save it here.' }));
      for (const n of names) {
        const d = ds[n];
        const el = this.spawnCard({ name: n, icon: '📋', sub: `${d.ents.length} objects`, onclick: () => { Tools.clipboard = d; Tools.pasteDupe(d, Tools.cast(80)); this.closeMenu(); } });
        el.append(h('div', { class: 'row' }, h('button', { class: 'small', html: ic('download', '⬇'), title: 'Download', onclick: e => { e.stopPropagation(); downloadJSON('dupe-' + n, d); } }), h('button', { class: 'small danger', html: ic('delete', '✕'), title: 'Delete', onclick: e => { e.stopPropagation(); if (confirm('Delete dupe "' + n + '"?')) { Save.deleteDupe(n); this.buildSpawn(); } } })));
        g.append(el);
      }
    } else {
      if (tab === 'map' && !canEdit(Players.local)) g.append(h('div', { class: 'sm-empty', text: 'The host hasn\'t allowed you to edit the map.' }));
      if (tab === 'favs') {
        const card = k => this.spawnEntries(ITEM_INDEX[k].cat).find(e => e.key === k);
        const favs = store.get('favs', []).filter(k => ITEM_INDEX[k]), rec = store.get('recent', []).filter(k => ITEM_INDEX[k] && ITEM_INDEX[k].pf && !favs.includes(k));
        sec('star', '⭐', 'Favorites'); if (favs.length) favs.forEach(k => { const c = card(k); if (c) g.append(this.spawnCard(c)); }); else g.append(h('div', { class: 'sm-empty', text: 'Click the ☆ on any item to keep it here.' }));
        if (rec.length) { sec('history', '🕘', 'Recently spawned'); rec.forEach(k => { const c = card(k); if (c) g.append(this.spawnCard(c)); }); }
        this.buildToolOptions(); return;
      }
      if (tab === 'props') {
        const rec = store.get('recent', []).filter(k => ITEM_INDEX[k] && ITEM_INDEX[k].pf);
        if (rec.length) {
          sec('history', '🕘', 'Recently spawned');
          for (const k of rec) g.append(this.spawnCard(this.spawnEntries(ITEM_INDEX[k].cat).find(e => e.key === k)));
          sec('inventory_2', '📦', 'All props');
        }
      }
      this.spawnEntries(tab).forEach(e => g.append(this.spawnCard(e)));
    }
    this.buildToolOptions();
  },
  buildToolOptions() {
    const s = $('#smSide'); s.innerHTML = ''; const o = Tools.opt;
    const slider = (label, key, min, max, step, fmt) => {
      const v = h('span', { class: 'val', text: fmt(o[key]) });
      const inp = h('input', { type: 'range', min, max, step, value: o[key], oninput: () => { o[key] = +inp.value; v.textContent = fmt(o[key]); Tools.saveOpt(); } });
      return h('div', { class: 'opt' }, h('div', { class: 'row' }, h('label', { text: label }), v), inp);
    };
    s.append(h('h3', { text: 'Tool Gun options', style: 'margin-top:0' }));
    const modes = h('div', { class: 'mats' });
    for (const m of TOOL_MODES) modes.append(h('button', { class: Tools.mode === m.id && Tools.weapon === 'toolgun' ? 'on' : '', title: m.desc, text: m.icon + ' ' + m.name, onclick: () => { Tools.setWeapon('toolgun'); Tools.setMode(m.id); this.buildToolOptions(); } }));
    s.append(h('div', { class: 'opt' }, modes));
    s.append(h('h3', { text: 'Rope' }), slider('Length', 'ropeLen', 0.3, 2, 0.05, v => Math.round(v * 100) + '%'), slider('Rigidity', 'ropeRigid', 0, 1, 0.05, v => v >= 0.95 ? 'Rope' : Math.round(v * 100) + '% elastic'));
    s.append(h('h3', { text: 'Thruster' }), slider('Force', 'thrForce', 1, 60, 1, v => v));
    const kb = h('button', { class: 'bindbtn', text: keyLabel(o.thrKey), onclick: () => { kb.textContent = 'press key…'; kb.classList.add('wait'); Input.capture = code => { if (code !== 'Escape') { o.thrKey = code; Tools.saveOpt(); } kb.textContent = keyLabel(o.thrKey); kb.classList.remove('wait'); }; } });
    const padSel = h('select', { onchange: () => { o.thrPad = padSel.value; Tools.saveOpt(); } });
    for (const [v, l] of [['Pad7', 'RT / R2'], ['Pad6', 'LT / L2'], ['Pad0', 'A / ✕'], ['Pad5', 'RB / R1'], ['Pad12', 'D-pad ↑'], ['Pad13', 'D-pad ↓'], ['', 'none']]) padSel.append(h('option', { value: v, text: l, selected: o.thrPad === v }));
    s.append(h('div', { class: 'opt' }, h('div', { class: 'row' }, h('label', { text: 'Key' }), kb)), h('div', { class: 'opt' }, h('div', { class: 'row' }, h('label', { text: 'Controller' }), padSel)));
    s.append(h('h3', { text: 'Wheel' }), slider('Radius', 'wheelR', 0.15, 1.2, 0.05, v => v.toFixed(2) + ' m'));
    s.append(h('h3', { text: 'Motor' }), slider('Speed', 'motSpd', -20, 20, 0.5, v => (v > 0 ? '' : v < 0 ? 'reverse ' : '') + Math.round(Math.abs(v) * 9.55) + ' rpm'));
    const mk = h('button', { class: 'bindbtn', text: keyLabel(o.motKey), onclick: () => { mk.textContent = 'press key…'; mk.classList.add('wait'); Input.capture = code => { if (code !== 'Escape') { o.motKey = code; Tools.saveOpt(); } mk.textContent = keyLabel(o.motKey); mk.classList.remove('wait'); }; } });
    s.append(h('div', { class: 'opt' }, h('div', { class: 'row' }, h('label', { text: 'Key' }), mk)),
      h('div', { class: 'opt' }, h('div', { class: 'row' }, h('label', { text: 'Toggle (press to start / stop)' }), h('input', { type: 'checkbox', checked: !!o.motTog, onchange: e => { o.motTog = e.target.checked; Tools.saveOpt(); } }))));
    s.append(h('h3', { text: 'Painter' }));
    const mats = h('div', { class: 'mats' });
    for (const k of MAT_KEYS) mats.append(h('button', { class: o.paintMat === k ? 'on' : '', text: MATDEFS[k].name, onclick: () => { o.paintMat = k; Tools.saveOpt(); this.buildToolOptions(); } }));
    const cols = h('div', { class: 'colors' });
    for (const c of PAINT_COLORS) cols.append(h('button', { class: o.paintCol === c ? 'sel' : '', style: `background:${c}`, title: c, onclick: () => { o.paintCol = c; Tools.saveOpt(); this.buildToolOptions(); } }));
    s.append(h('div', { class: 'opt' }, mats), h('div', { class: 'opt' }, cols));
  },
  // ---- radial menu ------------------------------------------------------------------
  radialPages() {
    const me = Players.local;
    return [
      { name: 'Weapons', items: WEAPONS.map(w => ({ img: Thumbs.urls['wp_' + w.id], icon: w.icon, ms: 'swords', name: w.name, on: Tools.weapon === w.id, act: () => Tools.setWeapon(w.id) })) },
      { name: 'Tool Gun', items: TOOL_MODES.map(m => ({ ms: TOOL_ICON[m.id], icon: m.icon, name: m.name, on: Tools.weapon === 'toolgun' && Tools.mode === m.id, act: () => { Tools.setWeapon('toolgun'); Tools.setMode(m.id); } })) },
      { name: 'Quick Spawn', items: ['crate', 'barrel', 'ball', 'plank', 'npc', 'zombie', 'car', 'kart'].map(k => ({ img: Thumbs.urls[k], icon: ITEM_INDEX[k].icon, name: ITEM_INDEX[k].name, act: () => Game.spawnItem(k) })) },
      { name: 'Actions', items: [
        { ms: 'undo', icon: '↩', name: 'Undo', act: () => Net.toHost({ t: 'undo' }) },
        { ms: 'flight', icon: '🕊', name: me && me.noclip ? 'Noclip off' : 'Noclip', act: () => Game.toggleNoclip() },
        { ms: 'architecture', icon: '🧱', name: Editor.active ? 'Exit Edit' : 'Edit Mode', act: () => Editor.toggle() },
        { ms: 'inventory_2', icon: '📋', name: 'Spawn Menu', act: () => setTimeout(() => this.openMenu('spawn'), 0) },
        { ms: 'thumb_up', icon: '👍', name: 'Say "Nice!"', act: () => Net.toHost({ t: 'chat', text: 'Nice! 👍' }) },
        { ms: 'sos', icon: '🆘', name: 'Say "Help!"', act: () => Net.toHost({ t: 'chat', text: 'Help! 🆘' }) },
        { ms: 'celebration', icon: '🎉', name: 'Say "GG"', act: () => Net.toHost({ t: 'chat', text: 'GG 🎉' }) },
        { ms: 'menu', icon: '⚙', name: 'Menu', act: () => setTimeout(() => this.openMenu('pause'), 0) },
      ] },
    ];
  },
  buildRadial() {
    const pages = this.radialPages(), pi = this.rad.page % pages.length, pg = pages[pi], ring = $('#radialRing');
    ring.querySelectorAll('.rItem').forEach(e => e.remove());
    const n = pg.items.length, C = 230, R1 = 100, R2 = 224, gap = 0.012;
    const P = (r, a) => `${(C + r * Math.cos(a)).toFixed(1)} ${(C + r * Math.sin(a)).toFixed(1)}`;
    let paths = '';
    pg.items.forEach((it, i) => {
      const a0 = -Math.PI / 2 + (i - 0.5) / n * Math.PI * 2 + gap, a1 = -Math.PI / 2 + (i + 0.5) / n * Math.PI * 2 - gap;
      paths += `<path data-i="${i}" class="${i === this.rad.sel ? 'sel' : ''}${it.on ? ' on' : ''}" d="M ${P(R2, a0)} A ${R2} ${R2} 0 0 1 ${P(R2, a1)} L ${P(R1, a1)} A ${R1} ${R1} 0 0 0 ${P(R1, a0)} Z"/>`;
      const a = -Math.PI / 2 + i / n * Math.PI * 2;
      ring.append(h('div', { class: 'rItem' + (i === this.rad.sel ? ' sel' : ''), style: `left:${C + Math.cos(a) * 162}px;top:${C + Math.sin(a) * 162}px`, 'data-i': i,
        html: (it.img ? `<img src="${it.img}" alt="">` : ic(it.ms || 'circle', it.icon || '')) + `<span class="lbl">${esc(it.name)}</span>` }));
    });
    $('#radialSvg').innerHTML = paths;
    $('#radialPage').textContent = pg.name;
    $('#radialName').textContent = this.rad.sel >= 0 && pg.items[this.rad.sel] ? pg.items[this.rad.sel].name : '';
    $('#radialSub').innerHTML = Input.device === 'pad' ? `${glyph(PAD.LEFT)}${glyph(PAD.RIGHT)} page` : '<kbd>Wheel</kbd> page';
    $('#radialDots').innerHTML = pages.map((p, i) => `<i class="${i === pi ? 'on' : ''}"></i>`).join('');
    this.rad.items = pg.items;
  },
  openRadial() { this.rad.sel = -1; this.rad.vx = this.rad.vy = 0; this.openMenu('radial'); },
  updateRadial() {
    const r = this.rad, pages = this.radialPages().length;
    let flip = 0;
    if (Input.wheel) flip = Math.sign(Input.wheel);
    if (Input.padHit(PAD.RIGHT) || Input.padHit(PAD.RT)) flip = 1; if (Input.padHit(PAD.LEFT) || Input.padHit(PAD.LT)) flip = -1;
    if (flip) { r.page = (r.page + flip + pages) % pages; r.sel = -1; r.vx = r.vy = 0; this.buildRadial(); }
    r.vx += Input.dx * 0.012; r.vy += Input.dy * 0.012;
    const L = Math.hypot(r.vx, r.vy); if (L > 1.2) { r.vx *= 1.2 / L; r.vy *= 1.2 / L; }
    let sx = r.vx, sy = r.vy;
    for (const [x, y] of [[Input.axes[0], Input.axes[1]], [Input.axes[2], Input.axes[3]]]) if (Math.hypot(x, y) > 0.5) { sx = x; sy = y; }
    if (Math.hypot(sx, sy) > 0.35 && r.items) {
      let a = Math.atan2(sy, sx) + Math.PI / 2; if (a < 0) a += Math.PI * 2;
      const n = r.items.length, sel = Math.round(a / (Math.PI * 2) * n) % n;
      if (sel !== r.sel) {
        r.sel = sel;
        $$('#radialSvg path').forEach(e => e.classList.toggle('sel', +e.dataset.i === sel));
        $$('.rItem').forEach(e => e.classList.toggle('sel', +e.dataset.i === sel));
        $('#radialName').textContent = r.items[sel].name;
        Audio.play('tick');
      }
    }
    if (Input.up('radial') || Input.mHit[0] || Input.padHit(PAD.A)) { const it = r.items && r.items[r.sel]; this.closeMenu(); if (it) it.act(); }
  },
  // ---- pause / settings / admin / save-load / help ---------------------------------------
  // ---- inventory: everything you can carry; drag onto the 12 hotbar slots ------------------------------------
  buildInventory() {
    const s = $('#inventoryMenu'); s.innerHTML = '';
    const tab = this.invTab || 'weapons', q = (this.invQ || '').toLowerCase();
    s.append(h('div', { class: 'inv-head' }, h('h2', { text: 'Inventory' }), h('span', { class: 'muted', text: this.invPick ? 'Now click a hotbar slot to put it there.' : 'Drag anything onto a hotbar slot, or click it and then a slot. Drag slots to swap them, right-click to empty one.' })));
    // the hotbar
    const bar = h('div', { class: 'inv-bar' }), slots = Hotbar.get();
    const drop = (i, data) => {
      if (data.from != null) { const a = slots[data.from], b = slots[i]; slots[i] = a; slots[data.from] = b; saveSettings(); }
      else if (data.e) slots[i] = Object.assign({}, data.e);
      saveSettings(); this.invPick = null; this.buildSlots(); this.buildInventory(); Audio.play('place');
    };
    slots.forEach((e, i) => {
      const f = Hotbar.info(e);
      const el = h('div', { class: 'inv-slot' + (f ? '' : ' empty') + (this.invSwap === i ? ' pick' : ''), draggable: !!f, tabindex: 0, title: f ? f.name : 'Empty slot' },
        h('b', { text: HOTBAR_LABEL[i] }),
        f ? (f.url ? h('img', { src: f.url, alt: '' }) : h('div', { class: 'ph', html: f.html ? f.icon : esc(f.icon) })) : h('div', { class: 'ph', text: '+' }),
        h('span', { class: 'nm', text: f ? f.name : 'Empty' }), f && f.sub ? h('span', { class: 'sb', text: f.sub }) : null,
        f ? h('button', { class: 'x', text: '×', title: 'Empty this slot', onclick: ev => { ev.stopPropagation(); slots[i] = null; saveSettings(); this.buildSlots(); this.buildInventory(); Audio.play('undo'); } }) : null);
      el.ondragstart = ev => { ev.dataTransfer.setData('text/plain', JSON.stringify({ from: i })); };
      el.ondragover = ev => { ev.preventDefault(); el.classList.add('over'); }; el.ondragleave = () => el.classList.remove('over');
      el.ondrop = ev => { ev.preventDefault(); try { drop(i, JSON.parse(ev.dataTransfer.getData('text/plain'))); } catch (err) { } };
      el.oncontextmenu = ev => { ev.preventDefault(); slots[i] = null; saveSettings(); this.buildSlots(); this.buildInventory(); };
      el.onclick = () => {
        if (this.invPick) return drop(i, { e: this.invPick });
        if (this.invSwap != null && this.invSwap !== i) { const from = this.invSwap; this.invSwap = null; return drop(i, { from }); }
        this.invSwap = this.invSwap === i ? null : i; this.buildInventory();
      };
      bar.append(el);
    });
    s.append(bar);
    // what you can carry
    const tabs = h('div', { class: 'tabs' });
    for (const [k, l] of [['weapons', 'Weapons'], ['tools', 'Tool gun modes'], ['items', 'Spawn items']]) tabs.append(h('button', { class: tab === k ? 'act' : '', text: l, onclick: () => { this.invTab = k; this.buildInventory(); } }));
    const search = h('input', { type: 'search', placeholder: 'Search…', value: this.invQ || '', style: 'margin-left:auto;width:200px', oninput: () => { this.invQ = search.value; clearTimeout(this._invT); this._invT = setTimeout(() => { this.buildInventory(); const n = $('#inventoryMenu input[type=search]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 200); } });
    s.append(h('div', { class: 'row', style: 'gap:8px;align-items:center;margin:12px 0 8px' }, tabs, search));
    let list = [];
    if (tab === 'weapons') list = WEAPONS.map(w => ({ e: { w: w.id }, name: w.name, url: Thumbs.urls['wp_' + w.id], icon: w.icon, desc: w.desc }));
    else if (tab === 'tools') list = TOOL_MODES.map(m => ({ e: { w: 'toolgun', m: m.id }, name: m.name, icon: ic(TOOL_ICON[m.id], m.icon), html: true, desc: m.desc }));
    else {
      const favs = store.get('favs', []).filter(k => ITEM_INDEX[k] && ITEM_INDEX[k].pf);
      const keys = [...favs, ...['props', 'building', 'furniture', 'fun', 'npcs', 'vehicles'].flatMap(c => (CATALOG[c] || []).map(it => it.key)).filter(k => !favs.includes(k))];
      list = keys.filter(k => ITEM_INDEX[k] && ITEM_INDEX[k].pf).map(k => { const it = ITEM_INDEX[k]; return { e: { i: k }, name: it.name || k, url: Thumbs.urls[k], icon: it.icon || '📦', desc: favs.includes(k) ? '★ Favorite' : '' }; });
    }
    if (q) list = list.filter(o => (o.name + ' ' + (o.desc || '')).toLowerCase().includes(q));
    const grid = h('div', { class: 'inv-grid' });
    for (const o of list) {
      const inBar = slots.some(e => e && JSON.stringify(e) === JSON.stringify(o.e));
      const picked = this.invPick && JSON.stringify(this.invPick) === JSON.stringify(o.e);
      const el = h('div', { class: 'item' + (picked ? ' pick' : ''), draggable: true, tabindex: 0, title: o.desc || o.name },
        o.url ? h('img', { src: o.url, alt: '' }) : h('div', { class: 'ph', html: o.html ? o.icon : esc(o.icon) }), h('div', { text: o.name }), inBar ? h('span', { class: 'tag', text: 'ON BAR' }) : null);
      el.ondragstart = ev => { ev.dataTransfer.setData('text/plain', JSON.stringify({ e: o.e })); };
      el.onclick = () => { this.invPick = picked ? null : o.e; this.invSwap = null; this.buildInventory(); };
      el.ondblclick = () => { const i = slots.findIndex(e => !Hotbar.valid(e)); if (i >= 0) drop(i, { e: o.e }); else this.toast('The hotbar is full: empty a slot first', 'info'); };
      grid.append(el);
    }
    if (!list.length) grid.append(h('div', { class: 'sm-empty', text: 'Nothing matches that search.' }));
    s.append(grid);
    s.append(h('div', { class: 'btns' },
      h('button', { text: 'Reset to default', onclick: () => { Settings.hotbar = Hotbar.def(); saveSettings(); this.invPick = this.invSwap = null; this.buildSlots(); this.buildInventory(); } }),
      h('button', { text: 'Empty all', onclick: () => { Settings.hotbar = Array(12).fill(null); saveSettings(); this.buildSlots(); this.buildInventory(); } }),
      h('button', { class: 'primary', text: 'Done', onclick: () => { this.invPick = this.invSwap = null; this.closeMenu(); } })));
  },
  refreshOwner() { if (this.open === 'owner') this.buildOwner(); },
  // owner access: unlock with the owner code (checked on this device), then the host verifies you
  buildOwner() {
    const s = $('#ownerMenu'); s.innerHTML = '';
    s.append(h('h2', { text: 'Owner access' }));
    if (!Owner.cfg()) { s.append(h('p', { class: 'muted', text: 'Owner access is not set up in this copy of the game.' })); s.append(h('div', { class: 'btns' }, h('button', { text: 'Back', onclick: () => this.back() }))); return; }
    if (Owner.key) {
      const st = Net.isHost ? 'You are the host, so you already have every setting.' : !Net.online ? 'Unlocked. Join or host a room: the host will verify you automatically.' : Owner.ok ? 'Verified by this room\'s host. Host settings are in the pause menu.' : 'Unlocked. Waiting for the host to verify you…';
      s.append(h('p', { text: st }));
      s.append(h('div', { class: 'btns' },
        !Owner.ok && Net.online && !Net.isHost ? h('button', { text: 'Ask the host again', onclick: () => { Owner.okHost = null; Owner.hello(); } }) : null,
        h('button', { class: 'danger', text: 'Forget on this device', onclick: () => Owner.forget() }),
        h('button', { class: 'primary', text: 'Done', onclick: () => this.back() })));
      return;
    }
    s.append(h('p', { class: 'muted', style: 'font-size:13px;line-height:1.5', text: 'Owners can change the host settings in any room. The code is checked on this device and is never sent to anyone.' }));
    const inp = h('input', { type: 'password', placeholder: 'Owner code', autocomplete: 'off', style: 'width:100%' });
    const rem = h('input', { type: 'checkbox' }), msg = h('p', { class: 'muted', style: 'min-height:1.2em;font-size:13px' });
    const go = async () => {
      if (Owner.busy || !inp.value.trim()) return; Owner.busy = true; msg.textContent = 'Checking…'; btn.disabled = true;
      try { await Owner.unlock(inp.value, rem.checked); inp.value = ''; this.buildOwner(); Audio.play('confirm'); }
      catch (e) { msg.textContent = e.message || 'Wrong owner code.'; Audio.play('error'); await new Promise(r => setTimeout(r, 1200)); }
      Owner.busy = false; btn.disabled = false;
    };
    inp.onkeydown = e => { if (e.key === 'Enter') go(); };
    const btn = h('button', { class: 'primary', text: 'Unlock', onclick: go });
    s.append(inp, h('label', { class: 'row', style: 'gap:8px;align-items:center;margin-top:10px;font-size:13px' }, rem, h('span', { text: 'Remember on this device' })), msg,
      h('div', { class: 'btns' }, h('button', { text: 'Back', onclick: () => this.back() }), btn));
    setTimeout(() => inp.focus(), 50);
  },
  buildPause() {
    const p = $('#pause'); p.innerHTML = '';
    p.append(h('h2', { text: 'Paused' }));
    if (Net.online) p.append(h('div', { class: 'psub' }, h('span', { text: 'Room' }), h('b', { text: fmtCode(Net.code) }), h('span', { text: `${Players.map.size} player${Players.map.size === 1 ? '' : 's'}` })));
    else p.append(h('div', { class: 'psub', text: 'Offline' }));
    const list = h('div', { class: 'mlist' }), item = (label, fn, cls) => list.append(h('button', { class: 'mitem' + (cls ? ' ' + cls : ''), text: label, onclick: fn }));
    item('Resume', () => this.closeMenu());
    item('Spawn menu', () => this.openMenu('spawn'));
    item('Inventory / hotbar', () => this.openMenu('inventory'));
    if (Net.online) item('Copy invite link', () => this.copyInvite());
    if (Net.online) item('Copy network report', () => this.copyReport());
    item('Save / load', () => this.openMenu('saveload'));
    item('Clean up props', () => this.openMenu('cleanup'));
    item('Community addons', () => this.openMenu('addons'));
    if (Net.isHost) item('Host settings', () => this.openMenu('admin'));
    else if (Owner.ok) item('Host settings (owner)', () => this.openMenu('admin'));
    item('Settings', () => this.openMenu('settings'));
    item('Controls', () => this.openMenu('help'));
    item(Owner.key ? 'Owner access ✓' : 'Owner access', () => this.openMenu('owner'));
    item(Net.online ? 'Leave room' : 'Quit to menu', () => Game.toLobby(), 'danger');
    p.append(list);
  },
  // player preview in the lobby (renders the avatar model in the chosen color)
  refreshLobbyAvatar() {
    if (!Models.has('avatar')) return;
    const g = Models.instance('avatar', 'plastic', Settings.color), gun = g.getObjectByName('gun');
    if (gun && Models.has('wp_physgun')) { gun.traverse(o => { if (o.isMesh) o.visible = false; }); const W = WEAPON_MODEL.physgun, wm = Models.instance('wp_physgun', W.t, W.c), hand = wm.getObjectByName('wp_physgun_hand'); if (hand) hand.visible = false; wm.position.set(0, 0.03, -0.12); gun.add(wm); }
    Models.plain(g);
    const url = Thumbs.snap(g, new V3(0.5, 0.18, -1), 150, 0.95);
    if (url) $('#lobbyAvatar').innerHTML = `<img src="${url}" alt="Your character">`;
  },
  buildSettings() {
    const s = $('#settings'); s.innerHTML = '';
    s.append(h('h2', { text: 'Settings' }));
    const tabs = h('div', { class: 'tabs' });
    for (const [k, l] of [['graphics', 'Graphics'], ['audio', 'Audio'], ['controls', 'Controls'], ['keys', 'Keybinds'], ['network', 'Network']]) tabs.append(h('button', { class: this.setTab === k ? 'act' : '', text: l, onclick: () => { this.setTab = k; this.buildSettings(); } }));
    s.append(tabs);
    const row = (label, ctl, extra) => h('div', { class: 'setrow' }, h('span', { html: label }), ctl, extra || null);
    const check = (key, on) => h('input', { type: 'checkbox', checked: !!Settings[key], onchange: e => { Settings[key] = e.target.checked; saveSettings(); if (on) on(); } });
    const range = (key, min, max, step, fmt, on) => { const v = h('span', { class: 'v', text: fmt(Settings[key]) }); const i = h('input', { type: 'range', min, max, step, value: Settings[key], oninput: () => { Settings[key] = +i.value; v.textContent = fmt(Settings[key]); saveSettings(); if (on) on(); } }); return [i, v]; };
    const t = this.setTab;
    if (t === 'graphics') {
      const sel = h('select', { onchange: () => Game.setTier(sel.value) });
      for (const k of TIER_KEYS) sel.append(h('option', { value: k, text: TIERS[k].label + (k === 'low' ? ' (PS1 style)' : ''), selected: R.tier === k }));
      s.append(row('Quality preset ' + tierBadge(R.tier), sel, h('button', { class: 'small', text: 'Auto-detect', onclick: () => { const d = R.detectTier(); Game.detected = d; Game.setTier(d.tier); this.toast(`Detected ${TIERS[d.tier].label} (${d.ms} ms bench)`); } })));
      const pbr = TIERS[R.tier].path === 'pbr';
      s.append(row('Shadows' + (pbr ? '' : ' <span class="muted">(n/a on Low)</span>'), check('shadows', () => R.applyTier(R.tier, false))));
      s.append(row('Ambient occlusion (GTAO)', check('ao', () => R.setupComposer())));
      s.append(row('Bloom', check('bloom', () => R.setupComposer())));
      s.append(row('Reflection probes <span class="muted">(Ultra)</span>', check('reflections')));
      s.append(row('Dynamic resolution', check('drs')));
      const tf = h('select', { onchange: () => { Settings.targetFps = +tf.value; saveSettings(); } });
      for (const f of [30, 45, 60, 90, 120, 144]) tf.append(h('option', { value: f, text: f + ' FPS', selected: Settings.targetFps === f }));
      s.append(row('Target frame rate', tf, h('span', { class: 'v', id: 'rsVal', text: Math.round(R.drs.scale * 100) + '%' })));
      s.append(row('Show FPS counter', check('showFps')));
      const gs = h('select', { onchange: () => { Settings.gore = gs.value; saveSettings(); if (gs.value === 'off') Gore.clearAll(); } });
      for (const [v, l] of [['full', 'Full'], ['blood', 'Blood only'], ['off', 'Off']]) gs.append(h('option', { value: v, text: l, selected: Settings.gore === v }));
      s.append(row('Gore', gs));
      const bc = h('select', { onchange: () => { Settings.bloodColor = bc.value; saveSettings(); Gore.rebuildMats(); } });
      for (const [v, l] of [['red', 'Red'], ['green', 'Green']]) bc.append(h('option', { value: v, text: l, selected: Settings.bloodColor === v }));
      s.append(row('Blood color', bc));
      s.append(h('p', { class: 'muted', style: 'font-size:12px;line-height:1.5', text: `GPU: ${R.gpuName || 'unknown'}. Every preset shows the same gameplay information.` }));
    } else if (t === 'audio') {
      const pct = v => Math.round(v * 100) + '%', sel = (key, opts, on) => { const e = h('select', { onchange: () => { Settings[key] = /^\d+$/.test(e.value) ? +e.value : e.value; saveSettings(); if (on) on(); } }); for (const [v, l] of opts) e.append(h('option', { value: v, text: l, selected: String(Settings[key]) === String(v) })); return e; };
      const head = txt => s.append(h('h3', { text: txt, style: 'margin:14px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;opacity:.7' }));
      head('Volume');
      s.append(row('Master', ...range('volume', 0, 1, 0.05, pct, () => Audio.setVolume())));
      for (const [k, l] of [['volWeapons', 'Weapons &amp; explosions'], ['volImpacts', 'Impacts, breaking &amp; water'], ['volSteps', 'Footsteps &amp; movement'], ['volVoices', 'Voices (NPCs, players, nextbots)'],
        ['volGore', 'Gore'], ['volVehicles', 'Vehicles &amp; machines'], ['volTools', 'Physics gun &amp; tools'], ['volAmb', 'Ambience (wind, city, birds, water)'], ['volUI', 'Interface']]) s.append(row(l, ...range(k, 0, 1.5, 0.05, pct)));
      head('Sound');
      s.append(row('3D audio', sel('audio3d', [['auto', 'Auto (headphone 3D on High / Ultra)'], ['on', 'Headphones (HRTF 3D)'], ['off', 'Speakers (stereo panning)']]),
        h('button', { class: 'small', text: 'Test left → right', onclick: () => Audio.test3d() })));
      s.append(row('Reverb (echo in rooms and outdoors)', ...range('reverb', 0, 1.5, 0.05, v => v ? pct(v) : 'Off')));
      s.append(row('Distance muffling <span class="muted">(far sounds lose their highs)</span>', check('airAbsorb')));
      s.append(row('Walls muffle sound', check('occlusion')));
      s.append(row('Speed of sound <span class="muted">(far gunfire / explosions arrive late)</span>', check('sosDelay')));
      s.append(row('Mono output <span class="muted">(one earbud / accessibility)</span>', check('monoAudio', () => Audio.applyOptions())));
      s.append(row('Night mode <span class="muted">(quieter loud sounds, louder quiet ones)</span>', check('nightMode', () => Audio.applyOptions())));
      s.append(row('Mute when the game is in the background', check('muteBg', () => Audio.setVolume())));
      s.append(row('Hit marker sound', check('hitSound')));
      s.append(row('Nextbot jumpscare scream', check('jumpscareSound')));
      s.append(row('Max sounds at once <span class="muted">(lower = lighter on weak PCs)</span>', sel('maxVoices', [[24, '24'], [32, '32'], [48, '48'], [64, '64']])));
      s.append(h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { text: 'Reset audio to defaults', onclick: () => { Object.assign(Settings, AUDIO_DEFAULTS, { volume: 0.6 }); saveSettings(); Audio.applyOptions(); this.buildSettings(); } })));
      s.append(h('p', { class: 'muted', style: 'font-size:12px;line-height:1.5', text: 'Volumes go up to 150%. Headphone 3D (HRTF) gives the most realistic direction but costs a little more CPU.' }));
    } else if (t === 'controls') {
      s.append(row('Field of view', ...range('fov', 60, 110, 1, v => v + '°', () => R.setFov(Settings.fov))));
      s.append(row('Mouse sensitivity', ...range('sens', 0.1, 3, 0.05, v => v.toFixed(2))));
      s.append(row('Invert look Y', check('invertY')));
      s.append(row('Show control hints', check('showHints', () => { this.hintKey = ''; })));
      s.append(row('Spawn with hologram preview', check('spawnPreview')));
      s.append(row('Damage numbers', check('dmgNums')));
      const su = h('select', { onchange: () => { Settings.speedUnit = su.value; saveSettings(); } });
      for (const [v, l] of [['mph', 'mph'], ['kmh', 'km/h']]) su.append(h('option', { value: v, text: l, selected: (Settings.speedUnit || 'mph') === v }));
      s.append(row('Speedometer units', su));
      s.append(row('Noclip fly speed', ...range('flySpeed', 0.25, 5, 0.25, v => v + 'x')));
      s.append(row('Controller look speed', ...range('padSens', 0.2, 3, 0.05, v => v.toFixed(2))));
      s.append(row('Controller deadzone', ...range('deadzone', 0.02, 0.45, 0.01, v => v.toFixed(2))));
      const aa = h('select', { onchange: () => { Settings.aimAssist = +aa.value; saveSettings(); } });
      ['Off', 'Low', 'Standard', 'Strong'].forEach((l, i) => aa.append(h('option', { value: i, text: l, selected: (Settings.aimAssist | 0) === i })));
      s.append(row('Controller aim assist' + (Rules.aimAssist === false ? ' <span class="muted">(disabled by host)</span>' : ''), aa));
      s.append(h('p', { class: 'muted', style: 'font-size:12px', text: 'Standard Xbox / PlayStation layout. Button prompts follow the last device you used. Aim assist applies to controllers only.' }));
    } else if (t === 'keys') {
      for (const a of Object.keys(DEFAULT_BINDS)) {
        const b = h('button', { class: 'bindbtn', text: keyLabel(Settings.binds[a]) });
        b.onclick = () => { b.textContent = 'press a key…'; b.classList.add('wait'); Input.capture = code => { if (code !== 'Escape') { Settings.binds[a] = code; saveSettings(); } this.buildSettings(); }; };
        s.append(row(BIND_LABELS[a] || a, b));
      }
      s.append(h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { text: 'Reset to defaults', onclick: () => { Settings.binds = Object.assign({}, DEFAULT_BINDS); saveSettings(); this.buildSettings(); } })));
      s.append(h('p', { class: 'muted', style: 'font-size:12px', text: 'Fire: left mouse. Alt-fire: right mouse. Weapons: 1-9, 0. Menu: Esc.' }));
    } else if (t === 'network') {
      const U = window.TWUpdate || { status: 'off' };
      s.append(row('Game version', h('span', { class: 'v', text: 'v' + GAME.version })));
      s.append(row('Updates', h('span', { class: 'v', style: 'max-width:300px;text-align:right', text: (this.updText(U) || 'idle') + (U.status === 'error' && U.msg ? ` (${U.msg})` : '') }),
        U.status === 'ready' ? h('button', { class: 'small primary', text: 'Restart to update', onclick: () => { if (Game.state !== 'playing' || confirm('Restart now? You will leave the current room.')) U.restart(); } })
          : h('button', { class: 'small', text: 'Check now', onclick: () => { if (U.check && U.status !== 'off') U.check(); else this.toast('Updates are not set up for this copy of the game', 'info'); } })));
      if (U.url) s.append(h('p', { class: 'muted', style: 'font-size:12px;word-break:break-all', text: 'Update server: ' + U.url + ' (updates are checked at start-up and every 30 minutes; only files signed with the developer key are accepted)' }));
      s.append(row('Show network stats overlay', check('showNet')));
      s.append(row('Network report <span class="muted">(last room you created or joined)</span>', h('button', { class: 'small', text: 'Copy network report', onclick: () => this.copyReport() })));
      const txt = (key, ph) => h('input', { type: 'text', value: Settings[key] || '', placeholder: ph, style: 'width:240px', onchange: e => { Settings[key] = e.target.value.trim(); saveSettings(); } });
      s.append(row('Signaling relays <span class="muted">(optional)</span>', txt('relays', 'wss://relay1, wss://relay2')));
      s.append(row('TURN server URL(s)', txt('turnUrl', 'turn:host:3478, turns:host:5349')));
      s.append(row('TURN username', txt('turnUser', 'optional')));
      s.append(row('TURN password', txt('turnPass', 'optional')));
      s.append(h('p', { class: 'muted', style: 'font-size:12px;line-height:1.5', text: 'Players connect peer-to-peer. Strict school or office networks may need a TURN server. Changes apply the next time you create or join a room.' }));
    }
    s.append(h('div', { class: 'btns' }, h('button', { class: 'primary', text: 'Done', onclick: () => this.back() })));
  },
  buildAdmin() {
    const s = $('#admin'); s.innerHTML = '';
    s.append(h('h2', { text: 'Host settings' }));
    if (Owner.ok && !Net.isHost) s.append(h('p', { class: 'muted', text: 'Owner access: changes go through the host and apply to everyone.' }));
    if (!Net.isHost && !Owner.ok) { s.append(h('p', { class: 'muted', text: 'Only the host can use the admin panel.' })); s.append(h('div', { class: 'btns' }, h('button', { text: 'Back', onclick: () => this.back() }))); return; }
    const row = (label, ctl) => h('div', { class: 'setrow' }, h('span', { html: label }), ctl);
    s.append(row('Combat (PvP damage)', h('input', { type: 'checkbox', checked: Rules.combat, onchange: e => Admin.req('combat', { v: e.target.checked }) })));
    const ep = h('select', { onchange: () => Admin.req('editPerm', { v: ep.value }) });
    for (const [v, l] of [['all', 'Everyone'], ['list', 'Selected players'], ['host', 'Host only']]) ep.append(h('option', { value: v, text: l, selected: Rules.editPerm === v }));
    s.append(row('Who can edit the map', ep));
    s.append(row('Allow noclip', h('input', { type: 'checkbox', checked: Rules.allowNoclip, onchange: e => Admin.req('noclip', { v: e.target.checked }) })));
    const th = h('select', { onchange: () => Admin.req('env', { v: th.value }) });
    for (const k in THEMES) th.append(h('option', { value: k, text: THEMES[k].label, selected: (Rules.env || 'plains') === k }));
    s.append(row('Map', th));
    const gm = h('select', { onchange: () => Admin.req('mode', { v: gm.value }) });
    for (const [k, l] of [['sandbox', 'Sandbox'], ['nextbot', 'Nextbot chase']]) gm.append(h('option', { value: k, text: l, selected: (Rules.mode || 'sandbox') === k }));
    s.append(row('Gamemode', gm));
    if (Rules.mode === 'nextbot') { const bc = h('input', { type: 'range', min: 1, max: 8, value: Rules.bots || 3, onchange: () => Admin.req('bots', { v: +bc.value }) }); s.append(row(`Nextbots <span class="muted">(${Rules.bots || 3})</span>`, bc)); }
    s.append(row('Dismemberment (NPC limbs can come off)', h('input', { type: 'checkbox', checked: Rules.dismember !== false, onchange: e => Admin.req('dismember', { v: e.target.checked }) })));
    s.append(row('Allow controller aim assist', h('input', { type: 'checkbox', checked: Rules.aimAssist !== false, onchange: e => Admin.req('aimAssist', { v: e.target.checked }) })));
    const pv = h('span', { class: 'v', text: Rules.propLimit });
    const pl = h('input', { type: 'range', min: 10, max: 600, step: 10, value: Rules.propLimit, oninput: () => pv.textContent = pl.value, onchange: () => Admin.req('propLimit', { v: +pl.value }) });
    s.append(h('div', { class: 'setrow' }, h('span', { text: 'Prop limit per player' }), pl, pv));
    const hpTxt = v => v + ' HP' + (v === 100 ? ' (normal)' : v < 100 ? ' (weaker)' : ' (tougher)');
    const hv = h('span', { class: 'v', text: hpTxt(Rules.npcHp || 100) });
    const hsl = h('input', { type: 'range', min: 10, max: 1000, step: 10, value: Rules.npcHp || 100, oninput: () => hv.textContent = hpTxt(+hsl.value), onchange: () => Admin.req('npcHp', { v: +hsl.value }) });
    s.append(h('div', { class: 'setrow' }, h('span', { html: 'NPC health <span class="muted">(limbs scale too)</span>' }), hsl, hv));
    const mphTxt = v => v > 0 ? v + ' mph' : 'Default (each car)';
    const cv = h('span', { class: 'v', text: mphTxt(Rules.carMph || 0) });
    const cs = h('input', { type: 'range', min: 0, max: 300, step: 5, value: Rules.carMph || 0, oninput: () => { const v = +cs.value; cv.textContent = mphTxt(v > 0 && v < 15 ? 15 : v); }, onchange: () => Admin.req('carMph', { v: +cs.value > 0 && +cs.value < 15 ? 15 : +cs.value }) });
    s.append(h('div', { class: 'setrow' }, h('span', { html: 'Car top speed <span class="muted">(0 = each car\'s own: 58-80 mph)</span>' }), cs, cv));
    s.append(h('div', { class: 'row', style: 'flex-wrap:wrap;margin-top:12px' },
      h('button', { text: '❄ Freeze all', onclick: () => Admin.req('freezeAll') }), h('button', { text: 'Unfreeze all', onclick: () => Admin.req('unfreezeAll') }),
      h('button', { class: 'danger', text: '🧹 Clear all props', onclick: () => { if (confirm('Remove every prop, NPC and vehicle?')) Admin.req('clearAll'); } }),
      h('button', { class: 'danger', text: 'Clear map pieces', onclick: () => { if (confirm('Remove all map pieces?')) Admin.req('clearMap'); } })));
    s.append(h('h3', { text: 'Players' }));
    const list = h('div', { class: 'list' });
    for (const p of Players.map.values()) {
      const me = p.isLocal;
      list.append(h('div', { class: 'li' }, h('span', { html: `<i class="pdot" style="background:${esc(p.color)}"></i>${esc(p.name)} ${tierBadge(p.tier)} <span class="muted">${World.countOwned(p.id)} props</span>` }),
        me ? h('small', { class: 'muted', text: 'you' }) : null,
        !me && Rules.editPerm === 'list' ? h('button', { class: 'small' + (p.canEdit ? ' on' : ''), text: p.canEdit ? '✏ Can edit' : '✏ Allow edit', onclick: () => Admin.req('canEdit', { id: p.id }) }) : null,
        h('button', { class: 'small', text: 'Clear props', onclick: () => Admin.req('clearPlayer', { id: p.id }) }),
        !me ? h('button', { class: 'small' + (p.muted ? ' on' : ''), text: p.muted ? 'Unmute' : 'Mute', onclick: () => Admin.req('mute', { id: p.id }) }) : null,
        !me ? h('button', { class: 'small danger', text: 'Kick', onclick: () => { if (confirm('Kick ' + p.name + '?')) Admin.req('kick', { id: p.id }); } }) : null));
    }
    s.append(list);
    s.append(h('div', { class: 'btns' }, h('button', { class: 'primary', text: 'Done', onclick: () => this.back() })));
  },
  refreshAdmin() { if (this.open === 'admin') this.buildAdmin(); },
  buildSaveLoad() {
    const s = $('#saveload'); s.innerHTML = '';
    s.append(h('h2', { text: 'Save / Load' }));
    const tabs = h('div', { class: 'tabs' });
    for (const [k, l] of [['worlds', 'Worlds'], ['dupes', 'Dupes']]) tabs.append(h('button', { class: this.slTab === k ? 'act' : '', text: l, onclick: () => { this.slTab = k; this.buildSaveLoad(); } }));
    s.append(tabs);
    const inGame = Game.state === 'playing', canLoad = !inGame || Net.isHost;
    if (this.slTab === 'worlds') {
      if (inGame) {
        const nm = h('input', { type: 'text', placeholder: 'World name', style: 'flex:1' });
        s.append(h('div', { class: 'row' }, nm, h('button', { class: 'primary', text: '💾 Save', onclick: () => { Save.saveWorld(nm.value); this.buildSaveLoad(); } }), h('button', { text: '⬇ Download', onclick: () => downloadJSON('world-' + (nm.value || 'tumblewright'), Object.assign(World.serialize(), { name: nm.value || 'World', rules: Rules })) })));
      }
      s.append(h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { text: '📂 Upload world file', disabled: !canLoad, onclick: async () => { const d = await pickJSON(); if (!Save.validWorld(d)) return this.toast('Not a valid world file'); Game.loadWorldChoice(d); } }),
        !canLoad ? h('span', { class: 'muted', text: 'Only the host can load worlds' }) : null));
      const ws = Save.worlds(), names = Object.keys(ws).sort((a, b) => (ws[b].saved || 0) - (ws[a].saved || 0));
      const auto = store.get('autosave', null);
      const list = h('div', { class: 'list' });
      if (auto && Save.validWorld(auto)) list.append(h('div', { class: 'li' }, h('span', { html: `⏱ <b>Autosave</b> <span class="muted">${auto.ents.length} objects · ${new Date(auto.saved || 0).toLocaleString()}</span>` }), h('button', { class: 'small', text: 'Load', disabled: !canLoad, onclick: () => Game.loadWorldChoice(auto) })));
      if (!names.length) list.append(h('div', { class: 'muted', text: 'No saved worlds yet.' }));
      for (const n of names) {
        const w = ws[n];
        list.append(h('div', { class: 'li' }, h('span', { html: `${esc(n)} <span class="muted">${w.ents.length} objects · ${new Date(w.saved || 0).toLocaleDateString()}</span>` }),
          h('button', { class: 'small', text: 'Load', disabled: !canLoad, onclick: () => Game.loadWorldChoice(w) }),
          h('button', { class: 'small', text: '⬇', title: 'Download', onclick: () => downloadJSON('world-' + n, w) }),
          h('button', { class: 'small danger', text: '✕', title: 'Delete', onclick: () => { if (confirm('Delete world "' + n + '"?')) { Save.deleteWorld(n); this.buildSaveLoad(); } } })));
      }
      s.append(list);
    } else {
      s.append(h('div', { class: 'row' }, h('button', { class: 'primary', text: '💾 Save clipboard', onclick: () => { if (!Tools.clipboard) return this.toast('Copy a contraption with the Duplicator first'); Save.saveDupe(prompt('Dupe name', Tools.clipboard.name) || Tools.clipboard.name, Tools.clipboard); this.buildSaveLoad(); } }),
        h('button', { text: '📂 Upload dupe', onclick: async () => { const d = await pickJSON(); if (!Save.validDupe(d)) return this.toast('Not a valid dupe file'); Save.saveDupe(d.name || 'Uploaded dupe', d); this.buildSaveLoad(); } })));
      const ds = Save.dupes(), list = h('div', { class: 'list' });
      if (!Object.keys(ds).length) list.append(h('div', { class: 'muted', text: 'No saved dupes yet.' }));
      for (const n of Object.keys(ds)) list.append(h('div', { class: 'li' }, h('span', { html: `📋 ${esc(n)} <span class="muted">${ds[n].ents.length} objects</span>` }),
        inGame ? h('button', { class: 'small', text: 'Spawn', onclick: () => { Tools.clipboard = ds[n]; this.closeMenu(); Tools.pasteDupe(ds[n], Tools.cast(80)); } }) : null,
        h('button', { class: 'small', text: '⬇', onclick: () => downloadJSON('dupe-' + n, ds[n]) }),
        h('button', { class: 'small danger', text: '✕', onclick: () => { if (confirm('Delete dupe "' + n + '"?')) { Save.deleteDupe(n); this.buildSaveLoad(); } } })));
      s.append(list);
    }
    s.append(h('div', { class: 'btns' }, h('button', { text: 'Back', onclick: () => this.back() })));
  },
  buildHelp() {
    const s = $('#help'); s.innerHTML = '';
    s.append(h('h2', { text: 'Controls' }));
    const B = Settings.binds, k = c => `<kbd>${esc(keyLabel(c))}</kbd>`, P = i => glyph(i);
    const rows = [
      ['Move', `${k(B.forward)}${k(B.left)}${k(B.back)}${k(B.right)}`, '<span class="glyph pad">LS</span>'], ['Look', 'Mouse', '<span class="glyph pad">RS</span>'],
      ['Jump / fly up', k(B.jump), P(PAD.A)], ['Crouch / fly down', k(B.crouch), P(PAD.B)], ['Sprint', k(B.sprint), P(PAD.LS)],
      ['Fire / grab', '<kbd>LMB</kbd>', P(PAD.RT)], ['Alt-fire / freeze', '<kbd>RMB</kbd>', P(PAD.LT)], ['Rotate held / unfreeze / next tool', k(B.reload), P(PAD.RB)],
      ['Push / pull held object', '<kbd>Wheel</kbd>', P(PAD.UP) + P(PAD.DOWN)], ['Switch weapon', '<kbd>1</kbd>–<kbd>6</kbd>, <kbd>Wheel</kbd>', P(PAD.LEFT) + P(PAD.RIGHT)],
      ['Use / enter & exit seat', k(B.use), P(PAD.X)], ['Spawn menu', k(B.spawnMenu), P(PAD.Y)], ['Radial menu (hold)', k(B.radial), P(PAD.LB)],
      ['Scoreboard (hold)', k(B.scoreboard), P(PAD.VIEW)], ['Menu', '<kbd>Esc</kbd>', P(PAD.MENU)], ['Noclip', k(B.noclip), P(PAD.RS)],
      ['Edit mode', k(B.editMode), 'Radial → Actions'], ['Undo last spawn', k(B.undo), 'Radial → Actions'], ['Chat', `${k(B.chat)} / <kbd>Enter</kbd>`, 'Radial → quick chat'],
      ['Network stats', k(B.netstats), 'Settings'],
    ];
    const tb = h('table', { style: 'width:100%;border-collapse:collapse;margin-top:10px' });
    tb.innerHTML = `<tr><th style="text-align:left" class="muted">Action</th><th style="text-align:left" class="muted">Keyboard / mouse</th><th style="text-align:left" class="muted">Controller</th></tr>` + rows.map(r => `<tr><td style="padding:5px 0">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
    s.append(tb);
    s.append(h('p', { class: 'muted', style: 'font-size:12px;line-height:1.5', text: 'Edit mode: the cursor is free. hold right mouse to look, WASD to fly, click to select or place, drag the gizmo, 1/2/3 switch move/rotate/scale, G toggles grid snap, Ctrl+Z / Ctrl+Y undo/redo, Del deletes. With a controller: RT place/select, LT delete, RB rotate, X switches what the d-pad does.' }));
    s.append(h('div', { class: 'btns' }, h('button', { class: 'primary', text: 'Back', onclick: () => this.back() })));
  },
  buildHostLeft() {
    const s = $('#hostLeft .menu'); s.innerHTML = '';
    s.append(h('h2', { text: 'The host left' }));
    s.append(h('p', { class: 'muted', text: 'The host left and nobody could take over. Your copy of the world was auto-saved, so you can host it yourself.' }));
    s.append(h('div', { class: 'btns' },
      h('button', { class: 'primary', text: '👑 Rehost the saved world', onclick: () => { const w = store.get('autosave', null); Game.toLobby(true); if (w) { Game.pendingWorld = w; Game.createRoom(); } } }),
      h('button', { text: 'Back to main menu', onclick: () => Game.toLobby() })));
  },
  showHostLeft() { Game.autosave(); this.openMenu('hostleft'); },
  // ---- scoreboard ---------------------------------------------------------------------
  refreshScoreboard() {
    const sb = $('#scoreboard'); if (sb.classList.contains('hidden')) return;
    const rows = [...Players.map.values()].sort((a, b) => b.kills - a.kills || a.joinOrder - b.joinOrder).map(p => `<tr class="${p.isLocal ? 'me' : ''}"><td><i class="pdot" style="background:${esc(p.color)}"></i>${Net.hostId === p.id && Net.online ? '👑 ' : ''}${esc(p.name)} ${tierBadge(p.tier)}${p.muted ? ' 🔇' : ''}${p.canEdit && Rules.editPerm === 'list' ? ' ✏' : ''}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${World.countOwned(p.id)}</td><td>${p.isLocal && Net.isHost ? '—' : Math.round(p.ping || 0) + ' ms'}</td></tr>`).join('');
    sb.innerHTML = `<div class="row"><h2 class="grow">${Net.online ? 'Room ' + fmtCode(Net.code) : 'Solo sandbox'}</h2><span class="muted">${Rules.combat ? '⚔ Combat on' : '🕊 Build mode'} · edit: ${{ all: 'everyone', host: 'host only', list: 'selected' }[Rules.editPerm]}</span></div>
      <table><tr><th>Player</th><th>K</th><th>D</th><th>Props</th><th>Ping</th></tr>${rows}</table>
      <p class="muted" style="font-size:11px;margin:10px 0 0">Badges show each player's graphics tier. All tiers see the same gameplay information.</p>`;
  },
  showScoreboard(on) {
    const sb = $('#scoreboard'), was = !sb.classList.contains('hidden');
    if (on !== was) sb.classList.toggle('hidden', !on);
    if (on && (!was || now() - (this._sbT || 0) > 0.5)) { this._sbT = now(); this.refreshScoreboard(); }
  },
  // ---- editor bar ------------------------------------------------------------------------
  refreshEdit() {
    const bar = $('#editBar'), info = $('#editInfo');
    bar.classList.toggle('hidden', !Editor.active); info.classList.toggle('hidden', !Editor.active);
    if (!Editor.active) return;
    bar.innerHTML = '';
    for (const it of CATALOG.map) bar.append(h('button', { class: Editor.piece === it.key ? 'act' : '', title: it.name, text: it.icon + ' ' + it.name, onclick: () => Editor.arm(Editor.piece === it.key ? null : it.key) }));
    bar.append(h('div', { class: 'sep' }));
    for (const [m, l] of [['translate', 'Move'], ['rotate', 'Rotate'], ['scale', 'Scale']]) bar.append(h('button', { class: Editor.mode === m ? 'act' : '', text: l, onclick: () => Editor.setMode(m) }));
    bar.append(h('button', { class: Editor.snap ? 'act' : '', text: '# Snap', onclick: () => Editor.setSnap(!Editor.snap) }));
    bar.append(h('div', { class: 'sep' }));
    bar.append(h('button', { text: '↩', title: 'Undo', onclick: () => Editor.doUndo() }), h('button', { text: '↪', title: 'Redo', onclick: () => Editor.doRedo() }));
    bar.append(h('button', { text: '⧉', title: 'Duplicate', disabled: !Editor.sel, onclick: () => Editor.duplicate() }), h('button', { class: 'danger', text: '🗑', title: 'Delete', disabled: !Editor.sel, onclick: () => Editor.del() }));
    const selE = World.ents.get(Editor.sel);
    if (selE) {
      const mats = h('select', { onchange: () => { Net.toHost({ t: 'tool', m: 'paint', a: { e: selE.id }, o: { m: mats.value, c: selE.d.c } }); } });
      for (const k of MAT_KEYS) mats.append(h('option', { value: k, text: MATDEFS[k].name, selected: selE.d.m === k }));
      bar.append(mats);
    }
    bar.append(h('div', { class: 'sep' }), h('button', { text: '✓ Done', onclick: () => Editor.toggle(false) }));
    info.innerHTML = Editor.piece ? `Placing <b>${esc(ITEM_INDEX[Editor.piece].name)}</b> — ${Input.device === 'pad' ? glyph(PAD.RT) + 'place, ' + glyph(PAD.RB) + 'rotate, ' + glyph(PAD.LT) + 'cancel' : 'click to place, R rotates, Esc cancels'}`
      : selE ? `Selected <b>${esc((ITEM_INDEX[Object.keys(ITEM_INDEX).find(k => ITEM_INDEX[k].d && ITEM_INDEX[k].d.sh.t === selE.d.sh.t)] || { name: 'piece' }).name)}</b> ${selE.d.sh.s ? selE.d.sh.s.map(v => v.toFixed(2)).join(' × ') + ' m' : ''}` : 'Pick a piece above to place it, or click a map piece to select it.';
  },
};
