// Owner access: people who know the owner code can use the host settings in any room.
//   node tools/owner/owner.mjs new            asks for a new owner code (or --random makes one), writes tools/owner/owner.json
//   node tools/owner/owner.mjs check          asks for a code and tells you whether it unlocks owner.json
// How it works: a P-256 signing key is generated; its private half is encrypted (AES-256-GCM) with a key derived from
// the owner code (PBKDF2-SHA256, 600k rounds). owner.json holds only the public key + the encrypted private key, so it is
// safe to publish. In the game an owner types the code, the browser decrypts the private key locally, and the host sends a
// one-time challenge that the owner signs; the host checks the signature with the public key. The code never leaves the
// owner's browser and a captured signature can't be reused. Changing the code (running `new` again) locks out old codes.
// Use a long code (e.g. four or more random words): anyone can download owner.json and try to guess it offline.
import { generateKeyPairSync, pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const F = join(dirname(fileURLToPath(import.meta.url)), 'owner.json'), ITER = 600000;
const b64 = b => Buffer.from(b).toString('base64');
const ask = async q => { const rl = createInterface({ input: process.stdin, output: process.stdout }); const a = await rl.question(q); rl.close(); return a.trim(); };
const WORDS = 'amber anchor apple arrow atlas badge basil beacon birch blaze bolt bramble breeze brick cabin canyon cedar chalk cinder cliff clover cobalt comet coral crane crater dawn delta dune ember falcon fern flint forge frost gale garnet glacier granite harbor hazel heron hollow iris ivory jade jasper juniper kelp kestrel lagoon lantern larch lava lemon lilac lotus lunar maple marble meadow mesa mint moss nectar nimbus north oak onyx orbit otter pebble pepper pine plume prairie quartz quill raven reef ridge river robin saffron sage salt sierra silver slate sparrow spruce storm summit sunset thistle thunder timber topaz trail tundra umber valley velvet willow winter wren zephyr'.split(' ');

const cmd = process.argv[2];
if (cmd === 'new') {
  let code;
  if (process.argv.includes('--random')) { const r = randomBytes(12); code = Array.from({ length: 5 }, (_, i) => WORDS[r.readUInt16BE(i * 2) % WORDS.length]).join('-') + '-' + (r.readUInt16BE(10) % 900 + 100); }
  else { code = await ask('New owner code (long, e.g. several random words): '); if (code.length < 12) { console.error('Too short: use at least 12 characters.'); process.exit(1); } if ((await ask('Type it again: ')) !== code) { console.error('The codes did not match.'); process.exit(1); } }
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const priv = privateKey.export({ format: 'jwk' }), pub = publicKey.export({ format: 'jwk' });
  const salt = randomBytes(16), iv = randomBytes(12), key = pbkdf2Sync(code.normalize('NFKC'), salt, ITER, 32, 'sha256');
  const c = createCipheriv('aes-256-gcm', key, iv), ct = Buffer.concat([c.update(JSON.stringify(priv)), c.final(), c.getAuthTag()]);
  writeFileSync(F, JSON.stringify({ v: 1, pub: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }, salt: b64(salt), iter: ITER, iv: b64(iv), ct: b64(ct) }, null, 1) + '\n');
  console.log('Wrote tools/owner/owner.json. Rebuild (node tools/build.mjs) and redeploy for it to take effect.');
  if (process.argv.includes('--random')) console.log('\nOWNER CODE (write it down, it is not stored anywhere):\n\n  ' + code + '\n');
} else if (cmd === 'check') {
  const o = JSON.parse(readFileSync(F, 'utf8')), code = await ask('Owner code: ');
  try {
    const key = pbkdf2Sync(code.normalize('NFKC'), Buffer.from(o.salt, 'base64'), o.iter, 32, 'sha256'), ct = Buffer.from(o.ct, 'base64');
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(o.iv, 'base64')); d.setAuthTag(ct.subarray(ct.length - 16));
    JSON.parse(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString()); console.log('Correct: this code unlocks owner access.');
  } catch (e) { console.log('Wrong code.'); process.exit(1); }
} else console.log('usage: node tools/owner/owner.mjs new [--random] | check');
