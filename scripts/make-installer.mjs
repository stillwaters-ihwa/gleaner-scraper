// Packs the built extension with the setup files into one ZIP to share:
// release/Gleaner-Setup-<version>.zip, holding Gleaner-Setup/ with Install Gleaner.cmd,
// Uninstall Gleaner.cmd, Gleaner Guide.html (and its pictures), READ ME.txt and extension/.
import fs from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const built = path.join(root, '.output', 'chrome-mv3');
if (!fs.existsSync(path.join(built, 'manifest.json'))) {
  console.error('Build Gleaner first: npm run build');
  process.exit(1);
}
const version = JSON.parse(fs.readFileSync(path.join(built, 'manifest.json'), 'utf8')).version;
const files = {};
const stored = /\.(png|jpe?g|woff2?|wasm|gz|zip)$/i;
// Windows scripts and notes need Windows line endings
const windowsText = /\.(cmd|ps1|txt)$/i;
const add = (dir, prefix) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const zipPath = `${prefix}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== '__pycache__') add(p, zipPath);
      continue;
    }
    let data = new Uint8Array(fs.readFileSync(p));
    if (windowsText.test(e.name)) data = new TextEncoder().encode(new TextDecoder().decode(data).replace(/\r?\n/g, '\r\n'));
    files[zipPath] = [data, { level: stored.test(e.name) ? 0 : 6 }];
  }
};
const top = 'Gleaner-Setup';
add(path.join(root, 'installer'), top);
add(built, `${top}/extension`);
const outDir = path.join(root, 'release');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `Gleaner-Setup-${version}.zip`);
fs.writeFileSync(out, zipSync(files));
console.log(`Saved ${path.relative(root, out)} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB, ${Object.keys(files).length} files)`);
