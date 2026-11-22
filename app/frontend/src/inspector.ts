/**
 * Pixel Inspector formatting & state.
 * Fulfills Issue #82 (C07 §3.5).
 */

import { PixelMetadata } from './canvas.js';
import { CANVAS_SIZE } from './viewport.js';

export interface PixelInspectionInfo {
  coordsText: string;
  authorText: string;
  timeText: string;
  colorText: string;
  hexColor: string;
  isEmpty: boolean;
  isOutOfBounds: boolean;
}

/**
 * Formats metadata of an inspected pixel for display in the Inspector HUD.
 * Handles out-of-bounds, empty (unpainted) pixels, and drawn pixels.
 */
export function formatPixelInspection(
  pixel: PixelMetadata | undefined,
  x: number,
  y: number
): PixelInspectionInfo {
  if (x < 0 || x >= CANVAS_SIZE || y < 0 || y >= CANVAS_SIZE) {
    return {
      coordsText: 'Hors champ',
      authorText: '—',
      timeText: '—',
      colorText: '—',
      hexColor: '#808080',
      isEmpty: false,
      isOutOfBounds: true,
    };
  }

  const coordsText = `(${x}, ${y})`;

  if (!pixel) {
    return {
      coordsText,
      authorText: 'Vide (pixel vierge)',
      timeText: 'Jamais modifié',
      colorText: '#ffffff (défaut)',
      hexColor: '#ffffff',
      isEmpty: true,
      isOutOfBounds: false,
    };
  }

  return {
    coordsText,
    authorText: pixel.author,
    timeText: new Date(pixel.timestamp).toLocaleTimeString(),
    colorText: pixel.color,
    hexColor: pixel.color,
    isEmpty: false,
    isOutOfBounds: false,
  };
}
