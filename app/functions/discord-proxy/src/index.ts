import * as ff from '@google-cloud/functions-framework';
import { time } from 'node:console';

ff.http('discordProxy', (req: ff.Request, res: ff.Response) => {
    // discord send only POST
    if (req.method !== 'POST') {
        res.status(405).send('method not allowed');
        return;
    }

    // discord header
    const signature = req.get('x-signature-ed25519');
    const timestamp = req.get('x-signature-timestamp');
    const rawBody = req.rawBody;//keep a complete copy of incoming buffer

    //check for discord signature
    if (!signature || !timestamp || !rawBody) {
        res.status(401).send('missing signature');
        return;
    }

    res.status(200).json({
        raw: rawBody.toString('utf8'),
        reserialized: JSON.stringify(req.body),
    });
});