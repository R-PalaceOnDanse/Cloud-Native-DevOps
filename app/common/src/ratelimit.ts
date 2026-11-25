import { RateLimitDocument, RateLimitResult } from './types.js';

/** Default rate limit: 20 pixels per minute */
export const DEFAULT_PIXELS_PER_MINUTE = 20;

/** Refill window in milliseconds (1 minute) */
export const REFILL_WINDOW_MS = 60 * 1000;

/**
 * Evaluates whether a user can draw the requested number of pixels.
 * Uses a token bucket model with continuous refill based on elapsed time.
 *
 * @param currentDoc Current Firestore rate limit document, or null if first draw
 * @param userId Discord user ID
 * @param pixelCount Number of pixels to draw (default 1)
 * @param nowMs Current timestamp in milliseconds (defaults to Date.now())
 */
export function evaluateRateLimit(
  currentDoc: RateLimitDocument | null,
  userId: string,
  pixelCount: number = 1,
  nowMs: number = Date.now()
): RateLimitResult {
  if (pixelCount <= 0 || !Number.isInteger(pixelCount)) {
    throw new RangeError(`pixelCount must be a positive integer, got ${pixelCount}`);
  }

  const effectiveLimit = currentDoc?.overrideLimit ?? DEFAULT_PIXELS_PER_MINUTE;

  // If admin set limit to 0, user is completely banned from drawing
  if (effectiveLimit <= 0) {
    return {
      allowed: false,
      remainingTokens: 0,
      effectiveLimit: 0,
      retryAfterSeconds: 3600,
      reason: 'Drawing is disabled for this user by administrator override.',
    };
  }

  // Brush stroke larger than total limit can never succeed
  if (pixelCount > effectiveLimit) {
    return {
      allowed: false,
      remainingTokens: currentDoc?.tokens ?? effectiveLimit,
      effectiveLimit,
      retryAfterSeconds: 0,
      reason: `Brush size (${pixelCount}) exceeds your maximum capacity of ${effectiveLimit} pixels/min.`,
    };
  }

  let tokens = currentDoc ? currentDoc.tokens : effectiveLimit;
  const lastRefill = currentDoc ? currentDoc.lastRefill : nowMs;
  const elapsedMs = Math.max(0, nowMs - lastRefill);

  // Refill tokens proportionally to elapsed time
  // Formula: tokensToAdd = (elapsedMs / REFILL_WINDOW_MS) * effectiveLimit
  const tokensToAdd = (elapsedMs / REFILL_WINDOW_MS) * effectiveLimit;
  tokens = Math.min(effectiveLimit, tokens + tokensToAdd);

  if (tokens >= pixelCount) {
    const remainingTokens = tokens - pixelCount;
    const updatedDoc: RateLimitDocument = {
      userId,
      tokens: remainingTokens,
      lastRefill: nowMs,
      ...(currentDoc?.overrideLimit !== undefined ? { overrideLimit: currentDoc.overrideLimit } : {}),
      updatedAt: nowMs,
    };

    return {
      allowed: true,
      remainingTokens: Math.floor(remainingTokens),
      effectiveLimit,
      retryAfterSeconds: 0,
      updatedDoc,
    };
  }

  // Calculate wait time until user has enough tokens
  const tokensNeeded = pixelCount - tokens;
  const msToWait = (tokensNeeded / effectiveLimit) * REFILL_WINDOW_MS;
  const retryAfterSeconds = Math.max(1, Math.ceil(msToWait / 1000));

  return {
    allowed: false,
    remainingTokens: Math.floor(tokens),
    effectiveLimit,
    retryAfterSeconds,
    reason: `Rate limit exceeded. Please wait ${retryAfterSeconds}s before drawing again.`,
  };
}
