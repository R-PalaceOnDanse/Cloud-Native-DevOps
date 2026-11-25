import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBrushPixels, validateBrushStroke } from './brush.js';

test('brush size 1 returns exactly the single center pixel', () => {
  const pixels = getBrushPixels(50, 50, 1, '#ff0000');
  assert.equal(pixels.length, 1);
  assert.deepEqual(pixels[0], { x: 50, y: 50, color: '#ff0000' });
});

test('brush size 3 returns a 3x3 square of 9 pixels', () => {
  const pixels = getBrushPixels(10, 10, 3, '#00ff00');
  assert.equal(pixels.length, 9);
  // Verify center is present
  assert.ok(pixels.some((p) => p.x === 10 && p.y === 10));
  // Verify corner is present
  assert.ok(pixels.some((p) => p.x === 9 && p.y === 9));
  assert.ok(pixels.some((p) => p.x === 11 && p.y === 11));
});

test('brush clamps to grid boundary and omits out-of-bounds coordinates', () => {
  // Center on corner (0, 0) with brush size 3 (radius 1)
  const pixels = getBrushPixels(0, 0, 3, '#0000ff');
  // Only (0,0), (0,1), (1,0), (1,1) are within [0..9999] => 4 pixels
  assert.equal(pixels.length, 4);
  assert.ok(pixels.every((p) => p.x >= 0 && p.y >= 0));
});

test('returns empty array if center is completely outside canvas', () => {
  const pixels = getBrushPixels(-5, -5, 3, '#ffffff');
  assert.equal(pixels.length, 0);
});

test('validateBrushStroke rejects when canvas is paused', () => {
  const result = validateBrushStroke(1, 20, 20, true);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'paused');
  assert.match(result.message || '', /paused/i);
});

test('validateBrushStroke rejects strokes larger than max capacity with explanation rather than cutting', () => {
  // 5x5 brush produces 25 pixels, max capacity is 20
  const result = validateBrushStroke(25, 20, 20, false);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'exceeds_max_capacity');
  assert.match(result.message || '', /exceeds max capacity/i);
  assert.match(result.message || '', /not truncated/i);
});

test('validateBrushStroke rejects when current tokens are insufficient', () => {
  // 3x3 brush produces 9 pixels, but user has only 5 tokens left
  const result = validateBrushStroke(9, 5, 20, false);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'insufficient_tokens');
  assert.match(result.message || '', /insufficient tokens/i);
});

test('validateBrushStroke allows stroke within tokens and max capacity', () => {
  const result = validateBrushStroke(9, 10, 20, false);
  assert.equal(result.allowed, true);
  assert.equal(result.reason, undefined);
});
