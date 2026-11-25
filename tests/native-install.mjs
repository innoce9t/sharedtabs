// Installs, updates, breaks and removes the Windows bridge for real, in a throwaway folder and registry key,
// with programs signed by a throwaway key and a stand-in for GitHub Releases. Takes a few minutes: it builds
// several versions. Never touches a real installation.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { build } from '../scripts/build-native.mjs';
import { makeRelease } from '../scripts/release.mjs';
import { newKey, sign } from '../scripts/signing.mjs';

const PASS = 'correct horse battery';
const key = newKey(PASS);
const other = newKey(PASS);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sharedtabs native test ')); // spaces on purpose
const target = path.join(os.tmpdir(), 'sharedtabs-native-test-target');
const REG = `Software\\SharedTabsTest${process.pid}`;
const raw = (k) => Buffer.from(k.publicKey, 'base64').subarray(-32).toString('base64');
const exes = {};
for (const [name, version, extra] of [['1.0.0', '1.0.0', {}], ['1.1.0', '1.1.0', {}], ['broken', '1.2.0', { SHAREDTABS_TEST_BREAK: '1' }]]) {
  const exe = build(['build'], { target, stamp: version, env: { SHAREDTABS_VERSION: version, SHAREDTABS_UPDATE: JSON.stringify({ repo: 'someone/sharedtabs', publicKey: raw(key) }), ...extra } });
  exes[name] = path.join(tmp, `${name}.exe`);
  fs.copyFileSync(exe, exes[name]);
}

