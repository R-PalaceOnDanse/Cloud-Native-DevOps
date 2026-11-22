import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBrushPixels } from './brush.js';

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
