import type { Validated } from "../events/index.js";
import { GRID_HEIGHT, GRID_WIDTH, TILE_SIZE, TILES_PER_COLUMN, TILES_PER_ROW } from "./constants.js";

export interface Pixel {
  readonly x: number;
  readonly y: number;
}

export interface TileCoordinate {
  readonly tx: number;
  readonly ty: number;
}

/** A rectangle of pixels: `x`, `y` is the top-left pixel, and the size is in pixels. */
export interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function isInGrid(pixel: Pixel): boolean {
  return (
    Number.isInteger(pixel.x) &&
    Number.isInteger(pixel.y) &&
    pixel.x >= 0 &&
    pixel.x < GRID_WIDTH &&
    pixel.y >= 0 &&
    pixel.y < GRID_HEIGHT
  );
}

export function parsePixel(x: unknown, y: unknown): Validated<Pixel> {
  if (typeof x !== "number" || typeof y !== "number") {
    return { ok: false, reason: "x and y must be numbers" };
  }
  const pixel = { x, y };
  return isInGrid(pixel)
    ? { ok: true, value: pixel }
    : { ok: false, reason: `(${String(x)}, ${String(y)}) is outside the grid 0..${String(GRID_WIDTH - 1)} x 0..${String(GRID_HEIGHT - 1)}` };
}

/** The tile that contains a pixel. The pixel must be inside the grid. */
export function tileOf(pixel: Pixel): TileCoordinate {
  return { tx: Math.floor(pixel.x / TILE_SIZE), ty: Math.floor(pixel.y / TILE_SIZE) };
}

/** Position of a pixel inside its own tile, from 0 to TILE_SIZE - 1. */
export function localOf(pixel: Pixel): Pixel {
  return { x: pixel.x % TILE_SIZE, y: pixel.y % TILE_SIZE };
}

/** Identifier of a tile, used as the key of its image and as the ordering key of its writes. */
export function tileId(tile: TileCoordinate): string {
  return `${String(tile.tx)}_${String(tile.ty)}`;
}

/** Identifier of a pixel document, `x:y` as in ADR-0007. */
export function pixelId(pixel: Pixel): string {
  return `${String(pixel.x)}:${String(pixel.y)}`;
}

export function parseTileId(id: string): Validated<TileCoordinate> {
  const match = /^(\d+)_(\d+)$/.exec(id);
  if (match?.[1] === undefined || match[2] === undefined) {
    return { ok: false, reason: "a tile ID looks like 12_7" };
  }
  const tile = { tx: Number(match[1]), ty: Number(match[2]) };
  return tile.tx < TILES_PER_ROW && tile.ty < TILES_PER_COLUMN
    ? { ok: true, value: tile }
    : { ok: false, reason: `tile ${id} is outside the grid` };
}

/** The pixels a tile covers, clipped to the grid on the right and bottom edges. */
export function tileBounds(tile: TileCoordinate): Rectangle {
  const x = tile.tx * TILE_SIZE;
  const y = tile.ty * TILE_SIZE;
  return {
    x,
    y,
    width: Math.min(TILE_SIZE, GRID_WIDTH - x),
    height: Math.min(TILE_SIZE, GRID_HEIGHT - y),
  };
}

/** Every tile that a viewport touches, in row order, ignoring the part outside the grid. */
export function tilesCovering(area: Rectangle): readonly TileCoordinate[] {
  if (area.width <= 0 || area.height <= 0) {
    return [];
  }
  const firstX = Math.max(0, area.x);
  const firstY = Math.max(0, area.y);
  const lastX = Math.min(GRID_WIDTH - 1, area.x + area.width - 1);
  const lastY = Math.min(GRID_HEIGHT - 1, area.y + area.height - 1);
  if (firstX > lastX || firstY > lastY) {
    return [];
  }
  const tiles: TileCoordinate[] = [];
  for (let ty = Math.floor(firstY / TILE_SIZE); ty <= Math.floor(lastY / TILE_SIZE); ty += 1) {
    for (let tx = Math.floor(firstX / TILE_SIZE); tx <= Math.floor(lastX / TILE_SIZE); tx += 1) {
      tiles.push({ tx, ty });
    }
  }
  return tiles;
}
