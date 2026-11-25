import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MAX_FILE, checkAllowed, isInside, readUpload } from '../host/files.mjs';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-chrome-files-')));
const ok = path.join(tmp, 'ok');
const other = path.join(tmp, 'other');
for (const d of [ok, other, path.join(ok, 'sub'), path.join(ok, '.ssh'), path.join(tmp, 'ok-evil')]) fs.mkdirSync(d);
const put = (...p) => { const f = path.join(...p); fs.writeFileSync(f, 'data'); return f; };
const folders = { mode: 'folders', folders: [ok] };
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('any file type in a listed folder, including subfolders', () => {
  for (const f of ['cv.pdf', 'photo.JPG', 'clip.mp4', 'data.csv', 'no-extension', 'sub\\letter.docx', 'key findings.docx', 'tokens explained.pdf']) {
    put(ok, f);
    assert.equal(readUpload(path.join(ok, f), folders).data.toString(), 'data', f);
  }
  assert.equal(readUpload(path.join(ok, 'CV.PDF').replaceAll('\\', '/'), folders).name, 'cv.pdf');
});
test('outside the listed folder is refused', () => {
  const f = put(other, 'cv.pdf');
  const g = put(tmp, 'ok-evil', 'cv.pdf');
  for (const p of [f, g, path.join(ok, '..', 'other', 'cv.pdf')]) assert.throws(() => readUpload(p, folders), /not in a folder/, p);
});
test('a junction out of the folder is refused', () => {
  fs.symlinkSync(other, path.join(ok, 'link'), 'junction');
  assert.throws(() => readUpload(path.join(ok, 'link', 'cv.pdf'), folders), /not in a folder/);
});
test('network, device, stream and relative paths are refused', () => {
  for (const p of ['\\\\server\\share\\cv.pdf', '//server/share/cv.pdf', '\\\\?\\C:\\x.pdf', '\\\\.\\pipe\\x', 'cv.pdf', '..\\cv.pdf', 'C:cv.pdf', path.join(ok, 'cv.pdf') + ':hidden', 'file:///C:/x', '', null, 5]) {
    assert.throws(() => readUpload(p, { mode: 'any', folders: [] }), /full local path/, String(p));
  }
});
test('secrets are refused everywhere', () => {
  for (const n of ['.env', '.env.local', 'prod.env', 'server.pem', 'private.key', 'id_rsa', 'id_ed25519.pub', 'vault.kdbx', 'credentials.json', 'client_secret.json', 'google_client_secret.json', 'google_token.json', 'auth.json', '.npmrc', '.git-credentials', 'Login Data', 'Cookies']) {
    const f = put(ok, n);
    for (const mode of ['folders', 'any']) assert.throws(() => readUpload(f, { mode, folders: [ok] }), /can't be uploaded/, n);
  }
});
test('protected folders', () => {
  assert.throws(() => readUpload(put(ok, '.ssh', 'config'), folders), /protected folder/);
  assert.throws(() => readUpload(put(other, 'a.pdf'), { mode: 'any', folders: [] }), /protected folder/); // the temp folder is in AppData
  assert.throws(() => checkAllowed('C:\\Windows\\System32\\drivers\\etc\\hosts', { mode: 'any', folders: [] }), /protected folder/);
  assert.doesNotThrow(() => checkAllowed('D:\\Photos\\a.jpg', { mode: 'any', folders: [] }));
});
test('off, unknown mode, missing, folder, too large', () => {
  const f = put(ok, 'cv.pdf');
  for (const mode of ['off', undefined, 'bogus']) assert.throws(() => readUpload(f, { mode, folders: [ok] }), /turned off/);
  assert.throws(() => readUpload(path.join(ok, 'nope.pdf'), folders), /no file at/);
  assert.throws(() => readUpload(path.join(ok, 'sub'), folders));
  const big = path.join(ok, 'big.bin');
  fs.writeFileSync(big, Buffer.alloc(MAX_FILE + 1));
  assert.throws(() => readUpload(big, folders), /larger than 20 MB/);
});
test('isInside', () => {
  assert.equal(isInside('C:\\a\\b.txt', 'C:\\A'), true);
  assert.equal(isInside('C:\\ab\\b.txt', 'C:\\a'), false);
  assert.equal(isInside('D:\\a\\b.txt', 'C:\\a'), false);
});
