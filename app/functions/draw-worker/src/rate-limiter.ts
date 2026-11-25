/**
 * In-memory RateLimiter, used by the tests only. Production uses FirestoreRateLimiter
 * (firestore-store.ts), which keeps the bucket of each user in `ratelimits/{userId}` (Issue #52, #167).
 */

import { DEFAULT_PIXELS_PER_MINUTE, RateLimitDecision, RateLimiter, evaluateTokenBucket } from './store.js';

export class WorkerRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; lastRefill: number; limit?: number }>();

  async tryConsume(userId: string, pixelCount: number, now = Date.now()): Promise<RateLimitDecision> {
    const bucket = this.buckets.get(userId) ?? null;
    const limit = bucket?.limit ?? DEFAULT_PIXELS_PER_MINUTE;
    const { decision, next } = evaluateTokenBucket(bucket, limit, pixelCount, now);
    if (next) {
      this.buckets.set(userId, { ...next, ...(bucket?.limit !== undefined ? { limit: bucket.limit } : {}) });
    }
    return decision;
  }

  async setOverride(userId: string, pixelsPerMinute: number): Promise<void> {
    const bucket = this.buckets.get(userId);
    this.buckets.set(userId, {
      tokens: Math.min(pixelsPerMinute, bucket?.tokens ?? pixelsPerMinute),
      lastRefill: bucket?.lastRefill ?? Date.now(),
      limit: pixelsPerMinute,
    });
  }
}
