const $ = (id) => document.getElementById(id);
const call = async (m) => {
  const r = await chrome.runtime.sendMessage(m);
  if (r?.error) throw new Error(r.error);
  return r.ok;
};
const lines = (id) => $(id).value.split('\n').map((l) => l.trim()).filter(Boolean);
let dirty = false;

async function load() {
  const s = await call({ type: 'state' });
  for (const r of document.querySelectorAll('input[name=mode]')) r.checked = r.value === s.permission;
  $('specific').hidden = s.permission !== 'specific';
  $('warn').hidden = !['all', 'session'].includes(s.permission);
  for (const r of document.querySelectorAll('input[name=uploads]')) r.checked = r.value === s.uploads;
  $('uploadFolders').hidden = s.uploads !== 'folders';
  $('indicator').checked = s.indicator;
  if ($('evaluate')) $('evaluate').checked = s.allowEvaluate;
  if (dirty) return;
  $('folders').value = s.folders.join('\n');
  $('allowed').value = s.allowed.join('\n');
  $('blocked').value = s.blocked.join('\n');
}

// The choices apply at once. Lists wait for Save, so a half-typed entry never takes effect.
$('modes').onchange = async (e) => { await call({ type: 'setPermission', mode: e.target.value }); await load(); };
$('uploads').onchange = async (e) => { await call({ type: 'setUploads', mode: e.target.value }); await load(); };
$('indicator').onchange = (e) => call({ type: 'setIndicator', on: e.target.checked });
$('evaluate')?.addEventListener('change', (e) => call({ type: 'setEvaluate', on: e.target.checked }));
for (const id of ['allowed', 'blocked', 'folders']) $(id).addEventListener('input', () => { dirty = true; $('done').textContent = 'Not saved yet.'; });
$('save').onclick = async () => {
  await call({ type: 'saveSettings', allowed: lines('allowed'), blocked: lines('blocked'), folders: lines('folders').map((f) => f.replace(/^"|"$/g, '')) });
  dirty = false;
  $('done').textContent = 'Saved.';
};
$('reset').onclick = async () => {
  await call({ type: 'resetBlocked' });
  $('blocked').value = (await call({ type: 'state' })).blocked.join('\n');
  $('done').textContent = 'Default blocked sites restored.';
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
load();
