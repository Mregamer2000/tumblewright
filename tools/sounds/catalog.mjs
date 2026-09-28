// Lists every clip in sounds/cc0/lib with duration, peak / RMS level and spectral centroid (brightness),
// so clips can be chosen and balanced without listening.   node tools/sounds/catalog.mjs [filter]
import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..'), LIB = join(root, 'sounds', 'cc0', 'lib');
const filt = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const rows = [];
for (const pack of readdirSync(LIB)) for (const f of readdirSync(join(LIB, pack))) {
  const rel = pack + '/' + f; if (filt && !filt.test(rel)) continue;
  const p = join(LIB, pack, f);
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', p, '-af', 'aformat=channel_layouts=mono,astats=measure_perchannel=0,aspectralstats=measure=centroid,ametadata=mode=print:key=lavfi.aspectralstats.1.centroid:file=-', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = r.stdout || '', err = r.stderr || '';
  const g = (re, s) => { const m = s.match(re); return m ? +m[1] : NaN; };
  const dm = err.match(/Duration: (\d+):(\d+):([\d.]+)/), dur = dm ? +dm[1] * 3600 + +dm[2] * 60 + +dm[3] : NaN;
  const cents = [...out.matchAll(/centroid=([\d.]+)/g)].map(m => +m[1]).filter(x => x > 0);
  const cen = cents.length ? cents.reduce((a, b) => a + b, 0) / cents.length : NaN;
  rows.push([rel, dur.toFixed(2), g(/Peak level dB: ([-\d.inf]+)/, err).toFixed(1), g(/RMS level dB: ([-\d.inf]+)/, err).toFixed(1), Math.round(cen)]);
}
const txt = rows.map(r => r.join('\t')).join('\n');
if (!filt) writeFileSync(join(root, 'sounds', 'cc0', 'catalog.tsv'), 'file\tdur\tpeak\trms\tcentroid\n' + txt);
console.log(txt);
