// Connecting AI agents on this computer to the bridge. Only the ones named by the user are touched.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SERVER = 'shared-tabs';

function onPath(name) {
  for (const d of (process.env.PATH || '').split(path.delimiter).filter((x) => path.isAbsolute(x))) {
    for (const ext of ['exe', 'cmd']) { const f = path.join(d, `${name}.${ext}`); if (fs.existsSync(f)) return f; }
  }
  return null;
}
function claudeDesktop() {
  const packages = path.join(process.env.LOCALAPPDATA || '', 'Packages');
  try {
    for (const p of fs.readdirSync(packages)) { // the packaged app keeps its settings in its own folder
      const d = path.join(packages, p, 'LocalCache', 'Roaming', 'Claude');
      if (p.startsWith('Claude_') && fs.existsSync(d)) return path.join(d, 'claude_desktop_config.json');
    }
  } catch { /* no packages */ }
  const d = path.join(process.env.APPDATA || '', 'Claude');
  return process.env.APPDATA && fs.existsSync(d) ? path.join(d, 'claude_desktop_config.json') : null;
}

/** Agents found on this computer: { id, name, how } */
export function found() {
  const out = [];
  const hermes = onPath('hermes');
  if (hermes) out.push({ id: 'hermes', name: 'Hermes Agent', how: 'hermes', exe: hermes });
  const cd = claudeDesktop();
  if (cd) out.push({ id: 'claude-desktop', name: 'Claude Desktop', how: 'json', file: cd });
  const cc = onPath('claude');
  if (cc) out.push({ id: 'claude-code', name: 'Claude Code', how: 'cli', exe: cc, add: ['mcp', 'add', '--scope', 'user'] });
  const cursor = path.join(os.homedir(), '.cursor');
  if (fs.existsSync(cursor)) out.push({ id: 'cursor', name: 'Cursor', how: 'json', file: path.join(cursor, 'mcp.json') });
  const codex = onPath('codex');
  if (codex) out.push({ id: 'codex', name: 'Codex', how: 'cli', exe: codex, add: ['mcp', 'add'] });
  return out;
}

function readSettings(file) {
  if (!fs.existsSync(file)) return { text: null, json: {} };
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return { text, json: {} };
  let json;
  try { json = JSON.parse(text.replace(/^﻿/, '')); } catch { /* reported below */ }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error('its settings file has comments or errors, so it was left alone. Add the server by hand');
  return { text, json };
}
/** Adds our entry, keeps everything else, and leaves a backup beside the file. */
export function addToSettings(file, server) {
  const { text, json } = readSettings(file);
  json.mcpServers ??= {};
  if (typeof json.mcpServers !== 'object' || Array.isArray(json.mcpServers)) throw new Error('its settings have an unexpected shape, so they were left alone. Add the server by hand');
  json.mcpServers[SERVER] = { command: server.command, args: server.args };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (text !== null) fs.writeFileSync(`${file}.sharedtabs-backup`, text);
  fs.writeFileSync(`${file}.sharedtabs-new`, JSON.stringify(json, null, 2) + '\n');
  fs.renameSync(`${file}.sharedtabs-new`, file); // never half a settings file
}

/** { id, status: connected | manual | failed, message, command? } */
export function connect(id, server, { interactive = false } = {}) {
  const a = found().find((x) => x.id === id);
  if (!a) return { id, status: 'failed', message: `${id} was not found on this computer.` };
  try {
    if (a.how === 'json') {
      addToSettings(a.file, server);
      return { id, status: 'connected', message: `${a.name}: connected. Quit and reopen it.` };
    }
    if (a.how === 'hermes') {
      const args = ['mcp', 'add', SERVER, '--command', server.command, '--args', ...server.args];
      if (!interactive) return { id, status: 'manual', message: 'Hermes asks which tools to turn on, so run this command and answer it, then use /reload-mcp or restart the gateway.', command: ['hermes', ...args] };
      const r = spawnSync(a.exe, args, { stdio: 'inherit' });
      return r.status === 0 ? { id, status: 'connected', message: 'Hermes Agent: connected. Use /reload-mcp or restart the gateway.' } : { id, status: 'failed', message: 'Hermes did not add the server.' };
    }
    const args = [...a.add, SERVER, '--', server.command, ...server.args];
    const cmd = a.exe.toLowerCase().endsWith('.cmd');
    const r = spawnSync(cmd ? 'cmd.exe' : a.exe, cmd ? ['/d', '/c', a.exe, ...args] : args, { encoding: 'utf8', windowsHide: true });
    const said = `${r.stdout || ''}${r.stderr || ''}`.trim();
    if (r.status === 0) return { id, status: 'connected', message: `${a.name}: connected. Start a new session.` };
    if (/already exists/.test(said)) return { id, status: 'connected', message: `${a.name}: already connected.` };
    return { id, status: 'manual', message: `${a.name} did not accept the command: ${said.slice(0, 160)}`, command: [id === 'codex' ? 'codex' : 'claude', ...args] };
  } catch (e) {
    return { id, status: 'failed', message: `${a.name}: ${e.message}.` };
  }
}
