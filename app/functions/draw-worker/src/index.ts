/**
 * Draw and Command Worker Cloud Function.
 * Consumes Pub/Sub messages, enforces rate limits and admin authorization,
 * performs transactional writes to Firestore chunks, and updates Discord interactions.
 * 
 * Fulfills Issues #48, #52, #53, #55, #56, #57, #68, #141, #142 (C06 §4, C07 §1 & §2).
 */

import type { Request, Response } from '@google-cloud/functions-framework';
import { ChunkStore, defaultChunkStore, isValidCoordinate } from './chunk-store.js';
import { WorkerRateLimiter, defaultWorkerRateLimiter } from './rate-limiter.js';
import { isUserAdmin } from './admin-auth.js';
import { discordApiClient, DiscordApiClient } from './discord-api.js';
import { SnapshotService, defaultSnapshotService } from './snapshot-service.js';

export interface PubSubMessagePayload {
  message?: {
    data?: string;
    attributes?: Record<string, string>;
    messageId?: string;
    publishTime?: string;
  };
}

export interface WorkerDependencies {
  chunkStore?: ChunkStore;
  rateLimiter?: WorkerRateLimiter;
  snapshotService?: SnapshotService;
  discordClient?: DiscordApiClient;
  firestoreAdmins?: readonly string[];
  snapshotBucketName?: string;
}

