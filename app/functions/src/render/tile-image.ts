import { parseColor, type Rgb } from "../grid/color.js";
import { tileBounds, type Pixel, type TileCoordinate } from "../grid/coordinates.js";
import { encodePng } from "./png.js";

export interface PaintedPixel extends Pixel {
  readonly rgb: Rgb;
}

const BYTES_PER_PIXEL = 3;

function whiteRgb(): Rgb {
  const white = parseColor("white");
  if (!white.ok) {
    throw new Error("the palette must contain white");
  }
  return white.value.rgb;
}

/**
 * Draws one tile as a PNG: the background everywhere, then each painted pixel. Pixels that belong
 * to another tile are ignored, so the caller can pass a whole batch. The image has the size of the
 * tile, which is smaller on the right and bottom edges of the grid.
 */
export function renderTile(
  tile: TileCoordinate,
  pixels: Iterable<PaintedPixel>,
  background: Rgb = whiteRgb(),
): Buffer {
  const bounds = tileBounds(tile);
  const rgb = new Uint8Array(bounds.width * bounds.height * BYTES_PER_PIXEL);
  for (let offset = 0; offset < rgb.length; offset += BYTES_PER_PIXEL) {
    rgb[offset] = background.r;
    rgb[offset + 1] = background.g;
    rgb[offset + 2] = background.b;
  }
  for (const pixel of pixels) {
    const column = pixel.x - bounds.x;
    const row = pixel.y - bounds.y;
    if (column < 0 || row < 0 || column >= bounds.width || row >= bounds.height) {
      continue;
    }
    const offset = (row * bounds.width + column) * BYTES_PER_PIXEL;
    rgb[offset] = pixel.rgb.r;
    rgb[offset + 1] = pixel.rgb.g;
    rgb[offset + 2] = pixel.rgb.b;
  }
  return encodePng({ width: bounds.width, height: bounds.height, rgb });
}
