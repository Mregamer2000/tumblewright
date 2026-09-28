// Synthesizes the game's own sound effects (things the CC0 recordings don't cover) into sounds/synth/*.wav.
//   node tools/sounds/synth.mjs
// Physical-ish models: modal resonators for casings, noise through swept resonant filters for whooshes / wind / tyres,
// exactly periodic harmonic stacks for seamless machine loops, FM sweeps for birdsong.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..'), OUT = join(root, 'sounds', 'synth');
mkdirSync(OUT, { recursive: true });
const SR = 44100, TAU = Math.PI * 2;
let seed = 1;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const rr = (a, b) => a + (b - a) * rnd();
const buf = s => new Float32Array(Math.round(s * SR));

function wav(name, x, peak = 0.9) {
  let m = 0; for (const v of x) m = Math.max(m, Math.abs(v));
  const g = m > 0 ? peak / m : 1, b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * g * 32767))), 44 + i * 2);
  writeFileSync(join(OUT, name + '.wav'), b);
}
// RBJ biquad (per-sample coefficients so the frequency can sweep)
function biquad(type) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x, f, q) => {
    const w = TAU * Math.min(f, SR * 0.45) / SR, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
    let b0, b1, b2; const a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
    if (type === 'bp') { b0 = a; b1 = 0; b2 = -a; } else if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; } else { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; return y;
  };
}
const white = () => rnd() * 2 - 1;
function brown() { let b = 0; return () => (b = (b + white() * 0.02) * 0.998) * 3.5; }
// excite a set of decaying modes at time t0: [freq, amp, decay seconds]
function modes(x, t0, ms, gain) {
  const i0 = Math.round(t0 * SR);
  for (const [f, a, d] of ms) { const ph = rnd() * TAU, n = Math.min(x.length - i0, Math.round(d * 7 * SR)); for (let i = 0; i < n; i++) x[i0 + i] += gain * a * Math.sin(TAU * f * i / SR + ph) * Math.exp(-i / (d * SR)); }
}
function click(x, t0, len, gain, hp = 1500) {
  const i0 = Math.round(t0 * SR), n = Math.round(len * SR), f = biquad('hp');
  for (let i = 0; i < n && i0 + i < x.length; i++) x[i0 + i] += gain * f(white(), hp, 0.7) * Math.exp(-i / (n * 0.3));
}
// make a buffer loop seamlessly: crossfade its last `xf` seconds into its start
function looped(x, xf) {
  const n = Math.round(xf * SR), y = x.slice(0, x.length - n);
  for (let i = 0; i < n; i++) { const k = i / n; y[i] = x[i] * Math.sqrt(k) + x[x.length - n + i] * Math.sqrt(1 - k); }
  return y;
}
const fadeOut = (x, s) => { const n = Math.round(s * SR); for (let i = 0; i < n; i++) x[x.length - 1 - i] *= i / n; return x; };

