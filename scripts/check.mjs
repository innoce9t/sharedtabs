// Says whether SharedTabs is working, and what is left to do. Changes nothing.
// --json prints one JSON object. Exit code: 0 working, 2 waiting for the user, 1 something is broken.
import fs from 'node:fs';
import path from 'node:path';
import { BRIDGE_VERSION } from '../host/shared.mjs';
import { Bridge } from '../mcp/bridge.mjs';
import { CHROME_KEY, ROOT, registered } from './register.mjs';

const checks = [];
const add = (name, ok, detail, fix) => checks.push({ name, ok, detail, ...(ok ? {} : { fix }) });

add('Windows', process.platform === 'win32', process.platform, 'SharedTabs supports Windows only.');
add('Node.js 20 or newer', Number(process.versions.node.split('.')[0]) >= 20, process.versions.node, 'Install a newer Node.js from https://nodejs.org.');
const manifest = registered(CHROME_KEY);
let points = '';
try { points = fs.readFileSync(JSON.parse(fs.readFileSync(manifest, 'utf8')).path, 'utf8'); } catch { /* reported next */ }
add('Registered with Chrome', !!points, manifest || 'not registered', 'Run: node scripts/install.mjs --json');
add('Registration uses this folder', points.includes(path.join(ROOT, 'host', 'host.mjs')), ROOT, 'This folder moved, or another copy is set up. Run: node scripts/install.mjs --json');

const bridge = new Bridge();
bridge.client = 'SharedTabs check';
let status = null;
try { status = await bridge.call('status', {}, { patience: 1500, timeout: 5000 }); } catch { /* reported next */ }
bridge.close();
const waiting = [];
if (!status) waiting.push('In Chrome, install the SharedTabs extension (or turn it off and on in chrome://extensions) and check that its popup says Connected.');
else {
  if (status.setupFinished === false) waiting.push('In Chrome, open the SharedTabs popup, choose Finish setup, read the page and decide whether to agree.');
  if (status.sitePermission === 'none') waiting.push('In SharedTabs settings, choose which sites agents may use.');
  if (status.stoppedByUser) waiting.push('SharedTabs is stopped. Choose Resume agents in its popup when ready.');
}
const broken = checks.some((c) => !c.ok);
const result = { ok: !broken && !waiting.length, bridgeVersion: BRIDGE_VERSION, checks, chromeConnected: !!status, extension: status, userMustDo: waiting };
if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
else {
  for (const c of checks) console.log(`${c.ok ? 'OK  ' : 'FIX '} ${c.name}${c.ok ? '' : `\n     ${c.fix}`}`);
  console.log(`${status ? 'OK  ' : 'WAIT'} Chrome connected`);
  console.log(result.ok ? '\nSharedTabs is working.' : `\nLeft to do:\n${[...checks.filter((c) => !c.ok).map((c) => c.fix), ...waiting].map((x) => `  - ${x}`).join('\n')}`);
}
process.exit(broken ? 1 : waiting.length ? 2 : 0);
