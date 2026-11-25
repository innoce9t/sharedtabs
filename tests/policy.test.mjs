import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { DEFAULT_BLOCKED, checkUrl, hostInList, parseKey, redactUrl, siteAllowed } from '../extension/policy.js';

const ok = (u) => checkUrl(u, DEFAULT_BLOCKED).ok;

test('blocks banks, password managers and their subdomains', () => {
  for (const u of ['https://www.chase.com/', 'https://secure.bankofamerica.com', 'https://online.emiratesnbd.com', 'https://vault.bitwarden.com', 'https://www.hsbc.ae', 'https://CHASE.com./x', 'https://passwords.google.com', 'https://chromewebstore.google.com/']) assert.equal(ok(u), false, u);
});
test('allows ordinary sites and look-alikes of blocked names', () => {
  for (const u of ['https://example.com', 'https://mail.google.com', 'http://localhost:3000', 'https://notchase.com', 'https://chase.com.example.org', 'https://otherwise.com']) assert.equal(ok(u), true, u);
});
test('only http and https, and no embedded credentials', () => {
  for (const u of ['chrome://settings', 'file:///C:/x', 'javascript:alert(1)', 'data:text/html,x', 'chrome-extension://abc/x', 'about:blank', 'https://a:b@example.com', '', 'nope']) assert.equal(ok(u), false, u);
});
test('exceptions win', () => {
  assert.equal(hostInList('foodbank.org', [...DEFAULT_BLOCKED, '!foodbank.org']), false);
  assert.equal(hostInList('foodbank.org', DEFAULT_BLOCKED), true);
});
test('site permission modes', () => {
  const list = ['example.com'];
  for (const m of ['all', 'session']) assert.equal(siteAllowed(m, 'x.org', []), true);
  for (const m of ['none', undefined, 'bogus']) assert.equal(siteAllowed(m, 'example.com', list), false);
  assert.equal(siteAllowed('specific', 'a.example.com', list), true);
  assert.equal(siteAllowed('specific', 'notexample.com', list), false);
  assert.equal(siteAllowed('specific', 'example.com', []), false);
});
test('network URLs lose values, fragment and credentials', () => {
  assert.equal(redactUrl('https://u:p@x.com/a?token=secret&b=1#frag'), 'https://x.com/a?token=…&b=…');
  assert.equal(redactUrl('data:text/plain,secret'), 'data:…');
});
test('keys', () => {
  assert.equal(parseKey('Enter').text, '\r');
  assert.equal(parseKey('Enter').typesText, false);
  assert.equal(parseKey('a').typesText, true);
  assert.equal(parseKey('Control+a').text, undefined);
  assert.equal(parseKey('Shift+a').key, 'A');
  assert.equal(parseKey('+').key, '+');
  for (const k of ['Control+v', 'ctrl+C', 'Meta+x', 'Shift+Insert', 'Hyper+a', 'nope', '']) assert.throws(() => parseKey(k), undefined, k);
});
test('extension-id.txt matches the manifest key', () => {
  const m = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url)));
  const hash = crypto.createHash('sha256').update(Buffer.from(m.key, 'base64')).digest('hex').slice(0, 32);
  const id = [...hash].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');
  assert.equal(fs.readFileSync(new URL('../extension-id.txt', import.meta.url), 'utf8').split(/\s+/)[0], id);
});