// ---- brass casings bouncing on a hard floor (inharmonic tube modes, 3-5 bounces) ----
for (let v = 0; v < 6; v++) {
  seed = 100 + v; const x = buf(0.9), f0 = rr(2700, 4300);
  let t = 0.005, g = 1, dt = rr(0.11, 0.17);
  for (let b = 0, nb = 3 + (rnd() * 3 | 0); b < nb; b++) {
    modes(x, t, [[f0, 1, 0.09 * g + 0.02], [f0 * 2.74, 0.6, 0.06], [f0 * 5.1, 0.35, 0.035], [f0 * 1.52, 0.25, 0.05], [f0 * 8.2, 0.15, 0.02]], g);
    click(x, t, 0.002, 0.5 * g, 3000);
    t += dt; dt *= rr(0.45, 0.65); g *= rr(0.45, 0.6);
  }
  for (let i = 0; i < 6; i++) { modes(x, t + i * rr(0.012, 0.02), [[f0 * rr(0.98, 1.02), 1, 0.02]], g * 0.3); }   // settling rattle
  wav('casing_' + v, fadeOut(x, 0.1));
}
// ---- shotgun hulls: plastic tube with a brass head, duller and lower ----
for (let v = 0; v < 4; v++) {
  seed = 200 + v; const x = buf(0.7), f0 = rr(1100, 1600);
  let t = 0.005, g = 1, dt = rr(0.1, 0.15);
  for (let b = 0; b < 3; b++) {
    modes(x, t, [[f0, 1, 0.03], [f0 * 2.3, 0.5, 0.02], [f0 * 3.9, 0.3, 0.012], [f0 * 2.9, 0.2, 0.05]], g);
    click(x, t, 0.004, 0.6 * g, 800); t += dt; dt *= 0.55; g *= 0.5;
  }
  wav('hull_' + v, fadeOut(x, 0.08));
}
// ---- ricochet: impact tick + a whining bullet fragment sweeping down (with flutter) ----
for (let v = 0; v < 6; v++) {
  seed = 300 + v; const L = rr(0.45, 0.8), x = buf(L + 0.05), f1 = rr(2400, 4200), f2 = f1 * rr(0.35, 0.55), bp = biquad('bp');
  click(x, 0, 0.004, 1.2, 1200);
  let ph = 0; const vib = rr(18, 40);
  for (let i = 0; i < L * SR; i++) {
    const t = i / SR, k = t / L, f = f1 * Math.pow(f2 / f1, k) * (1 + 0.02 * Math.sin(TAU * vib * t)), env = Math.min(1, t / 0.01) * Math.pow(1 - k, 1.6);
    ph += TAU * f / SR; x[i] += env * (0.55 * Math.sin(ph) + 0.12 * Math.sin(2 * ph)) + env * 0.35 * bp(white(), f, 6);
  }
  wav('ricochet_' + v, fadeOut(x, 0.05));
}
// ---- near miss: supersonic crack (N-wave) + short doppler swish ----
for (let v = 0; v < 5; v++) {
  seed = 400 + v; const x = buf(0.3), bp = biquad('bp'), n0 = Math.round(0.002 * SR);
  for (let i = 0; i < n0; i++) x[i] += 1 - 2 * i / n0;                        // N-wave
  for (let i = 0; i < 0.25 * SR; i++) { const t = i / SR, f = 3200 * Math.exp(-t * 7) + 600, env = Math.exp(-t * 16) * Math.min(1, t / 0.003); x[i] += 0.8 * env * bp(white(), f, 1.2); }
  wav('whiz_' + v, x);
}
// ---- swing whoosh (crowbar) / throw whoosh: noise through a band sweeping up then down ----
function whoosh(name, L, fLo, fHi, q) {
  const x = buf(L), bp = biquad('bp'), bp2 = biquad('bp');
  for (let i = 0; i < x.length; i++) { const k = i / x.length, bell = Math.sin(Math.PI * Math.pow(k, 0.8)), f = fLo + (fHi - fLo) * bell; x[i] = Math.pow(bell, 1.5) * (bp(white(), f, q) + 0.5 * bp2(white(), f * 2.1, q)); }
  wav(name, x);
}
for (let v = 0; v < 4; v++) { seed = 500 + v; whoosh('swing_' + v, rr(0.2, 0.28), rr(300, 450), rr(1400, 2200), 1.4); }
for (let v = 0; v < 3; v++) { seed = 520 + v; whoosh('throw_' + v, rr(0.3, 0.4), 250, rr(900, 1200), 1.0); }
// ---- bone crack: a cluster of sharp resonant clicks + a dull thump ----
for (let v = 0; v < 6; v++) {
  seed = 600 + v; const x = buf(0.35);
  for (let c = 0, n = 4 + (rnd() * 5 | 0); c < n; c++) { const t = rr(0, 0.07), f = rr(1400, 4200); modes(x, t, [[f, 1, 0.004], [f * 1.7, 0.5, 0.003]], rr(0.4, 1)); click(x, t, 0.0015, rr(0.5, 1.2), 2000); }
  modes(x, 0.0, [[rr(110, 170), 1, 0.05], [rr(260, 340), 0.4, 0.03]], 0.9);
  wav('bone_' + v, fadeOut(x, 0.05));
}
// ---- prop cannon: pneumatic thump + air hiss ----
for (let v = 0; v < 3; v++) {
  seed = 700 + v; const x = buf(0.7), lp = biquad('lp'), hp = biquad('hp'); let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR, f = 40 + 70 * Math.exp(-t * 30); ph += TAU * f / SR;
    x[i] = 1.1 * Math.sin(ph) * Math.exp(-t * 12) * Math.min(1, t / 0.002) + 0.9 * lp(white(), 900, 0.7) * Math.exp(-t * 25) + 0.25 * hp(white(), 3500, 0.7) * Math.exp(-t * 6) * Math.min(1, t / 0.02);
  }
  wav('pneu_' + v, fadeOut(x, 0.1));
}
// ---- balloon pop: a sharp broadband crack with a short room tail and a rubber snap ----
for (let v = 0; v < 4; v++) {
  seed = 800 + v; const x = buf(0.45), hp = biquad('hp'), lp = biquad('lp');
  for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] = hp(white(), 250, 0.7) * (Math.exp(-t * 180) + 0.08 * Math.exp(-t * 14)) + 0.5 * lp(white(), 400, 1) * Math.exp(-t * 60); }
  modes(x, 0, [[rr(160, 230), 0.4, 0.02]], 1);
  wav('pop_' + v, x);
}
// ---- tyre squeal loop: noise through narrow resonances that wander ----
{
  seed = 900; const L = 2.4, x = buf(L), fs = [880, 1340, 2080], F = fs.map(() => biquad('bp'));
  for (let i = 0; i < x.length; i++) { const t = i / SR; let s = 0; fs.forEach((f, j) => { s += F[j](white(), f * (1 + 0.035 * Math.sin(TAU * (0.83 + j * 0.41) * t) + 0.015 * Math.sin(TAU * 7.3 * t)), 28) * (1 - j * 0.25); }); x[i] = s * (0.8 + 0.2 * Math.sin(TAU * 11 * t)); }
  wav('skid_loop', looped(x, 0.35));
}
// ---- electric motor whir loop (exactly periodic: all partials are whole Hz over 1 s) ----
{
  const x = buf(1), f0 = 120, hp = biquad('bp');
  for (let i = 0; i < x.length; i++) {
    const t = i / SR; let s = 0;
    for (const [h, a] of [[1, 0.5], [2, 0.9], [3, 0.25], [4, 0.35], [6, 0.6], [12, 0.18], [18, 0.1]]) s += a * Math.sin(TAU * f0 * h * t);
    x[i] = s * (1 + 0.15 * Math.sin(TAU * 20 * t)) + 0.35 * hp(white(), 4200, 1.5);
  }
  wav('motor_loop', x, 0.7);
}
// ---- physics gun hum loop: low electrical buzz + airy shimmer ----
{
  const x = buf(1), bp = biquad('bp');
  for (let i = 0; i < x.length; i++) {
    const t = i / SR, fm = Math.sin(TAU * 3 * t) * 0.4;
    x[i] = 0.7 * Math.sin(TAU * 55 * t + fm) + 0.45 * Math.sin(TAU * 110 * t + 2 * fm) + 0.25 * Math.sin(TAU * 165 * t) + 0.12 * Math.sin(TAU * 440 * t + fm * 3)
      + 0.25 * bp(white(), 2400 + 800 * Math.sin(TAU * 2 * t), 3) * (0.6 + 0.4 * Math.sin(TAU * 7 * t));
  }
  wav('pghum_loop', x, 0.7);
}
// ---- wind loops (12 s): gusting band of noise; the strong one whistles ----
function wind(name, strong) {
  const L = 13, x = buf(L), br = brown(), bp = biquad('bp'), bp2 = biquad('bp'), lp = biquad('lp');
  const g1 = rr(0, TAU), g2 = rr(0, TAU), g3 = rr(0, TAU);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR, gust = 0.55 + 0.25 * Math.sin(TAU * t / 13 + g1) + 0.15 * Math.sin(TAU * 3 * t / 13 + g2) + 0.08 * Math.sin(TAU * 7 * t / 13 + g3);
    const f = (strong ? 520 : 380) * (0.7 + gust), n = white();
    let s = 1.6 * lp(br(), 300 + 500 * gust, 0.7) + 0.5 * bp(n, f, 0.8);
    if (strong) s += 0.35 * bp2(n, 700 + 500 * gust, 9) * gust;   // whistle
    x[i] = s * gust;
  }
  wav(name, looped(x, 1.0), 0.8);
}
seed = 1000; wind('wind_loop', false); seed = 1001; wind('windstrong_loop', true);
// ---- distant city: traffic rumble with passing swells ----
{
  seed = 1100; const L = 11, x = buf(L), br = brown(), lp = biquad('lp'), bp = biquad('bp');
  const cars = Array.from({ length: 7 }, () => [rr(0, L), rr(1.5, 3.5), rr(300, 700)]);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR; let sw = 0, fc = 500;
    for (const [c, d, f] of cars) { const k = (t - c) / d; if (k > -1 && k < 1) { const e = Math.cos(k * Math.PI / 2) ** 2; if (e > sw) { sw = e; fc = f * (1.1 - 0.2 * (k + 1) / 2); } } }
    x[i] = 1.4 * lp(br(), 180, 0.7) + 0.35 * sw * bp(white(), fc, 1.5);
  }
  wav('city_loop', looped(x, 1.0), 0.8);
}
// ---- songbird phrases: runs of fast FM-swept whistles ----
for (let v = 0; v < 8; v++) {
  seed = 1200 + v; const notes = 2 + (rnd() * 6 | 0), x = buf(1.6); let t = 0.01;
  const base = rr(2600, 4800), style = rnd();
  for (let n = 0; n < notes && t < 1.4; n++) {
    const d = rr(0.04, 0.13), fA = base * rr(0.8, 1.25), fB = style < 0.5 ? fA * rr(0.55, 0.8) : fA * rr(1.15, 1.5), trill = rnd() < 0.35 ? rr(25, 45) : 0;
    let ph = 0; const i0 = Math.round(t * SR);
    for (let i = 0; i < d * SR && i0 + i < x.length; i++) {
      const k = i / (d * SR), f = fA + (fB - fA) * k + (trill ? 250 * Math.sin(TAU * trill * i / SR) : 0), env = Math.sin(Math.PI * k) ** 1.5;
      ph += TAU * f / SR; x[i0 + i] += env * (Math.sin(ph) + 0.1 * Math.sin(2 * ph));
    }
    t += d + rr(0.02, 0.12);
  }
  wav('bird_' + v, x, 0.6);
}
console.log('synth ok');
