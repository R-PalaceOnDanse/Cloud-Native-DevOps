import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRID_WIDTH,
  GRID_HEIGHT,
  CHUNK_SIZE,
  MAX_CHUNK_X,
  MAX_CHUNK_Y,
  isValidPixel,
  toChunkCoordinates,
  fromChunkCoordinates,
  parseChunkId,
} from './coordinates.js';

test('GRID and CHUNK constants meet architectural requirements', () => {
  assert.equal(GRID_WIDTH, 10000);
  assert.equal(GRID_HEIGHT, 10000);
  assert.equal(CHUNK_SIZE, 64);
  assert.equal(MAX_CHUNK_X, 156);
  assert.equal(MAX_CHUNK_Y, 156);
});

test('isValidPixel validates boundaries correctly', () => {
  assert.equal(isValidPixel(0, 0), true);
  assert.equal(isValidPixel(9999, 9999), true);
  assert.equal(isValidPixel(5000, 5000), true);

  // Negative bounds
  assert.equal(isValidPixel(-1, 0), false);
  assert.equal(isValidPixel(0, -1), false);

  // Upper bounds overflow
  assert.equal(isValidPixel(10000, 0), false);
  assert.equal(isValidPixel(0, 10000), false);

  // Non-integers
  assert.equal(isValidPixel(12.5, 30), false);
  assert.equal(isValidPixel(NaN, 0), false);
});

test('toChunkCoordinates maps origin (0, 0) correctly', () => {
  const coord = toChunkCoordinates(0, 0);
  assert.equal(coord.chunkX, 0);
  assert.equal(coord.chunkY, 0);
  assert.equal(coord.localX, 0);
  assert.equal(coord.localY, 0);
  assert.equal(coord.chunkId, 'chunk_0_0');
  assert.equal(coord.pixelKey, '0,0');
});

test('toChunkCoordinates maps chunk boundaries accurately', () => {
  // Last pixel of chunk_0_0
  const endChunk0 = toChunkCoordinates(63, 63);
  assert.equal(endChunk0.chunkX, 0);
  assert.equal(endChunk0.chunkY, 0);
  assert.equal(endChunk0.localX, 63);
  assert.equal(endChunk0.localY, 63);
  assert.equal(endChunk0.chunkId, 'chunk_0_0');

  // First pixel of chunk_1_1
  const startChunk1 = toChunkCoordinates(64, 64);
  assert.equal(startChunk1.chunkX, 1);
  assert.equal(startChunk1.chunkY, 1);
  assert.equal(startChunk1.localX, 0);
  assert.equal(startChunk1.localY, 0);
  assert.equal(startChunk1.chunkId, 'chunk_1_1');
});

test('toChunkCoordinates maps maximum canvas pixel (9999, 9999)', () => {
  const maxCoord = toChunkCoordinates(9999, 9999);
  assert.equal(maxCoord.chunkX, 156);
  assert.equal(maxCoord.chunkY, 156);
  assert.equal(maxCoord.localX, 9999 % 64);
  assert.equal(maxCoord.localY, 9999 % 64);
  assert.equal(maxCoord.chunkId, 'chunk_156_156');
});

test('toChunkCoordinates throws RangeError on out of bounds', () => {
  assert.throws(() => toChunkCoordinates(-1, 50), /out of bounds/);
  assert.throws(() => toChunkCoordinates(10000, 50), /out of bounds/);
});

test('fromChunkCoordinates reconstructs global coordinates correctly', () => {
  const global = fromChunkCoordinates(1, 2, 10, 20);
  assert.equal(global.x, 1 * 64 + 10);
  assert.equal(global.y, 2 * 64 + 20);

  // Roundtrip test
  const original = { x: 4521, y: 7892 };
  const chunked = toChunkCoordinates(original.x, original.y);
  const reconstructed = fromChunkCoordinates(
    chunked.chunkX,
    chunked.chunkY,
    chunked.localX,
    chunked.localY
  );
  assert.deepEqual(reconstructed, original);
});

test('parseChunkId parses valid IDs and throws on invalid', () => {
  const parsed = parseChunkId('chunk_42_99');
  assert.equal(parsed.chunkX, 42);
  assert.equal(parsed.chunkY, 99);

  assert.throws(() => parseChunkId('invalid_id'), /Invalid chunkId format/);
  assert.throws(() => parseChunkId('chunk_200_200'), /exceeds grid limits/);
});
