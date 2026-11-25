import { BRIDGE_URL } from './config.js';

const $ = (id) => document.getElementById(id);
const call = async (m) => {
  const r = await chrome.runtime.sendMessage(m);
  if (r?.error) throw new Error(r.error);
  return r.ok;
};
const [active] = await chrome.tabs.query({ active: true, currentWindow: true });

const PERM = { all: 'Allow all', specific: 'Allow specific', session: 'Allow until Chrome closes', none: 'Not allowed' };
const LINK = { connected: 'Connected', connecting: 'Connecting…', disconnected: 'Not connected', error: 'Not connected' };

async function render() {
  const s = await call({ type: 'state', tabId: active?.id });
  $('link').replaceChildren(Object.assign(document.createElement('span'), { className: `dot${s.link.state === 'connected' ? ' ok' : ''}` }),
    s.paused ? 'Stopped' : LINK[s.link.state]);
  const missing = /not found|forbidden/i.test(s.link.detail);
  $('detail').hidden = !s.link.detail;
  $('detail').textContent = missing ? `The bridge app is not installed on this computer.${BRIDGE_URL ? '' : ' Run "npm run setup" in the SharedTabs folder.'}` : s.link.detail;

  $('setup').hidden = s.consent;
  $('setup').onclick = () => { chrome.tabs.create({ url: 'welcome.html' }); window.close(); };
  $('bridge').hidden = !(missing && BRIDGE_URL);
  $('bridge').href = BRIDGE_URL;
  $('old').hidden = !s.bridgeOld;
  const can = !!s.link.features?.includes('updater');
  $('oldbtn').hidden = !can;
  $('oldtext').hidden = can;
  $('oldbtn').onclick = () => run({ type: 'openUpdater' });
  $('oldlink').hidden = can || !BRIDGE_URL;
  $('oldlink').href = BRIDGE_URL;
  const t = s.tab;
  $('share').textContent = t?.shared ? 'Stop sharing this tab' : 'Share this tab';
  $('share').className = t?.shared ? '' : 'primary';
  $('share').disabled = !s.consent || !t || (!t.usable && !t.shared);
  $('share').onclick = () => run({ type: t.shared ? 'unshare' : 'share', tabId: active.id });
  $('stop').textContent = s.paused ? 'Resume agents' : 'Stop agents';
  $('stop').className = s.paused ? 'primary' : 'stop';
  $('stop').onclick = () => run({ type: s.paused ? 'resume' : 'stop' });
  $('note').textContent = t && !t.usable ? t.reason
    : t && !t.allowed ? `Site permission doesn't cover ${t.host}, so agents can't use this page.`
      : 'Agents only see tabs in the SharedTabs group.';
  $('perm').textContent = PERM[s.permission];
  $('allow').hidden = !(t?.usable && !t.allowed && s.permission === 'specific');
  $('allow').textContent = `Allow ${t?.host}`;
  $('allow').onclick = () => run({ type: 'allowSite', host: t.host });
  $('shared').hidden = !s.tabs.length;
  $('tabs').replaceChildren(...s.tabs.map((x) => Object.assign(document.createElement('li'), { textContent: x.title || 'Untitled', title: x.title })));
}
async function run(m) {
  try { await call(m); await render(); } catch (e) { $('note').textContent = e.message; }
}
$('panel').onclick = () => { chrome.sidePanel.open({ windowId: active.windowId }); window.close(); };
await render();
setInterval(render, 1500);
