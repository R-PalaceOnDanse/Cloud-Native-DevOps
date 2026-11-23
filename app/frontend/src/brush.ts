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

export const BRUSH_PIXEL_COUNTS: Record<BrushSize, number> = {
  1: 1,
  3: 9,
  5: 25,
  9: 81,
};

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

export interface StrokeValidationResult {
  allowed: boolean;
  reason?: 'paused' | 'exceeds_max_capacity' | 'insufficient_tokens';
  message?: string;
}

/**
 * Validates a brush stroke attempt against canvas pause state and token limits.
 * Requirement (Issue #83):
 * "A stroke larger than the limit is explained, not cut."
 */
export function validateBrushStroke(
  batchLength: number,
  currentTokens: number,
  maxCapacity: number = 20,
  isPaused: boolean = false
): StrokeValidationResult {
  if (isPaused) {
    return {
      allowed: false,
      reason: 'paused',
      message: 'Canvas is paused: drawing is temporarily suspended by an administrator.',
    };
  }

  if (batchLength > maxCapacity) {
    return {
      allowed: false,
      reason: 'exceeds_max_capacity',
      message: `Stroke exceeds max capacity (${batchLength} pixels requested, max capacity is ${maxCapacity} pixels). Reduce brush size (1px or 3px). The stroke is not truncated to preserve artwork integrity.`,
    };
  }

  if (currentTokens < batchLength) {
    return {
      allowed: false,
      reason: 'insufficient_tokens',
      message: `Temporarily insufficient tokens: ${Math.floor(currentTokens)}/${batchLength} available. Refilling (+1 every 3s).`,
    };
  }

  return { allowed: true };
}
