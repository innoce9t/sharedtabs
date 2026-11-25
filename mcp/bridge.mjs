// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
import net from 'node:net';
import { MAX_REQUEST, MAX_RESPONSE, lineReader, readEndpoints } from '../host/shared.mjs';

const NOT_CONNECTED = 'Chrome is not connected. Ask the user to open Chrome and check that the SharedTabs extension is on; its toolbar popup shows the connection state.';

export class Bridge {
  #socket = null;
  #connecting = null;
  #waiting = new Map();
  #nextId = 1;
  onConnect = () => {};
  client = ''; // the agent's own name for itself, shown to the user

  async call(method, params, { timeout = 110000, signal, patience = 3000 } = {}) {
    const socket = await this.#connect(patience);
    const id = this.#nextId++;
    const line = JSON.stringify({ id, method, params, client: this.client }) + '\n';
    if (Buffer.byteLength(line) > MAX_REQUEST) throw new Error('That request is too large.');
    if (signal?.aborted) throw new Error('Cancelled.');
    return new Promise((resolve, reject) => {
      const finish = (fn, v) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.#waiting.delete(id);
        fn(v);
      };
      const cancel = (why) => {
        if (!socket.destroyed) socket.write(JSON.stringify({ type: 'cancel', id }) + '\n');
        finish(reject, new Error(why));
      };
      const onAbort = () => cancel('Cancelled.');
      const timer = setTimeout(() => cancel('Chrome did not answer in time.'), timeout);
      signal?.addEventListener('abort', onAbort);
      this.#waiting.set(id, { resolve: (v) => finish(resolve, v), reject: (e) => finish(reject, e) });
      socket.write(line);
    });
  }

  #connect(patience) {
    if (this.#socket) return Promise.resolve(this.#socket);
    this.#connecting ??= this.#open(patience).finally(() => { this.#connecting = null; });
    return this.#connecting;
  }

  async #open(patience) {
    const deadline = Date.now() + patience;
    for (;;) {
      for (const e of readEndpoints()) {
        try { return this.#adopt(await dial(e.pipe)); } catch { /* try the next one */ }
      }
      if (Date.now() > deadline) throw new Error(NOT_CONNECTED);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  #adopt(socket) {
    this.#socket = socket;
    lineReader(socket, MAX_RESPONSE, (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      const w = this.#waiting.get(msg.id);
      if (!w) return;
      if (msg.ok) w.resolve(msg.result);
      else w.reject(new Error(msg.error || 'Unknown error'));
    }, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('close', () => {
      if (this.#socket === socket) this.#socket = null;
      for (const w of [...this.#waiting.values()]) {
        w.reject(new Error('Chrome disconnected. The action may or may not have happened; check before repeating it.'));
      }
    });
    queueMicrotask(this.onConnect);
    return socket;
  }

  close() { this.#socket?.destroy(); }
}

function dial(pipe) {
  return new Promise((resolve, reject) => {
    const s = net.connect(pipe);
    s.once('connect', () => { s.off('error', reject); resolve(s); });
    s.once('error', reject);
  });
}
