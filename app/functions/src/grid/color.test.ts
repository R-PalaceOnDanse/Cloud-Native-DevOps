import { describe, expect, it } from "vitest";
import { PALETTE, parseColor } from "./color.js";

describe("parseColor", () => {
  it("reads a hex color and gives its channels", () => {
    expect(parseColor("#ff8000")).toEqual({
      ok: true,
      value: { hex: "#ff8000", rgb: { r: 255, g: 128, b: 0 } },
    });
  });

  it("normalizes the case and the surrounding spaces", () => {
    expect(parseColor("  #FF8000 ")).toMatchObject({ ok: true, value: { hex: "#ff8000" } });
  });

  it("reads a palette name, in any case", () => {
    expect(parseColor("Red")).toMatchObject({ ok: true, value: { hex: "#e50000" } });
  });

  it("has a valid hex color for every name of the palette", () => {
    for (const name of Object.keys(PALETTE)) {
      expect(parseColor(name).ok).toBe(true);
    }
    expect(Object.keys(PALETTE)).toHaveLength(16);
  });

  it.each(["", "#fff", "ff0000", "#gg0000", "#ff00000", "rgb(1,2,3)", "notacolor", "__proto__", "constructor"])(
    "rejects %j",
    (input) => {
      expect(parseColor(input).ok).toBe(false);
    },
  );
});
