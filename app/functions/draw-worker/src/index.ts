/**
 * Draw and command worker (Cloud Run function, Pub/Sub push subscription).
 *
 * Consumes the events of `pixel-draw-events`:
 *   - pixel.draw        from the web proxy and the Discord proxy (/draw)
 *   - discord.command   /get, /snapshot, /admin pause|resume|clear|ratelimit
 *
 * State lives in Firestore and Cloud Storage, never in the instance (Issue #167). A transient failure
 * answers 500 so Pub/Sub redelivers, then dead-letters after 5 attempts; a business rejection (paused,
 * rate limited, unauthorized, invalid) answers 200 so it is not retried.
 *
 * Issues #48, #52, #53, #55, #56, #57, #68, #141, #142, #167, #169 (C06 §4, C07 §1-2).
 */

import { randomBytes } from 'node:crypto';
import type { Request, Response } from '@google-cloud/functions-framework';
import { isUserAdmin } from './admin-auth.js';
import { discordApiClient, type DiscordApiClient } from './discord-api.js';
import { renderCanvas, snapshotObjectName, type SnapshotStorage } from './snapshot-service.js';
import { isValidColor, isValidCoordinate, type CanvasStore, type PixelWrite, type RateLimiter } from './store.js';
import { exportSpan } from './trace.js';

export interface PubSubMessagePayload {
  message?: {
    data?: string;
    attributes?: Record<string, string>;
    messageId?: string;
    publishTime?: string;
  };
}

export interface WorkerDependencies {
  canvas: CanvasStore;
  rateLimiter: RateLimiter;
  snapshots: SnapshotStorage;
  discord: DiscordApiClient;
}

function log(severity: string, message: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ severity, message, function: 'draw-worker', ...fields });
  if (severity === 'ERROR') console.error(line);
  else if (severity === 'WARNING') console.warn(line);
  else console.log(line);
}

