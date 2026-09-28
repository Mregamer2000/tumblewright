// Embeds a (gltfpack-compressed) GLB into index.html as base64:
//   node tools/models/embed.mjs models.glb index.html              -> <script id="tw-models">
//   node tools/models/embed.mjs models_ps1.glb index.html tw-models-ps1   (low-poly set for the Low tier)
import { readFileSync, writeFileSync } from 'node:fs';

const [glbPath, htmlPath, id = 'tw-models'] = process.argv.slice(2);
const b64 = readFileSync(glbPath).toString('base64');
const html = readFileSync(htmlPath, 'utf8');
const re = new RegExp(`(<script id="${id}" type="application\\/octet-stream">)[\\s\\S]*?(<\\/script>)`);
if (!re.test(html)) { console.error(`${id} script tag not found in ${htmlPath}`); process.exit(1); }
writeFileSync(htmlPath, html.replace(re, (_, a, b) => a + b64 + b));
console.log(`embedded ${glbPath} (${(b64.length / 1024).toFixed(0)} KB base64) into ${htmlPath} #${id}`);
