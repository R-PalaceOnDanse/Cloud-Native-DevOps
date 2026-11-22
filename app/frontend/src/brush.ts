/**
 * Brush Tool Geometry & Pixel Batching.
 * Fulfills Issue #83 (C07 §3.6).
 */

import { CANVAS_SIZE } from './viewport.js';

export interface DrawnPixel {
  x: number;
  y: number;
  color: string;
}

/**
 * Supported brush sizes: 1x1, 3x3, 5x5, 9x9.
 */
export const ALLOWED_BRUSH_SIZES = [1, 3, 5, 9] as const;
export type BrushSize = (typeof ALLOWED_BRUSH_SIZES)[number];

/**
 * Calculates all valid canvas pixels covered by a brush stroke centered on (centerX, centerY).
 * Clamps coordinates strictly within [0..CANVAS_SIZE - 1].
 */
export function getBrushPixels(
  centerX: number,
  centerY: number,
  size: number,
  color: string
): DrawnPixel[] {
  if (centerX < 0 || centerX >= CANVAS_SIZE || centerY < 0 || centerY >= CANVAS_SIZE) {
    return [];
  }

  if (size <= 1) {
    return [{ x: centerX, y: centerY, color }];
  }

  const radius = Math.floor(size / 2);
  const pixels: DrawnPixel[] = [];

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = centerX + dx;
      const py = centerY + dy;

      if (px >= 0 && px < CANVAS_SIZE && py >= 0 && py < CANVAS_SIZE) {
        pixels.push({ x: px, y: py, color });
      }
    }
  }

  return pixels;
}
