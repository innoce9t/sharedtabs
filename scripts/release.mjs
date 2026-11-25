// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
// Builds the Windows setup program and its description in dist/release. Sign it with: npm run release:sign
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { build } from './build-native.mjs';
import { ROOT } from './register.mjs';

export const PRODUCT = 'sharedtabs-bridge-windows';

/** The exact bytes to sign. */
export function makeRelease(exe, { version, notes = '' }) {
  return Buffer.from(JSON.stringify({
    product: PRODUCT, version, file: `SharedTabsSetup-${version}.exe`, size: exe.length,
    sha256: crypto.createHash('sha256').update(exe).digest('hex'), notes,
  }, null, 2) + '\n');
}

if (process.argv[1]?.endsWith('release.mjs') && !process.argv[1].endsWith('sign-release.mjs')) {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const notesFile = path.join(ROOT, 'store', 'release-notes.txt');
  const exe = fs.readFileSync(build());
  const out = path.join(ROOT, 'dist', 'release');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `SharedTabsSetup-${version}.exe`), exe);
  fs.writeFileSync(path.join(out, 'release.json'), makeRelease(exe, { version, notes: fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8').trim() : '' }));
  console.log(`dist/release/SharedTabsSetup-${version}.exe\n${exe.length} bytes`);
  const update = JSON.parse(fs.readFileSync(path.join(ROOT, 'native', 'update.json'), 'utf8'));
  if (!update.repo || !update.publicKey) console.log('Note: without a repo in store/config.json and store/update-key.pub, this copy cannot update itself.');
  else console.log('Next: npm run release:sign');
}