export function createDrawWorkerHandler(resolveDeps: () => WorkerDependencies) {
  return async function drawWorker(req: Request, res: Response): Promise<void> {
    const body = req.body as PubSubMessagePayload;
    if (!body?.message?.data) {
      res.status(400).json({ error: 'Bad Request: missing Pub/Sub message data.' });
      return;
    }

    let envelope: any;
    try {
      envelope = JSON.parse(Buffer.from(body.message.data, 'base64').toString('utf8'));
    } catch {
      // A message that cannot be parsed will never succeed: acknowledge it, do not retry.
      res.status(400).json({ error: 'Bad Request: unable to parse JSON message payload.' });
      return;
    }

    const attributes = body.message.attributes ?? {};
    const correlationId: string = envelope.correlationId || attributes.correlationId || 'unknown-corr-id';
    const eventType: string | undefined = envelope.type || attributes.eventType;
    const eventSource: string = envelope.source || attributes.eventSource || 'unknown';

    // Trace context propagated from the proxy (W3C traceparent), linked in Cloud Logging (Issue #88, #89).
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || 'unknown-project';
    const parent = String(envelope.traceParent || attributes.traceparent || '').match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i);
    const traceId = parent ? parent[1]!.toLowerCase() : randomBytes(16).toString('hex');
    const spanId = randomBytes(8).toString('hex');
    const trace = {
      correlationId,
      eventId: envelope.id,
      eventType,
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: parent ? parent[2]!.toLowerCase() : undefined,
      'logging.googleapis.com/trace': `projects/${projectId}/traces/${traceId}`,
      'logging.googleapis.com/spanId': spanId,
      'logging.googleapis.com/trace_sampled': true,
    };
    log('INFO', `Processing event: ${eventType} from ${eventSource}`, trace);

    const data = envelope.data ?? {};
    const appId: string | undefined = data.applicationId;
    const token: string | undefined = data.interactionToken;

    let deps: WorkerDependencies;
    try {
      deps = resolveDeps();
    } catch (err) {
      log('ERROR', 'Worker misconfigured', { ...trace, error: String(err) });
      res.status(500).json({ error: 'worker misconfigured', correlationId });
      return;
    }

    const reply = async (content: string) => {
      if (appId && token) await deps.discord.editOriginalResponse(appId, token, { content });
    };
    // The span IDs ride in the answer so that the entry point can export the span (Pub/Sub ignores the body).
    const spanIds = { traceId, spanId, parentSpanId: trace.parent_span_id, eventType };
    const done = (status: string, extra: Record<string, unknown> = {}) => {
      res.status(200).json({ status, correlationId, ...extra, ...spanIds });
    };

    try {
      if (eventType === 'pixel.draw') {
        const userId: string = data.userId || 'anonymous';
        const author: string = data.author || (eventSource === 'web' ? `web:${userId}` : `discord:${userId}`);
        const pixels: PixelWrite[] = Array.isArray(data.pixels) ? data.pixels : [];

        if (pixels.length === 0 || pixels.some((p) => !isValidCoordinate(p?.x, p?.y) || !isValidColor(p?.color))) {
          log('WARNING', 'Draw rejected: invalid pixel', trace);
          await reply('❌ Invalid pixel: x and y must be between 0 and 9999 and the color a hex value like #ff0000.');
          done('invalid_coordinates');
          return;
        }

        const system = await deps.canvas.getSystemState();
        if (system.paused) {
          log('WARNING', 'Draw rejected: canvas paused', { ...trace, userId });
          await reply('⏸️ Drawing is paused by an administrator.');
          done('rejected_paused');
          return;
        }

        const rate = await deps.rateLimiter.tryConsume(userId, pixels.length);
        if (!rate.allowed) {
          log('WARNING', 'Draw rejected: rate limit', { ...trace, userId, retryAfterSeconds: rate.retryAfterSeconds });
          await reply(`⏳ ${rate.message ?? 'Rate limit reached.'}`);
          done('rate_limited', { retryAfterSeconds: rate.retryAfterSeconds });
          return;
        }

        const result = await deps.canvas.applyDraw(envelope.id, pixels, author, Number(envelope.timestamp) || Date.now());
        log('INFO', `pixel.processed: ${result.applied} pixels applied`, { ...trace, userId, applied: result.applied, duplicate: result.duplicate });
        const first = pixels[0]!;
        await reply(`✅ ${pixels.length === 1 ? 'Pixel' : `${pixels.length} pixels`} drawn at (${first.x}, ${first.y}).`);
        done('processed', { applied: result.applied, duplicate: result.duplicate });
        return;
      }

      if (eventType === 'discord.command') {
        const userId: string = data.userId;
        const options = data.options ?? {};
        const subcommand: string | undefined = options.subcommand || options.action;
        const system = await deps.canvas.getSystemState();
        const admin = () => isUserAdmin(userId, data.roleIds, system.admins);

        if (data.commandName === 'get') {
          const image = renderCanvas(await deps.canvas.listPixels());
          if (appId && token) {
            await deps.discord.postFollowupWithImage(
              appId,
              token,
              image.png,
              'canvas.png',
              `🎨 Current canvas, from (${image.originX}, ${image.originY}), 1 image pixel = ${image.scale}×${image.scale} cells.`
            );
          }
          done('get_success');
          return;
        }

        if (data.commandName === 'snapshot') {
          if (!admin()) {
            await reply('⛔ `/snapshot` is reserved to administrators.');
            done('unauthorized');
            return;
          }
          if (!appId || !token) {
            // Nobody to send the link to: the notifier would ignore the object anyway.
            done('invalid_arguments');
            return;
          }
          const image = renderCanvas(await deps.canvas.listPixels());
          const objectName = snapshotObjectName();
          // Answer before the upload: the notifier edits the same message, and this edit must not
          // land after the link and overwrite it.
          await reply('📸 Snapshot is being prepared, the signed link follows in this message.');
          await deps.snapshots.save(objectName, image.png, {
            applicationId: appId,
            interactionToken: token,
            correlationId,
            // The notifier span becomes a child of this one: one trace from /snapshot to the link.
            traceparent: `00-${traceId}-${spanId}-01`,
            requestedBy: String(userId ?? ''),
          });
          log('NOTICE', `Snapshot stored: ${objectName}`, trace);
          done('snapshot_success', { objectName });
          return;
        }

        if (data.commandName === 'admin') {
          if (!admin()) {
            log('WARNING', 'Unauthorized admin command', { ...trace, userId, subcommand });
            await reply('⛔ This command is reserved to administrators.');
            done('unauthorized');
            return;
          }

          if (subcommand === 'pause' || subcommand === 'resume') {
            await deps.canvas.setPaused(subcommand === 'pause', userId);
            log('NOTICE', `Canvas ${subcommand}d by admin`, { ...trace, userId });
            await reply(subcommand === 'pause' ? '⏸️ Drawing is now paused for everyone.' : '▶️ Drawing is allowed again.');
            done(`admin_${subcommand}_success`);
            return;
          }

          if (subcommand === 'clear') {
            const epoch = await deps.canvas.clear(userId);
            log('NOTICE', `Canvas cleared by admin, epoch ${epoch}`, { ...trace, userId });
            await reply('🧹 The canvas has been cleared.');
            done('admin_clear_success', { epoch });
            return;
          }

          if (subcommand === 'ratelimit') {
            const target = String(options.user ?? '');
            const limit = Number(options.limit);
            if (!target || !Number.isInteger(limit) || limit < 0) {
              await reply('❌ Usage: /admin ratelimit user:<user> limit:<pixels per minute, 0 or more>');
              done('invalid_arguments');
              return;
            }
            await deps.rateLimiter.setOverride(target, limit);
            log('NOTICE', `Rate limit of ${target} set to ${limit}/min`, { ...trace, userId });
            await reply(`⚙️ <@${target}> can now draw **${limit} pixels per minute**.`);
            done('admin_ratelimit_success', { targetUser: target, limit });
            return;
          }
        }
      }

      done('ignored_unrecognized_event');
    } catch (err) {
      // Transient failure (Firestore, Storage, Discord): let Pub/Sub retry, then dead-letter.
      log('ERROR', 'Event processing failed', { ...trace, error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'processing failed', status: 'failed', correlationId, ...spanIds });
    }
  };
}

