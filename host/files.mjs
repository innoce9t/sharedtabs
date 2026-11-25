// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
// Decides which files Hermes may upload, and reads them. The settings come from the extension.
import fs from 'node:fs';
import path from 'node:path';

const win = path.win32;
export const MAX_FILE = 20 * 1024 * 1024;

// Never uploaded, whatever the setting or folder.
const PROTECTED_NAMES = [
  /^\.env(\..*)?$/, /\.(env|pem|key|pfx|p12|ppk|kdbx?|jks|keystore|ovpn|rdp|wallet)$/, /^id_(rsa|dsa|ecdsa|ed25519)/,
  /^(client_?)?(credentials?|secrets?|auth|tokens?)([._-].*)?\.(json|ya?ml|toml|ini|txt|db)$/, /(client_secret|_token|credentials)\.json$/,
  /^\.?(git-credentials|npmrc|pypirc)$/, /^[._]netrc$/, /^(login data|cookies|web data|local state|key4\.db|logins\.json|wallet\.dat)$/, /^ntuser\.dat/,
];
// Not uploaded unless the user listed a folder inside them.
const PROTECTED_DIRS = new Set([
  'appdata', '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.git', '.hermes', '.hermes-chrome', '.claude', '.codex',
  'windows', 'programdata', 'program files', 'program files (x86)', '$recycle.bin', 'system volume information',
]);

const lower = (p) => p.toLowerCase();
export function isInside(file, folder) {
  const rel = win.relative(lower(folder), lower(file));
  return rel !== '' && !rel.startsWith('..') && !win.isAbsolute(rel);
}
const hasProtectedDir = (dir) => lower(dir).split('\\').some((s) => PROTECTED_DIRS.has(s));

/** A plain drive path: no network or device paths, no alternate data streams. */
function localPath(p) {
  if (typeof p !== 'string' || p.length > 1000 || !/^[a-z]:[\\/]/i.test(p) || /[<>:"|?*\x00-\x1f]/.test(p.slice(2))) {
    throw new Error(`Use a full local path such as C:\\Users\\me\\Documents\\cv.pdf, not ${JSON.stringify(p)}.`);
  }
  return win.normalize(p);
}

/** Throws unless the resolved path may be uploaded. policy: { mode: off | folders | any, folders } */
export function checkAllowed(real, policy) {
  const name = lower(win.basename(real));
  if (PROTECTED_NAMES.some((r) => r.test(name))) throw new Error(`${win.basename(real)} looks like a key, password or account file, which can't be uploaded.`);
  const listed = [];
  for (const f of policy.folders || []) {
    try { listed.push(fs.realpathSync.native(localPath(f))); } catch { /* missing or not a local folder */ }
  }
  const under = listed.filter((f) => isInside(real, f));
  if (policy.mode === 'folders' && !under.length) {
    throw new Error("That file is not in a folder the user's upload settings allow. Ask the user to add the folder or move the file.");
  }
  if (policy.mode !== 'folders' && policy.mode !== 'any') throw new Error('File uploads are turned off.');
  // A listed folder vouches for its own location, but not for protected folders below it.
  const vouched = under.some((f) => !hasProtectedDir(win.relative(f, win.dirname(real))));
  if (!vouched && hasProtectedDir(win.dirname(real))) throw new Error('That file is in a protected folder (system, app data or account settings), which can\'t be uploaded.');
}

/** { name, data: Buffer } */
export function readUpload(requested, policy) {
  const asked = localPath(requested);
  let real;
  try { real = localPath(fs.realpathSync.native(asked)); } catch (e) {
    throw new Error(e.code === 'ENOENT' ? `There is no file at ${asked}.` : 'That path could not be resolved to a local file.');
  }
  checkAllowed(real, policy);
  const fd = fs.openSync(real, 'r');
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    const named = fs.statSync(real, { bigint: true });
    if (opened.ino !== named.ino || opened.dev !== named.dev || localPath(fs.realpathSync.native(real)) !== real) throw new Error('The file changed while it was being opened. Try again.');
    if (!opened.isFile()) throw new Error('That is not a file.');
    if (opened.size > BigInt(MAX_FILE)) throw new Error('That file is larger than 20 MB.');
    return { name: win.basename(real), data: fs.readFileSync(fd) };
  } finally {
    fs.closeSync(fd);
  }
}
