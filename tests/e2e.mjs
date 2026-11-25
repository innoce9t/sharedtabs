// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
// End to end: MCP server -> named pipe -> native host -> extension -> pages, in Chrome for Testing
// with a throwaway profile. Set CHROME_FOR_TESTING to its chrome.exe. Registers the host under
// "Chrome for Testing" only, and removes it afterwards.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { EXTENSION_ID, HOST_NAME } from '../host/shared.mjs';
import { ROOT, register, unregister, writeHostFiles } from '../scripts/register.mjs';
import { Mcp } from './helpers.mjs';

const CHROME = process.env.CHROME_FOR_TESTING;
if (!CHROME) throw new Error('Set CHROME_FOR_TESTING');
const KEYS = [`HKCU\\Software\\Google\\Chrome for Testing\\NativeMessagingHosts\\${HOST_NAME}`, `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-chrome-e2e-'));
const state = path.join(tmp, 'state');
const uploadDir = path.join(tmp, 'uploads');
const downloads = path.join(tmp, 'downloads');
fs.mkdirSync(uploadDir);
const big = path.join(uploadDir, 'film.mp4');
fs.writeFileSync(big, Buffer.alloc(3_000_000, 7));
fs.writeFileSync(path.join(uploadDir, 'cv.pdf'), '%PDF-1.4 test');
fs.writeFileSync(path.join(uploadDir, 'photo.png'), 'png');
fs.writeFileSync(path.join(uploadDir, '.env'), 'SECRET=1');
const EXT = process.env.EXTENSION_DIR || path.join(ROOT, 'extension');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out: ${what}`);
    await sleep(150);
  }
}