let productionDeps: WorkerDependencies | undefined;

/** Builds the Google Cloud clients once per instance, on the first event. */
async function buildProductionDeps(): Promise<WorkerDependencies> {
  const bucket = process.env.SNAPSHOT_BUCKET;
  if (!bucket) throw new Error('SNAPSHOT_BUCKET is not set');
  const [{ Firestore }, { Storage }, store, snapshot] = await Promise.all([
    import('@google-cloud/firestore'),
    import('@google-cloud/storage'),
    import('./firestore-store.js'),
    import('./snapshot-service.js'),
  ]);
  const db = new Firestore({ ignoreUndefinedProperties: true });
  return {
    canvas: new store.FirestoreCanvasStore(db),
    rateLimiter: new store.FirestoreRateLimiter(db),
    snapshots: new snapshot.GcsSnapshotStorage(new Storage(), bucket),
    discord: discordApiClient,
  };
}

const productionHandler = createDrawWorkerHandler(() => {
  if (!productionDeps) throw new Error('dependencies not initialised');
  return productionDeps;
});

export async function drawWorker(req: Request, res: Response): Promise<void> {
  const start = new Date();
  if (!productionDeps) {
    try {
      productionDeps = await buildProductionDeps();
    } catch (err) {
      log('ERROR', 'Worker initialisation failed', { error: String(err) });
      res.status(500).json({ error: 'worker initialisation failed' });
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
      name: `draw-worker ${body.eventType ?? 'event'}`,
      start,
      end: new Date(),
      attributes: { correlationId: body.correlationId, outcome: body.status, applied: body.applied },
    });
  }
  res.status(code).json(body);
}
