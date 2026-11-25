/**
 * Pixel Store with Transactional Writes & Conflict Resolution.
 * Fulfills Issue #51, C06 §4.3 and ADR-0007.
 * 
 * Rules:
 * 1. Each pixel records color, author, update timestamp, and grid epoch.
 * 2. Write ordering: A write keeps the most recent timestamp (Last-Write-Wins per pixel).
 * 3. Epoch precedence: Writes with higher epoch override lower epochs.
 * 4. Idempotency: Duplicate events with the same event ID are detected and safely skipped.
 */

import { Pixel, ChunkDocument } from './types.js';
import { CHUNK_SIZE, toChunkCoordinates } from './coordinates.js';
import { normalizeColor, isValidColor } from './color.js';

export interface PixelWriteInput {
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly author: string;
  readonly timestamp: number;
  readonly epoch?: number;
}

export interface PixelMutationResult {
  readonly applied: boolean;
  readonly localKey?: string;
  readonly pixel?: Pixel;
  readonly reason?: string;
}

export interface ChunkMutationResult {
  readonly applied: boolean;
  readonly chunkId: string;
  readonly modifiedPixels: Record<string, Pixel>;
  readonly eventId: string;
  readonly skippedDuplicate: boolean;
  readonly updatedChunk: ChunkDocument;
}

/**
 * Creates an empty chunk document initialized with an optional epoch.
 */
export function createEmptyChunk(chunkX: number, chunkY: number, epoch = 0): ChunkDocument {
  return {
    chunkId: `chunk_${chunkX}_${chunkY}`,
    chunkX,
    chunkY,
    pixels: {},
    updatedAt: 0,
    epoch,
    processedEvents: [],
  };
}

/**
 * Checks if an event ID has already been processed on this chunk.
 */
export function isEventProcessed(chunk: ChunkDocument, eventId: string): boolean {
  if (!chunk.processedEvents || !Array.isArray(chunk.processedEvents)) {
    return false;
  }
  return chunk.processedEvents.includes(eventId);
}

/**
 * Applies a single pixel write to a chunk document using transactional Last-Write-Wins rules.
 */
export function applyPixelToChunk(
  chunk: ChunkDocument,
  write: PixelWriteInput
): PixelMutationResult {
  if (!isValidColor(write.color)) {
    return { applied: false, reason: `Invalid color format: ${write.color}` };
  }

  const coord = toChunkCoordinates(write.x, write.y);
  if (coord.chunkX !== chunk.chunkX || coord.chunkY !== chunk.chunkY) {
    return {
      applied: false,
      reason: `Coordinate (${write.x}, ${write.y}) belongs to chunk_${coord.chunkX}_${coord.chunkY}, not ${chunk.chunkId}`,
    };
  }

  const incomingEpoch = typeof write.epoch === 'number' ? write.epoch : (chunk.epoch ?? 0);
  const existing = chunk.pixels[coord.pixelKey];

  if (existing) {
    const existingEpoch = existing.epoch ?? 0;

    // 1. Epoch check: lower epoch cannot overwrite higher epoch
    if (incomingEpoch < existingEpoch) {
      return {
        applied: false,
        reason: `Incoming epoch ${incomingEpoch} is older than existing epoch ${existingEpoch}`,
      };
    }

    // 2. Timestamp check within same epoch: older or equal timestamp is rejected (Last-Write-Wins)
    if (incomingEpoch === existingEpoch && write.timestamp <= existing.timestamp) {
      return {
        applied: false,
        reason: `Incoming timestamp ${write.timestamp} is not newer than existing ${existing.timestamp}`,
      };
    }
  }

  const normalizedColor = normalizeColor(write.color);
  const newPixel: Pixel = {
    color: normalizedColor,
    author: write.author,
    timestamp: write.timestamp,
    epoch: incomingEpoch,
  };

  return {
    applied: true,
    localKey: coord.pixelKey,
    pixel: newPixel,
  };
}

/**
 * Applies a batch of pixel writes from a single draw event to a chunk document.
 * Enforces idempotency by eventId and updates chunk metadata transactionally.
 */
export function applyDrawEventToChunk(
  chunk: ChunkDocument,
  eventId: string,
  writes: PixelWriteInput[]
): ChunkMutationResult {
  // 1. Idempotency: Return unmodified chunk if event was already processed
  if (isEventProcessed(chunk, eventId)) {
    return {
      applied: false,
      chunkId: chunk.chunkId,
      modifiedPixels: {},
      eventId,
      skippedDuplicate: true,
      updatedChunk: chunk,
    };
  }

  const modifiedPixels: Record<string, Pixel> = {};
  const newPixels: Record<string, Pixel> = { ...chunk.pixels };
  let latestTimestamp = chunk.updatedAt;

  for (const write of writes) {
    const res = applyPixelToChunk({ ...chunk, pixels: newPixels }, write);
    if (res.applied && res.localKey && res.pixel) {
      newPixels[res.localKey] = res.pixel;
      modifiedPixels[res.localKey] = res.pixel;
      latestTimestamp = Math.max(latestTimestamp, write.timestamp);
    }
  }

  // Record event ID (keep last 50 processed events to avoid unbounded growth)
  const existingEvents = chunk.processedEvents || [];
  const updatedEvents = [...existingEvents.slice(-49), eventId];

  const updatedChunk: ChunkDocument = {
    ...chunk,
    pixels: newPixels,
    updatedAt: latestTimestamp,
    processedEvents: updatedEvents,
  };

  return {
    applied: Object.keys(modifiedPixels).length > 0,
    chunkId: chunk.chunkId,
    modifiedPixels,
    eventId,
    skippedDuplicate: false,
    updatedChunk,
  };
}