const PAGE = `<!doctype html><title>Form</title><body style="margin:20px">
<h1>Hello</h1><p>Some page text</p>
<button id=b onclick="out.textContent='clicked '+(++n)">Press me</button>
<button id=al onclick="out.textContent='confirm '+confirm('Sure?')">Ask</button>
<input id=name placeholder="Your name" oninput="echo.textContent=this.value">
<input id=pw type=password placeholder="Secret" value="hunter2">
<input id=otp autocomplete="one-time-code" placeholder="Code">
<select id=s onchange="echo.textContent='picked '+this.value"><option value=1>One</option><option value=2>Two</option></select>
<a href="/next">Next page</a><a id=x>No href</a>
<iframe srcdoc="<input id=i autofocus>" style="width:150px;height:40px"></iframe>
<p id=out></p><p id=echo></p>
<div style="position:relative"><button>Covered</button><div style="position:absolute;inset:0;background:#ccc">veil</div></div>
<div style="height:3000px"></div><button onclick="out.textContent='far'">Far button</button>
<script>n=0;console.log('loaded')</script>`;
const server = http.createServer((q, r) => {
  if (q.url === '/job') { r.setHeader('content-type', 'text/html'); return r.end(`<!doctype html><title>Job</title><body style="margin:0"><h1>Apply</h1><div style="height:900px"></div>
    <iframe src="http://localhost:${other}/form" style="width:500px;height:700px;border:7px solid;padding:5px"></iframe>
    <iframe srcdoc="<p>inline words</p><button onclick='this.textContent=&quot;inline done&quot;'>Inline</button>"></iframe>`); }
  if (q.url === '/swap') { r.setHeader('content-type', 'text/html'); return r.end(`<!doctype html><title>Swap</title><div id=h><input id=a placeholder="Swap search"></div><div id=h2><input id=b placeholder="Trap"></div>
    <div id=h3><input id=c placeholder="Jump"></div><div id=h4><input id=d placeholder="Vanish"></div><div style="height:200px"></div><input id=far placeholder="Elsewhere"><p id=o></p><script>
    a.onfocus=()=>setTimeout(()=>{h.innerHTML='<input id=n2 placeholder=New>';n2.oninput=()=>{o.textContent='got '+n2.value};n2.focus()},300);
    b.onfocus=()=>setTimeout(()=>{h2.innerHTML='<input id=p2 type=password>';p2.focus()},150);
    c.onfocus=()=>setTimeout(()=>{c.remove();far.focus()},150);d.oninput=()=>d.remove();far.oninput=()=>{o.textContent='far '+far.value}</script>`); }
  if (q.url === '/trap') { r.setHeader('content-type', 'text/html'); return r.end('<!doctype html><title>Trap</title><body style="margin:40px"><button id=b onclick="o.textContent=1">Real button</button><p id=o></p><div id=v style="display:none;position:fixed;inset:0;background:#eee">veil</div><script>addEventListener("mousedown",()=>{});addEventListener("pointermove",()=>setTimeout(()=>{v.style.display="block"},0))</script>'); }
  if (q.url === '/busy') { r.setHeader('content-type', 'text/html'); return r.end('<!doctype html><title>Busy</title><body style="margin:0"><canvas id=c width=1900 height=4000></canvas><script>const g=c.getContext("2d"),d=g.createImageData(1900,4000);for(let i=0;i<d.data.length;i++)d.data[i]=i%4===3?255:Math.random()*256;g.putImageData(d,0,0)</script>'); }
  if (q.url === '/play') { r.setHeader('content-type', 'text/html'); return r.end(`<!doctype html><title>Play</title><style>#menu{display:none}#m:hover #menu{display:block}</style><body style="margin:20px">
    <div id=m><button>Products</button><div id=menu>secret menu</div></div>
    <input type=search name=q placeholder="Type here"><button>Apply now</button><button>Cancel</button><a href="/next">Pricing plans</a>
    <div id=slider style="width:300px;height:30px;background:#ddd;position:relative"><div id=knob tabindex=0 aria-label="Knob" style="width:30px;height:30px;background:#333;position:absolute;left:0"></div></div>
    <div id=card draggable=true tabindex=0 aria-label="Card" style="width:80px;height:30px;background:#fc9">card</div><div id=bin tabindex=0 aria-label="Bin" style="width:200px;height:60px;background:#9cf">bin</div>
    <div id=zone tabindex=0 aria-label="Dropzone" style="width:200px;height:60px;background:#cfc">drop files</div><div tabindex=0 aria-label="Plain area" style="width:200px;height:40px">plain</div>
    <p id=line>one two three</p><button id=mod>Modkey</button><p id=o></p>
    <script>let down=null;knob.onmousedown=e=>{down=e.clientX};onmousemove=e=>{if(down!==null)knob.style.left=(e.clientX-down)+'px'};onmouseup=()=>{if(down!==null){down=null;o.textContent='knob '+parseInt(knob.style.left)}};
    card.ondragstart=e=>e.dataTransfer.setData('text/plain','card!');bin.ondragover=e=>e.preventDefault();bin.ondrop=e=>{e.preventDefault();o.textContent='binned '+e.dataTransfer.getData('text/plain')};
    zone.ondragover=e=>e.preventDefault();zone.ondrop=e=>{e.preventDefault();o.textContent='dropped '+[...e.dataTransfer.files].map(f=>f.name+':'+f.size).join()};
    mod.onclick=e=>{o.textContent='mod '+[e.ctrlKey,e.shiftKey,e.detail]};line.onclick=()=>{o.textContent='sel '+getSelection()};
    onkeydown=e=>{if(e.key==='ArrowDown')window.k=(window.k||0)+1,o.textContent='downs '+k};console.error('bad thing');console.log('fine thing')</script>`); }
  if (q.url === '/upload') { r.setHeader('content-type', 'text/html'); return r.end(`<!doctype html><title>Upload</title>
    <label for=f>CV</label><input id=f type=file style="display:none" onchange="show(this)">
    <input id=m type=file multiple aria-label="Extras" onchange="show(this)"><button onclick="const i=document.createElement('input');i.type='file';i.onchange=()=>show(i);i.click()">Choose file</button>
    <p id=o></p><script>async function show(i){const r=[];for(const f of i.files){const b=new Uint8Array(await f.arrayBuffer());r.push(f.name+'|'+f.type+'|'+b.length+'|'+b[b.length-1])}o.textContent='GOT '+r.join(' ; ')}</script>`); }
  if (q.url === '/redirect') { r.writeHead(302, { location: `http://localhost:${other}/` }); return r.end(); }
  r.setHeader('content-type', 'text/html');
  r.end(q.url.startsWith('/next') ? '<title>Next</title><p>Second page</p><script>fetch("/api?token=abc")</script>' : PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const server2 = http.createServer((q, r) => {
  r.setHeader('content-type', 'text/html');
  r.end(q.url === '/form' ? `<!doctype html><title>Form</title><body style="margin:10px"><p>frame words</p><input id=n placeholder="Full name" oninput="o.textContent='name '+value">
    <input type=password placeholder="Frame secret"><select onchange="o.textContent='chose '+value"><option>Red</option><option>Blue</option></select><div style="height:500px"></div>
    <button onclick="o.textContent='sent'">Send form</button><input type=file aria-label="Frame CV" onchange="o.textContent='file '+files[0].name"><p id=o></p>`
    : '<title>Other</title>other site secret');
});
await new Promise((r) => server2.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const other = server2.address().port;

// Minimal DevTools client, used only to press buttons in the extension's own windows.
async function page(match) {
  const list = await (await fetch(`http://127.0.0.1:${devPort}/json`)).json();
  const t = list.find((x) => x.url.includes(match));
  if (!t) return null;
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let lastId = 0;
  return {
    async eval(expression) {
      const id = ++lastId; // a late reply must never be taken for a newer command's
      const p = new Promise((r) => { ws.addEventListener('message', function on(e) { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener('message', on); r(m); } }); });
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
      const m = await p;
      if (m.result.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description);
      return m.result.result.value;
    },
    close: () => ws.close(),
  };
}
const ui = async (m) => {
  const r = await (await optionsPage()).eval(`chrome.runtime.sendMessage(${JSON.stringify(m)})`);
  if (r?.error) throw new Error(r.error);
  if (!r?.ok) throw new Error(`no answer to ${m.type}: ${JSON.stringify(r)}`);
  // The settings the agent meets must be the ones just chosen.
  if (m.type === 'setUploads') assert.match((await mcp.tool('status')).text, new RegExp(`"uploads": "${m.mode}"`));
  if (m.type === 'setPermission') assert.match((await mcp.tool('status')).text, new RegExp(`"sitePermission": "${m.mode}"`));
};
const settings = (allowed, blocked = ['*bank*', 'chase.com']) => ui({ type: 'saveSettings', allowed, blocked, folders: [uploadDir], allowEvaluate: false });

let chrome; let mcp; let devPort; let failed = 0;
async function step(name, fn) {
  const t0 = Date.now();
  const took = () => ` (${((Date.now() - t0) / 1000).toFixed(1)}s)`;
  try { await fn(); console.log(`ok   ${name}${took()}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 6).join('\n     ')}`); }
}
const refOf = (outline, label) => {
  const line = outline.split('\n').find((l) => l.includes(label) && l.includes('[ref='));
  if (!line) throw new Error(`no ref for ${label} in:\n${outline}`);
  return line.match(/\[ref=(\w+)\]/)[1];
};

try {
  const manifest = writeHostFiles(state, { HERMES_CHROME_STATE: state, HERMES_CHROME_DOWNLOADS: downloads });
  if (process.env.BRIDGE_EXE) {
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    fs.writeFileSync(manifest, JSON.stringify({ ...m, path: path.resolve(process.env.BRIDGE_EXE) }));
    Object.assign(process.env, { HERMES_CHROME_STATE: state, HERMES_CHROME_DOWNLOADS: downloads }); // Chrome passes these on
  }
  for (const k of KEYS) register(k, manifest);
  chrome = spawn(CHROME, [`--user-data-dir=${path.join(tmp, 'profile')}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    `--load-extension=${EXT}`, '--window-size=1100,800', 'about:blank'], { stdio: 'ignore' });
  devPort = await until(() => fs.readFileSync(path.join(tmp, 'profile', 'DevToolsActivePort'), 'utf8').split('\n')[0], 'Chrome');
  mcp = new Mcp({ HERMES_CHROME_STATE: state });
  await mcp.request('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'Test Agent', version: '1' } });

  await step('connects with no token', () => until(async () => !(await mcp.tool('status')).error, 'bridge', 30000));
  await step('pipe allows only this user', () => {
    const e = JSON.parse(fs.readFileSync(path.join(state, 'endpoints', fs.readdirSync(path.join(state, 'endpoints'))[0])));
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `
      $p=New-Object IO.Pipes.NamedPipeClientStream('.','${e.pipe.split('\\').pop()}',[IO.Pipes.PipeDirection]::InOut);$p.Connect(3000)
      $p.GetAccessControl().GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|%{"$($_.AccessControlType) $($_.IdentityReference.Value)"}
      'me '+[Security.Principal.WindowsIdentity]::GetCurrent().User.Value`], { encoding: 'utf8' }).trim().split(/\r?\n/);
    const me = out.pop().slice(3);
    assert.deepEqual(out.sort(), [`Allow ${me}`, 'Deny S-1-5-2']);
  });
  await step('nothing works until the user agrees, and the page opens by itself', async () => {
    const p = await until(() => page('welcome.html'), 'welcome page');
    assert.match((await mcp.tool('status')).text, /"setupFinished": false/);
    for (const [t, a] of [['list_tabs', {}], ['open_tab', { url: `${base}/` }], ['get_text', { tabId: 1 }]]) assert.match((await mcp.tool(t, a)).text, /not turned on yet/);
    await until(() => p.eval(`document.getElementById('agree') && !document.getElementById('agree').disabled && !!document.getElementById('agree').onclick`), 'ready');
    await p.eval(`document.getElementById('agree').click()`);
    await until(async () => /"setupFinished": true/.test((await mcp.tool('status')).text), 'agreed');
  });
  await step('the tool list comes from the extension, and versions are reported', async () => {
    const own = await (await optionsPage()).eval(`import('./tools.js').then((m) => m.TOOLS.map((t) => t.name).sort().join())`);
    const { result } = await mcp.request('tools/list');
    assert.equal(result.tools.map((t) => t.name).sort().join(), own);
    assert.equal(result.tools.length, process.env.EXTENSION_DIR ? 26 : 27);
    const s = (await mcp.tool('status')).text;
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'))).version;
    assert.match(s, new RegExp(`"bridge": "${v}"`));
    assert.match(s, /"bridgeUpdateAvailable": false/);
  });
  await step('the extension checks arguments itself, for callers that skip the MCP server', async () => {
    const { Bridge } = await import('../mcp/bridge.mjs');
    const e = JSON.parse(fs.readFileSync(path.join(state, 'endpoints', fs.readdirSync(path.join(state, 'endpoints'))[0])));
    const net = await import('node:net');
    const raw = (method, params) => new Promise((res, rej) => { const c = net.connect(e.pipe, () => c.write(JSON.stringify({ id: 1, method, params }) + '\n')); c.once('data', (d) => { c.destroy(); res(JSON.parse(d)); }); c.on('error', rej); });
    assert.ok(Bridge);
    assert.match((await raw('click', { tabId: 'x' })).error, /must be integer/);
    assert.match((await raw('open_tab', { url: 'https://example.com', extra: 1 })).error, /Unknown argument/);
    assert.match((await raw('constructor', {})).error, /Unknown tool/);
    assert.match((await raw('batch', { actions: [{ tool: 'status' }] })).error, /Unknown tool|not turned on|must/);
  });
  await step('no tabs visible at first', async () => assert.match((await mcp.tool('list_tabs')).text, /No tabs are shared/));
  await step('blocked and non-web URLs refused', async () => {
    assert.match((await mcp.tool('open_tab', { url: 'https://www.chase.com' })).text, /blocked list/);
    assert.match((await mcp.tool('open_tab', { url: 'chrome://settings' })).text, /only http/);
    assert.match((await mcp.tool('open_tab', { url: 'javascript:alert(1)' })).text, /only http/);
  });
  await step('nothing is allowed until the user chooses', async () => {
    assert.match((await mcp.tool('status')).text, /"sitePermission": "none"/);
    assert.match((await mcp.tool('open_tab', { url: `${base}/` })).text, /settings do not allow 127\.0\.0\.1/);
  });

  let tab;
  await step('Allow specific, chosen in the settings page, opens listed sites without asking', async () => {
    const opt = await optionsPage();
    await opt.eval(`document.querySelector('input[value=specific]').click()`);
    await until(() => opt.eval(`!document.getElementById('specific').hidden`), 'allowed list shown');
    await opt.eval(`(() => { const a = document.getElementById('allowed'); a.value = '127.0.0.1'; a.dispatchEvent(new Event('input')); document.getElementById('save').click(); })()`);
    await until(() => opt.eval(`document.getElementById('done').textContent === 'Saved.'`), 'saved');
    const r = await mcp.tool('open_tab', { url: `${base}/` });
    assert.equal(r.error, false, r.text);
    tab = Number(r.text.match(/"tabId": (\d+)/)[1]);
    assert.match((await mcp.tool('open_tab', { url: `http://localhost:${other}/` })).text, /settings do not allow localhost/);
    assert.equal(await page('approve'), null);
  });
  const read = async (args = {}) => (await mcp.tool('read_page', { tabId: tab, ...args })).text;
  await step('read page hides the password', async () => {
    const t = await read();
    assert.match(t, /Untrusted web content/);
    assert.match(t, /heading1/);
    assert.match(t, /Some page text/);
    assert.doesNotMatch(t, /hunter2/);
  });
  await step('click by ref in a background tab', async () => {
    const r = await mcp.tool('click', { tabId: tab, ref: refOf(await read(), 'Press me') });
    assert.equal(r.error, false, r.text);
    assert.match(await read(), /clicked 1/);
  });
  await step('click and screenshot at 150% zoom', async () => {
    const opt = await optionsPage();
    await opt.eval(`chrome.tabs.setZoom(${tab}, 1.5)`);
    try {
      await sleep(500);
      const r = await mcp.tool('click', { tabId: tab, ref: refOf(await read(), 'Press me') });
      assert.equal(r.error, false, r.text);
      assert.match(await read(), /clicked 2/);
      const s = await mcp.tool('screenshot', { tabId: tab });
      assert.equal(s.error, false, s.text);
    } finally {
      await opt.eval(`chrome.tabs.setZoom(${tab}, 1)`);
      await sleep(500);
    }
  });
  await step('clicks that land or navigate give no warning', async () => {
    const t = await read();
    const nav = await mcp.tool('click', { tabId: tab, ref: refOf(t, 'Next page') });
    assert.match(nav.text, /next/);
    assert.doesNotMatch(nav.text, /did not register/);
    await mcp.tool('navigate', { tabId: tab, url: `${base}/` });
    const r = await mcp.tool('click', { tabId: tab, ref: refOf(await read(), 'Press me') });
    assert.doesNotMatch(r.text, /did not register/);
  });
  await step('scrolls to a far element to click it', async () => {
    await mcp.tool('click', { tabId: tab, ref: refOf(await read(), 'Far button') });
    assert.match(await read(), /\bfar\b/);
  });
  await step('covered element is refused', async () => assert.match((await mcp.tool('click', { tabId: tab, ref: refOf(await read(), 'Covered') })).text, /covered by/));
  await step('type, then replace', async () => {
    const ref = refOf(await read(), 'Your name');
    await mcp.tool('type_text', { tabId: tab, ref, text: 'Ada' });
    const r = await mcp.tool('type_text', { tabId: tab, ref, text: 'Grace é', clear: true });
    assert.equal(r.error, false, r.text);
    assert.match(await read(), /value="Grace é"/);
  });
  await step('password and code fields refused', async () => {
    const t = await read();
    assert.match((await mcp.tool('type_text', { tabId: tab, ref: refOf(t, 'Secret'), text: 'x' })).text, /password field/);
    assert.match((await mcp.tool('type_text', { tabId: tab, ref: refOf(t, 'Code'), text: '1' })).text, /one-time code/);
    await mcp.tool('click', { tabId: tab, ref: refOf(t, 'Secret') });
    assert.match((await mcp.tool('type_text', { tabId: tab, text: 'x' })).text, /password field/);
    assert.match((await mcp.tool('press_key', { tabId: tab, key: 'x' })).text, /password field/);
    assert.match((await mcp.tool('press_key', { tabId: tab, key: 'Control+v' })).text, /Clipboard/);
  });
  await step('select an option', async () => {
    const t = await read();
    const ref = t.split('\n').find((l) => l.includes('combobox')).match(/\[ref=(\w+)\]/)[1];
    await mcp.tool('set_value', { tabId: tab, ref, value: 'Two' });
    assert.match(await read(), /picked 2/);
  });
  await step('screenshot of a background tab matches the viewport', async () => {
    const r = await mcp.tool('screenshot', { tabId: tab });
    assert.equal(r.error, false, r.text);
    assert.equal(r.image.mimeType, 'image/jpeg');
    fs.writeFileSync(path.join(os.tmpdir(), 'hermes-chrome-shot.jpg'), Buffer.from(r.image.data, 'base64'));
  });
  await step('scroll', async () => {
    const r = await mcp.tool('scroll', { tabId: tab, direction: 'up', amount: 20 });
    assert.equal(r.error, false, r.text);
  });
  await step('dialog reported and answered', async () => {
    const ref = refOf(await read(), '"Ask"').toString();
    const r = await mcp.tool('click', { tabId: tab, ref });
    assert.match(r.text, /A dialog opened \(confirm: "Sure\?"\)/);
    assert.match((await mcp.tool('read_page', { tabId: tab })).text, /dialog is open/);
    await mcp.tool('handle_dialog', { tabId: tab, accept: true });
    assert.match(await read(), /confirm true/);
  });
  await step('evaluate is off', async () => assert.match((await mcp.tool('evaluate', { tabId: tab, expression: '1' })).text, process.env.EXTENSION_DIR ? /Unknown tool/ : /turned off/));
  await step('the JavaScript switch applies at once, and saving lists leaves it alone', async () => {
    const opt = await optionsPage();
    if (process.env.EXTENSION_DIR) { assert.equal(await opt.eval(`document.getElementById('evaluate') === null`), true); return; }
    const on = async (v) => { await opt.eval(`document.getElementById('evaluate').click()`); await until(async () => new RegExp(`"javascriptAllowed": ${v}`).test((await mcp.tool('status')).text), `JavaScript ${v}`, 4000); };
    await on(true);
    assert.match((await mcp.tool('evaluate', { tabId: tab, expression: '1 + 1' })).text, /2/);
    await opt.eval(`document.getElementById('save').click()`);
    await until(() => opt.eval(`document.getElementById('done').textContent === 'Saved.'`), 'saved');
    assert.match((await mcp.tool('status')).text, /"javascriptAllowed": true/);
    await on(false);
    assert.match((await mcp.tool('evaluate', { tabId: tab, expression: '1 + 1' })).text, /turned off/);
  });
  await step('console', async () => assert.match((await mcp.tool('read_console', { tabId: tab })).text, /loaded/));
  await step('network, with query values removed', async () => {
    await mcp.tool('read_network', { tabId: tab });
    const old = refOf(await read(), 'Press me');
    const r = await mcp.tool('navigate', { tabId: tab, url: `${base}/next` });
    assert.match(r.text, /Next/);
    const n = (await until(async () => { const x = await mcp.tool('read_network', { tabId: tab }); return x.text.includes('/api') && x; }, 'request logged')).text;
    assert.match(n, /api\?token=…/);
    assert.doesNotMatch(n, /=abc/);
    assert.match((await mcp.tool('click', { tabId: tab, ref: old })).text, /no longer on the page/);
  });
  await step('redirect to a site that is not listed cannot be read', async () => {
    await mcp.tool('navigate', { tabId: tab, url: `${base}/redirect` });
    for (const t of ['read_page', 'get_text', 'screenshot', 'read_console']) {
      const r = await mcp.tool(t, { tabId: tab });
      assert.equal(r.error, true, t);
      assert.doesNotMatch(r.text, /other site secret/);
    }
    await mcp.tool('navigate', { tabId: tab, url: `${base}/` });
  });
  const go = (u) => mcp.tool('navigate', { tabId: tab, url: `${base}${u}` });
  const up = (ref, ...paths) => mcp.tool('upload_file', { tabId: tab, ref, paths });
  await step('uploads are off until chosen', async () => {
    await go('/upload');
    assert.match((await up(refOf(await read(), '"CV"'), path.join(uploadDir, 'cv.pdf'))).text, /uploads are turned off/);
  });
  await step('upload settings page', async () => {
    const opt = await optionsPage();
    await opt.eval(`document.querySelector('input[value=folders]').click()`);
    await until(() => opt.eval(`!document.getElementById('uploadFolders').hidden`), 'folder list shown');
    await opt.eval(`(() => { const a = document.getElementById('folders'); a.value = ${JSON.stringify(`"${uploadDir}"`)}; a.dispatchEvent(new Event('input')); document.getElementById('save').click(); })()`);
    await until(() => opt.eval(`document.getElementById('done').textContent === 'Saved.'`), 'saved');
  });
  await step('upload to a hidden file input', async () => {
    const r = await up(refOf(await read(), '"CV"'), path.join(uploadDir, 'cv.pdf'));
    assert.equal(r.error, false, r.text);
    await until(async () => /GOT cv\.pdf\|application\/pdf\|13\|116/.test(await read()), 'page got the pdf', 5000);
  });
  await step('several files of other types, one large', async () => {
    const r = await up(refOf(await read(), '"Extras"'), big, path.join(uploadDir, 'photo.png'));
    assert.equal(r.error, false, r.text);
    await until(async () => /GOT film\.mp4\|video\/mp4\|3000000\|7 ; photo\.png\|image\/png\|3\|103/.test(await read()), 'page got both', 5000);
    assert.match((await up(refOf(await read(), '"CV"'), big, path.join(uploadDir, 'photo.png'))).text, /takes one file/);
  });
  await step('upload through a button that opens the picker', async () => {
    const r = await up(refOf(await read(), 'Choose file'), path.join(uploadDir, 'photo.png'));
    assert.equal(r.error, false, r.text);
    await until(async () => /GOT photo\.png\|image\/png\|3\|103/.test(await read()), 'page got the photo', 5000);
  });
  await step('uploads outside the folder, secrets and odd paths refused', async () => {
    const ref = refOf(await read(), '"CV"');
    assert.match((await up(ref, path.join(ROOT, 'README.md'))).text, /not in a folder/);
    assert.match((await up(ref, path.join(uploadDir, '..', 'state', 'host.log'))).text, /not in a folder/);
    assert.match((await up(ref, path.join(uploadDir, '.env'))).text, /can't be uploaded/);
    assert.match((await up(ref, '\\\\server\\share\\a.pdf')).text, /full local path/);
    assert.match((await mcp.tool('click', { tabId: tab, ref })).text, /Use upload_file/);
  });
  await step('Any file covers other folders, still not secrets or app data', async () => {
    await ui({ type: 'setUploads', mode: 'any' });
    const ref = refOf(await read(), '"CV"');
    assert.equal((await up(ref, path.join(ROOT, 'README.md'))).error, false);
    assert.match((await up(ref, path.join(tmp, 'state', 'host.log'))).text, /protected folder/);
    await ui({ type: 'setUploads', mode: 'folders' });
  });
  const reload = async () => { await go('/play'); return read(); };
  await step('hover opens a hover menu', async () => {
    const t = await reload();
    assert.doesNotMatch(t, /secret menu/);
    const r = await mcp.tool('hover', { tabId: tab, ref: refOf(t, 'Products') });
    assert.equal(r.error, false, r.text);
    assert.match(await read(), /secret menu/);
  });
  await step('find by description', async () => {
    const f = async (query) => (await mcp.tool('find', { tabId: tab, query })).text.split('\n')[2];
    assert.match(await f('search box'), /Type here/);
    assert.match(await f('apply button'), /Apply now/);
    assert.match(await f('submit button'), /Apply now/);
    assert.match(await f('pricing link'), /Pricing plans/);
    assert.match(await f('zebra crossing'), /Nothing matched/);
    const ref = (await f('apply button')).match(/\[ref=(\w+)\]/)[1];
    assert.equal((await mcp.tool('click', { tabId: tab, ref })).error, false);
  });
  await step('drag a slider, and drag and drop', async () => {
    let t = await reload();
    const knob = await mcp.tool('scroll_to', { tabId: tab, ref: refOf(t, '"Knob"') });
    const [x, y] = knob.text.match(/at (\d+), (\d+)/).slice(1).map(Number);
    const r = await mcp.tool('drag', { tabId: tab, ref: refOf(t, '"Knob"'), toX: x + 120, toY: y });
    assert.equal(r.error, false, r.text);
    assert.match(await read(), /knob 1[12]\d/);
    t = await read();
    const d = await mcp.tool('drag', { tabId: tab, ref: refOf(t, '"Card"'), toRef: refOf(t, '"Bin"') });
    assert.equal(d.error, false, d.text);
    assert.match(await read(), /binned card!/);
  });
  await step('drop files on a drop area', async () => {
    const t = await reload();
    const r = await mcp.tool('upload_file', { tabId: tab, ref: refOf(t, '"Dropzone"'), drop: true, paths: [path.join(uploadDir, 'cv.pdf'), path.join(uploadDir, 'photo.png')] });
    assert.equal(r.error, false, r.text);
    assert.match(await read(), /dropped cv\.pdf:13,photo\.png:3/);
    assert.match((await mcp.tool('upload_file', { tabId: tab, ref: refOf(t, '"Plain area"'), drop: true, paths: [path.join(uploadDir, 'cv.pdf')] })).text, /did not accept/);
    const before = (await mcp.tool('status')).text;
    const outside = await mcp.tool('upload_file', { tabId: tab, ref: refOf(t, '"Dropzone"'), drop: true, paths: [path.join(ROOT, 'README.md')] });
    assert.match(outside.text, /not in a folder/, `settings before: ${before}\nresult: ${outside.text}\nsettings after: ${(await mcp.tool('status')).text}`);
  });
  await step('modifiers, triple click, repeated keys', async () => {
    const t = await reload();
    await mcp.tool('click', { tabId: tab, ref: refOf(t, 'Modkey'), modifiers: 'ctrl+shift', clicks: 2 });
    assert.match(await read(), /mod true,true,2/);
    const p = await page('/play'); const at = await p.eval(`(() => { const r = line.getBoundingClientRect(); return { x: r.x + 30, y: r.y + 8 }; })()`); p.close();
    await mcp.tool('click', { tabId: tab, ...at, clicks: 3 });
    assert.match(await read(), /sel one two three/);
    await mcp.tool('press_key', { tabId: tab, key: 'ArrowDown', repeat: 3 });
    assert.match(await read(), /downs 3/);
    assert.match((await mcp.tool('press_key', { tabId: tab, key: 'Tab Control+v' })).text, /Clipboard/);
  });
  await step('zoom and small screenshots', async () => {
    const dims = (r) => { const b = Buffer.from(r.image.data, 'base64'); if (r.image.mimeType === 'image/png') return [b.readUInt32BE(16), b.readUInt32BE(20)]; for (let i = 2; ;) { const m = b[i + 1]; if (m >= 0xc0 && m <= 0xc2) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + b.readUInt16BE(i + 2); } };
    const full = await mcp.tool('screenshot', { tabId: tab });
    const half = await mcp.tool('screenshot', { tabId: tab, scale: 0.5 });
    assert.ok(Math.abs(dims(half)[0] * 2 - dims(full)[0]) <= 2);
    assert.deepEqual(dims(await mcp.tool('zoom', { tabId: tab, x: 10, y: 10, width: 300, height: 100 })), [1200, 400]);
    assert.match((await mcp.tool('zoom', { tabId: tab, x: 9000, y: 10, width: 300, height: 100 })).text, /outside/);
  });
  await step('console and network filters', async () => {
    await mcp.tool('read_console', { tabId: tab });
    await go('/play');
    assert.match((await mcp.tool('read_console', { tabId: tab, onlyErrors: true })).text, /bad thing/);
    assert.doesNotMatch((await mcp.tool('read_console', { tabId: tab, onlyErrors: true })).text, /fine thing/);
    assert.match((await mcp.tool('read_console', { tabId: tab, pattern: 'FINE', clear: true })).text, /fine thing/);
    assert.doesNotMatch((await mcp.tool('read_console', { tabId: tab })).text, /thing/);
    await mcp.tool('read_network', { tabId: tab });
    await go('/next');
    await until(async () => /api/.test((await mcp.tool('read_network', { tabId: tab, urlPattern: '/api' })).text), 'api call');
    assert.doesNotMatch((await mcp.tool('read_network', { tabId: tab, urlPattern: '/api' })).text, /GET \d+ \S+next/);
  });
  await step('batch runs in order, returns images, stops at the first error', async () => {
    await go('/');
    const t = await read();
    const { result: r } = await mcp.request('tools/call', { name: 'batch', arguments: { actions: [
      { tool: 'type_text', args: { tabId: tab, ref: refOf(t, 'Your name'), text: 'Batch' } }, { tool: 'screenshot', args: { tabId: tab, scale: 0.3 } },
      { tool: 'get_text', args: { tabId: tab } }, { tool: 'type_text', args: { tabId: tab, ref: refOf(t, 'Secret'), text: 'x' } }, { tool: 'click', args: { tabId: tab, ref: refOf(t, 'Press me') } }] } });
    assert.equal(r.isError, true);
    assert.equal(r.content.filter((c) => c.type === 'image').length, 1);
    const all = JSON.stringify(r.content);
    assert.match(all, /password field.*1 later steps were not run/);
    assert.doesNotMatch(await read(), /clicked 1/);
    assert.match(await read(), /value="Batch"/);
  });
  await step('indicator shows, stays out of what agents read, and can be turned off', async () => {
    const count = async () => { const p = await page('127.0.0.1:' + server.address().port + '/'); const n = await p.eval(`[...document.documentElement.children].filter((e) => e.tagName === 'DIV' && e.getAttribute('aria-hidden') === 'true').length`); p.close(); return n; };
    await mcp.tool('get_text', { tabId: tab });
    assert.equal(await count(), 1);
    assert.doesNotMatch((await mcp.tool('get_text', { tabId: tab })).text, /agent is using/);
    await until(async () => (await count()) === 0, 'indicator removed', 8000);
    await ui({ type: 'setIndicator', on: false });
    await mcp.tool('get_text', { tabId: tab });
    assert.equal(await count(), 0);
    await ui({ type: 'setIndicator', on: true });
  });
  await step('resize the window', async () => assert.match((await mcp.tool('resize_window', { tabId: tab, width: 1000, height: 760 })).text, /1000 x 760/));
  await step('record and save a GIF', async () => {
    await mcp.tool('record', { tabId: tab, action: 'start' });
    await mcp.tool('click', { tabId: tab, ref: refOf(await read(), 'Press me') });
    await mcp.tool('scroll', { tabId: tab, direction: 'down' });
    assert.match((await mcp.tool('record', { tabId: tab, action: 'stop' })).text, /3 frames/);
    await mcp.tool('scroll', { tabId: tab, direction: 'up' });
    const r = await mcp.tool('record', { tabId: tab, action: 'save' });
    assert.equal(r.error, false, r.text);
    const [name] = fs.readdirSync(downloads);
    assert.match(name, /^agent-recording-\d{8}-\d{6}-[0-9a-f]{4}\.gif$/);
    const g = fs.readFileSync(path.join(downloads, name));
    assert.equal(g.toString('latin1', 0, 6), 'GIF89a');
    assert.equal(g[g.length - 1], 0x3b);
    assert.ok(g.length > 3000 && g.length < 2_000_000, String(g.length));
    if (process.env.KEEP_GIF) fs.copyFileSync(path.join(downloads, name), process.env.KEEP_GIF);
    assert.match((await mcp.tool('record', { tabId: 1, action: 'start' })).text, /not shared/);
  });
  await step('typing follows a field the page swaps on focus, but not to a password field or elsewhere', async () => {
    await go('/swap');
    const t = await read();
    const r = await mcp.tool('type_text', { tabId: tab, ref: refOf(t, 'Swap search'), text: 'hello' });
    assert.equal(r.error, false, r.text);
    assert.match(await read(), /got hello/);
    const late = await mcp.tool('type_text', { tabId: tab, ref: refOf(t, 'Vanish'), text: 'x', submit: true });
    assert.match(late.text, /replaced the field while typing, so Enter was not pressed/);
    assert.match((await mcp.tool('type_text', { tabId: tab, ref: refOf(t, 'Trap'), text: 'x' })).text, /password field/);
    assert.match((await mcp.tool('type_text', { tabId: tab, ref: refOf(t, 'Jump'), text: 'x' })).text, /did not focus/);
    assert.doesNotMatch(await read(), /far x/);
    await go('/');
  });
  await step('record a large, colourful page and save it', async () => {
    await go('/busy');
    await mcp.tool('resize_window', { tabId: tab, width: 1900, height: 1060 });
    await mcp.tool('record', { tabId: tab, action: 'start' });
    for (const direction of ['down', 'down', 'up']) await mcp.tool('scroll', { tabId: tab, direction });
    const t0 = Date.now();
    const { result } = await mcp.request('tools/call', { name: 'batch', arguments: { actions: [{ tool: 'record', args: { tabId: tab, action: 'stop' } }, { tool: 'record', args: { tabId: tab, action: 'save' } }] } });
    assert.equal(result.isError, false, JSON.stringify(result.content));
    const file = result.content.at(-1).text.match(/Saved (.+\.gif)/)[1];
    const size = fs.statSync(file).size;
    assert.ok(size > 500_000, String(size));
    if (process.env.SHOW) console.log(`     ${size} bytes in ${Date.now() - t0} ms`);
    await mcp.tool('resize_window', { tabId: tab, width: 1000, height: 760 });
    await go('/');
  });
  await step('side panel: activity with the agent name and no typed text', async () => {
    await fetch(`http://127.0.0.1:${devPort}/json/new?chrome-extension://${EXTENSION_ID}/sidepanel.html`, { method: 'PUT' });
    const p = await until(() => page('sidepanel.html'), 'side panel');
    const log = await until(() => p.eval(`document.querySelectorAll('#log .what').length > 3 && document.getElementById('log').innerText`), 'activity');
    assert.match(log, /Test Agent/);
    assert.match(log, /record/i);
    assert.doesNotMatch(log, /Batch/);
    await fetch(`http://127.0.0.1:${devPort}/json/close/${(await (await fetch(`http://127.0.0.1:${devPort}/json`)).json()).find((t) => t.url.includes('sidepanel')).id}`);
  });
  await step('embedded site that is not allowed is not read, typed in or clicked', async () => {
    await go('/job');
    const t = await read();
    assert.doesNotMatch(t, /frame words/);
    assert.match(t, /do not allow them: localhost/);
    assert.match(t, /inline words/);
    await mcp.tool('scroll', { tabId: tab, direction: 'down', amount: 20 });
    await sleep(300);
    // Straight after scrolling, and again later: wherever the frame is, no click may land in it.
    const at = await (async () => { const p = await page('/job'); const v = await p.eval(`(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return { x: r.x + 200, y: Math.max(r.y, 0) + 100 }; })()`); p.close(); return v; })();
    for (let i = 0; i < 3; i++) assert.match((await mcp.tool('click', { tabId: tab, x: at.x, y: at.y })).text, /embedded frame the user's settings do not allow/);
    await mcp.tool('scroll', { tabId: tab, direction: 'up', amount: 4 });
    const r = await mcp.tool('click', { tabId: tab, x: at.x, y: at.y });
    assert.doesNotMatch(r.text, /did not register/, r.text);
  });
  await step('embedded form on an allowed site: read, type, choose, click, upload', async () => {
    await settings(['127.0.0.1', 'localhost']);
    await go('/job');
    let t = await until(async () => { const x = await read(); return x.includes('frame words') && x; }, 'frame read');
    const typed = await mcp.tool('type_text', { tabId: tab, ref: refOf(t, 'Full name'), text: 'Ada L' });
    assert.equal(typed.error, false, typed.text);
    assert.match(await read(), /name Ada L/);
    const again = await mcp.tool('type_text', { tabId: tab, ref: refOf(t, 'Full name'), text: 'Grace', clear: true });
    assert.equal(again.error, false, again.text);
    assert.match(await read(), /name Grace/);
    assert.match((await mcp.tool('type_text', { tabId: tab, ref: refOf(t, 'Frame secret'), text: 'x' })).text, /password field/);
    await mcp.tool('set_value', { tabId: tab, ref: t.split('\n').find((l) => l.includes('combobox')).match(/\[ref=(\w+)\]/)[1], value: 'Blue' });
    assert.match(await read(), /chose Blue/);
    const c = await mcp.tool('click', { tabId: tab, ref: refOf(t, 'Send form') });
    assert.doesNotMatch(c.text, /did not register/);
    assert.match(await read(), /sent/);
    const u = await up(refOf(t, 'Frame CV'), path.join(uploadDir, 'cv.pdf'));
    assert.equal(u.error, false, u.text);
    assert.match(await read(), /file cv\.pdf/);
    const i = await mcp.tool('click', { tabId: tab, ref: refOf(t, '"Inline"') });
    assert.equal(i.error, false, i.text);
    assert.match(await read(), /inline done/);
    assert.match((await mcp.tool('wait', { tabId: tab, text: 'frame words', seconds: 1 })).text, /is on the page/);
    const s = await mcp.tool('press_key', { tabId: tab, key: 'Escape' });
    assert.equal(s.error, false, s.text);
  });
  await step('a click taken by something that appeared is not called a success', async () => {
    await go('/trap');
    const c = await mcp.tool('click', { tabId: tab, ref: refOf(await read(), 'Real button') });
    assert.match(c.text, /Something else on the page received the click|covered by/);
    await go('/job');
    await until(async () => (await read()).includes('frame words'), 'frame read');
  });
  await step('taking the embedded site away stops it at once', async () => {
    const t = await read();
    await settings(['127.0.0.1']);
    assert.match((await mcp.tool('click', { tabId: tab, ref: refOf(t, 'Send form') })).text, /do not allow the embedded site/);
    assert.match((await up(refOf(t, 'Frame CV'), path.join(uploadDir, 'cv.pdf'))).text, /do not allow the embedded site/);
    await go('/');
  });
  await step('unshared tab is invisible and unusable', async () => {
    const opt = await optionsPage();
    const id = await opt.eval(`chrome.tabs.create({ url: '${base}/', active: false }).then((t) => t.id)`);
    await sleep(800);
    assert.doesNotMatch((await mcp.tool('list_tabs')).text, new RegExp(String(id)));
    assert.match((await mcp.tool('get_text', { tabId: id })).text, /not shared/);
    await opt.eval(`chrome.runtime.sendMessage({ type: 'share', tabId: ${id} })`);
    assert.match((await mcp.tool('get_text', { tabId: id })).text, /Some page text/);
    assert.match((await mcp.tool('close_tab', { tabId: id })).text, /only close tabs they opened/);
    await opt.eval(`chrome.runtime.sendMessage({ type: 'unshare', tabId: ${id} })`);
    assert.match((await mcp.tool('get_text', { tabId: id })).text, /not shared/);
  });
  await step('Allow all covers other sites but not blocked ones', async () => {
    await ui({ type: 'setPermission', mode: 'all' });
    const r = await mcp.tool('navigate', { tabId: tab, url: `http://localhost:${other}/` });
    assert.match(r.text, /Other/);
    assert.match((await mcp.tool('get_text', { tabId: tab })).text, /other site secret/);
    assert.match((await mcp.tool('open_tab', { url: 'https://www.chase.com' })).text, /blocked list/);
  });
  await step('Not allowed takes effect on an open tab at once', async () => {
    const p = mcp.tool('wait', { tabId: tab, text: 'never appears', seconds: 10 });
    await sleep(600);
    await ui({ type: 'setPermission', mode: 'none' });
    assert.match((await p).text, /settings do not allow/);
    assert.match((await mcp.tool('screenshot', { tabId: tab })).text, /settings do not allow/);
  });
  await step('Allow until Chrome closes is kept in session storage only', async () => {
    await ui({ type: 'setPermission', mode: 'session' });
    assert.match((await mcp.tool('status')).text, /"sitePermission": "session"/);
    assert.match((await mcp.tool('get_text', { tabId: tab })).text, /other site secret/);
    const opt = await optionsPage();
    assert.equal(await opt.eval(`chrome.storage.local.get('mode').then((s) => s.mode)`), 'none');
    assert.equal(await opt.eval(`chrome.storage.session.clear().then(() => chrome.runtime.sendMessage({ type: 'state' })).then((r) => r.ok.permission)`), 'none');
    // Clearing session storage also forgot the tab group, as closing Chrome would.
    assert.match((await mcp.tool('get_text', { tabId: tab })).text, /not shared/);
    await ui({ type: 'setPermission', mode: 'specific' });
    const r = await mcp.tool('open_tab', { url: `${base}/` });
    tab = Number(r.text.match(/"tabId": (\d+)/)[1]);
  });
  await step('pages cannot change the permission', async () => {
    await assert.rejects(ui({ type: 'setPermission', mode: 'everything' }), /Unknown permission/);
    assert.match((await mcp.tool('open_tab', { url: `chrome-extension://${EXTENSION_ID}/options.html` })).text, /only http/);
  });
  await step('sites always allowed in 0.1.0 become the specific list', async () => {
    const opt = await optionsPage();
    const got = await opt.eval(`(async () => {
      const old = await chrome.storage.local.get(null);
      await chrome.storage.local.remove(['mode', 'allowed']);
      await chrome.storage.local.set({ sites: { 'https://a.example.com': 'allow', 'https://b.example.com': 'deny', 'http://a.example.com:81': 'allow' }, chatKey: 'old', chatUrl: 'x', chatModel: 'y' });
      return Object.keys(old).length;
    })()`);
    assert.ok(got > 0);
    // Chrome disables unpacked extensions on reload unless Developer mode is on.
    await fetch(`http://127.0.0.1:${devPort}/json/new?chrome://extensions`, { method: 'PUT' });
    const ext = await until(() => page('chrome://extensions'), 'extensions page');
    await until(() => ext.eval(`chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }).then(() => true)`), 'developer mode');
    await ext.eval(`chrome.developerPrivate.reload('${EXTENSION_ID}', { failQuietly: true }).then(() => true)`);
    await sleep(3000);
    await until(async () => { // a tab opened while the extension was down stays on an error page
      const list = await (await fetch(`http://127.0.0.1:${devPort}/json`)).json();
      for (const t of list) if (t.url.includes('options.html')) await fetch(`http://127.0.0.1:${devPort}/json/close/${t.id}`);
      return list.some((t) => t.type === 'service_worker' && t.url.includes(EXTENSION_ID));
    }, 'service worker back', 15000);
    const s = await until(async () => (await optionsPage()).eval(`chrome.runtime.sendMessage({ type: 'state' }).then((r) => ({ p: r.ok.permission, a: r.ok.allowed, l: r.ok.link.state }))`).then((v) => v.l === 'connected' && v), 'reconnected after reload', 30000);
    assert.deepEqual([s.p, s.a], ['specific', ['a.example.com']]);
    assert.equal(await (await optionsPage()).eval(`chrome.storage.local.get(null).then((s) => Object.keys(s).filter((k) => k.startsWith('chat')).length)`), 0);
    await settings(['127.0.0.1']);
    const r = await until(async () => { const x = await mcp.tool('open_tab', { url: `${base}/` }); return !x.error && x; }, 'tab after reload');
    tab = Number(r.text.match(/"tabId": (\d+)/)[1]);
  });
  await step('two Hermes processes at once', async () => {
    const second = new Mcp({ HERMES_CHROME_STATE: state });
    const [a, b] = await Promise.all([mcp.tool('get_text', { tabId: tab }), second.tool('get_text', { tabId: tab })]);
    second.close();
    assert.match(a.text, /Some page text/);
    assert.match(b.text, /Some page text/);
  });
  await step('Stop halts work in progress, and Resume restores it', async () => {
    const opt = await optionsPage();
    const p = mcp.tool('wait', { tabId: tab, text: 'never appears', seconds: 15 });
    await sleep(800);
    await opt.eval(`chrome.runtime.sendMessage({ type: 'stop' })`);
    assert.match((await p).text, /pressed Stop|stopped/);
    assert.match((await mcp.tool('get_text', { tabId: tab })).text, /stopped agents/);
    assert.match((await mcp.tool('status')).text, /"stoppedByUser": true/);
    await opt.eval(`chrome.runtime.sendMessage({ type: 'resume' })`);
    assert.match((await mcp.tool('get_text', { tabId: tab })).text, /Some page text/);
  });
  await step('web pages cannot message the extension', async () => {
    const p = await page(`${server.address().port}/`);
    assert.equal(await p.eval(`typeof chrome === 'undefined' || !chrome.runtime?.sendMessage ? 'none' : 'has'`), 'none');
    p.close();
  });
  await step('withdrawing agreement stops everything', async () => {
    await ui({ type: 'consent', agreed: false });
    assert.match((await mcp.tool('get_text', { tabId: tab })).text, /not turned on yet/);
    await ui({ type: 'consent', agreed: true });
    assert.match((await mcp.tool('get_text', { tabId: tab })).text, /Some page text/);
  });
  await step('closes its own tab', async () => assert.match((await mcp.tool('close_tab', { tabId: tab })).text, /Closed/));
  await step('Chrome exit removes the endpoint and is reported', async () => {
    const opt = await optionsPage();
    await opt.eval(`setTimeout(() => chrome.windows.getAll().then((w) => w.forEach((x) => chrome.windows.remove(x.id))), 50)`);
    await until(() => fs.readdirSync(path.join(state, 'endpoints')).length === 0, 'endpoint removed', 10000);
    await until(async () => /not connected/.test((await mcp.tool('list_tabs')).text), 'not connected reported');
  });
} finally {
  mcp?.close();
  chrome?.kill();
  for (const k of KEYS) unregister(k);
  server.close(); server2.close();
  await sleep(1500);
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) { console.log(`left ${tmp}: ${e.message}`); }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);

async function optionsPage() {
  const ready = (p) => p.eval(`!!document.querySelector('input[name=mode]:checked')`);
  const have = await page('options.html');
  if (have && await until(() => ready(have), 'open options page', 2000).catch(() => false)) return have;
  await fetch(`http://127.0.0.1:${devPort}/json/new?chrome-extension://${EXTENSION_ID}/options.html`, { method: 'PUT' });
  return until(async () => { const p = await page('options.html'); return p && await ready(p) && p; }, 'options page');
}
