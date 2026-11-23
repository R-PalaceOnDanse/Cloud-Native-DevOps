/**
 * Per-User Rate Limiter Token Bucket Engine.
 * Fulfills Issue #52 / C07 §3.2 & ADR-0007.
 */

export interface UserRateLimitState {
  userId: string;
  tokens: number;
  maxTokens: number;
  lastRefillTimestamp: number;
  customLimit?: number; // Admin override (Issue #57)
}

export class WorkerRateLimiter {
  private readonly userBuckets: Map<string, UserRateLimitState> = new Map();
  public readonly defaultMaxTokens = 20;
  public readonly refillIntervalMs = 3000; // 1 token every 3 seconds

  public getOrCreateBucket(userId: string): UserRateLimitState {
    let bucket = this.userBuckets.get(userId);
    if (!bucket) {
      bucket = {
        userId,
        tokens: this.defaultMaxTokens,
        maxTokens: this.defaultMaxTokens,
        lastRefillTimestamp: Date.now(),
      };
      this.userBuckets.set(userId, bucket);
    }
    return bucket;
  }

  /**
   * Refills the user bucket based on elapsed time.
   */
  public refill(bucket: UserRateLimitState, now = Date.now()): void {
    const elapsed = now - bucket.lastRefillTimestamp;
    if (elapsed >= this.refillIntervalMs) {
      const refilled = Math.floor(elapsed / this.refillIntervalMs);
      const capacity = bucket.customLimit !== undefined ? bucket.customLimit : bucket.maxTokens;
      bucket.tokens = Math.min(capacity, bucket.tokens + refilled);
      bucket.lastRefillTimestamp = now - (elapsed % this.refillIntervalMs);
    }
  }

  /**
   * Verifies if user has sufficient tokens and deducts if allowed.
   */
  public tryConsume(
    userId: string,
    tokensToConsume = 1,
    now = Date.now()
  ): { allowed: boolean; remainingTokens: number; retryAfterSeconds?: number; message?: string } {
    const bucket = this.getOrCreateBucket(userId);
    this.refill(bucket, now);

    const maxAllowed = bucket.customLimit !== undefined ? bucket.customLimit : bucket.maxTokens;

    if (maxAllowed === 0) {
      return {
        allowed: false,
        remainingTokens: 0,
        retryAfterSeconds: 60,
        message: 'Vos droits de dessin ont été temporairement suspendus par un administrateur.',
      };
    }

    if (tokensToConsume > maxAllowed) {
      return {
        allowed: false,
        remainingTokens: bucket.tokens,
        message: `Action refusée : le trait (${tokensToConsume} pixels) dépasse la capacité maximale (${maxAllowed}).`,
      };
    }

    if (bucket.tokens < tokensToConsume) {
      const deficit = tokensToConsume - bucket.tokens;
      const waitMs = deficit * this.refillIntervalMs - (now - bucket.lastRefillTimestamp);
      const retryAfterSeconds = Math.max(1, Math.ceil(waitMs / 1000));

      return {
        allowed: false,
        remainingTokens: bucket.tokens,
        retryAfterSeconds,
        message: `Rate limit atteint (${bucket.tokens}/${maxAllowed} jetons). Veuillez patienter ${retryAfterSeconds}s.`,
      };
    }

    bucket.tokens -= tokensToConsume;
    return {
      allowed: true,
      remainingTokens: bucket.tokens,
    };
  }

  /**
   * Sets an administrative rate limit override for a specific user (Issue #57).
   */
  public setOverride(userId: string, customLimit: number): void {
    const bucket = this.getOrCreateBucket(userId);
    bucket.customLimit = customLimit;
    bucket.tokens = Math.min(customLimit, bucket.tokens);
  }
}

export const defaultWorkerRateLimiter = new WorkerRateLimiter();
