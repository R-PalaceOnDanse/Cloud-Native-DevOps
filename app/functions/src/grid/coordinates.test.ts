import { describe, expect, it } from "vitest";
import { GRID_HEIGHT, GRID_WIDTH, TILE_SIZE, TILES_PER_COLUMN, TILES_PER_ROW } from "./constants.js";
import {
  isInGrid,
  localOf,
  parsePixel,
  parseTileId,
  pixelId,
  tileBounds,
  tileId,
  tileOf,
  tilesCovering,
} from "./coordinates.js";

describe("grid constants", () => {
  it("covers 10000 x 10000 pixels with 40 x 40 tiles", () => {
    expect([GRID_WIDTH, GRID_HEIGHT]).toEqual([10_000, 10_000]);
    expect([TILES_PER_ROW, TILES_PER_COLUMN]).toEqual([40, 40]);
  });
});

describe("isInGrid and parsePixel", () => {
  it.each([
    [0, 0],
    [9_999, 9_999],
    [255, 256],
  ])("accepts (%i, %i)", (x, y) => {
    expect(isInGrid({ x, y })).toBe(true);
    expect(parsePixel(x, y)).toEqual({ ok: true, value: { x, y } });
  });

  it.each([
    [-1, 0],
    [0, -1],
    [10_000, 0],
    [0, 10_000],
    [1.5, 2],
    [Number.NaN, 2],
    [Number.POSITIVE_INFINITY, 0],
  ])("rejects (%f, %f)", (x, y) => {
    expect(isInGrid({ x, y })).toBe(false);
    expect(parsePixel(x, y).ok).toBe(false);
  });

  it("rejects values that are not numbers", () => {
    expect(parsePixel("1", 2)).toEqual({ ok: false, reason: "x and y must be numbers" });
    expect(parsePixel(undefined, undefined).ok).toBe(false);
  });
});

describe("tileOf and localOf", () => {
  it("puts the first pixel of a tile at its local origin", () => {
    const pixel = { x: 2 * TILE_SIZE, y: 3 * TILE_SIZE };
    expect(tileOf(pixel)).toEqual({ tx: 2, ty: 3 });
    expect(localOf(pixel)).toEqual({ x: 0, y: 0 });
  });

  it("puts the last pixel of a tile at its far local corner", () => {
    const pixel = { x: 3 * TILE_SIZE - 1, y: 4 * TILE_SIZE - 1 };
    expect(tileOf(pixel)).toEqual({ tx: 2, ty: 3 });
    expect(localOf(pixel)).toEqual({ x: TILE_SIZE - 1, y: TILE_SIZE - 1 });
  });

  it("places the last pixel of the grid in the last tile", () => {
    expect(tileOf({ x: 9_999, y: 9_999 })).toEqual({ tx: 39, ty: 39 });
  });
});

describe("identifiers", () => {
  it("writes a tile ID and reads it back", () => {
    expect(tileId({ tx: 12, ty: 7 })).toBe("12_7");
    expect(parseTileId("12_7")).toEqual({ ok: true, value: { tx: 12, ty: 7 } });
  });

  it.each(["", "12", "12_", "a_b", "-1_0", "1_2_3", "40_0", "0_40"])("rejects the tile ID %j", (id) => {
    expect(parseTileId(id).ok).toBe(false);
  });

  it("writes a pixel ID as x:y", () => {
    expect(pixelId({ x: 10, y: 20 })).toBe("10:20");
  });
});

describe("tileBounds", () => {
  it("gives a full tile inside the grid", () => {
    expect(tileBounds({ tx: 1, ty: 2 })).toEqual({ x: 256, y: 512, width: 256, height: 256 });
  });

  it("clips the tiles on the right and bottom edges", () => {
    const edge = 10_000 - 39 * TILE_SIZE;
    expect(tileBounds({ tx: 39, ty: 39 })).toEqual({ x: 9_984, y: 9_984, width: edge, height: edge });
    expect(edge).toBe(16);
  });
});

describe("tilesCovering", () => {
  it("returns the single tile of a small area", () => {
    expect(tilesCovering({ x: 10, y: 10, width: 5, height: 5 })).toEqual([{ tx: 0, ty: 0 }]);
  });

  it("returns every tile touched, in row order", () => {
    expect(tilesCovering({ x: 250, y: 250, width: 10, height: 10 })).toEqual([
      { tx: 0, ty: 0 },
      { tx: 1, ty: 0 },
      { tx: 0, ty: 1 },
      { tx: 1, ty: 1 },
    ]);
  });

  it("ignores the part of the area outside the grid", () => {
    expect(tilesCovering({ x: -100, y: -100, width: 110, height: 110 })).toEqual([{ tx: 0, ty: 0 }]);
    expect(tilesCovering({ x: 9_990, y: 9_990, width: 100, height: 100 })).toEqual([{ tx: 39, ty: 39 }]);
  });

  it("returns nothing for an empty area or one fully outside", () => {
    expect(tilesCovering({ x: 0, y: 0, width: 0, height: 10 })).toEqual([]);
    expect(tilesCovering({ x: 20_000, y: 0, width: 10, height: 10 })).toEqual([]);
  });

  it("covers the whole grid with 1600 tiles", () => {
    expect(tilesCovering({ x: 0, y: 0, width: 10_000, height: 10_000 })).toHaveLength(1_600);
  });
});
