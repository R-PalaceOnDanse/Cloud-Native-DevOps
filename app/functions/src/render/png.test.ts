import { describe, expect, it } from "vitest";
import { encodePng } from "./png.js";
import { decodePng } from "./png-test-decoder.js";

describe("encodePng", () => {
  it("writes a valid 8-bit RGB PNG that reads back the same pixels", () => {
    const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
    const decoded = decodePng(encodePng({ width: 3, height: 2, rgb }));
    expect(decoded).toMatchObject({ width: 3, height: 2, bitDepth: 8, colorType: 2 });
    expect(Array.from(decoded.rgb)).toEqual(Array.from(rgb));
    expect(decoded.chunkTypes).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  it("starts with the PNG signature", () => {
    const png = encodePng({ width: 1, height: 1, rgb: new Uint8Array([1, 2, 3]) });
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("compresses a large flat image well below its raw size", () => {
    const rgb = new Uint8Array(256 * 256 * 3).fill(255);
    expect(encodePng({ width: 256, height: 256, rgb }).length).toBeLessThan(2_000);
  });

  it.each([
    [0, 1],
    [1, 0],
    [1.5, 1],
    [-1, 1],
  ])("refuses the size %f x %f", (width, height) => {
    expect(() => encodePng({ width, height, rgb: new Uint8Array(0) })).toThrow(RangeError);
  });

  it("refuses pixel data of the wrong length", () => {
    expect(() => encodePng({ width: 2, height: 2, rgb: new Uint8Array(5) })).toThrow(/expected 12 bytes/);
  });
});
