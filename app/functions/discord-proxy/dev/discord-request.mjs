// Outil de dev : joue le rôle de Discord en local.
//   node dev/discord-request.mjs key            -> affiche la clé publique de test
//   node dev/discord-request.mjs '{"type":1}'   -> signe ce body et l'envoie à localhost:8080
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const KEY_FILE = '.dev-discord-key.pem';

// Au premier lancement, crée une paire de clés de test et garde la clé privée dans un fichier.
if (!existsSync(KEY_FILE)) {
  const { privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(KEY_FILE, privateKey.export({ format: 'pem', type: 'pkcs8' }));
}
const privateKey = createPrivateKey(readFileSync(KEY_FILE));

const arg = process.argv[2] ?? '{"type":1}';

if (arg === 'key') {
  const x = createPublicKey(privateKey).export({ format: 'jwk' }).x;
  console.log(Buffer.from(x, 'base64url').toString('hex'));
  process.exit(0);
}

// Signe exactement comme Discord : timestamp + body brut.
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = sign(null, Buffer.from(timestamp + arg), privateKey).toString('hex');

const res = await fetch('http://localhost:8080', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-signature-ed25519': signature,
    'x-signature-timestamp': timestamp,
  },
  body: arg,
});
console.log(res.status, await res.text());