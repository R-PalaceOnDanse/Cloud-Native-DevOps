/**
 * Delta Documents for Real-time Streaming with TTL.
 * Fulfills Issue #58, C07 §3.3 and ADR-0008.
 * 
 * Rules:
 * 1. Each delta document records the changed pixels for a single tile/chunk.
 * 2. Carries an expiration timestamp (TTL) so documents automatically expire.
 * 3. Formatted to be read by authenticated Firestore onSnapshot listeners.
 */

import { Pixel } from './types.js';

/** Default TTL duration for delta documents: 5 minutes (300 seconds) */
export const DEFAULT_DELTA_TTL_SECONDS = 300;

export interface DeltaDocument {
  /** Canonical delta document ID, e.g. `delta_1700000000000_abc123` */
  readonly deltaId: string;
  /** Chunk ID this delta belongs to, e.g. `chunk_0_0` */
  readonly chunkId: string;
  /** Originating draw event ID */
  readonly eventId: string;
  /** Map of sparse local pixels updated in this batch: "localX,localY" => Pixel */
  readonly pixels: Record<string, Pixel>;
  /** Timestamp when delta was created in milliseconds */
  readonly createdAt: number;
  /** Expiration timestamp in milliseconds for Firestore TTL deletion policy */
  readonly expiresAt: number;
}

/**
 * Creates a delta document with a TTL for a given chunk update.
 */
export function createDeltaDocument(
  chunkId: string,
  eventId: string,
  pixels: Record<string, Pixel>,
  ttlSeconds = DEFAULT_DELTA_TTL_SECONDS,
  now = Date.now()
): DeltaDocument {
  const deltaId = `delta_${now}_${eventId.slice(0, 8)}`;
  const expiresAt = now + ttlSeconds * 1000;

  return {
    deltaId,
    chunkId,
    eventId,
    pixels,
    createdAt: now,
    expiresAt,
  };
}

/**
 * Checks if a delta document has exceeded its TTL expiration timestamp.
 */
export function isDeltaExpired(delta: DeltaDocument, now = Date.now()): boolean {
  return now >= delta.expiresAt;
}
