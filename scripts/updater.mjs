// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
// Installs a newer bridge from a signed GitHub Release. Nothing here runs by itself: scripts/update.mjs
// calls it when the user asks. The signature is the only thing trusted, not GitHub and not the network.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readZip } from './zip.mjs';

export const PRODUCT = 'sharedtabs-bridge';
/** Everything a bridge folder contains. An update may contain nothing else. */
export const TOP = new Set(['host', 'mcp', 'extension', 'package.json', 'extension-id.txt', 'update.json', 'README.md', 'INSTALL-WITH-AI.md', 'Set up SharedTabs.cmd', 'Check SharedTabs.cmd', 'Update SharedTabs.cmd', 'Remove SharedTabs.cmd', 'LICENSE.txt', 'scripts']);

const parse = (v) => {
  const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(String(v));
  if (!m) throw new Error(`That is not a version number: ${JSON.stringify(v)}`);
  return m.slice(1).map(Number);
};
export function newer(a, b) {
  const x = parse(a); const y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** The signed description of a release. Throws unless the signature matches the key this bridge was built with. */
export function verifyRelease(bytes, signature, publicKey) {
  const key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('The update key is not valid.');
  if (!crypto.verify(null, bytes, key, Buffer.from(String(signature).trim(), 'base64'))) {
    throw new Error('The update is not signed by the makers of SharedTabs. Nothing was changed.');
  }
  const r = JSON.parse(bytes.toString('utf8'));
  if (r.product !== PRODUCT) throw new Error('That update is for something else. Nothing was changed.');
  parse(r.version);
  if (!/^sharedtabs-bridge-\d{1,4}\.\d{1,4}\.\d{1,4}\.zip$/.test(r.file) || !/^[0-9a-f]{64}$/.test(r.sha256) || !Number.isInteger(r.size) || r.size < 1 || r.size > 10_000_000) {
    throw new Error('The update description is not valid. Nothing was changed.');
  }
  if (typeof r.notes !== 'string' || r.notes.length > 4000) throw new Error('The update description is not valid. Nothing was changed.');
  return r;
}

async function download(url, max) {
  const local = /^http:\/\/127\.0\.0\.1[:/]/.test(url);
  const r = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'user-agent': 'SharedTabs-updater' } });
  if (!local && !r.url.startsWith('https://')) throw new Error('The download was redirected to an insecure address. Nothing was changed.');
  if (r.status === 404) throw new Error('No release was found.');
  if (!r.ok) throw new Error(`The download failed (${r.status}).`);
  const parts = [];
  let size = 0;
  for await (const c of r.body) {
    size += c.length;
    if (size > max) throw new Error('The download is larger than expected. Nothing was changed.');
    parts.push(c);
  }
  return Buffer.concat(parts);
}

export function readConfig(root) {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(path.join(root, 'update.json'), 'utf8')); } catch { /* reported below */ }
  if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(c.repo || '') || !c.publicKey) {
    throw new Error('This copy has no update address. Download the new version by hand.');
  }
  return c;
}
export const installedVersion = (root) => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

/** { release, base } when a newer signed release exists, or null. */
export async function checkForUpdate(root, base) {
  const { repo, publicKey } = readConfig(root);
  const from = base || `https://github.com/${repo}/releases`;
  const bytes = await download(`${from}/latest/download/release.json`, 20_000);
  const sig = await download(`${from}/latest/download/release.json.sig`, 1000);
  const release = verifyRelease(bytes, sig.toString('utf8'), publicKey);
  // Never older or the same: an attacker could replay an old, genuinely signed release with a known flaw.
  return newer(release.version, installedVersion(root)) ? { release, from } : null;
}

export async function fetchPackage({ release, from }) {
  const zip = await download(`${from}/download/v${release.version}/${release.file}`, release.size);
  if (zip.length !== release.size || crypto.createHash('sha256').update(zip).digest('hex') !== release.sha256) {
    throw new Error('The downloaded file does not match the signed release. Nothing was changed.');
  }
  return readZip(zip, TOP);
}

