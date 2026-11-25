import { BRIDGE_URL } from './config.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const call = async (m) => {
  const r = await chrome.runtime.sendMessage(m);
  if (r?.error) throw new Error(r.error);
  return r.ok;
};
const run = async (m) => { try { $('note').textContent = ''; const r = await call(m); await render(); return r; } catch (e) { $('note').textContent = e.message; return null; } };
const PERM = { all: 'All sites allowed', specific: 'Listed sites only', session: 'All sites until Chrome closes', none: 'No sites allowed' };
const LINK = { connected: 'Connected', connecting: 'Connecting…', disconnected: 'Not connected', error: 'Not connected' };

let shown = '';
async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const s = await call({ type: 'state', tabId: tab?.id });
  const a = await call({ type: 'activity' });
  $('link').replaceChildren(el('span', { className: `dot${s.link.state === 'connected' ? ' ok' : ''}` }), s.paused ? 'Stopped' : LINK[s.link.state]);
  $('perm').textContent = PERM[s.permission];
  $('old').hidden = !s.bridgeOld;
  const can = !!s.link.features?.includes('updater');
  $('oldbtn').hidden = !can;
  $('oldtext').hidden = can;
  $('oldbtn').onclick = () => run({ type: 'openUpdater' });
  $('oldlink').hidden = can || !BRIDGE_URL;
  $('oldlink').href = BRIDGE_URL;
  const t = s.tab;
  $('share').textContent = t?.shared ? 'Stop sharing this tab' : 'Share this tab';
  $('share').disabled = !s.consent || !t || (!t.usable && !t.shared);
  $('share').onclick = () => run({ type: t.shared ? 'unshare' : 'share', tabId: tab.id });
  $('stop').textContent = s.paused ? 'Resume' : 'Stop';
  $('stop').onclick = () => run({ type: s.paused ? 'resume' : 'stop' });

  const rec = t && a.recordings[tab.id];
  $('rec').textContent = rec?.on ? 'Stop recording' : 'Record this tab';
  $('rec').disabled = !t?.shared && !rec?.on;
  $('rec').onclick = () => run({ type: rec?.on ? 'recordStop' : 'recordStart', tabId: tab.id });
  $('save').disabled = !rec?.frames;
  $('save').onclick = async () => { const r = await run({ type: 'recordSave', tabId: tab.id }); if (r) $('note').textContent = `Saved ${r.path}`; };
  $('rec-state').textContent = rec ? `${rec.on ? 'Recording' : 'Recorded'}: ${rec.frames} steps` : 'Not recording';

  const key = JSON.stringify([s.tabs, a.log]);
  if (key === shown) return;
  shown = key;
  $('tabs').replaceChildren(...(s.tabs.length ? s.tabs.map((x) => el('li', { textContent: x.title || 'Untitled', title: x.title || '' })) : [el('li', { className: 'muted', textContent: 'None' })]));
  $('log').replaceChildren(...(a.log.length ? a.log.map((x) => el('li', { className: x.ok ? '' : 'bad' },
    el('span', { className: 'what', textContent: x.tool.replaceAll('_', ' ') }),
    el('span', { className: 'small muted', textContent: ` ${x.host || ''}` }),
    el('br'),
    el('span', { className: 'small muted', textContent: `${new Date(x.t).toLocaleTimeString()} · ${x.client || 'unnamed agent'}${x.error ? ` · ${x.error}` : ''}` }))) : [el('li', { className: 'muted', textContent: 'Nothing yet' })]));
}
await render();
setInterval(() => render().catch(() => {}), 1500);
