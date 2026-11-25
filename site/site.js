// Copy buttons, and the card glow that follows the mouse. The page works without either.
for (const b of document.querySelectorAll('[data-copy]')) {
  b.hidden = false;
  const label = b.textContent;
  let timer;
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById(b.dataset.copy).textContent.trim());
      b.textContent = 'Copied';
    } catch { b.textContent = 'Select and copy'; }
    clearTimeout(timer);
    timer = setTimeout(() => { b.textContent = label; }, 2000);
  });
}
let queued = false;
addEventListener('pointermove', (e) => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const cards = [...document.querySelectorAll('.card')].map((c) => [c, c.getBoundingClientRect()]);
    for (const [c, r] of cards) {
      c.style.setProperty('--mouse-x', `${e.clientX - r.left}px`);
      c.style.setProperty('--mouse-y', `${e.clientY - r.top}px`);
    }
  });
}, { passive: true });

// Tips, through the website's own coffee endpoint. The server checks everything again, and payment happens on Ziina's page.
// The limits match the endpoint. Ziina converts to its owner's currency.
const CURRENCIES = {
  USD: { min: 1, max: 250, quick: [3, 5, 10] },
  EUR: { min: 1, max: 250, quick: [3, 5, 10] },
  GBP: { min: 1, max: 200, quick: [3, 5, 10] },
  AED: { min: 2, max: 1000, quick: [10, 20, 50] },
  SAR: { min: 3, max: 1000, quick: [10, 20, 50] },
  INR: { min: 100, max: 20000, quick: [200, 500, 1000] },
};
const tip = document.querySelector('.coffee-form');
const tipCurrency = tip.querySelector('select');
const tipQuick = [...tip.querySelectorAll('[data-quick]')];
for (const code of Object.keys(CURRENCIES)) tipCurrency.add(new Option(code, code));
tipCurrency.value = 'USD';
const tipAmount = tip.querySelector('input');
const tipButton = tip.querySelector('[type=submit]');
const tipNote = tip.querySelector('.note');
const tipText = tipNote.textContent;
let tipBusy = false;
function drawTip() {
  const code = tipCurrency.value;
  const { min, max, quick } = CURRENCIES[code];
  const n = Number(tipAmount.value);
  const ok = /^\d+$/.test(tipAmount.value) && n >= min && n <= max;
  tipQuick.forEach((b, i) => {
    b.textContent = quick[i];
    b.setAttribute('aria-label', `${code} ${quick[i]}`);
    b.setAttribute('aria-pressed', String(tipAmount.value === String(quick[i])));
  });
  tipAmount.setAttribute('aria-label', `Other amount in ${code}, from ${min} to ${max}`);
  tipAmount.setAttribute('aria-invalid', String(tipAmount.value !== '' && !ok));
  tipButton.disabled = !ok || tipBusy;
  tipButton.textContent = tipBusy ? 'Opening Ziina…' : ok ? `Pay ${code} ${n}` : tipAmount.value === '' ? 'Choose an amount' : /^\d+$/.test(tipAmount.value) ? `${code} ${min} to ${max}` : 'Whole amounts only';
  tip.dispatchEvent(new CustomEvent('tip', { detail: ok ? n / quick[1] : 0 }));
  return ok ? n : 0;
}
function tipSay(text) {
  tipNote.textContent = text || tipText;
  tipNote.classList.toggle('bad', !!text);
}
tip.addEventListener('click', (e) => {
  const b = e.target.closest('[data-quick]');
  if (!b) return;
  tipAmount.value = tipAmount.value === b.textContent ? '' : b.textContent;
  tipSay('');
  drawTip();
});
// The same number can be a very different amount of money, so it isn't carried over.
tipCurrency.addEventListener('change', () => {
  const i = tipQuick.findIndex((b) => b.getAttribute('aria-pressed') === 'true');
  tipAmount.value = i < 0 ? '' : String(CURRENCIES[tipCurrency.value].quick[i]);
  tipSay('');
  drawTip();
});
tipAmount.addEventListener('input', () => { tipSay(''); drawTip(); });
tip.addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = drawTip();
  if (!amount || tipBusy) return;
  tipBusy = true;
  tipSay('');
  drawTip();
  try {
    const r = await fetch('/api/coffee.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', amount, currency: tipCurrency.value, note: 'SharedTabs' }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'The payment service did not respond. Please try again.');
    const u = new URL(d.redirectUrl);
    if (u.protocol !== 'https:' || !/(^|\.)ziina\.com$/.test(u.hostname)) throw new Error('The payment service did not respond. Please try again.');
    location.assign(u.href);
  } catch (err) {
    tipBusy = false;
    drawTip();
    tipSay(err instanceof TypeError ? 'Could not reach the payment service. Please try again.' : err.message);
  }
});
// Coming back from Ziina with the Back button can restore this page as it was left.
addEventListener('pageshow', () => { tipBusy = false; drawTip(); });
drawTip();
