// Signs dist/release/release.json. Publishing is a separate step that you do yourself.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './register.mjs';
import crypto from 'node:crypto';
import { askSecret, sign } from './signing.mjs';
import { PRODUCT, TOP, verifyRelease } from './updater.mjs';
import { readZip } from './zip.mjs';

const keyFile = path.resolve(process.argv[2] || path.join(os.homedir(), 'sharedtabs-release-key.pem'));
const out = path.join(ROOT, 'dist', 'release');
try {
  const bytes = fs.readFileSync(path.join(out, 'release.json'));
  const pem = fs.readFileSync(keyFile, 'utf8');
  const expected = fs.readFileSync(path.join(ROOT, 'store', 'update-key.pub'), 'utf8').trim();
  const { signature, publicKey } = sign(bytes, pem, await askSecret('Passphrase (hidden): '));
  if (publicKey !== expected) throw new Error('That key does not match store/update-key.pub, so installed bridges would refuse this release.');
  const r = JSON.parse(bytes);
  const file = fs.readFileSync(path.join(out, r.file));
  if (file.length !== r.size || crypto.createHash('sha256').update(file).digest('hex') !== r.sha256) throw new Error('The file in dist/release does not match release.json. Run: npm run release');
  if (r.product === PRODUCT) {
    verifyRelease(bytes, signature, expected);
    if (JSON.parse(readZip(file, TOP).get('update.json')).publicKey !== expected) throw new Error('This release was built with a different key. Run: npm run release');
  } else if (JSON.parse(fs.readFileSync(path.join(ROOT, 'native', 'update.json'), 'utf8')).publicKey !== Buffer.from(expected, 'base64').subarray(-32).toString('base64')) throw new Error('This program was built with a different key. Build it again.');
  fs.writeFileSync(path.join(out, 'release.json.sig'), signature + '\n');
  console.log(`\nSigned version ${r.version}. To publish it, create the GitHub release v${r.version} with these three files from dist/release:\n  ${r.file}\n  release.json\n  release.json.sig`);
} catch (e) {
  console.error(`\n${e.code === 'ENOENT' ? `Not found: ${e.path}` : e.message}`);
  process.exitCode = 1;
}
