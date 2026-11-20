import * as ff from '@google-cloud/functions-framework';

ff.http('discordProxy', (req: ff.Request, res: ff.Response) => {
    // discord send only POST
    if (req.method !== 'POST') {
        res.status(405).send('method not allowed');
        return;
    }
    res.status(200).json({ received: true});
});