# Frontend Architecture & Canvas Rendering

This document describes the reactive web frontend for the collaborative pixel canvas (r/place clone), fulfilling GitHub Issues **#77**, **#80**, **#82**, and **#83** (C07 §3.1–§3.6).

---

## 1. Overview & Technology Stack

- **Stack**: TypeScript in strict mode (NodeNext, zero `any`), Vite bundler, HTML5 Canvas 2D.
- **Location**: `app/frontend/`.
- **Target Hosting**: Firebase Hosting / Static CDN (as decided in [ADR-0009](adr/0009-firebase-hosting-and-discord-oauth.md)).
- **Cost**: **0 €** during development and testing. Runs entirely on `localhost:5173`.

---

## 2. Core Capabilities

### A. Large-Grid Viewport & Zoom/Pan (Issue #80, C07 §3.4)
- **Dimensions**: Full 10,000 × 10,000 grid (`[0..9999, 0..9999]`).
- **Smooth Navigation**:
  - **Pan**: Click & drag with mouse (or middle click / Space + drag) smoothly repositions the viewport.
  - **Zoom**: Mouse wheel zooms smoothly centered at the pointer coordinate (`zoomAtPoint`), supporting zoom factors from `0.05x` (overview) up to `50x` (individual pixels).
- **Frustum Culling**: Only pixels intersecting the visible screen bounding box (`getVisibleWorldBounds`) are computed and drawn to the canvas, maintaining 60 FPS even on massive canvases.
- **Dynamic Pixel Grid**: When zoomed in ($\ge 8\times$), subtle grid lines appear to assist precision drawing.

### B. Pixel Inspection (Issue #82, C07 §3.5)
- Clicking or hovering over any pixel updates the bottom-right Inspector HUD:
  - Exact coordinates: `(X, Y)`.
  - Author: Discord user identifier or "Vide" if unpainted.
  - Timestamp: Formatted time of last update.
  - Color: Hex color code and visual swatch.

### C. Configurable Brush Tool (Issue #83, C07 §3.6)
- **Brush sizes**: `1px` (single pixel), `3px`, `5px`, `9px`.
- **Batching**: Calculates all pixels within the brush radius, clamps strictly to canvas bounds `[0..9999]`, and applies them in an atomic batch.
- **Palette**: Quick-selection of 16 standard colors (matching `@teampasx/common`) or arbitrary hex input via native color picker.

---

## 3. Local Development & Testing

```bash
cd app/frontend

# Install dependencies (Vite + TypeScript)
npm install

# Run unit tests (viewport math, frustum culling, brush geometry)
npm test

# Run local development server
npm run dev

# Build production bundle (dist/)
npm run build
```
