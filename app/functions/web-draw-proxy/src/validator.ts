/**
 * Input validation for web draw stroke requests.
 */

export const GRID_SIZE = 10000;
export const MAX_BATCH_SIZE = 100;
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export interface RawPixelInput {
  x?: unknown;
  y?: unknown;
  color?: unknown;
}

export interface ValidatedPixel {
  x: number;
  y: number;
  color: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  pixels?: ValidatedPixel[];
}

export function validateDrawBatch(rawPixels: unknown): ValidationResult {
  if (!Array.isArray(rawPixels)) {
    return { valid: false, error: 'Field "pixels" must be an array of pixel objects.' };
  }

  if (rawPixels.length === 0) {
    return { valid: false, error: 'Pixel batch must contain at least 1 pixel.' };
  }

  if (rawPixels.length > MAX_BATCH_SIZE) {
    return { valid: false, error: `Pixel batch exceeds maximum allowed size of ${MAX_BATCH_SIZE} pixels.` };
  }

  const validated: ValidatedPixel[] = [];

  for (let i = 0; i < rawPixels.length; i++) {
    const p = rawPixels[i] as RawPixelInput;
    if (!p || typeof p !== 'object') {
      return { valid: false, error: `Pixel at index ${i} is not a valid object.` };
    }

    const { x, y, color } = p;

    if (typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x >= GRID_SIZE) {
      return {
        valid: false,
        error: `Pixel at index ${i} has invalid x coordinate (${String(x)}). Expected integer in [0..${GRID_SIZE - 1}].`,
      };
    }

    if (typeof y !== 'number' || !Number.isInteger(y) || y < 0 || y >= GRID_SIZE) {
      return {
        valid: false,
        error: `Pixel at index ${i} has invalid y coordinate (${String(y)}). Expected integer in [0..${GRID_SIZE - 1}].`,
      };
    }

    if (typeof color !== 'string' || !HEX_COLOR_REGEX.test(color)) {
      return {
        valid: false,
        error: `Pixel at index ${i} has invalid color (${String(color)}). Expected hex format "#rrggbb".`,
      };
    }

    validated.push({
      x,
      y,
      color: color.toLowerCase(),
    });
  }

  return { valid: true, pixels: validated };
}
