/**
 * Viewport Coordinate Management for the 10,000 x 10,000 Canvas.
 * Handles Pan, Zoom, Screen-to-World and Frustum Culling.
 * Fulfills Issue #80 (C07 §3.4).
 */

export const CANVAS_SIZE = 10000;
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 50.0;

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
  screenWidth: number;
  screenHeight: number;
}

export interface VisibleBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Creates a default viewport centered on the 10,000 x 10,000 canvas.
 */
export function createDefaultViewport(screenWidth: number, screenHeight: number): ViewportState {
  // Start zoomed to fit a reasonable portion of the canvas (e.g. 1000px view)
  const initialZoom = Math.min(screenWidth, screenHeight) / 1000;
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, initialZoom));

  // Center canvas in viewport: world (5000, 5000) at screen center
  const panX = screenWidth / 2 - 5000 * zoom;
  const panY = screenHeight / 2 - 5000 * zoom;

  return {
    zoom,
    panX,
    panY,
    screenWidth,
    screenHeight,
  };
}

/**
 * Converts screen pixel coordinates to canvas world coordinates.
 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  viewport: ViewportState
): { x: number; y: number } {
  const worldX = Math.floor((screenX - viewport.panX) / viewport.zoom);
  const worldY = Math.floor((screenY - viewport.panY) / viewport.zoom);
  return { x: worldX, y: worldY };
}

/**
 * Converts canvas world coordinates to screen pixel coordinates.
 */
export function worldToScreen(
  worldX: number,
  worldY: number,
  viewport: ViewportState
): { screenX: number; screenY: number } {
  const screenX = worldX * viewport.zoom + viewport.panX;
  const screenY = worldY * viewport.zoom + viewport.panY;
  return { screenX, screenY };
}

/**
 * Computes visible integer bounds of the canvas within the current screen viewport.
 * Clamped to [0..CANVAS_SIZE].
 */
export function getVisibleWorldBounds(viewport: ViewportState): VisibleBounds {
  const topLeft = screenToWorld(0, 0, viewport);
  const bottomRight = screenToWorld(viewport.screenWidth, viewport.screenHeight, viewport);

  const minX = Math.max(0, topLeft.x);
  const minY = Math.max(0, topLeft.y);
  const maxX = Math.min(CANVAS_SIZE - 1, bottomRight.x + 1);
  const maxY = Math.min(CANVAS_SIZE - 1, bottomRight.y + 1);

  return { minX, minY, maxX, maxY };
}

/**
 * Zooms in or out at a specific screen anchor point (e.g. cursor position).
 */
export function zoomAtPoint(
  screenX: number,
  screenY: number,
  zoomFactor: number,
  viewport: ViewportState
): ViewportState {
  const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewport.zoom * zoomFactor));
  if (newZoom === viewport.zoom) {
    return viewport;
  }

  // Zoom relative to anchor: (screenX - newPanX) / newZoom = (screenX - panX) / zoom
  const panX = screenX - (screenX - viewport.panX) * (newZoom / viewport.zoom);
  const panY = screenY - (screenY - viewport.panY) * (newZoom / viewport.zoom);

  return {
    ...viewport,
    zoom: newZoom,
    panX,
    panY,
  };
}

/**
 * Moves the viewport by screen delta offsets (pan).
 */
export function panViewport(deltaX: number, deltaY: number, viewport: ViewportState): ViewportState {
  return {
    ...viewport,
    panX: viewport.panX + deltaX,
    panY: viewport.panY + deltaY,
  };
}
