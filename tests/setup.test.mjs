import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { addToSettings } from '../scripts/agents.mjs';
import { bundleFiles } from '../scripts/bundle.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sharedtabs setup test '));
const REG = `Software\\SharedTabsTest${process.pid}`;
test.after(() => { spawnSync('reg', ['delete', `HKCU\\${REG}`, '/f'], { stdio: 'ignore' }); fs.rmSync(tmp, { recursive: true, force: true }); });
const server = { command: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\x y\\server.mjs'] };

test('agent settings: added, everything else kept, backed up', () => {
  const f = path.join(tmp, 'new', 'mcp.json');
  addToSettings(f, server);
  assert.deepEqual(JSON.parse(fs.readFileSync(f)), { mcpServers: { 'shared-tabs': server } });
  const g = path.join(tmp, 'g.json');
  const before = '\ufeff{\n "z": 1,\n "mcpServers": { "other": { "command": "x" } },\n "a": [1, {"b": null}]\n}';
  fs.writeFileSync(g, before);
  addToSettings(g, server);
  addToSettings(g, server);
  const j = JSON.parse(fs.readFileSync(g));
  assert.deepEqual(Object.keys(j), ['z', 'mcpServers', 'a']);
  assert.deepEqual(j.mcpServers, { other: { command: 'x' }, 'shared-tabs': server });
  assert.ok(fs.existsSync(`${g}.sharedtabs-backup`));
});
test('agent settings we do not understand are left exactly as they were', () => {
  for (const bad of ['{ // comment\n }', '[]', '{"mcpServers": []}', '{"a":', '"x"', 'null']) {
    const h = path.join(tmp, 'h.json');
    fs.writeFileSync(h, bad);
    assert.throws(() => addToSettings(h, server), /left alone/, bad);
    assert.equal(fs.readFileSync(h, 'utf8'), bad);
  }
});

const dir = path.join(tmp, 'My Bridge');
for (const [n, b] of bundleFiles({ version: '1.0.0' })) { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), b); }
const state = path.join(tmp, 'state');
const run = (script, ...args) => {
  const r = spawnSync(process.execPath, [path.join('scripts', script), '--json', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, SHAREDTABS_TEST_REGISTRY: REG, HERMES_CHROME_STATE: state } });
  return { code: r.status, out: JSON.parse(r.stdout), err: r.stderr };
};

test('setup as an AI runs it: one JSON object, asks nothing, connects nobody by itself', () => {
  const r = run('install.mjs');
  assert.equal(r.err, '');
  if (r.out.code === 'hidden_from_chrome') { // inside an app such as Claude
    assert.equal(r.code, 1);
    assert.match(r.out.error, /nothing was changed.*double-click "Set up SharedTabs"/s);
    assert.equal(fs.existsSync(state), false); // really nothing
    return;
  }
  assert.equal(r.code, 0);
  assert.equal(r.out.ok, true);
  assert.deepEqual(r.out.connected, []);
  assert.equal(r.out.server.args[0], path.join(dir, 'mcp', 'server.mjs'));
  assert.ok(r.out.userMustDo.some((s) => /decide whether to agree/.test(s)));
  assert.equal(run('check.mjs').out.checks.every((c) => c.ok), true);
  assert.equal(run('uninstall.mjs').out.removed, true);
});
test('check says what is wrong without changing anything', () => {
  const r = run('check.mjs');
  assert.equal(r.code, 1);
  assert.equal(r.out.ok, false);
  assert.ok(r.out.checks.some((c) => c.name === 'Registered with Chrome' && !c.ok && /install\.mjs/.test(c.fix)));
  assert.ok(r.out.userMustDo.some((s) => /install the SharedTabs extension/.test(s)));
});
test('bad options and unknown agents', () => {
  assert.equal(run('install.mjs', '--connect', 'a;b').out.code, 'bad_option');
  assert.equal(run('install.mjs', '--connect', '../x').out.code, 'bad_option');
});
test('updating without --yes, as an AI might, changes nothing', () => {
  const r = spawnSync(process.execPath, [path.join('scripts', 'update.mjs')], { cwd: dir, encoding: 'utf8' });
  assert.match(r.stdout + r.stderr, /no update address/);
});
test('the guide an AI follows names real files, commands and codes', () => {
  const guide = fs.readFileSync(path.join(dir, 'INSTALL-WITH-AI.md'), 'utf8');
  for (const m of guide.matchAll(/node (scripts\/[a-z]+\.mjs)/g)) assert.ok(fs.existsSync(path.join(dir, m[1])), m[1]);
  const install = fs.readFileSync(path.join(dir, 'scripts', 'install.mjs'), 'utf8');
  for (const code of ['hidden_from_chrome', 'old_node', 'not_windows', 'setup_failed']) { assert.ok(guide.includes(`\`${code}\``)); assert.ok(install.includes(`'${code}'`)); }
  for (const rule of ['Ask first', 'Leave these to the user', "Don't get around protections"]) assert.ok(guide.includes(rule), rule);
  const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  for (const m of readme.matchAll(/\*\*((?:Set up|Check|Update|Remove) SharedTabs)\*\*/g)) assert.ok(fs.existsSync(path.join(dir, `${m[1]}.cmd`)), m[1]);
  assert.ok(!/\{\{/.test(guide + readme));
});
