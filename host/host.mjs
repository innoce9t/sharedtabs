// Native messaging host. Chrome starts this, and only for the extension ID in the host manifest.
// It relays requests from local MCP servers (named pipe) to the extension (stdio).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { BRIDGE_VERSION, ENDPOINT_DIR, EXTENSION_IDS, MAX_REQUEST, STATE_DIR, lineReader } from './shared.mjs';
import { readUpload } from './files.mjs';
import { lockPipeToCurrentUser } from './pipe-acl.mjs';

fs.mkdirSync(ENDPOINT_DIR, { recursive: true });
const logFile = path.join(STATE_DIR, 'host.log');
function log(...args) {
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 512 * 1024) fs.rmSync(logFile);
    fs.appendFileSync(logFile, `${new Date().toISOString()} [${process.pid}] ${args.join(' ')}\n`);
  } catch { /* logging must never break the bridge */ }
}

const caller = process.argv.find((a) => a.startsWith('chrome-extension://'));
if (!EXTENSION_IDS.some((id) => caller === `chrome-extension://${id}/`)) {
  log('refused caller', String(caller));
  process.exit(1);
}

// ---- MCP side: newline-delimited JSON on a named pipe ----
const pending = new Map(); // bridge id -> { socket, clientId }
const clients = new Set();
const early = new Set(); // connected before the pipe was locked down: never served
let nextId = 1;
let locked = false;

const server = net.createServer((socket) => {
  socket.on('error', () => {});
  if (!locked) { early.add(socket); socket.resume(); return; }
  clients.add(socket);
  toExtension({ type: 'clients', count: clients.size });
  lineReader(socket, MAX_REQUEST, (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { socket.destroy(); return; }
    if (msg.type === 'cancel') {
      for (const [id, p] of pending) {
        if (p.socket === socket && p.clientId === msg.id) { pending.delete(id); toExtension({ type: 'cancel', id }); }
      }
      return;
    }
    if (typeof msg.method !== 'string') return;
    const id = nextId++;
    pending.set(id, { socket, clientId: msg.id });
    toExtension({ type: 'req', id, method: msg.method, params: msg.params ?? {}, client: String(msg.client ?? '').slice(0, 60) });
  }, () => socket.destroy());
  socket.on('close', () => {
    clients.delete(socket);
    for (const [id, p] of pending) {
      if (p.socket === socket) { pending.delete(id); toExtension({ type: 'cancel', id }); }
    }
    toExtension({ type: 'clients', count: clients.size });
  });
});

const pipe = `\\\\.\\pipe\\hermes-chrome-${crypto.randomBytes(16).toString('hex')}`;
const endpointFile = path.join(ENDPOINT_DIR, `${process.pid}.json`);

server.on('error', (e) => { log('pipe error', e.message); fatal(`Could not open the local pipe: ${e.message}`); });
server.listen(pipe, async () => {
  try {
    await lockPipeToCurrentUser(pipe);
  } catch (e) {
    log('lockdown failed', e.message);
    fatal(`Could not restrict the local pipe to your account: ${e.message}`);
    return;
  }
  for (const s of early) s.destroy();
  early.clear();
  locked = true;
  fs.writeFileSync(endpointFile, JSON.stringify({ pipe, pid: process.pid, createdAt: Date.now() }));
  toExtension({ type: 'ready', bridge: BRIDGE_VERSION, features: ['files', 'gif'] });
  log('ready');
});

// ---- extension side: 4-byte length + JSON on stdio ----
function toExtension(msg) {
  const body = Buffer.from(JSON.stringify(msg));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([head, body]));
}

// A multiple of 3, so the base64 pieces join up; under Chrome's 1 MB message limit.
const CHUNK = 510000;
function sendFile({ id, path: requested, policy }) {
  try {
    const { name, data } = readUpload(requested, policy ?? {});
    let at = 0;
    do {
      const end = Math.min(at + CHUNK, data.length);
      toExtension({ type: 'file', id, name, size: data.length, chunk: data.toString('base64', at, end), last: end === data.length });
      at = end;
    } while (at < data.length);
  } catch (e) {
    toExtension({ type: 'file', id, error: e.message });
  }
}

// Recordings: the extension supplies only the image. The folder and name are chosen here, and nothing is overwritten.
function saveGif({ id, data }) {
  try {
    const bytes = Buffer.from(String(data), 'base64');
    if (bytes.subarray(0, 6).toString('latin1') !== 'GIF89a') throw new Error('That is not a recording.');
    const dir = process.env.HERMES_CHROME_DOWNLOADS || path.join(os.homedir(), 'Downloads');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    const file = path.join(dir, `agent-recording-${stamp}-${crypto.randomBytes(2).toString('hex')}.gif`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, bytes, { flag: 'wx' });
    toExtension({ type: 'file', id, saved: file });
  } catch (e) {
    toExtension({ type: 'file', id, error: `The recording could not be saved: ${e.message}` });
  }
}

function fromExtension(msg) {
  if (msg.type === 'saveGif') { saveGif(msg); return; }
  if (msg.type === 'readFile') { sendFile(msg); return; }
  if (msg.type !== 'res') return;
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (!p.socket.destroyed) {
    p.socket.write(JSON.stringify({ id: p.clientId, ok: msg.ok, result: msg.result, error: msg.error }) + '\n');
  }
}

let chunks = [];
let have = 0;
process.stdin.on('data', (chunk) => {
  chunks.push(chunk);
  have += chunk.length;
  while (have >= 4) {
    if (chunks[0].length < 4) chunks = [Buffer.concat(chunks)];
    const len = chunks[0].readUInt32LE(0);
    if (have < 4 + len) return;
    const all = Buffer.concat(chunks);
    const body = all.subarray(4, 4 + len);
    const rest = all.subarray(4 + len);
    chunks = rest.length ? [rest] : [];
    have = rest.length;
    try { fromExtension(JSON.parse(body.toString('utf8'))); } catch (e) { log('bad message', e.message); }
  }
});
process.stdin.on('end', shutdown);
process.stdin.on('error', shutdown);
process.stdout.on('error', shutdown);

function fatal(error) {
  toExtension({ type: 'fatal', error });
  setTimeout(shutdown, 200);
}
function shutdown() {
  try { fs.rmSync(endpointFile, { force: true }); } catch { /* already gone */ }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (e) => { log('crash', e.stack); shutdown(); });
