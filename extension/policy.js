// Which sites agents may touch. Pure functions, so they can be unit tested.

// One pattern per line. "example.com" also covers its subdomains; "*" matches any characters in the
// whole host name; a leading "!" makes an exception.
export const DEFAULT_BLOCKED = [
  '# Banks and payments',
  '*bank*', 'chase.com', 'wellsfargo.com', 'citi.com', 'hsbc.*', 'hsbc.co.uk', 'barclays.*', 'barclays.co.uk', 'santander.*',
  'capitalone.com', 'americanexpress.com', 'revolut.com', 'wise.com', 'monzo.com', 'paypal.com', 'venmo.com', 'cash.app',
  'stripe.com', 'emiratesnbd.com', 'adcb.com', 'adib.ae', 'adib.com', 'dib.ae', 'cbd.ae', 'mashreq.com', 'wio.io', 'liv.me', 'sc.com',
  '# Trading and crypto',
  'fidelity.com', 'schwab.com', 'vanguard.com', 'robinhood.com', 'interactivebrokers.*', 'etoro.com',
  'coinbase.com', 'binance.com', 'kraken.com', 'bybit.com', 'okx.com',
  '# Passwords and account security',
  '1password.com', '1password.eu', 'bitwarden.com', 'lastpass.com', 'dashlane.com', 'keepersecurity.com', 'proton.me',
  'passwords.google.com', 'myaccount.google.com', 'account.microsoft.com', 'appleid.apple.com', 'account.apple.com',
  '# Government identity',
  'uaepass.ae', 'login.gov', 'irs.gov', 'ssa.gov',
  '# Browser stores',
  'chromewebstore.google.com', 'chrome.google.com',
];

export function normalizeHost(host) {
  return host.toLowerCase().replace(/\.+$/, '');
}

function matches(host, pattern) {
  if (!pattern.includes('*')) return host === pattern || host.endsWith('.' + pattern);
  const body = pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^(.*\\.)?${body}$`).test(host);
}

/** Whether a host is covered by a list of patterns. Used for both the blocked and the allowed list. */
export function hostInList(rawHost, patterns) {
  const host = normalizeHost(rawHost);
  let found = false;
  for (const line of patterns) {
    const p = line.trim().toLowerCase();
    if (!p || p.startsWith('#')) continue;
    if (p.startsWith('!')) { if (matches(host, p.slice(1).trim())) return false; } else if (matches(host, p)) found = true;
  }
  return found;
}

/** { ok: true, origin, host } or { ok: false, reason } */
export function checkUrl(url, patterns) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, reason: 'That is not a valid URL.' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: `Agents cannot use ${u.protocol} pages, only http and https.` };
  }
  if (u.username || u.password) return { ok: false, reason: 'URLs containing a username or password are not allowed.' };
  if (hostInList(u.hostname, patterns)) {
    return { ok: false, reason: `${normalizeHost(u.hostname)} is on the user's blocked list. Do not look for a way around it.` };
  }
  return { ok: true, origin: u.origin, host: normalizeHost(u.hostname) };
}

/** Whether the user's site permission covers a host. mode: all | session | specific | none */
export function siteAllowed(mode, host, allowed) {
  if (mode === 'all' || mode === 'session') return true;
  return mode === 'specific' && hostInList(host, allowed);
}

/** URL with query values and fragment removed, for the network log. */
export function redactUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return `${u.protocol}…`;
    const names = [...new Set([...u.searchParams.keys()])];
    return u.origin + u.pathname + (names.length ? '?' + names.map((n) => `${encodeURIComponent(n)}=…`).join('&') : '');
  } catch { return '(invalid URL)'; }
}

const NAMED = {
  enter: ['Enter', 'Enter', 13, '\r'], tab: ['Tab', 'Tab', 9], escape: ['Escape', 'Escape', 27], esc: ['Escape', 'Escape', 27],
  backspace: ['Backspace', 'Backspace', 8], delete: ['Delete', 'Delete', 46], space: [' ', 'Space', 32, ' '],
  arrowup: ['ArrowUp', 'ArrowUp', 38], arrowdown: ['ArrowDown', 'ArrowDown', 40], arrowleft: ['ArrowLeft', 'ArrowLeft', 37], arrowright: ['ArrowRight', 'ArrowRight', 39],
  home: ['Home', 'Home', 36], end: ['End', 'End', 35], pageup: ['PageUp', 'PageUp', 33], pagedown: ['PageDown', 'PageDown', 34],
};
const MODS = { alt: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, shift: 8 };

/** Whether version a is older than b. A missing version is oldest. */
export function older(a, b) {
  const n = (v) => (/^\d+\.\d+\.\d+$/.test(v || '') ? v.split('.').map(Number) : [0, 0, 0]);
  const x = n(a); const y = n(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
}

/** "ctrl+shift" as CDP modifier bits. */
export function parseModifiers(spec) {
  let bits = 0;
  for (const m of (spec || '').split('+').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (!MODS[m]) throw new Error(`Unknown modifier: ${m}`);
    bits |= MODS[m];
  }
  return bits;
}

/** Parses "Tab Tab Enter" into keys. */
export function parseKeys(spec, repeat = 1) {
  const names = spec === ' ' ? ['Space'] : spec.trim().split(/\s+/);
  if (names.length * repeat > 100) throw new Error('At most 100 key presses in one call.');
  const keys = names.map(parseKey);
  return Array.from({ length: repeat }, () => keys).flat();
}

/** Parses "Control+a" into CDP key fields, or throws. */
export function parseKey(spec) {
  const parts = spec === '+' ? ['+'] : spec.split('+').map((s) => s.trim());
  const keyName = parts.pop();
  let modifiers = 0;
  for (const m of parts) {
    const bit = MODS[m.toLowerCase()];
    if (!bit) throw new Error(`Unknown modifier: ${m}`);
    modifiers |= bit;
  }
  let key; let code; let vk; let text;
  const named = NAMED[keyName?.toLowerCase()];
  if (named) [key, code, vk, text] = named;
  else if (/^f([1-9]|1[0-2])$/i.test(keyName)) { key = code = keyName.toUpperCase(); vk = 111 + Number(keyName.slice(1)); }
  else if (keyName && [...keyName].length === 1) {
    key = modifiers & 8 ? keyName.toUpperCase() : keyName;
    const up = keyName.toUpperCase();
    if (/[A-Z]/.test(up)) { code = `Key${up}`; vk = up.charCodeAt(0); } else if (/[0-9]/.test(up)) { code = `Digit${up}`; vk = up.charCodeAt(0); } else { code = ''; vk = 0; }
    text = key;
  } else throw new Error(`Unknown key: ${keyName}`);
  const command = modifiers & (1 | 2 | 4);
  if ((command & 6 && ['KeyC', 'KeyX', 'KeyV', 'Insert'].includes(code)) || /^insert$/i.test(keyName)) {
    throw new Error('Clipboard shortcuts are not allowed.');
  }
  if (command) text = undefined;
  return { key, code, vk, text, modifiers, typesText: text !== undefined && key !== 'Enter' };
}
