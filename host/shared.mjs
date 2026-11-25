// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// In the home folder rather than AppData: AppData writes made by packaged (MSIX) apps get
// redirected to a private copy, so Chrome and Hermes could disagree about what is there.
export const STATE_DIR = process.env.HERMES_CHROME_STATE || path.join(os.homedir(), '.hermes-chrome');
export const ENDPOINT_DIR = path.join(STATE_DIR, 'endpoints');
export const BRIDGE_VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export const HOST_NAME = 'com.hermes.chrome_bridge';
/** One per line: the development ID first, then the Chrome Web Store ID once it is known. */
export const EXTENSION_IDS = fs.readFileSync(new URL('../extension-id.txt', import.meta.url), 'utf8').split(/\s+/).filter((id) => /^[a-p]{32}$/.test(id));
export const EXTENSION_ID = EXTENSION_IDS[0];

// Chrome refuses host -> extension messages over 1 MB.
export const MAX_REQUEST = 900 * 1024;
// Screenshots travel extension -> host -> MCP; Chrome's own limit there is 64 MB.
export const MAX_RESPONSE = 48 * 1024 * 1024;

/** Calls onLine for each newline-terminated line; onOverflow once if a line exceeds max bytes. */
export function lineReader(stream, max, onLine, onOverflow) {
  let parts = [];
  let size = 0;
  const onData = (chunk) => {
    let start = 0;
    for (;;) {
      const nl = chunk.indexOf(10, start);
      const piece = chunk.subarray(start, nl === -1 ? chunk.length : nl);
      size += piece.length;
      if (size > max) {
        stream.off('data', onData);
        parts = [];
        onOverflow();
        return;
      }
      if (piece.length) parts.push(piece);
      if (nl === -1) return;
      const line = Buffer.concat(parts).toString('utf8').trim();
      parts = [];
      size = 0;
      if (line) onLine(line);
      start = nl + 1;
    }
  };
  stream.on('data', onData);
}

/** Running bridges, newest first. Entries left by dead processes are removed. */
export function readEndpoints() {
  let files = [];
  try { files = fs.readdirSync(ENDPOINT_DIR); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!/^\d+\.json$/.test(f)) continue;
    const file = path.join(ENDPOINT_DIR, f);
    try {
      const e = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!isAlive(e.pid)) { fs.rmSync(file, { force: true }); continue; }
      if (typeof e.pipe === 'string' && e.pipe.startsWith('\\\\.\\pipe\\hermes-chrome-')) out.push(e);
    } catch { /* being written or removed */ }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