const routes = {};
const server = http.createServer((q, r) => { const b = routes[q.url]; if (b === undefined) { r.statusCode = 404; r.end(); } else if (typeof b === 'function') b(r, q); else r.end(b); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let n = 0;
let dir; let env;
const exe = () => path.join(dir, 'sharedtabs.exe');
const run = (file, args) => new Promise((resolve) => { // asynchronous, so the stand-in server can answer
  const c = spawn(file, args, { env });
  let out = '';
  c.stdout.on('data', (d) => { out += d; });
  c.on('close', (code) => resolve({ code, out: out.trim() }));
});
const reg = (k, v) => { const r = spawnSync('reg', ['query', `HKCU\\${REG}\\${k}`, ...(v ? ['/v', v] : ['/ve'])], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.match(/REG_\w+\s+(.*)/)?.[1].trim() : null; };
const CHROME = 'Software\\Google\\Chrome\\NativeMessagingHosts\\com.hermes.chrome_bridge';
const UNINSTALL = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SharedTabs';
const version = () => reg(UNINSTALL, 'DisplayVersion');
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
async function fresh(v = '1.0.0') {
  dir = path.join(tmp, `install ${++n}`);
  env = { ...process.env, SHAREDTABS_TEST_DIR: dir, SHAREDTABS_TEST_REGISTRY: REG, SHAREDTABS_TEST_RELEASES: base, HERMES_CHROME_STATE: path.join(tmp, 'state') };
  const r = await run(exes[v], ['install', '/S']);
  assert.equal(r.code, 0, r.out);
}
function publish(v, file, { signer = key, change = (m) => m, body } = {}) {
  for (const k of Object.keys(routes)) delete routes[k];
  const data = fs.readFileSync(file);
  const m = Buffer.from(JSON.stringify(change(JSON.parse(makeRelease(data, { version: v, notes: 'Better.' })))));
  Object.assign(routes, { '/latest/download/release.json': m, '/latest/download/release.json.sig': sign(m, signer.privatePem, PASS).signature, [`/download/v${v}/SharedTabsSetup-${v}.exe`]: body ?? data });
}
async function refused(why) {
  const before = [hash(exe()), version()];
  const r = await run(exe(), ['update', '/S']);
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, why);
  assert.deepEqual([hash(exe()), version()], before);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('update-')), []);
  return r;
}
let failed = 0;
async function step(name, fn) { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 8).join('\n     ')}`); } }

try {
  await step('installs for this user, and registers itself', async () => {
    await fresh();
    assert.equal(version(), '1.0.0');
    const manifest = reg(CHROME);
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert.equal(m.path, exe());
    assert.match(m.allowed_origins[0], /^chrome-extension:\/\/[a-p]{32}\/$/);
    assert.match(reg(UNINSTALL, 'UninstallString'), /^".*sharedtabs\.exe" uninstall$/);
    assert.ok(fs.existsSync(path.join(dir, 'SharedTabs Bridge.lnk')));
    assert.equal((await run(exe(), ['selftest'])).out, 'sharedtabs 1.0.0 ok');
  });
  await step('installing again over itself is fine', async () => {
    assert.equal((await run(exes['1.0.0'], ['install', '/S'])).code, 0);
    assert.equal((await run(exe(), ['install', '/S'])).code, 0);
    assert.equal(version(), '1.0.0');
  });
  await step('a signed newer release installs while the old one is still running', async () => {
    await fresh();
    publish('1.1.0', exes['1.1.0']);
    const agent = spawn(exe(), ['mcp'], { env });
    const ask = (id) => new Promise((res) => { agent.stdout.once('data', (d) => res(JSON.parse(d))); agent.stdin.write(`{"jsonrpc":"2.0","id":${id},"method":"initialize","params":{}}\n`); });
    assert.equal((await ask(1)).result.serverInfo.version, '1.0.0');
    const r = await run(exe(), ['update', '/S']);
    assert.equal(r.out, 'Updated to 1.1.0');
    assert.equal(version(), '1.1.0');
    assert.equal(hash(exe()), hash(exes['1.1.0']));
    assert.equal((await ask(2)).result.serverInfo.version, '1.0.0'); // keeps working until it restarts
    agent.kill();
    await new Promise((s) => setTimeout(s, 500));
    assert.equal((await run(exe(), ['install', '/S'])).code, 0); // tidies the old copy
    assert.deepEqual(fs.readdirSync(dir).sort(), ['SharedTabs Bridge.lnk', 'com.hermes.chrome_bridge.json', 'sharedtabs.exe']);
  });
  await step('nothing newer', async () => {
    await fresh('1.1.0');
    for (const [v, f] of [['1.1.0', '1.1.0'], ['1.0.0', '1.0.0']]) { publish(v, exes[f]); assert.equal((await run(exe(), ['update', '/S'])).out, 'You have the newest version.'); }
    assert.equal(version(), '1.1.0');
  });
  await step('signed by someone else', async () => { await fresh(); publish('1.1.0', exes['1.1.0'], { signer: other }); await refused(/not signed by the makers/); });
  await step('description changed after signing', async () => { publish('1.1.0', exes['1.1.0']); routes['/latest/download/release.json'] = Buffer.from(String(routes['/latest/download/release.json']).replace('Better', 'Worse!')); await refused(/not signed by the makers/); });
  await step('signature missing or junk', async () => {
    publish('1.1.0', exes['1.1.0']); delete routes['/latest/download/release.json.sig']; await refused(/No release was found/);
    for (const s of ['', 'AAAA', 'A'.repeat(88)]) { publish('1.1.0', exes['1.1.0']); routes['/latest/download/release.json.sig'] = s; await refused(/not signed by the makers/); }
  });
  await step('program changed by one byte', async () => { const b = Buffer.from(fs.readFileSync(exes['1.1.0'])); b[5000] ^= 1; publish('1.1.0', exes['1.1.0'], { body: b }); await refused(/does not match the signed release/); });
  await step('endless download is cut off', async () => { publish('1.1.0', exes['1.1.0'], { body: (r) => { const t = setInterval(() => r.write(Buffer.alloc(300000)), 1); r.on('close', () => clearInterval(t)); } }); await refused(/larger than expected/); });
  await step('a download that stops early', async () => { publish('1.1.0', exes['1.1.0'], { body: (r) => r.end(Buffer.alloc(1000)) }); await refused(/does not match the signed release/); });
  await step('an old signed program under a newer number', async () => { publish('1.3.0', exes['1.0.0']); await refused(/did not start, so nothing was changed/); });
  await step('a signed file that is not a program', async () => { const f = path.join(tmp, 'x'); fs.writeFileSync(f, 'hello'); publish('1.1.0', f); await refused(/did not start, so nothing was changed/); });
  await step('another product, or a description that makes no sense', async () => {
    for (const c of [{ product: 'sharedtabs-bridge' }, { file: '..\\..\\evil.exe' }, { version: '1.1' }, { size: 9e9 }, { sha256: 'x' }]) { publish('1.1.0', exes['1.1.0'], { change: (m) => ({ ...m, ...c }) }); await refused(/something else|not valid/); }
  });
  await step('server errors and wrong redirects', async () => {
    publish('1.1.0', exes['1.1.0']);
    routes['/latest/download/release.json'] = (r) => { r.statusCode = 500; r.end(); };
    await refused(/download failed \(500\)/);
    for (const k of Object.keys(routes)) delete routes[k];
    await refused(/No release was found/);
  });
  await step('if setting up the new version fails, the old one is put back and works', async () => {
    await fresh();
    publish('1.2.0', exes.broken);
    await refused(/failed\. The previous version was put back/);
    assert.equal((await run(exe(), ['selftest'])).out, 'sharedtabs 1.0.0 ok');
    assert.ok(fs.existsSync(reg(CHROME)));
  });
  await step('removal leaves nothing behind, even while running from its own folder', async () => {
    await fresh();
    fs.writeFileSync(path.join(dir, 'mine.txt'), 'x'); // someone else's file is not ours to delete
    assert.equal((await run(exe(), ['uninstall', '/S'])).code, 0);
    await new Promise((s) => setTimeout(s, 4500));
    assert.equal(reg(CHROME), null);
    assert.equal(version(), null);
    assert.deepEqual(fs.readdirSync(dir), ['mine.txt']);
    await fresh();
    await run(exe(), ['uninstall', '/S']);
    await new Promise((s) => setTimeout(s, 4500));
    assert.equal(fs.existsSync(dir), false);
  });
  await step('removal keeps a registration that something else has taken over', async () => {
    await fresh();
    execFileSync('reg', ['add', `HKCU\\${REG}\\${CHROME}`, '/ve', '/d', 'C:\\dev\\other.json', '/f']);
    await run(exe(), ['uninstall', '/S']);
    assert.equal(reg(CHROME), 'C:\\dev\\other.json');
  });
  await step('refuses to install where Windows would hide it, such as from inside a packaged app', async () => {
    // Only meaningful where this happens, such as a terminal inside the Claude app. Uses a name no real install has.
    const d = path.join(process.env.LOCALAPPDATA, 'Programs', `SharedTabsTest${process.pid}`);
    fs.mkdirSync(path.join(process.env.LOCALAPPDATA, 'Programs'), { recursive: true });
    const check = path.join(process.env.LOCALAPPDATA, `probe${process.pid}`);
    fs.writeFileSync(check, '');
    const hidden = fs.readdirSync(path.join(process.env.LOCALAPPDATA, 'Packages')).some((p) => fs.existsSync(path.join(process.env.LOCALAPPDATA, 'Packages', p, 'LocalCache', 'Local', `probe${process.pid}`)));
    fs.rmSync(check);
    const r = spawnSync(exes['1.0.0'], ['install', '/S'], { encoding: 'utf8', env: { ...process.env, SHAREDTABS_TEST_DIR: d, SHAREDTABS_TEST_REGISTRY: REG } });
    if (hidden) {
      assert.equal(r.status, 1);
      assert.match(r.stdout, /private copy/);
      assert.equal(fs.existsSync(d), false);
    } else {
      assert.equal(r.status, 0, r.stdout);
      console.log('     (files are not hidden here, so only the ordinary case was checked)');
    }
    fs.rmSync(d, { recursive: true, force: true });
  });
} finally {
  server.close(); server.closeAllConnections();
  spawnSync('reg', ['delete', `HKCU\\${REG}`, '/f'], { stdio: 'ignore' });
  await new Promise((s) => setTimeout(s, 1500));
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
