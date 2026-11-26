/**
 * Discord interactions proxy (C06 §5, C07 §1). Behind API Gateway, never public.
 *
 * 1. Verifies the Ed25519 signature over the raw body, before anything else (401 if invalid).
 * 2. Answers PING with PONG.
 * 3. For a slash command: publishes the event to pixel-draw-events, then answers a deferred response
 *    (type 5) within Discord's 3 s budget. The worker does the work and edits that response.
 *    If the publish fails, the user gets an ephemeral error instead of a response that never comes.
 */

import * as ff from '@google-cloud/functions-framework';
import { verifyDiscordSignature } from './signature';
import { APPLICATION_COMMAND, PING, buildEvent, type DiscordInteraction, type EventEnvelope } from './interaction';
import { exportSpan, parseTraceParent } from './trace';

const PONG = 1;
const CHANNEL_MESSAGE = 4;
const DEFERRED_CHANNEL_MESSAGE = 5;
const EPHEMERAL = 64;

export interface ProxyDependencies {
  readPublicKey(): Promise<string>;
  publish(envelope: EventEnvelope): Promise<string>;
}

function log(severity: string, message: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ severity, message, function: 'discord-proxy', ...fields });
  if (severity === 'ERROR') console.error(line);
  else console.log(line);
}

export function createDiscordProxyHandler(deps: ProxyDependencies) {
  return async function discordProxy(req: ff.Request, res: ff.Response): Promise<void> {
    const start = new Date();
    // Discord only sends POST
    if (req.method !== 'POST') {
      res.status(405).send('method not allowed');
      return;
    }

    let publicKey: string;
    try {
      publicKey = await deps.readPublicKey();
    } catch (err) {
      log('ERROR', 'Discord public key could not be read', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).send('server misconfigured');
      return;
    }

    const signature = req.get('x-signature-ed25519');
    const timestamp = req.get('x-signature-timestamp');
    const rawBody = req.rawBody;
    if (!signature || !timestamp || !rawBody || !verifyDiscordSignature(publicKey, signature, timestamp, rawBody)) {
      log('WARNING', 'Invalid Discord request signature');
      res.status(401).send('invalid request signature');
      return;
    }

    // Valid signature: the body comes from Discord.
    const interaction = req.body as DiscordInteraction;

    if (interaction.type === PING) {
      res.status(200).json({ type: PONG });
      return;
    }

    if (interaction.type !== APPLICATION_COMMAND) {
      res.status(400).send('unsupported interaction type');
      return;
    }

    const built = buildEvent(interaction);
    if (!built.ok) {
      res.status(200).json({ type: CHANNEL_MESSAGE, data: { content: `❌ ${built.message}`, flags: EPHEMERAL } });
      return;
    }

    const { envelope } = built;
    const ctx = parseTraceParent(envelope.traceParent)!;
    const traceId = ctx.traceId;
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || 'unknown-project';
    const span = (outcome: string) =>
      exportSpan({
        traceId,
        spanId: ctx.spanId, // root span of the request; the worker's span is its child
        name: `discord-proxy /${interaction.data?.name}`,
        start,
        end: new Date(),
        attributes: { correlationId: envelope.correlationId, eventType: envelope.type, outcome },
      });
    try {
      const messageId = await deps.publish(envelope);
      await span('published');
      log('INFO', `Published ${envelope.type} for /${interaction.data?.name}`, {
        correlationId: envelope.correlationId,
        eventId: envelope.id,
        eventType: envelope.type,
        messageId,
        trace_id: traceId,
        'logging.googleapis.com/trace': `projects/${projectId}/traces/${traceId}`,
      });
      res.status(200).json({ type: DEFERRED_CHANNEL_MESSAGE });
    } catch (err) {
      await span('publish_failed');
      log('ERROR', 'Failed to publish the command', {
        correlationId: envelope.correlationId,
        error: err instanceof Error ? err.message : String(err),
        'logging.googleapis.com/trace': `projects/${projectId}/traces/${traceId}`,
      });
      res.status(200).json({ type: CHANNEL_MESSAGE, data: { content: '⚠️ The command could not be queued, try again in a moment.', flags: EPHEMERAL } });
    }
  };
}

// ---- Production wiring: Secret Manager for the public key, Pub/Sub for the events. -------------

const SECRET_VERSION = process.env.DISCORD_PUBLIC_KEY_SECRET_VERSION ?? '';
const TOPIC = process.env.PIXEL_DRAW_TOPIC ?? 'pixel-draw-events';
let cachedKey: string | undefined;
let pubsub: import('@google-cloud/pubsub').PubSub | undefined;

async function readPublicKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  if (!SECRET_VERSION) throw new Error('DISCORD_PUBLIC_KEY_SECRET_VERSION is not set');
  const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
  const [response] = await new SecretManagerServiceClient().accessSecretVersion({ name: SECRET_VERSION });
  const data = response.payload?.data;
  if (!data) throw new Error('the secret version has no payload');
  cachedKey = Buffer.from(data).toString('utf8').trim();
  return cachedKey;
}

async function publish(envelope: EventEnvelope): Promise<string> {
  if (!pubsub) {
    const { PubSub } = await import('@google-cloud/pubsub');
    pubsub = new PubSub();
  }
  return pubsub.topic(TOPIC).publishMessage({
    data: Buffer.from(JSON.stringify(envelope)),
    attributes: {
      correlationId: envelope.correlationId,
      eventType: envelope.type,
      eventSource: envelope.source,
      traceparent: envelope.traceParent,
    },
  });
}

ff.http('discordProxy', createDiscordProxyHandler({ readPublicKey, publish }));
