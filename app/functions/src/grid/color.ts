import type { Validated } from "../events/index.js";

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Named colors accepted in addition to `#rrggbb`. A fixed palette keeps the canvas readable and
 * lets a Discord user pick a color without knowing its hex code.
 */
export const PALETTE: Readonly<Record<string, string>> = {
  white: "#ffffff",
  lightgray: "#c8c8c8",
  gray: "#808080",
  black: "#000000",
  red: "#e50000",
  orange: "#ff8a00",
  yellow: "#ffe600",
  lime: "#94e044",
  green: "#02be01",
  cyan: "#00d3dd",
  blue: "#0083c7",
  navy: "#0000ea",
  purple: "#820080",
  magenta: "#e500e5",
  pink: "#ffa7d1",
  brown: "#a06a42",
};

const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/;

export interface ParsedColor {
  /** Canonical form: lowercase `#rrggbb`. */
  readonly hex: string;
  readonly rgb: Rgb;
}

function fromHex(hex: string): ParsedColor | undefined {
  const match = HEX_COLOR.exec(hex);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return undefined;
  }
  return {
    hex,
    rgb: { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) },
  };
}

/** Accepts `#rrggbb` in any case, or a name of the palette, and returns the canonical form. */
export function parseColor(input: string): Validated<ParsedColor> {
  const normalized = input.trim().toLowerCase();
  const hex = Object.hasOwn(PALETTE, normalized) ? PALETTE[normalized] : normalized;
  const parsed = hex === undefined ? undefined : fromHex(hex);
  return parsed === undefined
    ? { ok: false, reason: "a color is #rrggbb or one of: " + Object.keys(PALETTE).join(", ") }
    : { ok: true, value: parsed };
}
