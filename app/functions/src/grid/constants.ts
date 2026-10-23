/** The canvas is 10000 x 10000 pixels (subject §3.3). */
export const GRID_WIDTH = 10_000;
export const GRID_HEIGHT = 10_000;

/** Side of a tile in pixels, see ADR-0007. Tiles on the right and bottom edges are smaller. */
export const TILE_SIZE = 256;

export const TILES_PER_ROW = Math.ceil(GRID_WIDTH / TILE_SIZE);
export const TILES_PER_COLUMN = Math.ceil(GRID_HEIGHT / TILE_SIZE);
