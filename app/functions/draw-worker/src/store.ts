/**
 * Storage contracts of the worker.
 *
 * Production uses Firestore (firestore-store.ts) and Cloud Storage (snapshot-service.ts); the tests use
 * the in-memory implementations (chunk-store.ts, rate-limiter.ts). A function instance keeps no state
 * of its own: everything that must survive an invocation lives behind these interfaces (Issue #167).
 */

export interface PixelWrite {
  x: number;
  y: number;
  color: string;
}

/** A painted pixel as the frontend reads it from `chunks/{chunkId}.pixels["localX,localY"]`. */
export interface StoredPixel {
  color: string;
  author: string;
  timestamp: number;
}

/** `config/system`, read by the frontend listener and by the worker. */
export interface SystemState {
  paused: boolean;
  /** Incremented by /admin clear; chunks of an older epoch are treated as empty. */
  epoch: number;
  lastClearedAt: number | null;
  /** Discord user IDs allowed to run admin commands, on top of ADMIN_USER_IDS / ADMIN_ROLE_ID. */
  admins: string[];
}

export interface DrawResult {
  applied: number;
  duplicate: boolean;
}

export interface CanvasStore {
  getSystemState(): Promise<SystemState>;
  setPaused(paused: boolean, updatedBy: string): Promise<void>;
  /** Empties the grid and returns the new epoch. */
  clear(updatedBy: string): Promise<number>;
  /** Writes the pixels of one event, idempotent on `eventId`, last write wins per pixel. */
  applyDraw(eventId: string, pixels: readonly PixelWrite[], author: string, timestamp: number): Promise<DrawResult>;
  /** Every painted pixel of the current epoch, for /get and /snapshot. */
  listPixels(): Promise<Array<PixelWrite>>;
}

export interface RateLimitDecision {
  allowed: boolean;
  remainingTokens: number;
  retryAfterSeconds?: number;
  message?: string;
}

export interface RateLimiter {
  tryConsume(userId: string, pixelCount: number): Promise<RateLimitDecision>;
  setOverride(userId: string, pixelsPerMinute: number): Promise<void>;
}

export const CHUNK_SIZE = 64;
export const CANVAS_SIZE = 10000;
export const DEFAULT_PIXELS_PER_MINUTE = 20;

export function isValidCoordinate(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < CANVAS_SIZE && y >= 0 && y < CANVAS_SIZE;
}

export function isValidColor(color: unknown): color is string {
  return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color);
}

export function getChunkCoordinates(x: number, y: number) {
  if (!isValidCoordinate(x, y)) {
    throw new RangeError(`Coordinates (${x}, ${y}) are out of canvas bounds [0..${CANVAS_SIZE - 1}].`);
  }
  const chunkX = Math.floor(x / CHUNK_SIZE);
  const chunkY = Math.floor(y / CHUNK_SIZE);
  return {
    chunkX,
    chunkY,
    localX: x % CHUNK_SIZE,
    localY: y % CHUNK_SIZE,
    chunkId: `chunk_${chunkX}_${chunkY}`,
    pixelKey: `${x % CHUNK_SIZE},${y % CHUNK_SIZE}`,
  };
}

/** Groups the pixels of one event by chunk, so each chunk is written in its own transaction. */
export function groupByChunk(pixels: readonly PixelWrite[]) {
  const groups = new Map<string, { chunkX: number; chunkY: number; writes: Array<PixelWrite & { pixelKey: string }> }>();
  for (const p of pixels) {
    const c = getChunkCoordinates(p.x, p.y);
    const group = groups.get(c.chunkId) ?? { chunkX: c.chunkX, chunkY: c.chunkY, writes: [] };
    group.writes.push({ ...p, color: p.color.toLowerCase(), pixelKey: c.pixelKey });
    groups.set(c.chunkId, group);
  }
  return groups;
}

/** Keeps the last processed event IDs of a chunk to make redeliveries harmless. */
export const PROCESSED_EVENTS_KEPT = 50;

/**
 * Token bucket refilled continuously: `limit` pixels per minute. Pure function shared by the in-memory
 * and the Firestore rate limiters.
 */
export function evaluateTokenBucket(
  state: { tokens: number; lastRefill: number } | null,
  limit: number,
  pixelCount: number,
  now: number
): { decision: RateLimitDecision; next?: { tokens: number; lastRefill: number } } {
  if (limit <= 0) {
    return {
      decision: { allowed: false, remainingTokens: 0, retryAfterSeconds: 60, message: 'Drawing is disabled for you by an administrator.' },
    };
  }
  if (pixelCount > limit) {
    return {
      decision: {
        allowed: false,
        remainingTokens: Math.floor(state?.tokens ?? limit),
        message: `This stroke (${pixelCount} pixels) is larger than your limit of ${limit} pixels per minute.`,
      },
    };
  }
  const elapsed = Math.max(0, now - (state?.lastRefill ?? now));
  const tokens = Math.min(limit, (state?.tokens ?? limit) + (elapsed / 60_000) * limit);
  if (tokens >= pixelCount) {
    const remaining = tokens - pixelCount;
    return { decision: { allowed: true, remainingTokens: Math.floor(remaining) }, next: { tokens: remaining, lastRefill: now } };
  }
  const retryAfterSeconds = Math.max(1, Math.ceil((((pixelCount - tokens) / limit) * 60_000) / 1000));
  return {
    decision: {
      allowed: false,
      remainingTokens: Math.floor(tokens),
      retryAfterSeconds,
      message: `Rate limit reached (${limit} pixels per minute). Try again in ${retryAfterSeconds}s.`,
    },
  };
}
