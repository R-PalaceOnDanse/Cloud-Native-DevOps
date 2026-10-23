import { describe, expect, it } from "vitest";
import { renderTile } from "./tile-image.js";
import { decodePng } from "./png-test-decoder.js";

function pixelAt(rgb: Uint8Array, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 3;
  return [rgb[offset] ?? -1, rgb[offset + 1] ?? -1, rgb[offset + 2] ?? -1];
}

describe("renderTile", () => {
  it("draws a 256 x 256 white tile when nothing is painted", () => {
    const image = decodePng(renderTile({ tx: 0, ty: 0 }, []));
    expect(image).toMatchObject({ width: 256, height: 256 });
    expect(pixelAt(image.rgb, 256, 0, 0)).toEqual([255, 255, 255]);
    expect(pixelAt(image.rgb, 256, 255, 255)).toEqual([255, 255, 255]);
  });

  it("paints a pixel at its position inside the tile", () => {
    const image = decodePng(
      renderTile({ tx: 2, ty: 1 }, [{ x: 2 * 256 + 5, y: 256 + 7, rgb: { r: 229, g: 0, b: 0 } }]),
    );
    expect(pixelAt(image.rgb, 256, 5, 7)).toEqual([229, 0, 0]);
    expect(pixelAt(image.rgb, 256, 6, 7)).toEqual([255, 255, 255]);
  });

  it("ignores pixels that belong to another tile", () => {
    const image = decodePng(renderTile({ tx: 0, ty: 0 }, [{ x: 256, y: 0, rgb: { r: 0, g: 0, b: 0 } }]));
    expect(pixelAt(image.rgb, 256, 255, 0)).toEqual([255, 255, 255]);
  });

  it("makes the last tile of the grid 16 x 16", () => {
    const image = decodePng(renderTile({ tx: 39, ty: 39 }, [{ x: 9_999, y: 9_999, rgb: { r: 0, g: 0, b: 234 } }]));
    expect(image).toMatchObject({ width: 16, height: 16 });
    expect(pixelAt(image.rgb, 16, 15, 15)).toEqual([0, 0, 234]);
  });

  it("uses the background color given", () => {
    const image = decodePng(renderTile({ tx: 39, ty: 0 }, [], { r: 10, g: 20, b: 30 }));
    expect(image).toMatchObject({ width: 16, height: 256 });
    expect(pixelAt(image.rgb, 16, 3, 3)).toEqual([10, 20, 30]);
  });

  it("lets the later pixel win when two target the same position", () => {
    const image = decodePng(
      renderTile({ tx: 0, ty: 0 }, [
        { x: 1, y: 1, rgb: { r: 1, g: 1, b: 1 } },
        { x: 1, y: 1, rgb: { r: 2, g: 2, b: 2 } },
      ]),
    );
    expect(pixelAt(image.rgb, 256, 1, 1)).toEqual([2, 2, 2]);
  });
});
