/**
 * Canvas rendering (/get) and snapshot storage (/snapshot). Issues #55, #56, #167, C07 §2.
 *
 * - The grid is 10000x10000: the image covers the painted area (bounding box plus a margin), scaled
 *   down so its longest side is at most MAX_IMAGE_SIDE pixels.
 * - Snapshots go to the private bucket under a timestamped name; Discord gets a V4 signed URL valid one
 *   hour. On Cloud Run there is no key file: the Storage client signs through the IAM signBlob API with
 *   the function's own service account (roles/iam.serviceAccountTokenCreator on itself).
 */

import { deflateSync } from 'node:zlib';
import type { Storage } from '@google-cloud/storage';
import type { PixelWrite } from './store.js';

export const MAX_IMAGE_SIDE = 1024;
const MARGIN = 8;

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encodes an RGBA buffer as PNG, without native dependencies. */
export function encodeRgbaToPng(rgba: Uint8Array, width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // RGBA
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface RenderedCanvas {
  png: Buffer;
  width: number;
  height: number;
  /** Canvas coordinates of the top-left corner and grid cells per image pixel. */
  originX: number;
  originY: number;
  scale: number;
}

/** Renders the painted area of the grid on a white background. */
export function renderCanvas(pixels: readonly PixelWrite[]): RenderedCanvas {
  if (pixels.length === 0) {
    const size = 64;
    return { png: encodeRgbaToPng(new Uint8Array(size * size * 4).fill(255), size, size), width: size, height: size, originX: 0, originY: 0, scale: 1 };
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pixels) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  minX = Math.max(0, minX - MARGIN);
  minY = Math.max(0, minY - MARGIN);
  maxX = Math.min(9999, maxX + MARGIN);
  maxY = Math.min(9999, maxY + MARGIN);

  const spanX = maxX - minX + 1;
  const spanY = maxY - minY + 1;
  const scale = Math.max(1, Math.ceil(Math.max(spanX, spanY) / MAX_IMAGE_SIDE));
  const width = Math.ceil(spanX / scale);
  const height = Math.ceil(spanY / scale);

  const rgba = new Uint8Array(width * height * 4).fill(255);
  for (const p of pixels) {
    const ix = Math.floor((p.x - minX) / scale);
    const iy = Math.floor((p.y - minY) / scale);
    const i = (iy * width + ix) * 4;
    const hex = p.color.replace('#', '');
    rgba[i] = parseInt(hex.slice(0, 2), 16) || 0;
    rgba[i + 1] = parseInt(hex.slice(2, 4), 16) || 0;
    rgba[i + 2] = parseInt(hex.slice(4, 6), 16) || 0;
    rgba[i + 3] = 255;
  }
  return { png: encodeRgbaToPng(rgba, width, height), width, height, originX: minX, originY: minY, scale };
}

export interface SnapshotStorage {
  /** Stores the image and returns a time-limited signed URL to it. */
  save(objectName: string, png: Buffer, expiresInSeconds: number): Promise<string>;
}

export class GcsSnapshotStorage implements SnapshotStorage {
  constructor(private readonly storage: Storage, private readonly bucketName: string) {}

  async save(objectName: string, png: Buffer, expiresInSeconds: number): Promise<string> {
    const file = this.storage.bucket(this.bucketName).file(objectName);
    await file.save(png, { contentType: 'image/png', resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
    const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + expiresInSeconds * 1000 });
    return url;
  }
}

/** Snapshot object name: `snapshots/2026-11-25T14-03-07-123Z.png`. */
export function snapshotObjectName(now = new Date()): string {
  return `snapshots/${now.toISOString().replace(/[:.]/g, '-')}.png`;
}
