// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
// Builds the Windows bridge, native/target/release/sharedtabs.exe, which is also its own installer.
// The built-in tool list comes from extension/tools.js, and the update address and key from store/.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { INSTRUCTIONS, TOOLS, TRUSTED_RESULT } from '../extension/tools.js';
import { ROOT } from './register.mjs';

const native = path.join(ROOT, 'native');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (!fs.readFileSync(path.join(native, 'Cargo.toml'), 'utf8').includes(`\nversion = "${version}"`)) {
  console.error(`native/Cargo.toml must also say version = "${version}".`);
  process.exit(1);
}
const changed = (file, text) => { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text); };
changed(path.join(native, 'tools.json'), JSON.stringify({ tools: TOOLS, instructions: INSTRUCTIONS, trusted: [...TRUSTED_RESULT] }, null, 1) + '\n');

const { repo, storeId = '' } = JSON.parse(fs.readFileSync(path.join(ROOT, 'store', 'config.json'), 'utf8'));
const keyFile = path.join(ROOT, 'store', 'update-key.pub');
// The key file holds the standard (SPKI) form; the program uses its last 32 bytes.
const publicKey = fs.existsSync(keyFile) ? Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64').subarray(-32).toString('base64') : '';
changed(path.join(native, 'update.json'), JSON.stringify({ repo, publicKey, storeId }) + '\n'); // storeId stays blank until the store assigns it

export function build(args = ['build'], { target = path.join(native, 'target'), env = {}, stamp = version } = {}) {
  const r = spawnSync('cargo', [...args, '--release', '--locked', '--target-dir', target], { cwd: native, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, RUSTFLAGS: `--remap-path-prefix=${native}=. --remap-path-prefix=${process.env.CARGO_HOME || path.join(process.env.USERPROFILE, '.cargo')}=cargo`, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
  if (args[0] !== 'build') return null;
  const exe = path.join(target, 'release', 'sharedtabs.exe');
  const s = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(native, 'stamp.ps1'), '-Exe', exe, '-Version', stamp, '-IconDir', path.join(native, 'icon'), '-Manifest', path.join(native, 'app.manifest')], { stdio: 'inherit' });
  if (s.status !== 0) process.exit(1);
  return exe;
}
if (process.argv[1]?.endsWith('build-native.mjs')) {
  const exe = build([process.argv[2] === 'test' ? 'test' : 'build']);
  if (exe) console.log(`${exe}\n${fs.statSync(exe).size} bytes${repo && publicKey ? '' : '\nNote: without a repo and store/update-key.pub, this copy cannot update itself.'}`);
}
