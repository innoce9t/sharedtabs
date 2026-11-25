// Sets up the bridge for the current Windows user. No administrator rights are used.
//   (no options)     asks which agents to connect
//   --json           asks nothing and prints one JSON object; connects nothing unless told to
//   --connect a,b    connects those agents
//   --update         only registers this copy again, after an update
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { BRIDGE_VERSION, EXTENSION_ID } from '../host/shared.mjs';
import { SERVER, connect, found } from './agents.mjs';
import { CHROME_KEY, PROBE_KEY, ROOT, register, unregister, visibleToOtherApps, writeHostFiles } from './register.mjs';

const has = (f) => process.argv.includes(f);
const json = has('--json');
const update = has('--update');
const at = process.argv.indexOf('--connect');
const wanted = at > 0 ? (process.argv[at + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : [];

function fail(code, error) {
  if (json) console.log(JSON.stringify({ ok: false, code, error }, null, 2));
  else console.error(error);
  process.exit(1);
}

if (process.platform !== 'win32') fail('not_windows', 'SharedTabs supports Windows only.');
if (Number(process.versions.node.split('.')[0]) < 20) fail('old_node', `Node.js 20 or newer is needed (this is ${process.versions.node}). Get it from https://nodejs.org.`);
if (at > 0 && (!wanted.length || wanted.some((w) => !/^[a-z-]{2,30}$/.test(w)))) fail('bad_option', '--connect takes agent names such as hermes,cursor.');

// Checked before anything is written: a packaged app's private registry would make setup look done and do nothing.
let visible = false;
try {
  register(PROBE_KEY, 'probe');
  visible = visibleToOtherApps(PROBE_KEY);
} catch (e) { fail('setup_failed', `Windows did not allow the setup check: ${e.message}`); } finally { unregister(PROBE_KEY); }
if (!visible) {
  fail('hidden_from_chrome', `Windows hides settings made from here from Chrome, so nothing was changed. This happens inside some apps, such as Claude. Ask the user to open ${ROOT} in File Explorer and double-click "Set up SharedTabs", or run it in an ordinary PowerShell window.`);
}

let manifest;
try {
  manifest = writeHostFiles();
  register(CHROME_KEY, manifest);
} catch (e) { fail('setup_failed', e.message); }
if (update) {
  console.log(json ? JSON.stringify({ ok: true, bridgeVersion: BRIDGE_VERSION }) : 'SharedTabs is set up again.');
  process.exit(0);
}

const server = { name: SERVER, command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')] };
const dev = fs.existsSync(path.join(ROOT, 'extension', 'manifest.json'));
const userMustDo = [
  dev ? `In chrome://extensions, turn on Developer mode, choose Load unpacked and pick ${path.join(ROOT, 'extension')}. Its ID should be ${EXTENSION_ID}.` : 'Install the SharedTabs extension from the Chrome Web Store (the link is on https://ahsan.live/sharedtabs). Its popup should say Connected.',
  'In Chrome, read the SharedTabs setup page and decide whether to agree.',
  'In SharedTabs settings, choose which sites agents may use.',
  'Restart the AI agent so it sees the new tools.',
];

let connected = [];
if (json || wanted.length) connected = wanted.map((id) => connect(id, server));
else if (process.stdin.isTTY) {
  console.log(`SharedTabs bridge ${BRIDGE_VERSION} is set up for your Windows account.\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const yes = [];
  for (const a of found()) if (/^y(es)?$/i.test((await rl.question(`Connect ${a.name}? [y/N] `)).trim())) yes.push(a.id);
  rl.close();
  connected = yes.map((id) => connect(id, server, { interactive: true }));
}

const settings = { mcpServers: { [SERVER]: { command: server.command, args: server.args } } };
if (json) {
  console.log(JSON.stringify({ ok: true, bridgeVersion: BRIDGE_VERSION, folder: ROOT, registration: manifest, server, settings, agentsFound: found().map(({ id, name }) => ({ id, name })), connected, userMustDo, next: 'node scripts/check.mjs --json' }, null, 2));
} else {
  if (connected.length) console.log(`\n${connected.map((c) => c.message + (c.command ? `\n  ${c.command.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' ')}` : '')).join('\n')}`);
  console.log(`\nFor any other MCP agent, add this to its settings:\n${JSON.stringify(settings, null, 2)}\n\nLeft to do:\n${userMustDo.map((x, i) => `  ${i + 1}. ${x}`).join('\n')}\n`);
}
process.exit(connected.some((c) => c.status === 'failed') ? 1 : 0);
