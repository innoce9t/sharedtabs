import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { older } from '../extension/policy.js';
import { newKey, sign } from '../scripts/signing.mjs';

test('versions', () => {
  assert.equal(older('', '0.7.0'), true);
  assert.equal(older(undefined, '0.7.0'), true);
  assert.equal(older('0.7.0', '0.7.0'), false);
  assert.equal(older('0.10.0', '0.9.0'), false);
});
test('signing keys', () => {
  assert.throws(() => newKey('short'), /at least 12/);
  const k = newKey('correct horse battery');
  assert.match(k.privatePem, /ENCRYPTED PRIVATE KEY/);
  assert.throws(() => sign(Buffer.from('x'), k.privatePem, 'wrong passphrase'), /does not open/);
  const s = sign(Buffer.from('x'), k.privatePem, 'correct horse battery');
  assert.equal(s.publicKey, k.publicKey);
  assert.ok(crypto.verify(null, Buffer.from('x'), crypto.createPublicKey({ key: Buffer.from(k.publicKey, 'base64'), format: 'der', type: 'spki' }), Buffer.from(s.signature, 'base64')));
});
