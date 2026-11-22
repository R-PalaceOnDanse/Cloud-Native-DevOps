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
- Clicking on any pixel selects it and updates the bottom-right Inspector HUD:
  - **Visual Selection Reticle**: A cyan bounding highlight (`#06b6d4`) is drawn directly around the selected pixel in the viewport.
  - **Empty Pixels**: Explicitly identifies unpainted pixels ("Vide (pixel vierge)", "Jamais modifié", default `#ffffff`).
  - **Painted Pixels**: Displays the exact author Discord handle/ID, formatted timestamp of last update, and hex color code.
  - **Deselection**: A "Désélectionner" action or clicking out-of-bounds clears the active selection reticle.

### C. Configurable Brush Tool & Stroke Validation (Issue #83, C07 §3.6)
- **Brush sizes**: `1px` (1 pixel), `3px` (9 pixels), `5px` (25 pixels), `9px` (81 pixels).
- **Stroke Larger Than Limit Explained, Not Cut**:
  - The client token bucket maintains a reserve capacity of 20 tokens (refilling continuously at 1 token / 3s).
  - When selecting a brush requiring more pixels than the maximum reserve capacity (e.g., 5px requiring 25 pixels or 9px requiring 81 pixels), the HUD highlights a warning.
  - If a stroke attempt requires more than the maximum capacity, the client rejects the stroke with an explanatory toast (`Trait supérieur à la capacité maximale (25 pixels > 20 max). Réduisez la taille du pinceau. Le trait n'est pas tronqué pour préserver l'intégrité du dessin.`), rather than silently cutting or clipping the stroke shape.
- **Canvas Pause State (Admin Override)**:
  - The client subscribes to global system configuration (`config/system`).
  - When an admin executes `/admin pause`, a persistent red banner appears (`⏸️ Canevas en pause`), and any draw attempt is refused immediately with an explanatory toast notification until resumed by `/admin resume`.

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

---

## 4. Real-time Updates & Event Subscriptions (Issue #81, C07 §3.3)

In accordance with [ADR-0008](adr/0008-firestore-listeners-for-realtime.md) and module requirements:
- **ZERO Polling**: No `setInterval`, no polling loops, and no manual "Rafraîchir" button exist anywhere in the application.
- **Viewport-Driven Chunk Subscriptions**:
  - The client calculates which 64×64 chunks intersect the current viewport (`getVisibleChunkIds`).
  - As the user pans and zooms, newly visible chunks are subscribed to in real time (`onSnapshot`), while chunks moving out of the viewport are immediately unsubscribed.
  - When zoomed far out, subscriptions are capped to the closest chunks to the center (max 64) to prevent exceeding connection quotas.
- **In-Place Delta Application**:
  - Incremental chunk updates (written by backend workers upon Discord `/draw` or web draws) are pushed to the client and applied directly to the `CanvasRenderer` in place.
- **Discord OAuth2 Client Integration** (Issue #17 / [ADR-0009](adr/0009-firebase-hosting-and-discord-oauth.md)):
  - Top-right Discord login button initiates OAuth2 authorization code flow with scope `identify`.
  - Authenticated session tags the user's Discord handle and snowflake ID on drawn pixels.

---

## 5. Web Draw Proxy & Client Rate Limiting (Issue #76, C07 §3.2)

- **Asynchronous Pipeline**: The client never writes directly to storage or Firestore. All brush strokes are posted to the Web Draw Proxy (`/api/draw`).
- **Token Bucket HUD Indicator**: The client displays a real-time token bucket indicator (`🪙 20/20`) that refills continuously (1 token every 3 seconds, up to 20 tokens per minute).
- **Graceful Error Toasting**: If the user draws when tokens are exhausted or if the proxy returns HTTP 429, a floating toast notification informs the user of the retry cooldown without crashing the viewport.
