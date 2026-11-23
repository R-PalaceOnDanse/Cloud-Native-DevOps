import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeltaDocument, isDeltaExpired, DEFAULT_DELTA_TTL_SECONDS } from './deltas.js';
import { Pixel } from './types.js';

test('createDeltaDocument generates document with unique ID, chunkId, pixels and TTL', () => {
  const pixels: Record<string, Pixel> = {
    '10,20': {
      color: '#ff0000',
      author: 'user-bob',
      timestamp: 1700000000000,
      epoch: 0,
    },
  };

  const now = 1700000000000;
  const delta = createDeltaDocument('chunk_2_5', 'event-uuid-456789', pixels, 300, now);

  assert.equal(delta.chunkId, 'chunk_2_5');
  assert.equal(delta.eventId, 'event-uuid-456789');
  assert.equal(delta.createdAt, now);
  assert.equal(delta.expiresAt, now + 300 * 1000);
  assert.match(delta.deltaId, /^delta_1700000000000_event-uu/);
  assert.deepEqual(delta.pixels, pixels);
});

test('isDeltaExpired accurately identifies expired vs active deltas based on TTL', () => {
  const pixels: Record<string, Pixel> = {
    '0,0': { color: '#000000', author: 'user', timestamp: 1000 },
  };

  const createdAt = 100000;
  const delta = createDeltaDocument('chunk_0_0', 'ev-1', pixels, DEFAULT_DELTA_TTL_SECONDS, createdAt);
  // expiresAt = 100000 + 300000 = 400000

  // 1. Before expiration
  assert.equal(isDeltaExpired(delta, 200000), false);
  assert.equal(isDeltaExpired(delta, 399999), false);

  // 2. Exactly at or after expiration
  assert.equal(isDeltaExpired(delta, 400000), true);
  assert.equal(isDeltaExpired(delta, 500000), true);
});
