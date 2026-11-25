import crypto from 'node:crypto';

/** A new signing key: the private half encrypted with a passphrase, and the public half to ship. */
export function newKey(passphrase) {
  if (passphrase.length < 12) throw new Error('Use a passphrase of at least 12 characters.');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

export function sign(bytes, privatePem, passphrase) {
  let key;
  try { key = crypto.createPrivateKey({ key: privatePem, passphrase }); } catch { throw new Error('That passphrase does not open the key.'); }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('That is not a SharedTabs signing key.');
  return {
    signature: crypto.sign(null, bytes, key).toString('base64'),
    publicKey: crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

/** Asks for a secret without showing it. */
export function askSecret(question) {
  if (!process.stdin.isTTY) throw new Error('Run this in an ordinary terminal window, so the passphrase stays hidden.');
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    let s = '';
    const end = (fn, v) => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', on); process.stdout.write('\n'); fn(v); };
    const on = (d) => {
      for (const c of d) {
        if (c === '\r' || c === '\n') { end(resolve, s); return; }
        if (c === '\u0003') { end(reject, new Error('Cancelled.')); return; }
        if (c === '\u007f' || c === '\b') s = s.slice(0, -1);
        else s += c;
      }
    };
    process.stdin.on('data', on);
  });
}
