<!-- game module: started by the loader at the end of the file -->
<script id="tw-main" type="text/tw-module">
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { CSM } from 'three/addons/csm/CSM.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

/* ============================================================================
   0. CONFIG & UTIL
   ========================================================================== */
const GAME = { name: 'Tumblewright', version: (document.querySelector('meta[name="tw-version"]') || {}).content || '1.0.0', appId: 'tumblewright-sandbox-v1' };
// the public site: invite links point here (a copy opened from disk has no shareable address) and it serves relay credentials
GAME.site = ((document.querySelector('meta[name="tw-update-url"]') || {}).content || 'https://tumblewright.vercel.app/').replace(/\/?$/, '/');
// matchmaking on Supabase Realtime (public project URL + publishable key; null = public Nostr relays only)
GAME.supa = { url: 'https://imonuvmxzxdtglxyvdmj.supabase.co', key: 'sb_publishable_LpsLJ5i8_X43A8SjcVhgkw_3gZXVEob' };   // Supabase project 'tumblewright'
const newerVer = (x, y) => { const a = String(x).split('.').map(Number), b = String(y).split('.').map(Number); for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); return false; };
const CFG = {
  dt: 1 / 60, snapRate: 20, inputRate: 30, interpDelay: 0.11, keyframeEvery: 2,
  worldHalf: 320, killY: -60, maxBodies: 900, propLimit: 250, maxPlayers: 10,
  walk: 5.2, sprint: 8.8, crouchMul: 0.5, jump: 5.4, gravity: 9.81 * 1.5,
  eye: 1.62, capR: 0.34, capHalf: 0.56, respawn: 3.0,
};
const V3 = THREE.Vector3, QT = THREE.Quaternion;
const _v1 = new V3(), _v2 = new V3(), _v3 = new V3(), _v4 = new V3(), _q1 = new QT(), _q2 = new QT(), _q3 = new QT();
const UP = new V3(0, 1, 0);
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;
const now = () => performance.now() / 1000;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r4 = x => Math.round(x * 10000) / 10000;
const a3 = v => [r4(v.x), r4(v.y), r4(v.z)];
const a4 = q => [r4(q.x), r4(q.y), r4(q.z), r4(q.w)];
const isChromebook = /CrOS/.test(navigator.userAgent);
const store = {
  get(k, d) { try { const v = localStorage.getItem('tw_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('tw_' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};
// icon: Material Symbols glyph with an emoji fallback (shown until / unless the icon font loads)
const ic = (name, em) => `<span class="ic"><span class="ms">${name}</span><span class="em">${em || ''}</span></span>`;
function randCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += A[(Math.random() * A.length) | 0]; return s; }
function fmtCode(c) { return c.length === 6 ? c.slice(0, 3) + '-' + c.slice(3) : c; }
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'style') e.style.cssText = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}
function downloadJSON(name, obj) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: name.replace(/[^\w\-. ]+/g, '_') + '.json' });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function pickJSON() {
  return new Promise(res => {
    const inp = $('#fileIn'); inp.value = '';
    inp.onchange = () => { const f = inp.files[0]; if (!f) return res(null); const r = new FileReader(); r.onload = () => { try { res(JSON.parse(r.result)); } catch (e) { res(null); } }; r.readAsText(f); };
    inp.click();
  });
}

const PLAYER_COLORS = ['#ff9f43', '#ff5a5f', '#f368e0', '#a55eea', '#4b7bec', '#45aaf2', '#26de81', '#20bf6b', '#fed330', '#d1d8e0', '#778ca3', '#2bcbba'];
const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'ControlLeft', sprint: 'ShiftLeft',
  use: 'KeyE', reload: 'KeyR', spawnMenu: 'KeyQ', radial: 'KeyC', chat: 'KeyT', scoreboard: 'Tab', editMode: 'KeyB',
  undo: 'KeyZ', noclip: 'KeyV', snap: 'KeyG', netstats: 'F3', help: 'F1', hints: 'KeyH', inventory: 'KeyI',
};
const BIND_LABELS = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right', jump: 'Jump / fly up', crouch: 'Crouch / fly down',
  sprint: 'Sprint', use: 'Use / enter seat', reload: 'Rotate (physgun) / unfreeze', spawnMenu: 'Spawn menu', radial: 'Radial menu',
  chat: 'Chat', scoreboard: 'Scoreboard', editMode: 'Toggle edit mode', undo: 'Undo last spawn', noclip: 'Noclip (fly)',
  snap: 'Editor grid snap', netstats: 'Network stats', help: 'Controls help', hints: 'Show / hide control hints', inventory: 'Inventory / hotbar',
};
const AUDIO_DEFAULTS = {
  volWeapons: 1, volImpacts: 1, volSteps: 1, volVoices: 1, volGore: 1, volVehicles: 1, volTools: 1, volAmb: 1, volUI: 1,
  audio3d: 'auto', reverb: 1, airAbsorb: true, occlusion: true, sosDelay: true, monoAudio: false, nightMode: false, muteBg: true, hitSound: true, jumpscareSound: true, maxVoices: 48,
};
const Settings = Object.assign({
  tier: null, shadows: true, ao: true, bloom: true, reflections: false, outlines: true, drs: true,
  targetFps: isChromebook ? 30 : 60, fov: 80, sens: 1.0, invertY: false, deadzone: 0.15, padSens: 1.0, aimAssist: 2, flySpeed: 1, volume: 0.6, gore: 'full', bloodColor: 'red', spawnPreview: true, dmgNums: true, publicRoom: true,
  showNet: false, showFps: false, showHints: true, name: '', color: PLAYER_COLORS[(Math.random() * PLAYER_COLORS.length) | 0],
  turnUrl: '', turnUser: '', turnPass: '', binds: {},
}, AUDIO_DEFAULTS, store.get('settings', {}));
Settings.binds = Object.assign({}, DEFAULT_BINDS, Settings.binds || {});
const saveSettings = () => store.set('settings', Settings);

