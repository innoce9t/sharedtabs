// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Mcp } from './helpers.mjs';

test('MCP server without Chrome', async () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-chrome-'));
  const mcp = new Mcp({ HERMES_CHROME_STATE: state });
  try {
    const init = await mcp.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.protocolVersion, '2025-03-26');
    assert.equal((await mcp.request('tools/list')).result.tools.length, 27);
    assert.equal(init.result.serverInfo.version, JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version);
    assert.equal((await mcp.request('nope')).error.code, -32601);
    assert.match((await mcp.tool('click', {})).text, /Missing argument: tabId/);
    assert.match((await mcp.tool('click', { tabId: '1' })).text, /must be integer/);
    assert.match((await mcp.tool('click', { tabId: 1, evil: 1 })).text, /Unknown argument/);
    assert.match((await mcp.tool('constructor', {})).text, /Unknown tool/);
    assert.match((await mcp.tool('upload_file', { tabId: 1, ref: 'a_1', paths: [] })).text, /must be array/);
    assert.match((await mcp.tool('upload_file', { tabId: 1, ref: 'a_1', paths: [1] })).text, /must be array/);
    assert.match((await mcp.tool('batch', { actions: [] })).text, /must be array/);
    assert.match((await mcp.tool('batch', { actions: [null] })).text, /must be array/);
    const nested = (await mcp.request('tools/call', { name: 'batch', arguments: { actions: [{ tool: 'batch', args: { actions: [] } }, { tool: 'status' }] } })).result;
    assert.equal(nested.isError, true);
    assert.match(JSON.stringify(nested.content), /cannot contain a batch.*1 later steps were not run/);
    assert.match(JSON.stringify((await mcp.request('tools/call', { name: 'batch', arguments: { actions: [{ tool: 'click', tabId: 1 }] } })).result.content), /Unknown field: tabId/);
    const r = await mcp.tool('list_tabs');
    assert.equal(r.error, true);
    assert.match(r.text, /Chrome is not connected/);
  } finally {
    mcp.close();
    fs.rmSync(state, { recursive: true, force: true });
  }
});
