/**
 * Data Model Types for Firestore NoSQL Persistence & Application Events
 * Fulfills Issue #140 and C06 §4.3.
 */

/**
 * A single painted pixel on the canvas.
 */
export interface Pixel {
  /** Hex color in lowercase `#rrggbb` */
  readonly color: string;
  /** Discord user identifier who drew this pixel */
  readonly author: string;
  /** Unix timestamp in milliseconds when the pixel was updated */
  readonly timestamp: number;
  /** Grid epoch (increments on admin clear, defaults to 0) */
  readonly epoch?: number;
}

/**
 * Coordinate mapping result from global (x, y) to chunk + local tile coordinates.
 */
export interface ChunkCoordinate {
  /** Global X coordinate [0..GRID_WIDTH - 1] */
  readonly x: number;
  /** Global Y coordinate [0..GRID_HEIGHT - 1] */
  readonly y: number;
  /** Chunk X index [0..MAX_CHUNK_X] */
  readonly chunkX: number;
  /** Chunk Y index [0..MAX_CHUNK_Y] */
  readonly chunkY: number;
  /** Local X offset within the chunk [0..CHUNK_SIZE - 1] */
  readonly localX: number;
  /** Local Y offset within the chunk [0..CHUNK_SIZE - 1] */
  readonly localY: number;
  /** Canonical Firestore document ID: `chunk_{chunkX}_{chunkY}` */
  readonly chunkId: string;
  /** Sparse pixel map key within the chunk: `${localX},${localY}` */
  readonly pixelKey: string;
}

/**
 * Firestore Document in the `chunks` collection.
 * Key: `chunk_{chunkX}_{chunkY}`
 */
export interface ChunkDocument {
  /** Unique chunk ID, e.g. `chunk_0_0` */
  readonly chunkId: string;
  /** Chunk X coordinate */
  readonly chunkX: number;
  /** Chunk Y coordinate */
  readonly chunkY: number;
  /** Map of sparse local pixels: "localX,localY" => Pixel */
  readonly pixels: Record<string, Pixel>;
  /** Timestamp in milliseconds of the latest write to this chunk */
  readonly updatedAt: number;
  /** Grid epoch (increments on admin clear, defaults to 0) */
  readonly epoch?: number;
  /** List of recent processed event IDs for idempotency */
  readonly processedEvents?: string[];
}

/**
 * Firestore Document in the `rate_limits` collection.
 * Key: Discord user ID
 */
export interface RateLimitDocument {
  /** Discord user ID */
  readonly userId: string;
  /** Current available draw tokens (e.g. max 20) */
  readonly tokens: number;
  /** Timestamp in milliseconds of the last token refill */
  readonly lastRefill: number;
  /** Optional custom limit override set by /admin ratelimit */
  readonly overrideLimit?: number;
  /** Timestamp in milliseconds of last rate limit update */
  readonly updatedAt: number;
}

/**
 * Rate limit evaluation result.
 */
export interface RateLimitResult {
  /** Whether the user is permitted to draw the requested number of pixels */
  readonly allowed: boolean;
  /** Remaining tokens after the draw (or available tokens if rejected) */
  readonly remainingTokens: number;
  /** Effective limit (default or override) */
  readonly effectiveLimit: number;
  /** Seconds until the next token refill if rejected */
  readonly retryAfterSeconds: number;
  /** Human-readable explanation if rejected */
  readonly reason?: string;
  /** Updated rate limit document state to persist on success */
  readonly updatedDoc?: RateLimitDocument;
}

/**
 * Firestore Document in the `session` collection at document `state`.
 */
export interface SessionStateDocument {
  /** When true, all draw commands from Discord and Web are rejected */
  readonly paused: boolean;
  /** Discord ID of the administrator who toggled pause */
  readonly updatedBy: string;
  /** Timestamp in milliseconds of the change */
  readonly updatedAt: number;
}
