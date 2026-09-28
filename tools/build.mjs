// Builds index.html (the whole game in one file) from src/ and the prebuilt assets.
//   node tools/build.mjs
// 1. concatenates src/01_head.html ... src/11_loader.html
// 2. syntax-checks the game module and the loader with node --check
// 3. embeds the 3D models (assets/*.glb), the sound banks (sounds/clips/sounds.json) and the owner key (tools/owner/owner.json)
// To rebuild the assets themselves: tools/models/build.ps1 (Blender), tools/sounds/*.mjs (ffmpeg), tools/owner/owner.mjs.
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'), SRC = join(root, 'src'), OUT = join(root, 'index.html');
const parts = readdirSync(SRC).filter(f => /^\d\d_.*\.(html|js)$/.test(f)).sort();
let html = parts.map(f => readFileSync(join(SRC, f), 'utf8')).join('');

// syntax check
const tmp = mkdtempSync(join(tmpdir(), 'twb-'));
try {
  const main = html.match(/<script id="tw-main" type="text\/tw-module">([\s\S]*?)<\/script>/), loader = html.match(/\n<script>\n([\s\S]*?)<\/script>/);
  if (!main) throw new Error('tw-main module not found');
  writeFileSync(join(tmp, 'main.mjs'), main[1]); execFileSync(process.execPath, ['--check', join(tmp, 'main.mjs')], { stdio: 'inherit' });
  if (loader) { writeFileSync(join(tmp, 'loader.js'), loader[1]); execFileSync(process.execPath, ['--check', join(tmp, 'loader.js')], { stdio: 'inherit' }); }
  console.log('syntax ok');
} finally { rmSync(tmp, { recursive: true, force: true }); }

// embeds
const embed = (id, type, data) => {
  const re = new RegExp(`(<script id="${id}" type="${type.replace('/', '\\/')}">)[\\s\\S]*?(<\\/script>)`);
  if (!re.test(html)) throw new Error(`#${id} not found`);
  html = html.replace(re, (_, a, b) => a + data + b);
  console.log(`embedded #${id} (${(data.length / 1024).toFixed(0)} KB)`);
};
embed('tw-models', 'application/octet-stream', readFileSync(join(root, 'assets', 'models.glb')).toString('base64'));
embed('tw-models-ps1', 'application/octet-stream', readFileSync(join(root, 'assets', 'models_ps1.glb')).toString('base64'));
embed('tw-sounds', 'application/json', readFileSync(join(root, 'sounds', 'clips', 'sounds.json'), 'utf8'));
embed('tw-owner', 'application/json', readFileSync(join(root, 'tools', 'owner', 'owner.json'), 'utf8').trim());
writeFileSync(OUT, html);
console.log(`wrote index.html (${(html.length / 1048576).toFixed(2)} MB)`);
