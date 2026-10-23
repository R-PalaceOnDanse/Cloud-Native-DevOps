import { crc32, deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BIT_DEPTH = 8;
const COLOR_TYPE_RGB = 2;
const BYTES_PER_PIXEL = 3;

export interface RgbImage {
  readonly width: number;
  readonly height: number;
  /** `width * height * 3` bytes, red then green then blue for each pixel, row by row. */
  readonly rgb: Uint8Array;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** Encodes an 8-bit RGB image as a PNG, with no dependency other than Node's zlib. */
export function encodePng(image: RgbImage): Buffer {
  const { width, height, rgb } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError("a PNG needs a positive width and height");
  }
  const rowBytes = width * BYTES_PER_PIXEL;
  if (rgb.length !== rowBytes * height) {
    throw new RangeError(`expected ${String(rowBytes * height)} bytes of pixels, got ${String(rgb.length)}`);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = BIT_DEPTH;
  header[9] = COLOR_TYPE_RGB;
  // compression, filter and interlace methods stay at 0

  // Each row starts with its filter type; 0 means "no filter".
  const scanlines = Buffer.alloc((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const offset = row * (rowBytes + 1);
    scanlines[offset] = 0;
    scanlines.set(rgb.subarray(row * rowBytes, (row + 1) * rowBytes), offset + 1);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
