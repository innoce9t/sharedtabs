// What goes into the bridge download.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './register.mjs';
import { PRODUCT } from './updater.mjs';
import { makeZip } from './zip.mjs';

const SCRIPTS = ['agents.mjs', 'check.mjs', 'demo.mjs', 'install.mjs', 'register.mjs', 'uninstall.mjs', 'update.mjs', 'updater.mjs', 'zip.mjs'];
// One line each: cmd reads a script while it runs, and an update replaces these files.
const cmd = (script) => Buffer.from(`@echo off & title SharedTabs & cd /d "%~dp0" & (where node >nul 2>nul && node scripts\\${script} || (where node >nul 2>nul || echo Node.js 20 or newer is needed. Get it from https://nodejs.org, then run this again.)) & echo. & pause & exit /b\r\n`);

export function bundleFiles({ version, repo = '', publicKey = '' }) {
  const files = new Map();
  for (const dir of ['host', 'mcp']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir)).sort()) if (f.endsWith('.mjs')) files.set(`${dir}/${f}`, fs.readFileSync(path.join(ROOT, dir, f)));
  }
  files.set('extension/tools.js', fs.readFileSync(path.join(ROOT, 'extension', 'tools.js')));
  files.set('LICENSE.txt', fs.readFileSync(path.join(ROOT, 'LICENSE.txt')));
  files.set('extension-id.txt', fs.readFileSync(path.join(ROOT, 'extension-id.txt')));
  files.set('package.json', Buffer.from(JSON.stringify({
    name: PRODUCT, version, private: true, type: 'module', engines: { node: '>=20' },
    scripts: { setup: 'node scripts/install.mjs', check: 'node scripts/check.mjs', update: 'node scripts/update.mjs', demo: 'node scripts/demo.mjs', 'uninstall-host': 'node scripts/uninstall.mjs' },
  }, null, 2) + '\n'));
  files.set('update.json', Buffer.from(JSON.stringify({ repo, publicKey }, null, 2) + '\n'));
  for (const f of ['README.md', 'INSTALL-WITH-AI.md']) {
    const text = fs.readFileSync(path.join(ROOT, 'bridge', f), 'utf8').replaceAll('{{VERSION}}', version);
    if (text.includes('{{')) throw new Error(`${f} has an unfilled placeholder`);
    files.set(f, Buffer.from(text));
  }
  files.set('Set up SharedTabs.cmd', cmd('install.mjs'));
  files.set('Check SharedTabs.cmd', cmd('check.mjs'));
  files.set('Update SharedTabs.cmd', cmd('update.mjs'));
  files.set('Remove SharedTabs.cmd', cmd('uninstall.mjs'));
  for (const f of SCRIPTS) files.set(`scripts/${f}`, fs.readFileSync(path.join(ROOT, 'scripts', f)));
  return files;
}

/** { zip, manifest } where manifest is the exact bytes to sign. */
export function makeRelease(files, { version, notes = '' }) {
  const zip = makeZip(files);
  const manifest = Buffer.from(JSON.stringify({
    product: PRODUCT, version, file: `sharedtabs-bridge-${version}.zip`, size: zip.length,
    sha256: crypto.createHash('sha256').update(zip).digest('hex'), notes,
  }, null, 2) + '\n');
  return { zip, manifest };
}
