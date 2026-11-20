import * as ff from '@google-cloud/functions-framework';
import { verifyDiscordSignature } from './signature.js';

// public key discord
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY ?? '';

const PING = 1;
const PONG = 1;

ff.http('discordProxy', (req: ff.Request, res: ff.Response) => {
    // discord send only POST
    if (req.method !== 'POST') {
        res.status(405).send('method not allowed');
        return;
    }

    // no public key, no check
    if (!PUBLIC_KEY) {
        console.error(JSON.stringify({ severity: 'ERROR', message: 'DISCORD_PUBLIC_KEY is not set', function: 'discord-proxy' }));
        res.status(500).send('server misconfigured');
        return;
    }

    // discord header
    const signature = req.get('x-signature-ed25519');
    const timestamp = req.get('x-signature-timestamp');
    const rawBody = req.rawBody;
    //keep a complete copy of incoming buffer

    //check for discord signature
    if (!signature || !timestamp || !rawBody || !verifyDiscordSignature(PUBLIC_KEY, signature, timestamp, rawBody)) {
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