/**
 * Snapshot notifier (Cloud Run function, Pub/Sub push subscription). Issue #169, C07 §2.
 *
 * The draw worker only uploads the PNG of /snapshot to the private bucket, with the Discord
 * interaction in the object's custom metadata. The bucket notification (OBJECT_FINALIZE, JSON_API_V1)
 * publishes to `snapshot-ready`, which pushes here: the chain is event-driven, the worker never waits
 * for the link.
 *
 * Here: read the metadata from the notification payload, sign a V4 read URL valid 1 hour with the
 * function's own identity (IAM signBlob, no key file), and edit the original interaction answer.
 *
 * Answers: 200 when done or when there is nothing to do (no interaction metadata, other event,
 * malformed payload, Discord refusing for good); 500 on a transient failure so Pub/Sub retries, then
 * dead-letters to `snapshot-ready-dlq`.
 */

import { randomBytes } from 'node:crypto';
import type { Request, Response } from '@google-cloud/functions-framework';
import { DiscordWebhookClient, type DiscordWebhook } from './discord-api.js';
import { exportSpan, parseTraceParent } from './trace.js';

export const SIGNED_URL_SECONDS = 3600;

export interface PubSubPushBody {
  message?: {
    data?: string;
    attributes?: Record<string, string>;
    messageId?: string;
  };
}

export interface UrlSigner {
  signReadUrl(bucket: string, objectName: string, expiresInSeconds: number): Promise<string>;
}

export interface NotifierDependencies {
  signer: UrlSigner;
  discord: DiscordWebhook;
}

/** Thrown for failures worth a Pub/Sub redelivery. */
class TransientError extends Error {}

function log(severity: string, message: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ severity, message, function: 'snapshot-notifier', ...fields });
  if (severity === 'ERROR') console.error(line);
  else if (severity === 'WARNING') console.warn(line);
  else console.log(line);
}

