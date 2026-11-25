import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyChunk,
  applyPixelToChunk,
  applyDrawEventToChunk,
  isEventProcessed,
  PixelWriteInput,
} from './pixel-store.js';

test('createEmptyChunk initializes with 0 pixels and given coordinates and epoch', () => {
  const chunk = createEmptyChunk(3, 4, 1);
  assert.equal(chunk.chunkId, 'chunk_3_4');
  assert.equal(chunk.chunkX, 3);
  assert.equal(chunk.chunkY, 4);
  assert.equal(chunk.epoch, 1);
  assert.deepEqual(chunk.pixels, {});
  assert.equal(chunk.updatedAt, 0);
  assert.deepEqual(chunk.processedEvents, []);
});

test('applyPixelToChunk applies valid pixel write to empty slot', () => {
  const chunk = createEmptyChunk(0, 0);
  const write: PixelWriteInput = {
    x: 5,
    y: 10,
    color: '#ff0000',
    author: 'user-alice',
    timestamp: 1000,
  };

  const res = applyPixelToChunk(chunk, write);
  assert.equal(res.applied, true);
  assert.equal(res.localKey, '5,10');
  assert.ok(res.pixel);
  assert.equal(res.pixel.color, '#ff0000');
  assert.equal(res.pixel.author, 'user-alice');
  assert.equal(res.pixel.timestamp, 1000);
  assert.equal(res.pixel.epoch, 0);
});

test('applyPixelToChunk rejects invalid color or out of chunk coordinates', () => {
  const chunk = createEmptyChunk(0, 0);

  // Invalid color
  const badColor = applyPixelToChunk(chunk, {
    x: 1,
    y: 1,
    color: 'invalid-color',
    author: 'user',
    timestamp: 1000,
  });
  assert.equal(badColor.applied, false);
  assert.match(badColor.reason || '', /Invalid color format/);

  // Belongs to different chunk (x=100 is chunk 1)
  const wrongChunk = applyPixelToChunk(chunk, {
    x: 100,
    y: 1,
    color: '#ff0000',
    author: 'user',
    timestamp: 1000,
  });
  assert.equal(wrongChunk.applied, false);
  assert.match(wrongChunk.reason || '', /belongs to chunk_1_0/);
});

test('applyPixelToChunk enforces Last-Write-Wins based on timestamp', () => {
  const chunk = createEmptyChunk(0, 0);
  const firstWrite: PixelWriteInput = {
    x: 2,
    y: 2,
    color: '#111111',
    author: 'user-first',
    timestamp: 2000,
  };

  const res1 = applyPixelToChunk(chunk, firstWrite);
  assert.equal(res1.applied, true);
  chunk.pixels[res1.localKey!] = res1.pixel!;

  // Older timestamp should be rejected
  const olderWrite: PixelWriteInput = {
    x: 2,
    y: 2,
    color: '#222222',
    author: 'user-older',
    timestamp: 1500, // Older than 2000
  };
  const res2 = applyPixelToChunk(chunk, olderWrite);
  assert.equal(res2.applied, false);
  assert.match(res2.reason || '', /not newer/);

  // Equal timestamp should also be rejected
  const equalWrite: PixelWriteInput = {
    x: 2,
    y: 2,
    color: '#333333',
    author: 'user-equal',
    timestamp: 2000,
  };
  const res3 = applyPixelToChunk(chunk, equalWrite);
  assert.equal(res3.applied, false);

  // Newer timestamp should succeed
  const newerWrite: PixelWriteInput = {
    x: 2,
    y: 2,
    color: '#444444',
    author: 'user-newer',
    timestamp: 2500,
  };
  const res4 = applyPixelToChunk(chunk, newerWrite);
  assert.equal(res4.applied, true);
  assert.equal(res4.pixel?.color, '#444444');
  assert.equal(res4.pixel?.author, 'user-newer');
});

test('applyPixelToChunk enforces Epoch precedence over timestamps', () => {
  const chunk = createEmptyChunk(0, 0, 1);
  chunk.pixels['0,0'] = {
    color: '#ffffff',
    author: 'old-admin',
    timestamp: 5000,
    epoch: 1,
  };

  // Higher epoch with lower timestamp wins
  const higherEpochWrite: PixelWriteInput = {
    x: 0,
    y: 0,
    color: '#00ff00',
    author: 'new-user',
    timestamp: 1000, // lower timestamp
    epoch: 2,        // higher epoch
  };
  const res = applyPixelToChunk(chunk, higherEpochWrite);
  assert.equal(res.applied, true);
  assert.equal(res.pixel?.epoch, 2);
  assert.equal(res.pixel?.color, '#00ff00');

  // Lower epoch with high timestamp is rejected
  const lowerEpochWrite: PixelWriteInput = {
    x: 0,
    y: 0,
    color: '#ff0000',
    author: 'stale-user',
    timestamp: 99999,
    epoch: 0, // lower epoch
  };
  const resStale = applyPixelToChunk(chunk, lowerEpochWrite);
  assert.equal(resStale.applied, false);
  assert.match(resStale.reason || '', /older than existing epoch/);
});

test('applyDrawEventToChunk enforces idempotency by eventId', () => {
  const chunk = createEmptyChunk(0, 0);
  const eventId = 'event-unique-123';
  const writes: PixelWriteInput[] = [
    { x: 1, y: 1, color: '#ff0000', author: 'alice', timestamp: 1000 },
    { x: 1, y: 2, color: '#00ff00', author: 'alice', timestamp: 1000 },
  ];

  // First application
  const result1 = applyDrawEventToChunk(chunk, eventId, writes);
  assert.equal(result1.applied, true);
  assert.equal(result1.skippedDuplicate, false);
  assert.equal(Object.keys(result1.modifiedPixels).length, 2);
  assert.equal(result1.updatedChunk.updatedAt, 1000);
  assert.ok(isEventProcessed(result1.updatedChunk, eventId));

  // Second application with same eventId -> duplicate skipped!
  const result2 = applyDrawEventToChunk(result1.updatedChunk, eventId, writes);
  assert.equal(result2.applied, false);
  assert.equal(result2.skippedDuplicate, true);
  assert.deepEqual(result2.modifiedPixels, {});
  assert.deepEqual(result2.updatedChunk, result1.updatedChunk);
});
