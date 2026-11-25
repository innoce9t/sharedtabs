// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSION_IDS, HOST_NAME, STATE_DIR } from '../host/shared.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Overridable so tests never touch the real registration.
const BASE = process.env.SHAREDTABS_TEST_REGISTRY ? `HKCU\\${process.env.SHAREDTABS_TEST_REGISTRY}` : 'HKCU';
export const CHROME_KEY = `${BASE}\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
export const PROBE_KEY = `${BASE}\\Software\\SharedTabsProbe${process.pid}`;
const REG = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');

/** Writes the launcher and host manifest, and returns the manifest path. */
export function writeHostFiles(dir = STATE_DIR, env = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const bat = path.join(dir, 'hermes-chrome-host.bat');
  const host = path.join(ROOT, 'host', 'host.mjs');
  for (const p of [process.execPath, host, ...Object.values(env)]) {
    if (/["%\r\n]/.test(p)) throw new Error(`This path can't be used in a batch file: ${p}`);
  }
  const sets = Object.entries(env).map(([k, v]) => `set "${k}=${v}"\r\n`).join('');
  fs.writeFileSync(bat, `@echo off\r\nchcp 65001 >nul\r\n${sets}"${process.execPath}" "${host}" %*\r\n`);
  const manifest = path.join(dir, `${HOST_NAME}.json`);
  fs.writeFileSync(manifest, JSON.stringify({
    name: HOST_NAME,
    description: 'SharedTabs bridge',
    path: bat,
    type: 'stdio',
    allowed_origins: EXTENSION_IDS.map((id) => `chrome-extension://${id}/`),
  }, null, 2));
  return manifest;
}

export function register(key, manifest) {
  execFileSync(REG, ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifest, '/f'], { stdio: 'ignore' });
}
export function unregister(key) {
  try { execFileSync(REG, ['delete', key, '/f'], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** The manifest path Chrome has for the bridge, or null. */
export function registered(key) {
  try { return execFileSync(REG, ['query', key, '/ve'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).match(/REG_SZ\s+(.+)/)?.[1].trim() || null; } catch { return null; }
}

/**
 * True when processes outside this one's app package can see the key. Packaged (MSIX) apps, such as
 * the Claude desktop app, get a private registry, so an install run inside one would do nothing.
 */
export function visibleToOtherApps(key) {
  const result = path.join(os.homedir(), `.sharedtabs-visible-${process.pid}.txt`);
  fs.rmSync(result, { force: true });
  const command = `cmd.exe /c reg query "${key}" /ve >nul 2>&1 && (echo yes> "${result}") || (echo no> "${result}")`;
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = `Invoke-CimMethod Win32_Process -MethodName Create -Arguments @{CommandLine=$env:HERMES_CMD} | Out-Null
for ($i = 0; $i -lt 50 -and -not (Test-Path $env:HERMES_OUT); $i++) { Start-Sleep -Milliseconds 100 }
Start-Sleep -Milliseconds 200`;
  execFileSync(ps, ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, HERMES_CMD: command, HERMES_OUT: result }, stdio: 'ignore' });
  try { return fs.readFileSync(result, 'utf8').trim() === 'yes'; } finally { fs.rmSync(result, { force: true }); }
}