/** Starts the new version's server on its own, and checks that it answers with the right version. */
export function selfTest(dir, version) {
  for (const f of ['host/host.mjs', 'scripts/install.mjs', 'scripts/update.mjs']) {
    if (spawnSync(process.execPath, ['--check', path.join(dir, f)], { stdio: 'ignore' }).status !== 0) throw new Error(`The new version is damaged (${f}).`);
  }
  return new Promise((resolve, reject) => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'sharedtabs-check-'));
    const c = spawn(process.execPath, [path.join(dir, 'mcp', 'server.mjs')], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, HERMES_CHROME_STATE: state }, windowsHide: true });
    let out = '';
    const done = (fn, v) => { clearTimeout(timer); c.kill(); fs.rmSync(state, { recursive: true, force: true }); fn(v); };
    const timer = setTimeout(() => done(reject, new Error('The new version did not start.')), 10000);
    c.on('error', (e) => done(reject, e));
    c.on('exit', () => done(reject, new Error('The new version did not start.')));
    c.stdin.on('error', () => {});
    c.stdout.on('data', (d) => {
      out += d;
      if (!out.includes('\n')) return;
      let v;
      try { v = JSON.parse(out.slice(0, out.indexOf('\n'))).result.serverInfo.version; } catch { /* not the answer expected */ }
      c.removeAllListeners('exit');
      if (v === version) done(resolve); else done(reject, new Error('The new version reports the wrong number.'));
    });
    c.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}\n');
  });
}

function move(from, to) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      if (i === 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; // virus scanners hold files briefly
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

/** Puts the previous version back. Safe to repeat. */
function rollBack(root, backup) {
  const failed = path.join(root, '.update', `failed-${Date.now()}`);
  fs.mkdirSync(failed, { recursive: true });
  for (const n of fs.readdirSync(backup)) {
    if (!TOP.has(n)) continue;
    if (fs.existsSync(path.join(root, n))) move(path.join(root, n), path.join(failed, n));
    move(path.join(backup, n), path.join(root, n));
  }
  // Things only the new version had.
  const j = path.join(root, '.update', 'journal.json');
  for (const n of JSON.parse(fs.readFileSync(j, 'utf8')).added) if (TOP.has(n) && fs.existsSync(path.join(root, n))) move(path.join(root, n), path.join(failed, n));
  fs.rmSync(j, { force: true });
  fs.rmSync(failed, { recursive: true, force: true });
}

/** Finishes an update that was cut off, such as by a power cut, by going back to the version before it. */
export function recover(root) {
  const j = path.join(root, '.update', 'journal.json');
  if (!fs.existsSync(j)) return false;
  const { backup } = JSON.parse(fs.readFileSync(j, 'utf8'));
  if (!/^backup-\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(backup)) throw new Error('The update journal is not valid.');
  rollBack(root, path.join(root, '.update', backup));
  return true;
}

export async function applyUpdate(root, files, version, { test = selfTest, afterSwap = () => {} } = {}) {
  if (fs.existsSync(path.join(root, '.git')) || fs.existsSync(path.join(root, 'extension', 'manifest.json'))) {
    throw new Error('This is the development copy. Update it with git instead.');
  }
  const work = path.join(root, '.update');
  fs.mkdirSync(work, { recursive: true });
  const lock = path.join(work, 'lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx'); } catch {
    if (Date.now() - fs.statSync(lock).mtimeMs < 10 * 60000) throw new Error('Another update is running.');
    fs.rmSync(lock);
    fd = fs.openSync(lock, 'wx');
  }
  try {
    recover(root);
    const old = installedVersion(root);
    if (!newer(version, old)) throw new Error('That version is not newer. Nothing was changed.');
    const stage = path.join(work, 'new');
    fs.rmSync(stage, { recursive: true, force: true });
    for (const [n, b] of files) {
      const to = path.join(stage, ...n.split('/'));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, b);
    }
    const p = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
    if (p.name !== PRODUCT || p.version !== version) throw new Error('The package does not match the release. Nothing was changed.');
    await test(stage, version);

    for (const n of fs.readdirSync(work)) if (n.startsWith('backup-')) fs.rmSync(path.join(work, n), { recursive: true, force: true });
    const backup = path.join(work, `backup-${old}`);
    fs.mkdirSync(backup);
    const items = fs.readdirSync(stage).sort((a, b) => (a === 'scripts') - (b === 'scripts')); // scripts last, so this stays runnable
    const added = items.filter((n) => !fs.existsSync(path.join(root, n)));
    fs.writeFileSync(path.join(work, 'journal.json'), JSON.stringify({ backup: path.basename(backup), added }));
    try {
      for (const n of items) {
        if (fs.existsSync(path.join(root, n))) move(path.join(root, n), path.join(backup, n));
        move(path.join(stage, n), path.join(root, n));
      }
      await afterSwap(root);
    } catch (e) {
      rollBack(root, backup);
      throw new Error(`${e.message} The previous version (${old}) was put back.`);
    }
    fs.rmSync(path.join(work, 'journal.json'), { force: true });
    fs.rmSync(stage, { recursive: true, force: true });
    return { from: old, to: version };
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}
