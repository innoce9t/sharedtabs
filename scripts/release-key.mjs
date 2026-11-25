// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
// Makes the key that signs bridge updates. Run once, by the person who publishes releases.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './register.mjs';
import { askSecret, newKey } from './signing.mjs';

const file = path.resolve(process.argv[2] || path.join(os.homedir(), 'sharedtabs-release-key.pem'));
const pub = path.join(ROOT, 'store', 'update-key.pub');
try {
  if (!path.relative(ROOT, file).startsWith('..') && !path.isAbsolute(path.relative(ROOT, file))) throw new Error('Keep the private key outside the project folder.');
  if (fs.existsSync(file)) throw new Error(`${file} already exists. It was not changed.`);
  if (fs.existsSync(pub)) throw new Error(`${pub} already exists. Replacing it would cut off updates for everyone who has installed the bridge.`);
  const one = await askSecret('New passphrase (12 characters or more, hidden): ');
  const two = await askSecret('Same passphrase again: ');
  if (one !== two) throw new Error('Those did not match. Nothing was made.');
  const k = newKey(one);
  fs.writeFileSync(file, k.privatePem, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(pub, k.publicKey + '\n', { flag: 'wx' });
  console.log(`\nPrivate key: ${file}\nPublic key:  ${pub}\n\nPut the private key file and its passphrase in your password manager, and keep an offline copy.\nNever put the private key on GitHub. Without it, you cannot publish updates.`);
} catch (e) {
  console.error(`\n${e.message}`);
  process.exitCode = 1;
}
