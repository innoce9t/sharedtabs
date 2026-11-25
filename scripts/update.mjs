// Run by "Update SharedTabs.cmd". Asks before installing anything.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { applyUpdate, checkForUpdate, fetchPackage, installedVersion, readConfig, recover } from './updater.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plain = (s) => s.replace(/[^\x20-\x7e\n]/g, '');

try {
  if (recover(root)) console.log('An earlier update did not finish, so the previous version was put back.\n');
  const { repo } = readConfig(root);
  console.log(`SharedTabs bridge ${installedVersion(root)}\nLooking for a newer version at github.com/${repo} ...`);
  const found = await checkForUpdate(root);
  if (!found) {
    console.log('\nYou have the newest version.');
  } else {
    console.log(`\nVersion ${found.release.version} is available, and its signature is valid.\n\n${plain(found.release.notes)}\n`);
    if (!process.argv.includes('--yes') && !process.stdin.isTTY) {
      console.log('Nothing was changed. To install it, run this again with --yes.');
      process.exit(0);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const yes = process.argv.includes('--yes') || /^y(es)?$/i.test((await rl.question('Install it now? [y/N] ')).trim());
    rl.close();
    if (!yes) console.log('Nothing was changed.');
    else {
      const files = await fetchPackage(found);
      const done = await applyUpdate(root, files, found.release.version, {
        afterSwap: (dir) => {
          const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'install.mjs'), '--update'], { stdio: 'inherit' });
          if (r.status !== 0) throw new Error('Setting up the new version failed.');
        },
      });
      console.log(`\nUpdated from ${done.from} to ${done.to}. To finish, restart Chrome and your agent. Your settings are kept in Chrome.`);
    }
  }
} catch (e) {
  console.error(`\n${e.message}`);
  process.exitCode = 1;
}
