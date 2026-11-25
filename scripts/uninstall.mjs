// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
// Removes what setup made for the current user. --json prints one JSON object.
import fs from 'node:fs';
import path from 'node:path';
import { HOST_NAME, STATE_DIR } from '../host/shared.mjs';
import { CHROME_KEY, registered, unregister } from './register.mjs';

const ours = path.join(STATE_DIR, `${HOST_NAME}.json`);
const now = registered(CHROME_KEY);
const mine = !!now && path.resolve(now).toLowerCase() === path.resolve(ours).toLowerCase(); // leave anyone else's alone
if (mine) unregister(CHROME_KEY);
for (const f of ['hermes-chrome-host.bat', `${HOST_NAME}.json`, 'host.log']) fs.rmSync(path.join(STATE_DIR, f), { force: true });
fs.rmSync(path.join(STATE_DIR, 'endpoints'), { recursive: true, force: true });
try { fs.rmdirSync(STATE_DIR); } catch { /* not empty or already gone */ }
const userMustDo = ['Remove the SharedTabs extension in chrome://extensions, if you no longer want it.', 'Remove the "shared-tabs" server from your AI agent. For Hermes: hermes mcp remove shared-tabs', 'Delete this folder.'];
if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: true, removed: mine, userMustDo }, null, 2));
else console.log(`${mine ? 'SharedTabs is no longer registered with Chrome.' : 'SharedTabs was not registered with Chrome.'}\n\nTo finish:\n${userMustDo.map((x) => `  - ${x}`).join('\n')}`);