export function createDrawWorkerHandler(deps: WorkerDependencies = {}) {
  const chunkStore = deps.chunkStore || defaultChunkStore;
  const rateLimiter = deps.rateLimiter || defaultWorkerRateLimiter;
  const snapshotService = deps.snapshotService || defaultSnapshotService;
  const discord = deps.discordClient || discordApiClient;
  const firestoreAdmins = deps.firestoreAdmins || [];
  const snapshotBucketName = deps.snapshotBucketName || process.env.SNAPSHOT_BUCKET || 'teampasx-canvas-snapshots';

  return async function drawWorker(req: Request, res: Response): Promise<void> {
    const rawBody = req.body as PubSubMessagePayload;

    if (!rawBody?.message?.data) {
      res.status(400).json({ error: 'Bad Request: missing Pub/Sub message data.' });
      return;
    }

    // 1. Decode Base64 Pub/Sub Data
    let envelope: any;
    try {
      const decodedString = Buffer.from(rawBody.message.data, 'base64').toString('utf8');
      envelope = JSON.parse(decodedString);
    } catch {
      res.status(400).json({ error: 'Bad Request: unable to parse JSON message payload.' });
      return;
    }

    const correlationId = envelope.correlationId || rawBody.message.attributes?.correlationId || 'unknown-corr-id';
    const eventType = envelope.type || rawBody.message.attributes?.eventType;
    const eventSource = envelope.source || rawBody.message.attributes?.eventSource || 'unknown';

    // Structured JSON log for Cloud Logging / distributed tracing (Issue #89)
    console.log(
      JSON.stringify({
        severity: 'INFO',
        message: `Processing event: ${eventType} from ${eventSource}`,
        correlationId,
        eventId: envelope.id,
        eventType,
      })
    );

    // 2. Route by Event Type
    if (eventType === 'pixel.draw') {
      const data = envelope.data || {};
      const userId = data.userId || 'anonymous';
      const author = data.author || (eventSource === 'web' ? 'Web User' : `Discord:<@${userId}>`);
      const pixels: Array<{ x: number; y: number; color: string }> = data.pixels || [];
      const appId = data.applicationId;
      const token = data.interactionToken;

      // 2a. Check Global Canvas Pause State (Issue #57)
      if (chunkStore.getPauseState()) {
        console.warn(
          JSON.stringify({
            severity: 'WARNING',
            message: 'Draw rejected: canvas is currently paused by an administrator.',
            correlationId,
            userId,
          })
        );
        if (appId && token) {
          await discord.editOriginalResponse(appId, token, {
            content: '⏸️ Le canevas est actuellement en pause par un administrateur. Le dessin est suspendu.',
          });
        }
        res.status(200).json({ status: 'rejected_paused', correlationId });
        return;
      }

      // 2b. Check User Rate Limit (Issue #52)
      const rateCheck = rateLimiter.tryConsume(userId, pixels.length);
      if (!rateCheck.allowed) {
        console.warn(
          JSON.stringify({
            severity: 'WARNING',
            message: `Draw rejected: rate limit exceeded for user ${userId}`,
            correlationId,
            userId,
            retryAfterSeconds: rateCheck.retryAfterSeconds,
          })
        );
        if (appId && token) {
          await discord.editOriginalResponse(appId, token, {
            content: `⏳ ${rateCheck.message || 'Rate limit atteint.'}`,
          });
        }
        res.status(200).json({ status: 'rate_limited', correlationId });
        return;
      }

      // 2c. Validate Pixel Coordinates
      for (const p of pixels) {
        if (!isValidCoordinate(p.x, p.y)) {
          console.warn(
            JSON.stringify({
              severity: 'WARNING',
              message: `Draw rejected: invalid coordinate (${p.x}, ${p.y})`,
              correlationId,
            })
          );
          if (appId && token) {
            await discord.editOriginalResponse(appId, token, {
              content: `❌ Coordonnées invalides : (${p.x}, ${p.y}). Les valeurs doivent être comprises entre 0 et 9999.`,
            });
          }
          res.status(200).json({ status: 'invalid_coordinates', correlationId });
          return;
        }
      }

      // 2d. Transactional Chunk Write & Delta Document Emission (Issues #51, #58)
      const writeResult = chunkStore.applyDraw(envelope.id, pixels, author, envelope.timestamp);

      console.log(
        JSON.stringify({
          severity: 'INFO',
          message: `pixel.processed: applied ${writeResult.applied} pixels across chunks`,
          correlationId,
          eventId: envelope.id,
          applied: writeResult.applied,
          duplicate: writeResult.duplicate,
        })
      );

      // 2e. Update Discord Deferred Interaction Response (Issue #142)
      if (appId && token) {
        await discord.editOriginalResponse(appId, token, {
          content: `✅ Pixel${pixels.length > 1 ? 's' : ''} posé${pixels.length > 1 ? 's' : ''} avec succès ! (${pixels.length} pixel${pixels.length > 1 ? 's' : ''} à [${pixels[0]?.x}, ${pixels[0]?.y}])`,
        });
      }

      res.status(200).json({ status: 'processed', applied: writeResult.applied, correlationId });
      return;
    }

    if (eventType === 'discord.command') {
      const data = envelope.data || {};
      const commandName = data.commandName;
      const userId = data.userId;
      const roleIds = data.roleIds;
      const options = data.options || {};
      const appId = data.applicationId;
      const token = data.interactionToken;
      const subcommand = options.subcommand || options.action;

      if (commandName === 'admin') {
        // Enforce Admin Authorization (Issue #68 / ADR-0019)
        const authorized = isUserAdmin(userId, roleIds, firestoreAdmins);
        if (!authorized) {
          console.warn(
            JSON.stringify({
              severity: 'WARNING',
              message: `Unauthorized admin command attempt by user ${userId}`,
              correlationId,
              subcommand,
            })
          );
          if (appId && token) {
            await discord.editOriginalResponse(appId, token, {
              content: '⛔ Commande réservée aux administrateurs autorisés.',
            });
          }
          res.status(200).json({ status: 'unauthorized', correlationId });
          return;
        }

        if (subcommand === 'pause') {
          chunkStore.setPauseState(true);
          console.log(JSON.stringify({ severity: 'NOTICE', message: 'Canvas paused globally by admin', correlationId }));
          if (appId && token) {
            await discord.editOriginalResponse(appId, token, {
              content: '⏸️ **Canevas en pause** : les dessins sont désormais suspendus pour tous les utilisateurs.',
            });
          }
          res.status(200).json({ status: 'admin_pause_success', correlationId });
          return;
        }

        if (subcommand === 'resume') {
          chunkStore.setPauseState(false);
          console.log(JSON.stringify({ severity: 'NOTICE', message: 'Canvas resumed by admin', correlationId }));
          if (appId && token) {
            await discord.editOriginalResponse(appId, token, {
              content: '▶️ **Canevas actif** : les dessins sont de nouveau autorisés.',
            });
          }
          res.status(200).json({ status: 'admin_resume_success', correlationId });
          return;
        }

        if (subcommand === 'clear') {
          const newEpoch = chunkStore.getEpoch() + 1;
          chunkStore.setEpoch(newEpoch);
          console.log(JSON.stringify({ severity: 'NOTICE', message: `Canvas cleared by admin: new epoch ${newEpoch}`, correlationId }));
          if (appId && token) {
            await discord.editOriginalResponse(appId, token, {
              content: `🧹 **Canevas réinitialisé** avec succès ! (Époque active : **${newEpoch}**).`,
            });
          }
          res.status(200).json({ status: 'admin_clear_success', epoch: newEpoch, correlationId });
          return;
        }

        if (subcommand === 'ratelimit') {
          const targetUser = options.user as string;
          const limit = Number(options.limit);
          if (targetUser && !isNaN(limit)) {
            rateLimiter.setOverride(targetUser, limit);
            console.log(JSON.stringify({ severity: 'NOTICE', message: `Admin override rate limit for ${targetUser} set to ${limit}`, correlationId }));
            if (appId && token) {
              await discord.editOriginalResponse(appId, token, {
                content: `⚙️ Limite de dessin pour <@${targetUser}> définie à **${limit} pixels / minute**.`,
              });
            }
            res.status(200).json({ status: 'admin_ratelimit_success', targetUser, limit, correlationId });
            return;
          }
        }
      }

      if (commandName === 'get') {
        // Issue #55: Render current canvas view as PNG
        const png = snapshotService.renderSampleCanvasPng(chunkStore);
        if (appId && token) {
          await discord.postFollowupWithImage(appId, token, png, 'canvas.png', '🎨 Voici l’état actuel de la grille :');
        }
        res.status(200).json({ status: 'get_success', correlationId });
        return;
      }

      if (commandName === 'snapshot') {
        // Issue #56: Generate snapshot in private bucket and share via signed URL
        const authorized = isUserAdmin(userId, roleIds, firestoreAdmins);
        if (!authorized) {
          if (appId && token) {
            await discord.editOriginalResponse(appId, token, {
              content: '⛔ Commande `/snapshot` réservée aux administrateurs autorisés.',
            });
          }
          res.status(200).json({ status: 'unauthorized', correlationId });
          return;
        }

        const timestamp = Date.now();
        const objectName = `snapshots/snapshot_${timestamp}.png`;
        const signedUrl = snapshotService.createSignedUrl(snapshotBucketName, objectName, 3600);

        console.log(JSON.stringify({ severity: 'NOTICE', message: `Snapshot created: gs://${snapshotBucketName}/${objectName}`, correlationId }));

        if (appId && token) {
          await discord.editOriginalResponse(appId, token, {
            content: `📸 **Snapshot généré avec succès !**\nLien d'accès signé (valide 1h) :\n${signedUrl}`,
          });
        }
        res.status(200).json({ status: 'snapshot_success', signedUrl, correlationId });
        return;
      }
    }

    res.status(200).json({ status: 'ignored_unrecognized_event', correlationId });
  };
}

export const drawWorker = createDrawWorkerHandler();
