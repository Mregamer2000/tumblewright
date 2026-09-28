#!/usr/bin/env node
// Tumblewright release tool: stamps the version + update server into index.html, signs it, and writes a
// folder you upload to your static host. Players' copies check that host, verify the signature with the
// public key baked into their file, and install the update on their next start.
//
//   node tools/release/release.mjs init <https://your-site.example/>   one time: make a signing key + config
//   node tools/release/release.mjs publish [patch|minor|major|1.2.3] ["what's new"]
//   node tools/release/release.mjs status
//
// Output: release/public/ -> index.html, update.json, vercel.json (upload the whole folder).
// Keep release/update-key.pem private and backed up: without it you cannot ship updates to existing copies.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME = join(ROOT, 'index.html');
const REL = join(ROOT, 'release');
const CONF = join(REL, 'config.json');
const KEYF = join(REL, 'update-key.pem');
const OUT = join(REL, 'public');

const die = m => { console.error('\n  ✖ ' + m + '\n'); process.exit(1); };
const readConf = () => existsSync(CONF) ? JSON.parse(readFileSync(CONF, 'utf8')) : die('Not set up yet. Run: node tools/release/release.mjs init https://your-site.example/');
const writeConf = c => writeFileSync(CONF, JSON.stringify(c, null, 2) + '\n');
const pubKeyB64 = pem => createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'der' }).toString('base64');

function setMeta(html, name, value) {
  const re = new RegExp(`<meta name="${name}" content="[^"]*">`);
  if (!re.test(html)) die(`index.html has no <meta name="${name}"> tag. It was built before the auto-updater was added.`);
  return html.replace(re, `<meta name="${name}" content="${value.replace(/"/g, '&quot;')}">`);
}
function bump(v, how) {
  if (/^\d+\.\d+\.\d+$/.test(how || '')) return how;
  const [a, b, c] = v.split('.').map(Number);
  if (how === 'major') return `${a + 1}.0.0`;
  if (how === 'minor') return `${a}.${b + 1}.0`;
  return `${a}.${b}.${c + 1}`;
}
const newer = (x, y) => { const a = x.split('.').map(Number), b = y.split('.').map(Number); for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'init') {
  let url = (args[0] || '').trim();
  if (!/^(https:\/\/.+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/.*)$/.test(url)) die('Give the https:// address of your site, e.g.  node tools/release/release.mjs init https://tumblewright.vercel.app/');
  if (!url.endsWith('/')) url += '/';
  mkdirSync(REL, { recursive: true });
  if (existsSync(KEYF)) console.log('  • Keeping the existing signing key (release/update-key.pem).');
  else {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    writeFileSync(KEYF, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    console.log('  • Created a new signing key: release/update-key.pem  (keep it private, back it up)');
  }
  writeFileSync(join(REL, '.gitignore'), 'update-key.pem\n');
  const prev = existsSync(CONF) ? JSON.parse(readFileSync(CONF, 'utf8')) : {};
  const html = readFileSync(GAME, 'utf8'), m = html.match(/<meta name="tw-version" content="([^"]+)"/);
  writeConf({ url, version: prev.version || (m ? m[1] : '1.0.0'), publicKey: pubKeyB64(readFileSync(KEYF, 'utf8')) });
  console.log(`  • Update server: ${url}\n  • Next: node tools/release/release.mjs publish "first release"`);
  process.exit(0);
}

if (cmd === 'publish') {
  const conf = readConf();
  if (!existsSync(KEYF)) die('release/update-key.pem is missing. Without the original key, existing copies will not accept updates.');
  const pem = readFileSync(KEYF, 'utf8');
  if (pubKeyB64(pem) !== conf.publicKey) die('release/update-key.pem does not match the public key in release/config.json.');
  let how = args[0], notes = args[1];
  if (how && !/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(how)) { notes = how; how = 'patch'; }
  const version = bump(conf.version, how || 'patch');
  if (!newer(version, conf.version) && existsSync(join(OUT, 'update.json'))) die(`Version ${version} is not newer than the last release (${conf.version}).`);

  let html = readFileSync(GAME, 'utf8');
  const oldKey = (html.match(/<meta name="tw-update-key" content="([^"]*)">/) || [])[1];
  if (oldKey && oldKey !== conf.publicKey) console.warn('  ! index.html had a different signing key. Copies made with the old key will NOT accept this update.');
  html = setMeta(html, 'tw-version', version);
  html = setMeta(html, 'tw-update-url', conf.url);
  html = setMeta(html, 'tw-update-key', conf.publicKey);
  const bytes = Buffer.from(html, 'utf8');
  const sig = sign('sha256', bytes, { key: createPrivateKey(pem), dsaEncoding: 'ieee-p1363' });
  if (!verify('sha256', bytes, { key: createPublicKey(pem), dsaEncoding: 'ieee-p1363' }, sig)) die('Signature self-check failed.');

  mkdirSync(OUT, { recursive: true });
  writeFileSync(GAME, bytes);                     // keep the working copy stamped too
  writeFileSync(join(OUT, 'index.html'), bytes);
  const manifest = { version, file: 'index.html', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), sig: sig.toString('base64'), notes: notes || '', date: new Date().toISOString() };
  writeFileSync(join(OUT, 'update.json'), JSON.stringify(manifest, null, 2) + '\n');
  // the game file may be opened from disk (origin "null"), so the host must allow cross-origin reads
  // crons: /api/keepalive stops the free Supabase project (matchmaking) from pausing after a week without use
  writeFileSync(join(OUT, 'vercel.json'), JSON.stringify({ headers: [{ source: '/(.*)', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }, { key: 'Cache-Control', value: 'no-cache' }] }], crons: [{ path: '/api/keepalive', schedule: '0 15 * * *' }] }, null, 2) + '\n');
  // serverless functions: /api/turn (relay credentials for players who can't connect peer-to-peer), /api/keepalive
  const API = join(dirname(fileURLToPath(import.meta.url)), 'api');
  mkdirSync(join(OUT, 'api'), { recursive: true });
  for (const f of readdirSync(API)) writeFileSync(join(OUT, 'api', f), readFileSync(join(API, f)));
  conf.version = version; writeConf(conf);
  console.log(`\n  ✔ Release v${version} is ready in release/public/  (${(bytes.length / 1048576).toFixed(2)} MB)`);
  console.log(`    Upload that folder to ${conf.url}  (Vercel: cd release/public && npx vercel --prod)`);
  console.log('    Give people release/public/index.html (or the site link). Their copies update themselves.\n');
  process.exit(0);
}

if (cmd === 'status' || !cmd) {
  if (!existsSync(CONF)) { console.log('\n  Not set up. Run: node tools/release/release.mjs init https://your-site.example/\n'); process.exit(0); }
  const c = readConf();
  console.log(`\n  version:  ${c.version}\n  server:   ${c.url}\n  key:      ${existsSync(KEYF) ? 'release/update-key.pem (present)' : 'MISSING'}\n`);
  process.exit(0);
}
die(`Unknown command "${cmd}". Use init, publish or status.`);
