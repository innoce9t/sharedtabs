// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
// Builds the bridge download in dist/release/. Sign it afterwards with: npm run release:sign
import fs from 'node:fs';
import path from 'node:path';
import { bundleFiles, makeRelease } from './bundle.mjs';
import { ROOT } from './register.mjs';
import { selfTest } from './updater.mjs';

const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const { repo } = JSON.parse(fs.readFileSync(path.join(ROOT, 'store', 'config.json'), 'utf8'));
const keyFile = path.join(ROOT, 'store', 'update-key.pub');
const publicKey = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : '';
const notesFile = path.join(ROOT, 'store', 'release-notes.txt');
const notes = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8').trim() : '';

const files = bundleFiles({ version, repo, publicKey });
const out = path.join(ROOT, 'dist', 'release');
fs.rmSync(out, { recursive: true, force: true });
const check = path.join(out, 'check');
for (const [n, b] of files) {
  fs.mkdirSync(path.dirname(path.join(check, n)), { recursive: true });
  fs.writeFileSync(path.join(check, n), b);
}
await selfTest(check, version);
fs.rmSync(check, { recursive: true, force: true });
const { zip, manifest } = makeRelease(files, { version, notes });
fs.writeFileSync(path.join(out, `sharedtabs-bridge-${version}.zip`), zip);
fs.writeFileSync(path.join(out, 'release.json'), manifest);
console.log(`dist/release/sharedtabs-bridge-${version}.zip\n${files.size} files, ${zip.length} bytes\nSHA-256 ${JSON.parse(manifest).sha256}`);
if (!repo) console.log('Note: store/config.json has no repo, so this copy cannot update itself.');
if (!publicKey) console.log('Note: there is no store/update-key.pub, so this copy cannot update itself. Run: npm run release:key');
if (repo && publicKey) console.log('Next: npm run release:sign');