/* ============================================================================
   1. INPUT (keyboard/mouse, pointer lock, Gamepad API, glyphs)
   ========================================================================== */
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const PAD_BIND = {
  jump: PAD.A, crouch: PAD.B, use: PAD.X, spawnMenu: PAD.Y, radial: PAD.LB, reload: PAD.RB, fire: PAD.RT, alt: PAD.LT,
  scoreboard: PAD.VIEW, pause: PAD.MENU, sprint: PAD.LS, noclip: PAD.RS, pushOut: PAD.UP, pullIn: PAD.DOWN, prevSlot: PAD.LEFT, nextSlot: PAD.RIGHT,
};
const PAD_NAMES = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D↑', 'D↓', 'D←', 'D→'],
  ps: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', 'D↑', 'D↓', 'D←', 'D→'],
};
function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  if (code.startsWith('Pad')) return PAD_NAMES[Input.padType][+code.slice(3)] || code;
  const m = { Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'RShift', ControlLeft: 'Ctrl', ControlRight: 'RCtrl', AltLeft: 'Alt', Tab: 'Tab', Escape: 'Esc', Enter: 'Enter', Backspace: 'Bksp', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Wheel: 'Wheel', Delete: 'Del' };
  return m[code] || code;
}
const Input = {
  keys: new Set(), kHit: new Set(), kUp: new Set(), mouse: [false, false, false], mHit: [false, false, false], mUp: [false, false, false],
  dx: 0, dy: 0, wheel: 0, mx: 0, my: 0, device: 'kbm', padType: 'xbox', padIndex: -1,
  pb: new Array(17).fill(false), pbPrev: new Array(17).fill(false), axes: [0, 0, 0, 0], trig: [0, 0],
  locked: false, capture: null, listeners: [],
  init(canvas) {
    const typing = e => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'); };
    addEventListener('keydown', e => {
      if (this.capture) { e.preventDefault(); const cb = this.capture; this.capture = null; cb(e.code); return; }
      if (typing(e)) { if (e.code === 'Escape') { e.target.blur(); } this.fireKey(e.code, e, true); return; }
      if (['Tab', 'F1', 'F3', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code) || (e.ctrlKey && ['KeyZ', 'KeyY', 'KeyD', 'KeyS'].includes(e.code))) e.preventDefault();
      if (!this.keys.has(e.code)) this.kHit.add(e.code);
      this.keys.add(e.code); this.setDevice('kbm');
      this.fireKey(e.code, e, false);
    });
    addEventListener('keyup', e => { this.keys.delete(e.code); this.kUp.add(e.code); });
    addEventListener('blur', () => { this.keys.clear(); this.mouse = [false, false, false]; });
    canvas.addEventListener('mousedown', e => {
      if (this.capture && e.button !== 0) { const cb = this.capture; this.capture = null; cb('Mouse' + e.button); return; }
      this.mouse[e.button] = true; this.mHit[e.button] = true; this.setDevice('kbm');
    });
    addEventListener('mouseup', e => { if (this.mouse[e.button]) this.mUp[e.button] = true; this.mouse[e.button] = false; });
    addEventListener('mousemove', e => {
      this.mx = e.clientX; this.my = e.clientY;
      if (this.locked || this.mouse[2]) { this.dx += e.movementX || 0; this.dy += e.movementY || 0; }
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.setDevice('kbm');
    });
    canvas.addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; if (!this.locked) this.lockLostAt = performance.now() / 1000; if (this.onLockChange) this.onLockChange(this.locked); });
    document.addEventListener('pointerlockerror', () => { this.locked = false; });
    addEventListener('gamepadconnected', e => { this.padIndex = e.gamepad.index; this.detectPadType(e.gamepad); UI.toast('Controller connected: ' + (this.padType === 'ps' ? 'PlayStation' : 'Xbox') + ' layout'); });
    addEventListener('gamepaddisconnected', e => { if (e.gamepad.index === this.padIndex) { this.padIndex = -1; this.setDevice('kbm'); UI.toast('Controller disconnected'); } });
  },
  fireKey(code, e, typing) { for (const l of this.listeners) l(code, e, typing); },
  detectPadType(g) { const id = (g.id || '').toLowerCase(); this.padType = /054c|sony|dualshock|dualsense|playstation|wireless controller/.test(id) ? 'ps' : 'xbox'; },
  setDevice(d) { if (this.device !== d) { this.device = d; if (this.onDevice) this.onDevice(d); } },
  poll() {
    let g = null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.padIndex >= 0) g = pads[this.padIndex];
    if (!g) for (const p of pads) if (p && p.connected) { g = p; this.padIndex = p.index; this.detectPadType(p); break; }
    this.pbPrev = this.pb.slice();
    if (!g) { this.pb.fill(false); this.axes = [0, 0, 0, 0]; this.trig = [0, 0]; return; }
    const dz = Settings.deadzone;
    const ax = i => { const v = g.axes[i] || 0; return Math.abs(v) < dz ? 0 : Math.sign(v) * (Math.abs(v) - dz) / (1 - dz); };
    this.axes = [ax(0), ax(1), ax(2), ax(3)];
    let any = Math.abs(this.axes[0]) + Math.abs(this.axes[1]) + Math.abs(this.axes[2]) + Math.abs(this.axes[3]) > 0.3;
    for (let i = 0; i < 17; i++) { const b = g.buttons[i]; const v = !!b && (b.pressed || b.value > 0.5); this.pb[i] = v; if (v) any = true; }
    this.trig = [g.buttons[6] ? g.buttons[6].value : 0, g.buttons[7] ? g.buttons[7].value : 0];
    if (any) this.setDevice('pad');
  },
  padDown(i) { return this.pb[i]; }, padHit(i) { return this.pb[i] && !this.pbPrev[i]; }, padUp(i) { return !this.pb[i] && this.pbPrev[i]; },
  kb(a) { if (a === 'fire') return 'Mouse0'; if (a === 'alt') return 'Mouse2'; if (a === 'pause') return 'Escape'; return Settings.binds[a]; },
  kbDown(code) { if (!code) return false; if (code.startsWith('Mouse')) return this.mouse[+code.slice(5)]; return this.keys.has(code); },
  kbHitC(code) { if (!code) return false; if (code.startsWith('Mouse')) return this.mHit[+code.slice(5)]; return this.kHit.has(code); },
  kbUpC(code) { if (!code) return false; if (code.startsWith('Mouse')) return this.mUp[+code.slice(5)]; return this.kUp.has(code); },
  down(a) { return this.kbDown(this.kb(a)) || (PAD_BIND[a] != null && this.pb[PAD_BIND[a]]); },
  hit(a) { return this.kbHitC(this.kb(a)) || (PAD_BIND[a] != null && this.padHit(PAD_BIND[a])); },
  up(a) { return this.kbUpC(this.kb(a)) || (PAD_BIND[a] != null && this.padUp(PAD_BIND[a])); },
  move() {
    let x = 0, y = 0; const B = Settings.binds;
    if (this.keys.has(B.forward)) y += 1; if (this.keys.has(B.back)) y -= 1;
    if (this.keys.has(B.right)) x += 1; if (this.keys.has(B.left)) x -= 1;
    x += this.axes[0]; y -= this.axes[1];
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    return { x, y };
  },
  heldCodes() { const s = [...this.keys]; for (let i = 0; i < 16; i++) if (this.pb[i]) s.push('Pad' + i); return s; },
  endFrame() { this.kHit.clear(); this.kUp.clear(); this.mHit = [false, false, false]; this.mUp = [false, false, false]; this.dx = 0; this.dy = 0; this.wheel = 0; },
};
function glyph(action, labelOverride) {
  if (Input.device === 'pad') {
    const b = typeof action === 'number' ? action : PAD_BIND[action];
    if (b == null) return '';
    const cls = ['pa', 'pb', 'px', 'py'][b] || '';
    return `<span class="glyph pad ${cls} ${Input.padType === 'ps' ? 'ps' : ''}">${PAD_NAMES[Input.padType][b]}</span>`;
  }
  const code = typeof action === 'string' && (action.startsWith('Key') || action.startsWith('Mouse') || action === 'Wheel' || action.startsWith('Digit')) ? action : Input.kb(action);
  return `<kbd>${esc(labelOverride || keyLabel(code))}</kbd>`;
}
