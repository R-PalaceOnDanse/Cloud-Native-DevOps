import { ChunkCoordinate } from './types.js';

/** Canvas dimensions (10,000 x 10,000 pixels) */
export const GRID_WIDTH = 10000;
export const GRID_HEIGHT = 10000;

/** Chunk dimension (64 x 64 pixels per chunk) */
export const CHUNK_SIZE = 64;

/** Max chunk indices */
export const MAX_CHUNK_X = Math.floor((GRID_WIDTH - 1) / CHUNK_SIZE); // 156
export const MAX_CHUNK_Y = Math.floor((GRID_HEIGHT - 1) / CHUNK_SIZE); // 156

/**
 * Checks whether global pixel coordinates are valid integers within canvas bounds.
 */
export function isValidPixel(x: number, y: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    x < GRID_WIDTH &&
    y >= 0 &&
    y < GRID_HEIGHT
  );
}

/**
 * Converts global canvas coordinates (x, y) into chunk and local tile coordinates.
 * Throws a RangeError if the coordinates are out of canvas boundaries.
 */
export function toChunkCoordinates(x: number, y: number): ChunkCoordinate {
  if (!isValidPixel(x, y)) {
    throw new RangeError(
      `Coordinates (${x}, ${y}) are out of bounds. Expected integers in [0..${GRID_WIDTH - 1}, 0..${GRID_HEIGHT - 1}].`
    );
  }

  const chunkX = Math.floor(x / CHUNK_SIZE);
  const chunkY = Math.floor(y / CHUNK_SIZE);
  const localX = x % CHUNK_SIZE;
  const localY = y % CHUNK_SIZE;

  return {
    x,
    y,
    chunkX,
    chunkY,
    localX,
    localY,
    chunkId: `chunk_${chunkX}_${chunkY}`,
    pixelKey: `${localX},${localY}`,
  };
}

/**
 * Reconstructs global canvas coordinates from chunk coordinates and local offsets.
 */
export function fromChunkCoordinates(
  chunkX: number,
  chunkY: number,
  localX: number,
  localY: number
): { x: number; y: number } {
  if (
    !Number.isInteger(chunkX) ||
    !Number.isInteger(chunkY) ||
    !Number.isInteger(localX) ||
    !Number.isInteger(localY) ||
    chunkX < 0 ||
    chunkX > MAX_CHUNK_X ||
    chunkY < 0 ||
    chunkY > MAX_CHUNK_Y ||
    localX < 0 ||
    localX >= CHUNK_SIZE ||
    localY < 0 ||
    localY >= CHUNK_SIZE
  ) {
    throw new RangeError(`Invalid chunk or local coordinates provided.`);
  }

  const x = chunkX * CHUNK_SIZE + localX;
  const y = chunkY * CHUNK_SIZE + localY;

  if (x >= GRID_WIDTH || y >= GRID_HEIGHT) {
    throw new RangeError(`Reconstructed coordinates (${x}, ${y}) exceed canvas boundaries.`);
  }

  return { x, y };
}

/**
 * Parses a Firestore document ID `chunk_{x}_{y}` back into chunk indices.
 */
export function parseChunkId(chunkId: string): { chunkX: number; chunkY: number } {
  const match = /^chunk_(\d+)_(\d+)$/.exec(chunkId);
  if (!match) {
    throw new Error(`Invalid chunkId format: "${chunkId}". Expected "chunk_{x}_{y}".`);
  }

  const chunkX = Number(match[1]);
  const chunkY = Number(match[2]);

  if (chunkX > MAX_CHUNK_X || chunkY > MAX_CHUNK_Y) {
    throw new RangeError(`Chunk ID "${chunkId}" exceeds grid limits [0..${MAX_CHUNK_X}, 0..${MAX_CHUNK_Y}].`);
  }

  return { chunkX, chunkY };
}
