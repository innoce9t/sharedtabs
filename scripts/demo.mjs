// A short tour for trying out an installation, without needing an AI agent.
import { Bridge } from '../mcp/bridge.mjs';

const bridge = new Bridge();
bridge.client = 'SharedTabs demo';
const short = (r) => (r?.image ? `${r.note}` : (typeof r === 'string' ? r : JSON.stringify(r))).replace(/\s+/g, ' ').slice(0, 160);
async function step(title, tool, args = {}) {
  console.log(`\n${title}`);
  try {
    const r = await bridge.call(tool, args);
    console.log(`  ok: ${short(r)}`);
    return r;
  } catch (e) {
    console.log(`  refused: ${e.message}`);
    return null;
  }
}

await step('Status', 'status');
const tabs = await step('Tabs shared with agents', 'list_tabs');
const shared = Array.isArray(tabs) ? tabs.find((t) => t.site === 'allowed') : null;
if (shared) {
  await step('Read a shared tab', 'get_text', { tabId: shared.tabId, maxChars: 600 });
  await step('Screenshot it', 'screenshot', { tabId: shared.tabId, scale: 0.5 });
}
const wiki = await step('Open Wikipedia in a new tab', 'open_tab', { url: 'https://en.wikipedia.org/wiki/Web_browser' });
if (wiki?.tabId) {
  await step('Find the search box', 'find', { tabId: wiki.tabId, query: 'search box' });
  await step('Scroll', 'scroll', { tabId: wiki.tabId, direction: 'down' });
  await step('Close the tab it opened', 'close_tab', { tabId: wiki.tabId });
}
await step('A blocked site (should be refused)', 'open_tab', { url: 'https://www.chase.com' });
await step('A tab that is not shared (should be refused)', 'get_text', { tabId: 1 });
bridge.close();
