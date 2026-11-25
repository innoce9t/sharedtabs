// Builds dist/site/sharedtabs: plain files to put in the website's public folder, served at /sharedtabs/.
// File names carry a hash of their contents, because the website caches CSS for a year.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { bundleFiles } from './bundle.mjs';
import { EXTENSION_IDS } from '../host/shared.mjs';
import { ROOT } from './register.mjs';

const SRC = path.join(ROOT, 'site');
const OUT = path.join(ROOT, 'dist', 'site', 'sharedtabs');
const BASE = '/sharedtabs/';
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'store', 'config.json'), 'utf8'));
const release = path.join(ROOT, 'dist', 'release');
const manifest = JSON.parse(fs.readFileSync(path.join(release, 'release.json'), 'utf8'));
if (manifest.version !== version || !manifest.file.endsWith('.zip')) throw new Error('Run npm run release first, so the download is this version.');
const zip = fs.readFileSync(path.join(release, manifest.file));
if (crypto.createHash('sha256').update(zip).digest('hex') !== manifest.sha256) throw new Error('The download does not match its description.');

fs.rmSync(path.join(ROOT, 'dist', 'site'), { recursive: true, force: true });
const put = (name, data) => { const f = path.join(OUT, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
const hashed = new Map();
// GSAP (its licence notice stays in it) is a classic script, because it can't run as a module. Nothing is loaded from other sites.
const join = (...names) => Buffer.from(names.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8').trim()).join('\n;\n') + '\n');
const joined = { 'gsap.js': join('vendor/gsap.min.js', 'vendor/ScrollTrigger.min.js'), 'site.js': join('site.js', 'motion.js') };
for (const f of ['site.css', 'gsap.js', 'site.js', ...fs.readdirSync(path.join(SRC, 'img')).map((x) => `img/${x}`)]) {
  const data = joined[f] || fs.readFileSync(path.join(SRC, f));
  const name = f.replace(/\.(\w+)$/, `.${crypto.createHash('sha256').update(data).digest('hex').slice(0, 10)}.$1`);
  hashed.set(f, BASE + name);
  put(name, data);
}
// The address people give their AI never changes; the number in the link keeps old copies from being reused.
put('sharedtabs-bridge.zip', zip);
// Its name stays the same, so caches must check for a newer one: an old copy would not match the SHA-256 on the page.
put('.htaccess', `<IfModule mod_headers.c>
  <Files "sharedtabs-bridge.zip">
    Header set Cache-Control "no-cache"
  </Files>
</IfModule>
`);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const head = (title, description, url, motion) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0a0a0a">
<link rel="canonical" href="https://ahsan.live${url}">
<link rel="icon" type="image/png" href="${hashed.get('img/icon.png')}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="https://ahsan.live${url}">
<meta property="og:image" content="https://ahsan.live${hashed.get('img/og.jpg')}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="${hashed.get('site.css')}">
${motion ? '<script>document.documentElement.classList.add("js");try{if(/^(on|off)$/.test(localStorage.motion))document.documentElement.dataset.motion=localStorage.motion}catch{}</script>\n' : ''}</head>`;
const footer = `  <footer><div class="wrap">
    <p>SharedTabs is an independent project. It is not made or endorsed by Google or by the makers of any AI agent. Chrome is a trademark of Google LLC.</p>
    <nav aria-label="Footer"><a href="${BASE}">SharedTabs</a><a href="${BASE}privacy/">Privacy</a><a href="mailto:hello@ahsan.live">hello@ahsan.live</a><a href="https://github.com/innoce9t/sharedtabs">Source code</a><a href="/coffee">Buy me a coffee</a><a href="https://ahsan.live/">Built by Ahsan Nawazish</a></nav>
  </div></footer>`;

const id = /^[a-p]{32}$/.test(config.storeId || '') ? config.storeId : '';
// The link works only once Google has published the item.
const live = !!id && config.storeLive === true;
const store = `https://chromewebstore.google.com/detail/${id}`;
const values = {
  HEAD: head('SharedTabs: AI agents, only in the tabs you share', 'A Chrome extension that lets an AI agent on your computer work only in the tabs you share, on sites you allow. Works with local MCP agents. Windows, free.', BASE, true),
  FOOTER: footer,
  STORE_BUTTON: live ? `<a class="btn main" href="${store}">Add to Chrome</a>` : '<span class="soon">Coming to the Chrome Web Store</span>',
  STORE_STEP: live ? `From the <a href="${store}">Chrome Web Store</a>.` : 'Coming to the Chrome Web Store.',
  ZIP: `${BASE}sharedtabs-bridge.zip?v=${version}`,
  VERSION: version,
  SIZE: `${Math.round(zip.length / 1024)} KB`,
  SHA: manifest.sha256,
};
put('index.html', fs.readFileSync(path.join(SRC, 'index.html'), 'utf8').replace(/\{\{([\w./-]+)\}\}/g, (m, k) => {
  const v = values[k] ?? hashed.get(k);
  if (v === undefined) throw new Error(`Unknown placeholder ${m}`);
  return v;
}));

// The privacy policy, from the same text as the store listing. Understands only what that file uses.
const md = fs.readFileSync(path.join(ROOT, 'store', 'privacy-policy.md'), 'utf8');
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\(((?:https:\/\/|mailto:)[^)\s]+)\)/g, '<a href="$2">$1</a>');
const draft = md.includes('[DATE]');
const body = md.replace('Effective: [DATE]', '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).map((b) => {
  if (b.startsWith('# ')) return `<h1><span class="shimmer">${inline(b.slice(2))}</span></h1>${draft ? '\n<p class="draft">Draft. Not in effect yet.</p>' : ''}`;
  if (b.startsWith('## ')) return `<h2>${inline(b.slice(3))}</h2>`;
  if (b.startsWith('- ')) return `<ul>\n${b.split('\n').map((l) => `<li>${inline(l.replace(/^- /, ''))}</li>`).join('\n')}\n</ul>`;
  return `<p>${inline(b.replace(/\n/g, ' '))}</p>`;
}).join('\n');
put('privacy/index.html', `${head('SharedTabs privacy policy', 'What SharedTabs handles, where it goes, and your choices.', `${BASE}privacy/`)}
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="nav"><div class="wrap">
    <a class="brand" href="${BASE}"><img src="${hashed.get('img/icon.png')}" alt="" width="34" height="34"><span>Shared<i>Tabs</i></span></a>
    <nav aria-label="Main"><a href="${BASE}#how">How it works</a><a href="${BASE}#setup">Set up</a></nav>
  </div></header>
  <main id="main" class="doc">
${body}
  </main>
${footer}
</body>
</html>
`);

console.log(`dist/site/sharedtabs\nBridge ${version}, SHA-256 ${manifest.sha256}`);
const missing = [];
if (!live) missing.push(`${id ? 'storeLive' : 'storeId and storeLive'} in store/config.json, once published (the Add to Chrome button says "Coming to the Chrome Web Store")`);
if (!id || !EXTENSION_IDS.includes(id)) missing.push('the store ID in extension-id.txt, so the store version can connect; then npm run release again');
if (draft) missing.push('the date in store/privacy-policy.md (the page says it is a draft)');
const u = JSON.parse(bundleFiles({ version, repo: config.repo, publicKey: fs.existsSync(path.join(ROOT, 'store', 'update-key.pub')) ? 'x' : '' }).get('update.json'));
if (!u.repo || !u.publicKey) missing.push('a public repo and signing key, so the download can update itself');
if (missing.length) console.log(`Before going live, still missing:\n${missing.map((m) => `  - ${m}`).join('\n')}`);
