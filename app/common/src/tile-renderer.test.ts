import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderChunkToRgba, renderTileToPng } from './tile-renderer.js';
import { Pixel } from './types.js';

test('renderChunkToRgba creates exactly 64x64x4 bytes with default white background', () => {
  const pixels: Record<string, Pixel> = {
    '0,0': { color: '#ff0000', author: 'alice', timestamp: 1000 },
    '1,0': { color: '#00ff00', author: 'bob', timestamp: 1000 },
  };

  const buffer = renderChunkToRgba(pixels);
  assert.equal(buffer.length, 64 * 64 * 4); // 16384 bytes

  // Pixel (0, 0) should be Red (255, 0, 0, 255)
  assert.equal(buffer[0], 255);
  assert.equal(buffer[1], 0);
  assert.equal(buffer[2], 0);
  assert.equal(buffer[3], 255);

  // Pixel (1, 0) should be Green (0, 255, 0, 255)
  assert.equal(buffer[4], 0);
  assert.equal(buffer[5], 255);
  assert.equal(buffer[6], 0);
  assert.equal(buffer[7], 255);

  // Pixel (2, 0) unpainted should be default White (255, 255, 255, 255)
  assert.equal(buffer[8], 255);
  assert.equal(buffer[9], 255);
  assert.equal(buffer[10], 255);
  assert.equal(buffer[11], 255);
});

test('renderTileToPng outputs valid standard PNG binary buffer', () => {
  const pixels: Record<string, Pixel> = {
    '10,10': { color: '#0000ff', author: 'charlie', timestamp: 1000 },
  };

  const png = renderTileToPng(pixels);
  assert.ok(Buffer.isBuffer(png));
  assert.ok(png.length > 50); // Valid PNG file size

  // Verify PNG header signature: 89 50 4E 47 0D 0A 1A 0A
  const signature = png.subarray(0, 8);
  assert.deepEqual(
    Array.from(signature),
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  );

  // Verify IHDR chunk exists immediately after signature
  const ihdrType = png.subarray(12, 16).toString('ascii');
  assert.equal(ihdrType, 'IHDR');

  // Verify width and height in IHDR (bytes 16..24) are 64 x 64
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(width, 64);
  assert.equal(height, 64);

  // Verify IEND chunk at end
  const iend = png.subarray(png.length - 12);
  const iendType = iend.subarray(4, 8).toString('ascii');
  assert.equal(iendType, 'IEND');
});
