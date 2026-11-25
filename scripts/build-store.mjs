// Builds the Chrome Web Store package in dist/. The store build differs from the development copy:
// no manifest key (the store assigns the ID), and no tool for running JavaScript supplied by agents.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './register.mjs';
import { makeZip } from './zip.mjs';

const SRC = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'dist', 'store');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'store', 'config.json'), 'utf8'));
if (config.bridgeUrl && !/^https:\/\//.test(config.bridgeUrl)) throw new Error('bridgeUrl must be https');

const files = new Map();
(function read(dir, base = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = base + e.name;
    if (e.isDirectory()) read(path.join(dir, e.name), `${name}/`);
    else files.set(name, fs.readFileSync(path.join(dir, e.name)));
  }
})(SRC);

const text = (name, fn) => files.set(name, Buffer.from(fn(files.get(name).toString('utf8'))));
const strip = (s) => s.replace(/[ \t]*(\/\*|<!--) store:off (\*\/|-->)[\s\S]*?store:end (\*\/|-->)\n/g, '');
for (const name of files.keys()) if (/\.(js|html)$/.test(name)) text(name, strip);
text('config.js', (s) => s.replace("BRIDGE_URL = ''", `BRIDGE_URL = ${JSON.stringify(config.bridgeUrl || '')}`));
text('manifest.json', (s) => {
  const m = JSON.parse(s);
  delete m.key;
  if (config.bridgeUrl) m.homepage_url = config.bridgeUrl;
  return JSON.stringify(m, null, 2) + '\n';
});

// Checks that would otherwise surface as a rejection.
const m = JSON.parse(files.get('manifest.json'));
const all = [...files].filter(([n]) => /\.(js|html)$/.test(n)).map(([n, b]) => [n, b.toString('utf8')]);
const bad = [];
if (m.key) bad.push('manifest has a key');
if (m.name.length > 75) bad.push('name is over 75 characters');
if (m.description.length > 132) bad.push('description is over 132 characters');
for (const [n, s] of all) {
  if (/store:(off|end)/.test(s)) bad.push(`${n}: marker left behind`);
  if (/Runtime\.evaluate|\beval\(|new Function\(/.test(s)) bad.push(`${n}: runs supplied code`);
  if (/<script[^>]+src=["']https?:|import\(?\s*["']https?:/.test(s)) bad.push(`${n}: loads remote code`);
  if (/hermes/i.test(s.replace(/com\.hermes\.chrome_bridge|__hermes|hermesFrame/g, ''))) bad.push(`${n}: still says Hermes`);
}
if (/hermes/i.test(m.name + m.description + m.action.default_title)) bad.push('manifest still says Hermes');
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }

fs.rmSync(OUT, { recursive: true, force: true });
for (const [n, b] of files) {
  fs.mkdirSync(path.dirname(path.join(OUT, n)), { recursive: true });
  fs.writeFileSync(path.join(OUT, n), b);
}

const zip = path.join(ROOT, 'dist', `sharedtabs-${m.version}.zip`);
fs.writeFileSync(zip, makeZip(files));
console.log(`${zip}\n${files.size} files, ${fs.statSync(zip).size} bytes`);
if (!config.bridgeUrl) console.log('Note: store/config.json has no bridgeUrl yet, so users get no link to the bridge app.');
