/**
 * Tile Renderer for Serverless Storage & Cloud Storage/CDN Delivery.
 * Fulfills Issue #54, C06 §4.1 and ADR-0007.
 * 
 * Rules:
 * 1. Each 64×64 tile is rendered as a standard image (PNG).
 * 2. Pure TypeScript implementation using Node.js built-in zlib (zero native binary dependencies).
 * 3. Supports sparse pixel maps (unpainted pixels render as white #ffffff or transparent).
 */

import { deflateSync } from 'node:zlib';
import { Pixel } from './types.js';
import { CHUNK_SIZE } from './coordinates.js';

export interface TileRenderOptions {
  /** Background color hex (default '#ffffff') */
  backgroundColor?: string;
  /** Whether unpainted pixels should be fully transparent */
  transparentBackground?: boolean;
}

/**
 * Standard CRC32 lookup table for PNG chunk checksums.
 */
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  CRC_TABLE[n] = c;
}

function calculateCrc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = data.length;
  const chunk = new Uint8Array(4 + 4 + len + 4);
  const view = new DataView(chunk.buffer);

  // Length
  view.setUint32(0, len, false);
  // Type
  chunk.set(typeBytes, 4);
  // Data
  chunk.set(data, 8);

  // CRC32 calculated over Type + Data
  const crcTarget = new Uint8Array(4 + len);
  crcTarget.set(typeBytes, 0);
  crcTarget.set(data, 4);
  const crc = calculateCrc32(crcTarget);

  // CRC
  view.setUint32(8 + len, crc, false);

  return chunk;
}

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;
  return [r, g, b];
}

/**
 * Renders a 64×64 chunk's sparse pixel dictionary into an RGBA byte buffer.
 * Output size: exactly 64 * 64 * 4 = 16,384 bytes.
 */
export function renderChunkToRgba(
  pixels: Record<string, Pixel>,
  options: TileRenderOptions = {}
): Uint8Array {
  const buffer = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 4);
  const bgHex = options.backgroundColor || '#ffffff';
  const [bgR, bgG, bgB] = parseHexRgb(bgHex);
  const bgAlpha = options.transparentBackground ? 0 : 255;

  // 1. Initialize background
  for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = bgR;
    buffer[i + 1] = bgG;
    buffer[i + 2] = bgB;
    buffer[i + 3] = bgAlpha;
  }

  // 2. Paint sparse pixels
  for (const [key, p] of Object.entries(pixels)) {
    const comma = key.indexOf(',');
    if (comma === -1) continue;
    const lx = parseInt(key.substring(0, comma), 10);
    const ly = parseInt(key.substring(comma + 1), 10);

    if (lx >= 0 && lx < CHUNK_SIZE && ly >= 0 && ly < CHUNK_SIZE) {
      const idx = (ly * CHUNK_SIZE + lx) * 4;
      const [r, g, b] = parseHexRgb(p.color);
      buffer[idx] = r;
      buffer[idx + 1] = g;
      buffer[idx + 2] = b;
      buffer[idx + 3] = 255; // Fully opaque
    }
  }

  return buffer;
}

/**
 * Encodes a 64×64 chunk into a valid PNG image buffer.
 * Compatible with Cloud Storage object upload and CDN delivery.
 */
export function renderTileToPng(
  pixels: Record<string, Pixel>,
  options: TileRenderOptions = {}
): Buffer {
  const rgba = renderChunkToRgba(pixels, options);

  // PNG Signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR: 13 bytes
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, CHUNK_SIZE, false); // width 64
  ihdrView.setUint32(4, CHUNK_SIZE, false); // height 64
  ihdr[8] = 8;  // bit depth: 8 bits per channel
  ihdr[9] = 6;  // color type: 6 (RGBA)
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: standard adaptive
  ihdr[12] = 0; // interlace: none

  const ihdrChunk = createChunk('IHDR', ihdr);

  // Raw Scanlines: each row starts with filter byte 0 (None), then 64*4 RGBA bytes = 257 bytes/row
  const scanlines = new Uint8Array(CHUNK_SIZE * (CHUNK_SIZE * 4 + 1));
  for (let y = 0; y < CHUNK_SIZE; y++) {
    const rowOffset = y * (CHUNK_SIZE * 4 + 1);
    scanlines[rowOffset] = 0; // Filter byte: None
    const rgbaOffset = y * CHUNK_SIZE * 4;
    scanlines.set(rgba.subarray(rgbaOffset, rgbaOffset + CHUNK_SIZE * 4), rowOffset + 1);
  }

  // IDAT: Compressed scanlines
  const compressed = deflateSync(scanlines);
  const idatChunk = createChunk('IDAT', compressed);

  // IEND: 0 bytes
  const iendChunk = createChunk('IEND', new Uint8Array(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}
