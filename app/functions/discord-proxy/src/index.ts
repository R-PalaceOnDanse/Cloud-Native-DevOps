import * as ff from '@google-cloud/functions-framework';
import { verifyDiscordSignature } from './signature.js';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

// path to the public key discord
const SECRET_VERSION = process.env.DISCORD_PUBLIC_KEY_SECRET_VERSION ?? ''; 

const secrets = new SecretManagerServiceClient();
let cachedKey: string | undefined;

const PING = 1;
const PONG = 1;

async function readPublicKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  if (!SECRET_VERSION) throw new Error('DISCORD_PUBLIC_KEY_SECRET_VERSION is not set');

  const [response] = await secrets.accessSecretVersion({ name: SECRET_VERSION });
  const data = response.payload?.data;
  if (!data) throw new Error('the secret version has no payload');

  cachedKey = Buffer.from(data).toString('utf8').trim();
  return cachedKey;
}

ff.http('discordProxy', async (req: ff.Request, res: ff.Response) => {
    // discord send only POST
    if (req.method !== 'POST') {
        res.status(405).send('method not allowed');
        return;
    }

    // read the Discord public key from Secret Manager (cached after the first call)
    let publicKey: string;
    try {
        publicKey = await readPublicKey();
    } catch (err) {
        console.error(JSON.stringify({ severity: 'ERROR', message: 'Discord public key could not be read', error: err instanceof Error ? err.message : String(err), function: 'discord-proxy', }));
        res.status(500).send('server misconfigured');
        return;
    }

    // discord header
    const signature = req.get('x-signature-ed25519');
    const timestamp = req.get('x-signature-timestamp');
    const rawBody = req.rawBody;
    //keep a complete copy of incoming buffer

    //check for discord signature
    if (!signature || !timestamp || !rawBody || !verifyDiscordSignature(publicKey, signature, timestamp, rawBody)) {
        console.error(JSON.stringify({ severity: 'ERROR', message: 'Invalid Discord request signature', function: 'discord-proxy', }));
        res.status(401).send('invalid request signature');
        return;
    }

    //valid signature: trust the incoming body
    const interaction = req.body as { type?: number };

    if (interaction.type === PING) {
        res.status(200).json({ type: PONG });
        return;
    }

    res.status(400).send('unsupported interaction type');
});