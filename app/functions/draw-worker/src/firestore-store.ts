/**
 * Firestore implementation of the worker storage (Issue #167, C06 §4.3).
 *
 * Layout, shared with the frontend listeners and app/frontend Firestore rules:
 *   config/system        { paused, epoch, lastClearedAt, admins[], updatedAt, updatedBy }
 *   chunks/chunk_X_Y     { chunkId, chunkX, chunkY, epoch, pixels{"lx,ly": {color, author, timestamp}},
 *                          processedEvents[], updatedAt }
 *   ratelimits/{userId}  { tokens, lastRefill, overrideLimit?, updatedAt }
 *
 * Consistency under concurrent updates: each chunk is read and written in one Firestore transaction,
 * which also reads the current epoch, so two workers writing the same chunk retry instead of losing a
 * pixel, and a write racing an /admin clear cannot resurrect old pixels. Redelivered events are
 * skipped through `processedEvents`.
 */

import { Firestore, type DocumentData, type DocumentReference } from '@google-cloud/firestore';
import {
  CHUNK_SIZE,
  CanvasStore,
  DEFAULT_PIXELS_PER_MINUTE,
  DrawResult,
  PROCESSED_EVENTS_KEPT,
  PixelWrite,
  RateLimitDecision,
  RateLimiter,
  StoredPixel,
  SystemState,
  evaluateTokenBucket,
  groupByChunk,
} from './store.js';

interface ChunkDoc {
  chunkId: string;
  chunkX: number;
  chunkY: number;
  epoch: number;
  pixels: Record<string, StoredPixel>;
  processedEvents: string[];
  updatedAt: number;
}

function toSystemState(data: DocumentData | undefined): SystemState {
  return {
    paused: Boolean(data?.paused),
    epoch: typeof data?.epoch === 'number' ? data.epoch : 1,
    lastClearedAt: typeof data?.lastClearedAt === 'number' ? data.lastClearedAt : null,
    admins: Array.isArray(data?.admins) ? data.admins.map(String) : [],
  };
}

export class FirestoreCanvasStore implements CanvasStore {
  private readonly systemRef: DocumentReference;

  constructor(private readonly db: Firestore) {
    this.systemRef = db.collection('config').doc('system');
  }

  async getSystemState(): Promise<SystemState> {
    return toSystemState((await this.systemRef.get()).data());
  }

  async setPaused(paused: boolean, updatedBy: string): Promise<void> {
    await this.systemRef.set({ paused, updatedBy, updatedAt: Date.now() }, { merge: true });
  }

  async clear(updatedBy: string): Promise<number> {
    const epoch = await this.db.runTransaction(async (tx) => {
      const current = toSystemState((await tx.get(this.systemRef)).data());
      const next = current.epoch + 1;
      tx.set(this.systemRef, { epoch: next, lastClearedAt: Date.now(), updatedBy, updatedAt: Date.now() }, { merge: true });
      return next;
    });
    // The new epoch already hides the old chunks; deleting them frees the storage.
    await this.db.recursiveDelete(this.db.collection('chunks'));
    return epoch;
  }

  async applyDraw(eventId: string, pixels: readonly PixelWrite[], author: string, timestamp: number): Promise<DrawResult> {
    let applied = 0;
    let duplicates = 0;
    const groups = groupByChunk(pixels);

    for (const [chunkId, group] of groups) {
      const ref = this.db.collection('chunks').doc(chunkId);
      const result = await this.db.runTransaction(async (tx) => {
        const [systemSnap, chunkSnap] = await tx.getAll(this.systemRef, ref);
        const epoch = toSystemState(systemSnap!.data()).epoch;
        const existing = chunkSnap!.data() as ChunkDoc | undefined;
        const current: ChunkDoc =
          existing && existing.epoch >= epoch
            ? existing
            : { chunkId, chunkX: group.chunkX, chunkY: group.chunkY, epoch, pixels: {}, processedEvents: [], updatedAt: 0 };

        if (current.processedEvents?.includes(eventId)) {
          return { applied: 0, duplicate: true };
        }

        const nextPixels = { ...current.pixels };
        let count = 0;
        for (const w of group.writes) {
          const old = nextPixels[w.pixelKey];
          if (!old || timestamp >= old.timestamp) {
            nextPixels[w.pixelKey] = { color: w.color, author, timestamp };
            count++;
          }
        }

        tx.set(ref, {
          chunkId,
          chunkX: group.chunkX,
          chunkY: group.chunkY,
          epoch,
          pixels: nextPixels,
          processedEvents: [...(current.processedEvents ?? []), eventId].slice(-PROCESSED_EVENTS_KEPT),
          updatedAt: Math.max(current.updatedAt ?? 0, timestamp),
        } satisfies ChunkDoc);
        return { applied: count, duplicate: false };
      });
      applied += result.applied;
      if (result.duplicate) duplicates++;
    }

    return { applied, duplicate: duplicates === groups.size && groups.size > 0 };
  }

  async listPixels(): Promise<PixelWrite[]> {
    const epoch = (await this.getSystemState()).epoch;
    const snap = await this.db.collection('chunks').select('chunkX', 'chunkY', 'epoch', 'pixels').get();
    const out: PixelWrite[] = [];
    for (const doc of snap.docs) {
      const data = doc.data() as Partial<ChunkDoc>;
      if ((data.epoch ?? 0) < epoch || !data.pixels) continue;
      for (const [key, p] of Object.entries(data.pixels)) {
        const [lx, ly] = key.split(',').map(Number);
        out.push({ x: (data.chunkX ?? 0) * CHUNK_SIZE + lx!, y: (data.chunkY ?? 0) * CHUNK_SIZE + ly!, color: p.color });
      }
    }
    return out;
  }
}

export class FirestoreRateLimiter implements RateLimiter {
  constructor(private readonly db: Firestore) {}

  async tryConsume(userId: string, pixelCount: number): Promise<RateLimitDecision> {
    const ref = this.db.collection('ratelimits').doc(userId);
    return this.db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data();
      const limit = typeof data?.overrideLimit === 'number' ? data.overrideLimit : DEFAULT_PIXELS_PER_MINUTE;
      const state = data ? { tokens: Number(data.tokens), lastRefill: Number(data.lastRefill) } : null;
      const now = Date.now();
      const { decision, next } = evaluateTokenBucket(state, limit, pixelCount, now);
      if (next) {
        tx.set(ref, { tokens: next.tokens, lastRefill: next.lastRefill, updatedAt: now }, { merge: true });
      }
      return decision;
    });
  }

  async setOverride(userId: string, pixelsPerMinute: number): Promise<void> {
    await this.db
      .collection('ratelimits')
      .doc(userId)
      .set({ overrideLimit: pixelsPerMinute, tokens: pixelsPerMinute, lastRefill: Date.now(), updatedAt: Date.now() }, { merge: true });
  }
}
