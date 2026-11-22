/**
 * Color palette validation and canonicalization.
 * Supports #rrggbb hex or 16 predefined standard names.
 */

export const STANDARD_PALETTE: Readonly<Record<string, string>> = {
  white: '#ffffff',
  lightgray: '#d3d3d3',
  gray: '#808080',
  black: '#000000',
  red: '#ff0000',
  orange: '#ffa500',
  yellow: '#ffff00',
  lime: '#00ff00',
  green: '#008000',
  cyan: '#00ffff',
  blue: '#0000ff',
  navy: '#000080',
  purple: '#800080',
  magenta: '#ff00ff',
  pink: '#ffc0cb',
  brown: '#8b4513',
};

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{6})$/;

/**
 * Normalizes input color to canonical lowercase `#rrggbb`.
 * Throws an Error if color is invalid or unknown.
 */
export function normalizeColor(input: string): string {
  const trimmed = input.trim().toLowerCase();

  // 1. Check palette name
  if (trimmed in STANDARD_PALETTE) {
    return STANDARD_PALETTE[trimmed]!;
  }

  // 2. Check hex format with #
  if (HEX_COLOR_REGEX.test(trimmed)) {
    return trimmed;
  }

  // 3. Check hex format without #
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed}`;
  }

  throw new Error(
    `Invalid color "${input}". Expected a 6-digit hex (#rrggbb) or one of: ${Object.keys(STANDARD_PALETTE).join(', ')}.`
  );
}

/**
 * Check whether a color string is valid without throwing.
 */
export function isValidColor(input: string): boolean {
  try {
    normalizeColor(input);
    return true;
  } catch {
    return false;
  }
}
