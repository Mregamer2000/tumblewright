// Builds the game's sound banks and embeds them into index.html (#tw-sounds).
//   node tools/sounds/synth.mjs               (once: renders our own synthesized sounds into sounds/synth/)
//   node tools/sounds/build_sounds.mjs        (needs ffmpeg on PATH; cuts / layers / normalizes / encodes every bank)
//   node tools/sounds/build_sounds.mjs --embed  (just re-embed sounds/clips/sounds.json, e.g. after rebuilding index.html)
// Sources (all CC0 / public domain, see sounds/CREDITS.md):
//   sounds/firearms  - "The Free Firearm Sound Library" (opengameart.org)
//   sounds/cc0/lib   - Kenney.nl audio packs + OpenGameArt CC0 packs (voices, gore, water, breaking, footsteps, engine loops)
//   sounds/synth     - rendered by tools/sounds/synth.mjs
// Each bank is a list of variants; the game picks one at random (never the same twice in a row).
// Output: { name: [base64 mp3, ...] }, mono 44.1 kHz VBR MP3, every variant peak-normalized to -1 dBFS.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(root, 'sounds', 'clips'), html = join(root, 'index.html'), TMP = join(tmpdir(), 'tw_snd');
const P = { fa: join(root, 'sounds', 'firearms', 'Prepared SFX Library'), lib: join(root, 'sounds', 'cc0', 'lib'), syn: join(root, 'sounds', 'synth') };
const path = s => { const i = s.indexOf(':'); return join(P[s.slice(0, i)], s.slice(i + 1)); };
const K = 'lib:kenney_impact-sounds/', KR = 'lib:kenney_rpg-audio/', KI = 'lib:kenney_interface-sounds/', KS = 'lib:kenney_sci-fi-sounds/', BF = 'lib:sfx_breaking_and_falling/bfh1_';
const C1 = 'lib:100-CC0-SFX_0/', CR = 'lib:80-CC0-creature-SFX_0/', W = 'lib:water-splash-slime-sfx/', M = 'lib:misc/';
const seq = (pre, from, to, pad = 3, ext = '.ogg') => Array.from({ length: to - from + 1 }, (_, i) => pre + String(from + i).padStart(pad, '0') + ext);
const cut = (f, ss, to) => ({ f, ss, t: to - ss });

