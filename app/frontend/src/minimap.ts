/**
 * Interactive Minimap / Radar for the 10,000 x 10,000 Canvas.
 * Renders global overview, active pixel locations, and interactive viewport frustum.
 * Fulfills C07 §3.4 (Large-grid navigation and viewport awareness).
 */

import { CANVAS_SIZE, ViewportState, screenToWorld } from './viewport.js';
import { CanvasRenderer } from './canvas.js';

export interface MinimapOptions {
  size?: number | undefined; // width & height in CSS pixels, default 140
  onNavigate?: ((worldX: number, worldY: number) => void) | undefined;
}

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private readonly onNavigate?: ((worldX: number, worldY: number) => void) | undefined;
  private isInteracting = false;

  constructor(canvas: HTMLCanvasElement, options: MinimapOptions = {}) {
    this.canvas = canvas;
    this.size = options.size || 140;
    this.onNavigate = options.onNavigate;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to get 2D context for minimap canvas.');
    }
    this.ctx = context;

    this.setupCanvasSize();
    this.attachEventListeners();
  }

  private setupCanvasSize(): void {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.canvas.width = this.size * dpr;
    this.canvas.height = this.size * dpr;
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
  }

  private attachEventListeners(): void {
    const handleEvent = (clientX: number, clientY: number): void => {
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(this.size, clientX - rect.left));
      const y = Math.max(0, Math.min(this.size, clientY - rect.top));

      const worldX = Math.round((x / this.size) * CANVAS_SIZE);
      const worldY = Math.round((y / this.size) * CANVAS_SIZE);

      if (this.onNavigate) {
        this.onNavigate(
          Math.max(0, Math.min(CANVAS_SIZE - 1, worldX)),
          Math.max(0, Math.min(CANVAS_SIZE - 1, worldY))
        );
      }
    };

    this.canvas.addEventListener('mousedown', (e) => {
      this.isInteracting = true;
      handleEvent(e.clientX, e.clientY);
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', (e) => {
        if (!this.isInteracting) return;
        handleEvent(e.clientX, e.clientY);
      });

      window.addEventListener('mouseup', () => {
        this.isInteracting = false;
      });
    }

    // Touch support for minimap
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length > 0) {
        this.isInteracting = true;
        const touch = e.touches[0]!;
        handleEvent(touch.clientX, touch.clientY);
      }
    }, { passive: true });

    this.canvas.addEventListener('touchmove', (e) => {
      if (!this.isInteracting || e.touches.length === 0) return;
      const touch = e.touches[0]!;
      handleEvent(touch.clientX, touch.clientY);
    }, { passive: true });

    this.canvas.addEventListener('touchend', () => {
      this.isInteracting = false;
    });
  }

  /**
   * Renders the minimap with current viewport frustum and pixel distribution.
   */
  public render(viewport: ViewportState, renderer: CanvasRenderer): void {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const ctx = this.ctx;
    const canvasPx = this.size * dpr;

    ctx.save();
    ctx.clearRect(0, 0, canvasPx, canvasPx);

    // 1. Background grid bounds (10,000 x 10,000 canvas)
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, canvasPx, canvasPx);

    ctx.strokeStyle = '#3f3f46';
    ctx.lineWidth = 1 * dpr;
    ctx.strokeRect(0, 0, canvasPx, canvasPx);

    // 2. Draw downscaled representation of painted pixels
    const pixels = renderer.getAllPixels();
    const scale = canvasPx / CANVAS_SIZE;

    for (const [key, meta] of pixels) {
      const commaIdx = key.indexOf(',');
      if (commaIdx === -1) continue;
      const px = Number(key.substring(0, commaIdx));
      const py = Number(key.substring(commaIdx + 1));

      ctx.fillStyle = meta.color || '#ff0000';
      const miniX = px * scale;
      const miniY = py * scale;
      const dotSize = Math.max(2 * dpr, 2);
      ctx.fillRect(miniX, miniY, dotSize, dotSize);
    }

    // 3. Compute Viewport Frustum on the 10,000 x 10,000 world
    const topLeft = screenToWorld(0, 0, viewport);
    const bottomRight = screenToWorld(viewport.screenWidth, viewport.screenHeight, viewport);

    const frustumMinX = Math.max(0, Math.min(CANVAS_SIZE, topLeft.x));
    const frustumMinY = Math.max(0, Math.min(CANVAS_SIZE, topLeft.y));
    const frustumMaxX = Math.max(0, Math.min(CANVAS_SIZE, bottomRight.x));
    const frustumMaxY = Math.max(0, Math.min(CANVAS_SIZE, bottomRight.y));

    const boxX = frustumMinX * scale;
    const boxY = frustumMinY * scale;
    const boxW = Math.max(4 * dpr, (frustumMaxX - frustumMinX) * scale);
    const boxH = Math.max(4 * dpr, (frustumMaxY - frustumMinY) * scale);

    // 4. Highlight Frustum Box
    ctx.fillStyle = 'rgba(6, 182, 212, 0.25)'; // translucent cyan
    ctx.fillRect(boxX, boxY, boxW, boxH);

    ctx.strokeStyle = '#06b6d4'; // bright cyan border
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.restore();
  }
}
