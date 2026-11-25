// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export class Mcp {
  #id = 0;
  #waiting = new Map();
  constructor(env = {}) {
    // BRIDGE_EXE runs the same tests against the native bridge.
    const [exe, args] = process.env.BRIDGE_EXE ? [process.env.BRIDGE_EXE, ['mcp']] : [process.execPath, [fileURLToPath(new URL('../mcp/server.mjs', import.meta.url))]];
    this.child = spawn(exe, args, {
      env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'],
    });
    let buf = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const m = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        this.#waiting.get(m.id)?.(m);
        this.#waiting.delete(m.id);
      }
    });
  }
  request(method, params) {
    const id = ++this.#id;
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((r) => this.#waiting.set(id, r));
  }
  /** { text, error, image } */
  async tool(name, args = {}) {
    const { result } = await this.request('tools/call', { name, arguments: args });
    return { text: result.content[0].text, error: result.isError, image: result.content[1] };
  }
  close() { this.child.stdin.end(); }
}
