import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bundleFiles, makeRelease } from '../scripts/bundle.mjs';
import { newKey, sign } from '../scripts/signing.mjs';
import { TOP, applyUpdate, checkForUpdate, fetchPackage, installedVersion, newer, recover, verifyRelease } from '../scripts/updater.mjs';
import { makeZip, readZip } from '../scripts/zip.mjs';

const PASS = 'correct horse battery';
const key = newKey(PASS);
const other = newKey(PASS);
const REPO = 'someone/sharedtabs-bridge';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sharedtabs update test ')); // spaces on purpose
test.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

const put = (dir, files) => { for (const [n, b] of files) { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), b); } };
const bundle = (version, publicKey = key.publicKey) => bundleFiles({ version, repo: REPO, publicKey });
let n = 0;
function install(version = '1.0.0') { const dir = path.join(tmp, `install ${++n}`); put(dir, bundle(version)); return dir; }
const snapshot = (dir) => fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => !f.startsWith('.update') && fs.statSync(path.join(dir, f)).isFile()).sort().map((f) => f + crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, f))).digest('hex')).join();

/** A stand-in for GitHub Releases. */
async function releases(routes) {
  const s = http.createServer((q, r) => { const b = routes[q.url]; if (b === undefined) { r.statusCode = 404; r.end(); } else if (typeof b === 'function') b(r); else r.end(b); });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${s.address().port}`, close: () => { s.close(); s.closeAllConnections(); } };
}
function publish(version, { files = bundle(version), signer = key, change = (m) => m, zip } = {}) {
  const rel = makeRelease(files, { version, notes: 'Better.' });
  const manifest = Buffer.from(JSON.stringify(change(JSON.parse(rel.manifest))));
  return { '/latest/download/release.json': manifest, '/latest/download/release.json.sig': sign(manifest, signer.privatePem, PASS).signature, [`/download/v${version}/sharedtabs-bridge-${version}.zip`]: zip ?? rel.zip };
}
async function attempt(root, routes, options) {
  const s = await releases(routes);
  try {
    const found = await checkForUpdate(root, s.base);
    if (!found) return null;
    return await applyUpdate(root, await fetchPackage(found), found.release.version, options);
  } finally { s.close(); }
}
/** The update must fail with this message and leave the installation exactly as it was. */
async function refused(routes, message, options) {
  const root = install();
  const before = snapshot(root);
  await assert.rejects(attempt(root, routes, options), message);
  assert.equal(snapshot(root), before);
  assert.equal(fs.existsSync(path.join(root, '.update', 'lock')), false);
}

test('version numbers', () => {
  assert.equal(newer('0.10.0', '0.9.9'), true);
  assert.equal(newer('1.0.0', '1.0.0'), false);
  for (const v of ['1.0', 'v1.0.0', '1.0.0-beta', '99999.0.0', '', null]) assert.throws(() => newer(v, '1.0.0'), undefined, String(v));
});
test('a signed newer release installs, runs, and keeps a backup', async () => {
  const root = install();
  let ran = 0;
  assert.deepEqual(await attempt(root, publish('1.1.0'), { afterSwap: () => { ran++; } }), { from: '1.0.0', to: '1.1.0' });
  assert.equal(ran, 1);
  assert.equal(installedVersion(root), '1.1.0');
  assert.deepEqual(fs.readdirSync(path.join(root, '.update')), ['backup-1.0.0']);
  await attempt(root, publish('1.2.0')); // and again, from the version just installed
  assert.equal(installedVersion(root), '1.2.0');
  assert.deepEqual(fs.readdirSync(path.join(root, '.update')), ['backup-1.1.0']);
});
test('a bridge from before this version can update to it', async () => {
  const root = install('0.6.0');
  for (const f of ['INSTALL-WITH-AI.md', 'README.md', 'Check SharedTabs.cmd', 'scripts/check.mjs', 'scripts/agents.mjs']) fs.rmSync(path.join(root, f));
  fs.writeFileSync(path.join(root, 'README.txt'), 'old');
  await attempt(root, publish('1.1.0'));
  assert.equal(installedVersion(root), '1.1.0');
  assert.ok(fs.existsSync(path.join(root, 'INSTALL-WITH-AI.md')));
});
test('nothing newer', async () => {
  for (const v of ['1.0.0', '0.9.0']) { const root = install(); assert.equal(await attempt(root, publish(v)), null); assert.equal(installedVersion(root), '1.0.0'); }
});

test('signed by someone else', () => refused(publish('1.1.0', { signer: other }), /not signed by the makers/));
test('description changed after signing', () => { const r = publish('1.1.0'); r['/latest/download/release.json'] = Buffer.from(r['/latest/download/release.json'].toString().replace('Better', 'Worse!')); return refused(r, /not signed by the makers/); });
test('no or junk signature', async () => {
  for (const s of ['', 'AAAA', 'not base64 !!']) { const r = publish('1.1.0'); r['/latest/download/release.json.sig'] = s; await refused(r, /not signed by the makers/); }
  const r = publish('1.1.0'); delete r['/latest/download/release.json.sig'];
  await refused(r, /No release was found/);
});
test('file swapped for another one', () => refused(publish('1.1.0', { zip: makeRelease(bundle('1.1.0', other.publicKey), { version: '1.1.0' }).zip }), /larger than expected|does not match the signed release/));
test('file changed by one byte', () => { const r = publish('1.1.0'); const k = '/download/v1.1.0/sharedtabs-bridge-1.1.0.zip'; const b = Buffer.from(r[k]); b[200] ^= 1; r[k] = b; return refused(r, /does not match the signed release/); });
test('endless download is cut off', () => { const r = publish('1.1.0'); r['/download/v1.1.0/sharedtabs-bridge-1.1.0.zip'] = (res) => { const t = setInterval(() => res.write(Buffer.alloc(200000)), 1); res.on('close', () => clearInterval(t)); }; return refused(r, /larger than expected/); });
test('an old signed release replayed under a new number is refused', () => refused(publish('1.1.0', { files: bundle('0.9.0') }), /does not match the release/));
test('signed descriptions must still make sense', async () => {
  for (const c of [{ product: 'other' }, { product: 'sharedtabs-bridge-windows' }, { version: '2' }, { file: '..\\evil.zip' }, { file: 'https://evil.example/x.zip' }, { sha256: 'x' }, { size: 0 }, { size: 1e9 }, { notes: 5 }]) {
    await refused(publish('1.1.0', { change: (m) => ({ ...m, ...c }) }), /something else|not a version|not valid/);
  }
});
test('an older release cannot be installed even if the check is skipped', async () => {
  await assert.rejects(applyUpdate(install('2.0.0'), bundle('1.9.0'), '1.9.0'), /not newer/);
});
test('packages may only hold plain bridge files', () => {
  const zip = (name) => makeZip(new Map([['package.json', Buffer.from('{}')], [name, Buffer.from('x')]]));
  for (const name of ['../evil.mjs', 'host/../../evil', '/etc/x', 'C:/x', 'host\\..\\x', 'host/a:b', 'host/con', 'host/nul.txt', 'host/x.', 'host/x ', 'evil.exe', '.git/config', 'node_modules/x.js', 'host//x', '', 'HOST/x']) {
    assert.throws(() => readZip(zip(name), TOP), /not valid/, name);
  }
  assert.throws(() => readZip(makeZip(new Map([['host/a.mjs', Buffer.from('1')], ['host/A.mjs', Buffer.from('2')]])), TOP), /appears twice/);
  assert.throws(() => readZip(makeZip(new Map([['host/a', Buffer.alloc(5_000_001)]])), TOP), /too large/);
  assert.throws(() => readZip(Buffer.from('junk'.repeat(50)), TOP), /not valid/);
  const lying = makeZip(new Map([['host/a', Buffer.alloc(1000)]])); // claims to be smaller than it is
  lying.writeUInt32LE(10, lying.indexOf(Buffer.from('PK\x01\x02', 'latin1')) + 24);
  assert.throws(() => readZip(lying, TOP));
  for (const [k, b] of readZip(makeZip(bundle('1.0.0')), TOP)) assert.deepEqual(b, bundle('1.0.0').get(k), k);
});
test('a new version that does not start is refused', async () => {
  for (const [file, body] of [['mcp/server.mjs', 'process.exit(3)'], ['mcp/server.mjs', 'setInterval(() => {}, 1000); console.log("{}")'], ['host/host.mjs', 'this is not javascript'], ['scripts/update.mjs', 'import {']]) {
    const f = bundle('1.1.0'); f.set(file, Buffer.from(body));
    await refused(publish('1.1.0', { files: f }), /did not start|wrong number|damaged/);
  }
});
test('if setting up the new version fails, the old one is put back and still works', async () => {
  const f = bundle('1.1.0'); f.set('LICENSE.txt', Buffer.from('new file'));
  await refused(publish('1.1.0', { files: f }), /Setup broke.*1\.0\.0.*put back/, { afterSwap: () => { throw new Error('Setup broke.'); } });
});
test('a cut-off update is undone next time', async () => {
  const root = install();
  fs.rmSync(path.join(root, 'LICENSE.txt')); // the new version adds it back
  const before = snapshot(root);
  const backup = path.join(root, '.update', 'backup-1.0.0'); // as a power cut would leave it
  fs.mkdirSync(backup, { recursive: true });
  for (const d of ['host', 'mcp', 'package.json']) fs.renameSync(path.join(root, d), path.join(backup, d));
  put(root, new Map([...bundle('1.1.0')].filter(([k]) => k.startsWith('host/'))));
  fs.writeFileSync(path.join(root, 'LICENSE.txt'), 'new');
  fs.writeFileSync(path.join(root, '.update', 'journal.json'), JSON.stringify({ backup: 'backup-1.0.0', added: ['LICENSE.txt'] }));
  assert.equal(recover(root), true);
  assert.equal(snapshot(root), before);
  assert.equal(recover(root), false);
  for (const bad of ['..', '.', 'x', 'backup-1.0.0/../..']) {
    fs.writeFileSync(path.join(root, '.update', 'journal.json'), JSON.stringify({ backup: bad, added: [] }));
    assert.throws(() => recover(root), /journal is not valid/, bad);
  }
});
test('development copies, two updates at once, and copies with no key', async () => {
  const dev = install(); fs.mkdirSync(path.join(dev, '.git'));
  await assert.rejects(applyUpdate(dev, bundle('1.1.0'), '1.1.0'), /development copy/);
  const busy = install(); fs.mkdirSync(path.join(busy, '.update')); fs.writeFileSync(path.join(busy, '.update', 'lock'), '');
  await assert.rejects(applyUpdate(busy, bundle('1.1.0'), '1.1.0'), /Another update is running/);
  const bare = path.join(tmp, 'bare'); put(bare, bundleFiles({ version: '1.0.0' }));
  await assert.rejects(checkForUpdate(bare, 'http://127.0.0.1:1'), /no update address/);
});
test('only our kind of key is accepted', () => {
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => verifyRelease(Buffer.from('{}'), crypto.sign('sha256', Buffer.from('{}'), rsa.privateKey).toString('base64'), rsa.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')), /key is not valid/);
});

/** As a double-click runs it: by full path, in a folder with spaces. */
const runCmd = (dir, name = 'Update') => spawnSync('cmd.exe', ['/d', '/s', '/c', `""${path.join(dir, `${name} SharedTabs.cmd`)}""`], { cwd: os.tmpdir(), encoding: 'utf8', input: '\r\n', windowsVerbatimArguments: true });
test('the update command survives being replaced while it runs', () => {
  const dir = path.join(tmp, 'self replace'); put(dir, bundleFiles({ version: '1.0.0' }));
  fs.writeFileSync(path.join(dir, 'scripts', 'update.mjs'), "import fs from 'node:fs'; fs.writeFileSync('Update SharedTabs.cmd', '@echo off\\r\\n'.repeat(80) + 'echo WRONG > wrong.txt\\r\\n'.repeat(40)); console.log('replaced');");
  assert.match(runCmd(dir).stdout, /replaced/);
  assert.equal(fs.existsSync(path.join(dir, 'wrong.txt')), false);
});
test('the commands a user double-clicks', () => {
  const dir = path.join(tmp, 'cmd copy'); put(dir, bundleFiles({ version: '1.0.0' }));
  const r = runCmd(dir);
  assert.match(r.stdout + r.stderr, /no update address/);
  assert.match(runCmd(dir, 'Check').stdout, /Left to do|SharedTabs is working/);
  for (const f of ['Set up', 'Check', 'Update', 'Remove']) assert.equal(fs.readFileSync(path.join(dir, `${f} SharedTabs.cmd`), 'utf8').trim().split('\n').length, 1, f);
});
