const $ = (id) => document.getElementById(id);
const call = async (m) => {
  const r = await chrome.runtime.sendMessage(m);
  if (r?.error) throw new Error(r.error);
  return r.ok;
};
function show(agreed) {
  $('agree').disabled = agreed;
  $('decline').textContent = agreed ? 'Withdraw agreement' : 'Not now';
  $('done').textContent = agreed ? 'SharedTabs is on. Choose which sites agents may use in Settings.' : '';
}
$('agree').onclick = async () => {
  await call({ type: 'consent', agreed: true });
  location.href = 'options.html';
};
$('decline').onclick = async () => {
  await call({ type: 'consent', agreed: false });
  show(false);
  $('done').textContent = 'SharedTabs stays off. You can open this page again from the toolbar popup.';
};
show((await call({ type: 'state' })).consent);
