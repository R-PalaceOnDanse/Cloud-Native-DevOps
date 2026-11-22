/**
 * Canvas Rendering Engine for the 10,000 x 10,000 Grid.
 * Only draws visible tiles/pixels in the viewport (Frustum Culling).
 * Fulfills Issue #80 (C07 §3.4).
 */

import { ViewportState, getVisibleWorldBounds, worldToScreen, CANVAS_SIZE } from './viewport.js';
import { DrawnPixel } from './brush.js';

export interface PixelMetadata {
  color: string;
  author: string;
  timestamp: number;
}

export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private readonly pixels: Map<string, PixelMetadata> = new Map();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Unable to obtain Canvas 2D context.');
    }
    this.ctx = ctx;
  }

  public setPixel(x: number, y: number, color: string, author: string = 'Local User', timestamp: number = Date.now()): void {
    if (x >= 0 && x < CANVAS_SIZE && y >= 0 && y < CANVAS_SIZE) {
      this.pixels.set(`${x},${y}`, { color, author, timestamp });
    }
  }

  public applyBatch(batch: DrawnPixel[], author: string = 'Local User'): void {
    const now = Date.now();
    for (const p of batch) {
      this.setPixel(p.x, p.y, p.color, author, now);
    }
  }

  public getPixel(x: number, y: number): PixelMetadata | undefined {
    return this.pixels.get(`${x},${y}`);
  }

  public render(viewport: ViewportState): void {
    const { ctx, canvas } = this;
    const width = canvas.width;
    const height = canvas.height;

    // 1. Clear background
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, width, height);

    // 2. Draw canvas bounds (10,000 x 10,000 white square)
    const origin = worldToScreen(0, 0, viewport);
    const canvasPxWidth = CANVAS_SIZE * viewport.zoom;
    const canvasPxHeight = CANVAS_SIZE * viewport.zoom;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(origin.screenX, origin.screenY, canvasPxWidth, canvasPxHeight);

    // Border around canvas
    ctx.strokeStyle = '#484852';
    ctx.lineWidth = 1;
    ctx.strokeRect(origin.screenX, origin.screenY, canvasPxWidth, canvasPxHeight);

    // 3. Optional: draw subtle grid lines when zoomed in
    if (viewport.zoom >= 8) {
      this.renderGridLines(viewport);
    }

    // 4. Frustum culling: render only visible pixels
    const bounds = getVisibleWorldBounds(viewport);
    const pixelSize = Math.max(1, viewport.zoom);

    for (const [key, meta] of this.pixels.entries()) {
      const commaIdx = key.indexOf(',');
      const px = Number(key.substring(0, commaIdx));
      const py = Number(key.substring(commaIdx + 1));

      // Frustum check
      if (px >= bounds.minX && px <= bounds.maxX && py >= bounds.minY && py <= bounds.maxY) {
        const screen = worldToScreen(px, py, viewport);
        ctx.fillStyle = meta.color;
        // Ceil size to avoid sub-pixel gaps
        ctx.fillRect(screen.screenX, screen.screenY, Math.ceil(pixelSize), Math.ceil(pixelSize));
      }
    }
  }

  private renderGridLines(viewport: ViewportState): void {
    const { ctx } = this;
    const bounds = getVisibleWorldBounds(viewport);

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();

    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const p = worldToScreen(x, 0, viewport);
      ctx.moveTo(p.screenX, 0);
      ctx.lineTo(p.screenX, this.canvas.height);
    }

    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      const p = worldToScreen(0, y, viewport);
      ctx.moveTo(0, p.screenY);
      ctx.lineTo(this.canvas.width, p.screenY);
    }

    ctx.stroke();
  }
}
