import { crc32, inflateSync } from "node:zlib";

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  /** Raw pixel bytes with the filter byte of each row removed. */
  readonly rgb: Uint8Array;
  readonly chunkTypes: readonly string[];
}

/** Reads back what encodePng writes (no filter) and checks every chunk's CRC. For tests only. */
export function decodePng(png: Buffer): DecodedPng {
  if (!png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error("not a PNG");
  }
  const chunkTypes: string[] = [];
  const idat: Buffer[] = [];
  let header: Buffer | undefined;
  let position = 8;
  while (position < png.length) {
    const length = png.readUInt32BE(position);
    const type = png.subarray(position + 4, position + 8).toString("ascii");
    const data = png.subarray(position + 8, position + 8 + length);
    const expected = png.readUInt32BE(position + 8 + length);
    if (crc32(png.subarray(position + 4, position + 8 + length)) !== expected) {
      throw new Error(`bad CRC in ${type}`);
    }
    chunkTypes.push(type);
    if (type === "IHDR") {
      header = data;
    }
    if (type === "IDAT") {
      idat.push(data);
    }
    position += 12 + length;
  }
  if (header === undefined) {
    throw new Error("no IHDR");
  }
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const raw = inflateSync(Buffer.concat(idat));
  const rowBytes = width * 3;
  const rgb = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    if (raw[row * (rowBytes + 1)] !== 0) {
      throw new Error("unexpected filter");
    }
    rgb.set(raw.subarray(row * (rowBytes + 1) + 1, (row + 1) * (rowBytes + 1)), row * rowBytes);
  }
  return { width, height, bitDepth: header[8] ?? 0, colorType: header[9] ?? 0, rgb, chunkTypes };
}