// ---- bank definitions ----------------------------------------------------------------------------------------
// variant: 'src' | { f, ss?, t?, rate?, gain? } | { mix: [variant, ...], at?: [s], gain?: [dB] } | { shots: 'src', n, dur }
// bank options: dur (max length), hp / lp (Hz), fade (s), loop (keep whole, no trim), q (lame VBR quality 0-9, lower = better), sr (sample rate)
const DP = M + 'death_pain_grunts.wav', FH = M + 'female_hurt_grunts_groans_1.ogg';
const BANKS = {
  // ---------- guns: separate shots cut out of the recordings (close / mid / far) ----------
  pistol: { v: [{ shots: 'fa:Walther PPQ/X_39P.wav', n: 4, dur: 1.2 }], fade: 0.4 },
  pistol_far: { v: [{ shots: 'fa:Walther PPQ/X_31P.wav', n: 3, dur: 1.7 }], fade: 0.6 },
  m1911: { v: [{ shots: 'fa:1911/A_42P.wav', n: 3, dur: 1.2 }], fade: 0.4 },
  m1911_far: { v: [{ shots: 'fa:1911/A_34P.wav', n: 3, dur: 1.7 }], fade: 0.6 },
  rifle: { v: [{ shots: 'fa:AR-15/D_32P.wav', n: 3, dur: 1.0 }], fade: 0.4 },
  rifle_far: { v: [{ shots: 'fa:AR-15/D_24P.wav', n: 3, dur: 1.7 }], fade: 0.6 },
  ak: { v: [{ shots: 'fa:AK-47/C_27P.wav', n: 2, dur: 1.0 }, { shots: 'fa:AK-47/C_29P.wav', n: 3, dur: 1.0 }], fade: 0.4 },
  ak_far: { v: [{ shots: 'fa:AK-47/C_31P.wav', n: 2, dur: 1.7 }, { shots: 'fa:AK-47/C_28P.wav', n: 3, dur: 1.7 }], fade: 0.6 },
  shotgun: { v: [{ shots: 'fa:Nova/O_21P.wav', n: 3, dur: 1.6 }], fade: 0.5 },
  shotgun_far: { v: [{ shots: 'fa:Nova/O_17P.wav', n: 3, dur: 2.0 }], fade: 0.7 },
  sniper: { v: [{ shots: 'fa:Tikka/W_29P.wav', n: 3, dur: 2.4 }], fade: 0.9 },
  sniper_far: { v: [{ shots: 'fa:Tikka/W_24P.wav', n: 3, dur: 2.6 }], fade: 1.0 },
  gun_dist: { sr: 32000, q: 8, v: [{ shots: 'fa:AK-47/C_34P.wav', n: 4, dur: 2.2 }, { shots: 'fa:AK-47/C_36P.wav', n: 3, dur: 2.2 }], fade: 1.0, lp: 5000 },   // any gun, very far away
  rocket_fire: { v: [{ shots: 'fa:Carl Gustav M45/G_31P.wav', n: 3, dur: 2.2 }], fade: 1.0 },
  rocket_loop: { sr: 32000, q: 8, v: [cut(KS + 'thrusterFire_000.ogg', 0.5, 3.0)], loop: 1 },
  // explosions: the recoilless rifle blast + a sub-bass layer + a debris crunch
  boom: { v: [0, 1, 2].map(i => ({ mix: [{ shots: 'fa:Carl Gustav M45/G_33P.wav', n: 3, dur: 3.2, pick: i }, KS + `lowFrequency_explosion_00${i % 2}.ogg`, KS + `explosionCrunch_00${i}.ogg`], at: [0, 0, 0.05], gain: [0, -3, -7] })), fade: 1.2 },
  boom_far: { sr: 32000, q: 8, v: [{ mix: [cut(M + 'NenadSimic_-_Muffled_Distant_Explosion.wav', 0, 3.5), KS + 'lowFrequency_explosion_001.ogg'], gain: [0, -6] }, { shots: 'fa:Carl Gustav M45/G_20P.wav', n: 2, dur: 3.5 }, { shots: 'fa:Carl Gustav M45/G_24P.wav', n: 1, dur: 3.5 }], fade: 1.2, lp: 2500 },
  debris: { sr: 32000, q: 8, v: [BF + 'rock_falling_01.ogg', BF + 'rock_falling_03.ogg', BF + 'rock_falling_05.ogg', BF + 'rock_falling_07.ogg', BF + 'falling_02.ogg', BF + 'falling_04.ogg'] },
  // gun foley, casings, bullet flight
  casing: { v: seq('syn:casing_', 0, 5, 1, '.wav') }, hull: { v: seq('syn:hull_', 0, 3, 1, '.wav') },
  pump: { v: [{ mix: [KR + 'metalLatch.ogg', KR + 'metalClick.ogg'], at: [0, 0.16] }, { mix: [KR + 'metalClick.ogg', KR + 'metalLatch.ogg'], at: [0, 0.14], gain: [-2, 0] }] },
  bolt: { v: [{ mix: [KR + 'metalClick.ogg', KR + 'metalLatch.ogg', KR + 'metalClick.ogg'], at: [0, 0.18, 0.42], gain: [-3, 0, -2] }] },
  draw: { v: [KR + 'beltHandle1.ogg', KR + 'beltHandle2.ogg', { mix: [KR + 'clothBelt.ogg', KR + 'metalClick.ogg'], at: [0, 0.1], gain: [0, -8] }] },
  ricochet: { v: seq('syn:ricochet_', 0, 5, 1, '.wav') }, whiz: { v: seq('syn:whiz_', 0, 4, 1, '.wav') },
  swing: { v: seq('syn:swing_', 0, 3, 1, '.wav') }, throw: { v: seq('syn:throw_', 0, 2, 1, '.wav') },
  pin: { v: [{ mix: [C1 + 'key_open_01.ogg', KR + 'metalClick.ogg'], at: [0, 0.05] }, C1 + 'key_open_02.ogg'], dur: 0.6 },
  nade_bounce: { v: [...seq(K + 'impactTin_medium_', 0, 4), { f: K + 'impactMetal_light_001.ogg', rate: 1.25 }, { f: K + 'impactMetal_light_003.ogg', rate: 1.25 }] },
  propcannon: { v: seq('syn:pneu_', 0, 2, 1, '.wav') },
  // bullet impacts by surface
  bimp_concrete: { v: [...seq(K + 'impactMining_', 0, 4), BF + 'rock_hit_01.ogg'], dur: 0.5 },
  bimp_metal: { v: [...seq(KS + 'impactMetal_', 0, 4), ...seq(K + 'impactMetal_light_', 0, 2)], dur: 0.6 },
  bimp_wood: { v: [...seq(K + 'impactWood_light_', 0, 4), K + 'impactPlank_medium_000.ogg', K + 'impactPlank_medium_002.ogg'], dur: 0.5 },
  bimp_dirt: { v: seq(K + 'impactSoft_medium_', 0, 4).map(f => ({ f, rate: 1.35 })), dur: 0.4 },
  bimp_flesh: { v: [0, 1, 2, 3, 4].map(i => ({ mix: [K + `impactPunch_medium_00${i}.ogg`, i < 3 ? M + `squish_0${i + 2}.mp3` : `lib:independent_nu_ljudbank-wet_squish_slurp_impacts/impactsplat0${i + 1}.mp3.flac`], gain: [0, -6] })), dur: 0.6 },
  bimp_glass: { v: seq(K + 'impactGlass_light_', 0, 4), dur: 0.8 },
  // ---------- physics impacts (light / heavy) and breaking ----------
  hit_wood: { v: [...seq(K + 'impactWood_light_', 0, 4), ...seq(K + 'impactPlank_medium_', 0, 4)] },
  hit_wood_h: { v: [...seq(K + 'impactWood_heavy_', 0, 4), ...seq(K + 'impactWood_medium_', 0, 4), BF + 'wood_hit_01.ogg', BF + 'wood_hit_02.ogg'] },
  hit_metal: { v: [...seq(K + 'impactMetal_light_', 0, 4), ...seq(K + 'impactPlate_light_', 0, 4)] },
  hit_metal_h: { v: [...seq(K + 'impactMetal_heavy_', 0, 4), ...seq(K + 'impactMetal_medium_', 0, 4), ...seq(K + 'impactPlate_heavy_', 0, 2), BF + 'metal_hit_01.ogg', BF + 'metal_hit_03.ogg'] },
  hit_tin: { v: [...seq(K + 'impactTin_medium_', 0, 4), ...seq(K + 'impactPlate_medium_', 0, 4)] },
  hit_plastic: { v: [...seq(K + 'impactGeneric_light_', 0, 4), ...seq(K + 'impactPlate_light_', 0, 4).map(f => ({ f, rate: 1.2, gain: -3 }))] },
  hit_stone: { v: [...seq(BF + 'hit_', 1, 8, 2), BF + 'rock_hit_01.ogg', ...seq(K + 'impactMining_', 0, 2)], dur: 1.2 },
  hit_glass: { v: [...seq(K + 'impactGlass_light_', 0, 4), ...seq(K + 'impactGlass_medium_', 0, 4)] },
  hit_glass_h: { v: [...seq(K + 'impactGlass_heavy_', 0, 4), BF + 'glass_hit_01.ogg', BF + 'glass_hit_02.ogg'] },
  hit_soft: { v: seq(K + 'impactSoft_medium_', 0, 4) },
  hit_soft_h: { v: seq(K + 'impactSoft_heavy_', 0, 4) },
  hit_body: { v: [0, 1, 2, 3, 4].map(i => ({ mix: [K + `impactSoft_heavy_00${i}.ogg`, K + `impactPunch_heavy_00${i}.ogg`], gain: [0, -5] })) },
  punch: { v: [...seq(K + 'impactPunch_heavy_', 0, 4), ...seq(K + 'impactPunch_medium_', 0, 2)] },
  bell: { v: seq(K + 'impactBell_heavy_', 0, 4), dur: 1.6 },
  break_wood: { sr: 32000, q: 8, v: [...seq(BF + 'wood_breaking_', 1, 4, 2), BF + 'breaking_01.ogg'], dur: 2.2 },
  break_stone: { sr: 32000, q: 8, v: [...seq(BF + 'rock_breaking_', 1, 3, 2), BF + 'breaking_02.ogg', BF + 'breaking_03.ogg'], dur: 2.2 },
  break_glass: { v: [...seq(BF + 'glass_breaking_', 1, 6, 2)], dur: 2.2 },
  crash: { sr: 32000, q: 8, v: [...seq(BF + 'metal_falling_', 1, 5, 2)], dur: 2.0 },
  pop: { v: seq('syn:pop_', 0, 3, 1, '.wav') },
  boing: { sr: 32000, q: 8, v: seq(C1 + 'spring_', 1, 6, 2), dur: 1.0 },
  // ---------- footsteps / movement ----------
  step_grass: { v: seq(K + 'footstep_grass_', 0, 4), dur: 0.5 },
  step_concrete: { v: [...seq(K + 'footstep_concrete_', 0, 4), ...['L1', 'L2', 'L3', 'R1', 'R2', 'R3'].map(s => `lib:Fantozzi-footsteps/Fantozzi-Stone${s}.ogg`)], dur: 0.5 },
  step_wood: { v: seq(K + 'footstep_wood_', 0, 4), dur: 0.5 },
  step_snow: { v: [...seq(K + 'footstep_snow_', 0, 4), ...[4, 10, 12, 18].map(n => `lib:corsica_s-walking_in_snow/Corsica_S-Walking_on_snow_covered_gravel_${String(n).padStart(2, '0')}.flac`)], dur: 0.6 },
  step_sand: { v: ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'].map(s => `lib:Fantozzi-footsteps/Fantozzi-Sand${s}.ogg`), dur: 0.5 },
  step_carpet: { v: seq(K + 'footstep_carpet_', 0, 4), dur: 0.5 },
  step_metal: { v: seq(K + 'impactPlate_light_', 0, 4).map(f => ({ f, rate: 0.8 })), dur: 0.4 },
  step_water: { sr: 32000, q: 8, v: [3, 5, 8, 11, 13].map(n => ({ f: W + `splash_${String(n).padStart(2, '0')}.ogg`, rate: 1.3 })), dur: 0.6 },
  cloth: { sr: 32000, q: 8, v: [KR + 'cloth1.ogg', KR + 'cloth2.ogg', KR + 'cloth3.ogg', KR + 'cloth4.ogg', KR + 'clothBelt.ogg', KR + 'clothBelt2.ogg'] },
  land: { v: [0, 1, 2, 3].map(i => ({ mix: [K + `impactSoft_heavy_00${i}.ogg`, KR + `cloth${i + 1}.ogg`], gain: [0, -4] })) },
  // ---------- water ----------
  splash_s: { sr: 32000, q: 8, v: [1, 2, 4, 6, 9].map(n => W + `splash_${String(n).padStart(2, '0')}.ogg`), dur: 1.2 },
  splash_l: { sr: 32000, q: 8, v: [7, 10, 12, 14, 15].map(n => W + `splash_${String(n).padStart(2, '0')}.ogg`).concat([C1 + 'splash_01.ogg', C1 + 'splash_02.ogg']), dur: 1.8 },
  water_loop: { sr: 32000, q: 8, v: [W + 'loop_water_02.ogg'], loop: 1 },
  wave: { sr: 32000, q: 8, v: [1, 2, 3, 4].map(n => M + `wave_0${n}_cc0-11505__transitking__wavesound.flac`), dur: 3.4 },
  // ---------- voices ----------
  pain_m: { sr: 32000, q: 8, v: [[0.46, 1.95], [6.9, 7.42], [8.32, 9.2], [14.42, 16.16], [17.4, 18.8], [27.55, 28.52], [29.82, 30.37], [31.46, 32.56], [33.46, 34.88], [38.8, 39.52], [40.36, 41.1], [44.9, 46.04]].map(([a, b]) => cut(DP, a, b + 0.08)), fade: 0.08 },
  death_m: { sr: 32000, q: 8, v: [[3.92, 6.14], [9.96, 12.5], [20.3, 22.35], [23.84, 25.78], [35.92, 37.4], [42.17, 43.6], [47.33, 49.12]].map(([a, b]) => cut(DP, a, b + 0.1)), fade: 0.15 },
  pain_f: { sr: 32000, q: 8, v: [[0.31, 1.18], [2.07, 2.75], [3.69, 4.16], [7.3, 8.14], [11.66, 12.6]].map(([a, b]) => cut(FH, a, b + 0.08)), fade: 0.08 },
  death_f: { sr: 32000, q: 8, v: [[4.89, 6.14], [9.29, 10.34]].map(([a, b]) => cut(FH, a, b + 0.1)), fade: 0.15 },
  scream: { sr: 32000, q: 8, v: seq('lib:slightscreams/slightscream-', 1, 15, 2, '.flac') },
  z_groan: { sr: 32000, q: 8, v: [...seq(CR + 'monster_', 1, 7, 2), CR + 'troll_01.ogg', CR + 'troll_02.ogg', CR + 'grunt_01.ogg', CR + 'grunt_03.ogg', CR + 'breath.ogg'].map(f => ({ f, rate: 0.85 })), dur: 2.4, fade: 0.3 },
  z_attack: { sr: 32000, q: 8, v: [...seq(CR + 'roar_', 1, 3, 2), CR + 'troll_03.ogg'].map(f => ({ f, rate: 0.9 })), dur: 2.0, fade: 0.3 },
  z_pain: { sr: 32000, q: 8, v: seq(CR + 'hurt_', 1, 5, 2).map(f => ({ f, rate: 0.8 })), dur: 1.4 },
  jumpscare: { sr: 32000, q: 8, v: [cut(M + 'scream_horror1_0.mp3', 0.26, 3.3), { mix: [CR + 'scream_01.ogg', cut(M + 'scream_horror1_0.mp3', 4.0, 6.5)], gain: [-2, 0] }], fade: 0.4 },
  // ---------- gore ----------
  gore_splat: { sr: 32000, q: 8, v: [...seq('lib:independent_nu_ljudbank-wet_squish_slurp_impacts/impactsplat', 1, 8, 2, '.mp3.flac'), M + 'squish_04.mp3', M + 'squish_06.mp3', M + 'squishsplat_impact.mp3'], dur: 1.2, fade: 0.2 },
  gore_squish: { sr: 32000, q: 8, v: [M + 'squish_01_0.mp3', M + 'squish_02.mp3', M + 'squish_03.mp3', M + 'squish_05.mp3', M + 'squishpop.mp3', ...seq(W + 'slime_', 1, 6, 2)], dur: 0.9 },
  gore_bone: { v: [0, 1, 2, 3, 4, 5].map(i => ({ mix: ['syn:bone_' + i + '.wav', i % 2 ? M + 'squishpop.mp3' : K + `impactPunch_medium_00${i >> 1}.ogg`], gain: [0, -8] })) },
  gore_gib: { v: [0, 1, 2, 3].map(i => ({ mix: [`lib:independent_nu_ljudbank-wet_squish_slurp_impacts/impactsplat0${i + 5}.mp3.flac`, W + `slime_${String(i * 3 + 7).padStart(2, '0')}.ogg`, 'syn:bone_' + i + '.wav'], at: [0, 0.03, 0], gain: [0, -3, -4] })), dur: 1.6, fade: 0.3 },
  // ---------- tools ----------
  pg_grab: { v: seq(KS + 'forceField_', 0, 4), dur: 0.7, fade: 0.25 },
  pg_loop: { v: ['syn:pghum_loop.wav'], loop: 1 },
  pg_drop: { v: seq(KI + 'minimize_', 1, 4, 3), dur: 0.5 },
  freeze: { v: [0, 1, 2].map(i => ({ mix: [KI + `glass_00${i + 1}.ogg`, KS + `forceField_00${i}.ogg`], gain: [0, -10] })), dur: 0.7, fade: 0.3 },
  unfreeze: { v: seq(KI + 'maximize_', 1, 4, 3), dur: 0.6 },
  tool_zap: { v: [0, 1, 2, 3].map(i => ({ mix: [KS + `laserSmall_00${i}.ogg`, KI + `click_00${i + 1}.ogg`], gain: [0, -6] })), dur: 0.6 },
  delete_zap: { v: [0, 1, 2].map(i => ({ mix: [KS + `laserLarge_00${i}.ogg`, KI + `glitch_00${i + 1}.ogg`], at: [0, 0.05], gain: [0, -4] })), dur: 0.8 },
  motor_loop: { v: ['syn:motor_loop.wav'], loop: 1 },
  thruster_loop: { sr: 32000, q: 8, v: [cut(KS + 'thrusterFire_002.ogg', 0.5, 3.0)], loop: 1 },
  // ---------- vehicles ----------
  // one car recorded at rising revs (firing frequency 43 / 65 / 77 Hz); the game crossfades between them
  eng0: { v: [M + 'loop_0.wav'], loop: 1 }, eng2: { v: [M + 'loop_2_0.wav'], loop: 1 }, eng5: { v: [M + 'loop_5_0.wav'], loop: 1 },
  skid_loop: { v: ['syn:skid_loop.wav'], loop: 1 },
  // ---------- doors, seats ----------
  door_open: { sr: 32000, q: 8, v: [KR + 'doorOpen_1.ogg', KR + 'doorOpen_2.ogg', C1 + 'door_open.ogg', { mix: [KR + 'doorOpen_1.ogg', KR + 'creak2.ogg'], at: [0, 0.1], gain: [0, -4] }], dur: 1.6 },
  door_close: { sr: 32000, q: 8, v: [...seq(KR + 'doorClose_', 1, 4, 1), ...seq(C1 + 'door_close_', 1, 4, 2)], dur: 1.4 },
  creak: { v: [KR + 'creak1.ogg', KR + 'creak2.ogg', KR + 'creak3.ogg'] },
  // ---------- ambience ----------
  amb_wind: { sr: 32000, q: 8, v: ['syn:wind_loop.wav'], loop: 1, q: 7 }, amb_windstrong: { sr: 32000, q: 8, v: ['syn:windstrong_loop.wav'], loop: 1, q: 7 },
  amb_city: { sr: 32000, q: 8, v: ['syn:city_loop.wav'], loop: 1, q: 7 }, bird: { v: seq('syn:bird_', 0, 7, 1, '.wav') },
  // ---------- UI ----------
  ui: { v: seq(KI + 'click_', 1, 5, 3) }, tick: { v: [KI + 'tick_001.ogg', KI + 'tick_002.ogg', KI + 'tick_004.ogg'] },
  switch: { v: seq(KI + 'switch_', 1, 7, 3) }, open: { v: seq(KI + 'open_', 1, 4, 3) }, close: { v: seq(KI + 'close_', 1, 4, 3) },
  confirm: { v: seq(KI + 'confirmation_', 1, 4, 3) }, error: { v: seq(KI + 'error_', 1, 4, 3) }, undo: { v: seq(KI + 'back_', 1, 4, 3) },
  place: { v: seq(KI + 'drop_', 1, 4, 3) }, chat: { v: [KI + 'pluck_001.ogg', KI + 'pluck_002.ogg'] }, notify: { v: [KI + 'bong_001.ogg'] },
  hitmark: { v: [KI + 'tick_002.ogg', KI + 'tick_004.ogg'].map(f => ({ f, rate: 1.3 })) }, kill: { v: [KI + 'confirmation_002.ogg'] },
};

// ---- helpers ---------------------------------------------------------------------------------------------------
const ff = args => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); return r; };
const probe = (f, af) => spawnSync('ffmpeg', ['-v', 'info', '-i', f, '-af', af, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
let tn = 0; const tmp = ext => join(TMP, 't' + (tn++) + ext);
const onsetCache = {};
function onsets(f) {   // shot onsets = ends of silence (the recordings are shots separated by quiet)
  if (onsetCache[f]) return onsetCache[f];
  const txt = probe(f, 'aformat=channel_layouts=mono,silencedetect=noise=-38dB:d=0.35');
  const ends = [...txt.matchAll(/silence_end: ([\d.]+)/g)].map(m => +m[1]), starts = [...txt.matchAll(/silence_start: ([\d.]+)/g)].map(m => +m[1]);
  const o = starts[0] > 0.05 ? [0] : []; o.push(...ends.filter(e => e < probeDur(f) - 0.3));
  return (onsetCache[f] = o);
}
function probeDur(f) { const m = probe(f, 'anull').match(/Duration: (\d+):(\d+):([\d.]+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; }
// render one variant to a mono 44.1 kHz wav; returns the wav path
function render(v) {
  if (typeof v === 'string') v = { f: v };
  if (v.mix) {
    const parts = v.mix.map(render), o = tmp('.wav'), at = v.at || [], g = v.gain || [];
    const inputs = parts.flatMap(p => ['-i', p]);
    const fl = parts.map((_, i) => `[${i}]adelay=${Math.round((at[i] || 0) * 1000)}:all=1,volume=${g[i] || 0}dB[a${i}]`).join(';') + ';' + parts.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${parts.length}:normalize=0:duration=longest`;
    ff([...inputs, '-filter_complex', fl, '-ac', '1', '-ar', '44100', o]); return o;
  }
  if (v.shots) {
    const f = path(v.shots), on = onsets(f), s = on[Math.min(on.length - 1, v.pick || 0)];
    return render({ f: v.shots, ss: Math.max(0, s - 0.012), t: v.dur });
  }
  const o = tmp('.wav'), af = ['aformat=channel_layouts=mono'];
  if (v.rate) af.push(`asetrate=${Math.round(44100 * v.rate)},aresample=44100`);
  if (v.gain) af.push(`volume=${v.gain}dB`);
  ff([...(v.ss != null ? ['-ss', String(v.ss)] : []), ...(v.t ? ['-t', String(v.t)] : []), '-i', path(v.f), '-af', af.join(','), '-ac', '1', '-ar', '44100', o]);
  return o;
}
function expand(v) { return v && v.shots && v.n ? Array.from({ length: v.n }, (_, i) => Object.assign({}, v, { pick: i, n: 0 })) : [v]; }
function encode(name, i, w, B) {
  const af = [];
  if (!B.loop) {   // trim silence at both ends
    af.push('silenceremove=start_periods=1:start_threshold=-55dB', 'areverse', 'silenceremove=start_periods=1:start_threshold=-60dB', 'areverse');
    if (B.dur) af.push(`atrim=0:${B.dur}`);
  }
  af.push(`highpass=f=${B.hp || 28}`); if (B.lp) af.push(`lowpass=f=${B.lp}`);
  const pre = tmp('.wav'); ff(['-i', w, '-af', af.join(','), pre]);
  const mx = +(probe(pre, 'volumedetect').match(/max_volume: ([-\d.]+) dB/) || [0, 0])[1];
  const post = [`volume=${(-1 - mx).toFixed(2)}dB`];
  if (!B.loop) { const d = probeDur(pre), fd = Math.min(B.fade || 0.06, d * 0.4); post.push(`afade=t=out:st=${Math.max(0, d - fd).toFixed(3)}:d=${fd.toFixed(3)}`); }
  const out = join(OUT, `${name}_${i}.mp3`);
  ff(['-i', pre, '-af', post.join(','), '-ac', '1', '-ar', String(B.sr || 44100), '-c:a', 'libmp3lame', '-q:a', String(B.q ?? 7), out]);
  return readFileSync(out);
}

// ---- build -------------------------------------------------------------------------------------------------------
const embedOnly = process.argv.includes('--embed'), only = process.argv.slice(2).filter(a => !a.startsWith('--'));
mkdirSync(OUT, { recursive: true });
let pack = {};
if (embedOnly || only.length) { try { pack = JSON.parse(readFileSync(join(OUT, 'sounds.json'), 'utf8')); } catch (e) { pack = {}; } }
if (!embedOnly) {
  rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
  let total = 0;
  for (const [name, B] of Object.entries(BANKS)) {
    if (only.length && !only.includes(name)) continue;
    const vars = B.v.flatMap(expand), out = [];
    for (const v of vars) { try { const b = encode(name, out.length, render(v), B); out.push(b.toString('base64')); total += b.length; } catch (e) { console.error(`${name}: ${String(e.message).split('\n')[0]}`); } }
    pack[name] = out; console.log(`${name.padEnd(15)} ${out.length} var  ${(out.reduce((a, s) => a + s.length * 0.75, 0) / 1024).toFixed(0)} KB`);
  }
  console.log(`total ${(total / 1024).toFixed(0)} KB mp3`);
}
const json = JSON.stringify(pack);
const src = readFileSync(html, 'utf8'), re = /(<script id="tw-sounds" type="application\/json">)[\s\S]*?(<\/script>)/;
if (!re.test(src)) { console.error('tw-sounds script tag not found in index.html'); process.exit(1); }
writeFileSync(html, src.replace(re, (_, a, b) => a + json + b));
writeFileSync(join(OUT, 'sounds.json'), json);
console.log(`embedded ${Object.keys(pack).length} sounds (${(json.length / 1024).toFixed(0)} KB) into index.html #tw-sounds`);