export function createSnapshotNotifierHandler(resolveDeps: () => NotifierDependencies) {
  return async function snapshotNotifier(req: Request, res: Response): Promise<void> {
    const message = (req.body as PubSubPushBody)?.message;
    const attributes = message?.attributes ?? {};
    const spanId = randomBytes(8).toString('hex');

    // Nothing here can succeed on a retry: acknowledge (200) instead of filling the dead-letter topic.
    const ignore = (status: string, fields: Record<string, unknown> = {}) => {
      log('WARNING', `Notification ignored: ${status}`, { ...fields, messageId: message?.messageId });
      res.status(200).json({ status });
    };

    if (attributes.eventType && attributes.eventType !== 'OBJECT_FINALIZE') {
      ignore('ignored_event_type', { eventType: attributes.eventType });
      return;
    }

    let object: { bucket?: string; name?: string; metadata?: Record<string, string> };
    try {
      object = JSON.parse(Buffer.from(message?.data ?? '', 'base64').toString('utf8'));
    } catch {
      ignore('ignored_malformed');
      return;
    }
    const bucket = object?.bucket || attributes.bucketId;
    const objectName = object?.name || attributes.objectId;
    const meta = object?.metadata ?? {};
    if (!bucket || !objectName) {
      ignore('ignored_malformed');
      return;
    }

    // Same trace as /snapshot: the parent is the worker span that uploaded the object (Issue #88).
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || 'unknown-project';
    const parent = parseTraceParent(meta.traceparent);
    const traceId = parent?.traceId ?? randomBytes(16).toString('hex');
    const correlationId = meta.correlationId || 'unknown-corr-id';
    const trace = {
      correlationId,
      objectName,
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: parent?.spanId,
      'logging.googleapis.com/trace': `projects/${projectId}/traces/${traceId}`,
      'logging.googleapis.com/spanId': spanId,
      'logging.googleapis.com/trace_sampled': true,
    };
    // The span IDs ride in the answer so that the entry point can export the span (Pub/Sub ignores the body).
    const spanIds = { traceId, spanId, parentSpanId: parent?.spanId, correlationId };

    if (!meta.applicationId || !meta.interactionToken) {
      log('INFO', 'Object has no interaction metadata, nothing to notify', trace);
      res.status(200).json({ status: 'ignored_no_interaction', ...spanIds });
      return;
    }

    let deps: NotifierDependencies;
    try {
      deps = resolveDeps();
    } catch (err) {
      log('ERROR', 'Notifier misconfigured', { ...trace, error: String(err) });
      res.status(500).json({ status: 'failed', ...spanIds });
      return;
    }

    try {
      const url = await deps.signer.signReadUrl(bucket, objectName, SIGNED_URL_SECONDS);
      let result;
      try {
        result = await deps.discord.editOriginal(meta.applicationId, meta.interactionToken, {
          content: `📸 Snapshot of the canvas saved. Signed link, valid 1 hour:\n${url}`,
        });
      } catch (err) {
        throw new TransientError(`Discord unreachable: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!result.ok && (result.status === 429 || result.status >= 500)) {
        throw new TransientError(`Discord answered ${result.status}`);
      }
      if (!result.ok) {
        // 401/404: the interaction token expired (15 min) or is invalid; a retry cannot fix it.
        log('ERROR', `Discord refused the edit (${result.status}), link not delivered`, { ...trace, requestedBy: meta.requestedBy, discordStatus: result.status });
        res.status(200).json({ status: 'discord_rejected', discordStatus: result.status, ...spanIds });
        return;
      }
      // Never log the URL or the token: both are credentials.
      log('NOTICE', 'Signed snapshot link sent to Discord', { ...trace, requestedBy: meta.requestedBy });
      res.status(200).json({ status: 'notified', ...spanIds });
    } catch (err) {
      log('ERROR', 'Snapshot notification failed, Pub/Sub will retry', { ...trace, error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ status: 'failed', ...spanIds });
    }
  };
}

let productionDeps: NotifierDependencies | undefined;

/** Builds the clients once per instance, on the first event. */
async function buildProductionDeps(): Promise<NotifierDependencies> {
  const { Storage } = await import('@google-cloud/storage');
  const storage = new Storage();
  return {
    signer: {
      // No key file on Cloud Run: the client signs through IAM signBlob with the runtime identity
      // (roles/iam.serviceAccountTokenCreator on itself).
      async signReadUrl(bucket, objectName, expiresInSeconds) {
        const [url] = await storage
          .bucket(bucket)
          .file(objectName)
          .getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + expiresInSeconds * 1000 });
        return url;
      },
    },
    discord: new DiscordWebhookClient(),
  };
}

const productionHandler = createSnapshotNotifierHandler(() => {
  if (!productionDeps) throw new Error('dependencies not initialised');
  return productionDeps;
});

export async function snapshotNotifier(req: Request, res: Response): Promise<void> {
  const start = new Date();
  if (!productionDeps) {
    try {
      productionDeps = await buildProductionDeps();
    } catch (err) {
      log('ERROR', 'Notifier initialisation failed', { error: String(err) });
      res.status(500).json({ error: 'notifier initialisation failed' });
      return;
    }
  }

  // Hold the answer until the span is exported: once the answer is sent, Cloud Run throttles the CPU.
  let code = 200;
  let body: any;
  const held = {
    status(c: number) { code = c; return held; },
    json(b: unknown) { body = b; return held; },
    send(b: unknown) { body = b; return held; },
  } as unknown as Response;
  await productionHandler(req, held);

  if (body?.traceId && body?.spanId) {
    await exportSpan({
      traceId: body.traceId,
      spanId: body.spanId,
      parentSpanId: body.parentSpanId,
      name: 'snapshot-notifier OBJECT_FINALIZE',
      start,
      end: new Date(),
      attributes: { correlationId: body.correlationId, outcome: body.status },
    });
  }
  res.status(code).json(body);
}
