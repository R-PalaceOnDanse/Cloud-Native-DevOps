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
- **Global Reset (`/admin clear`)**:
  - The client listens for updates to `lastClearedAt` in `config/system`.
  - When triggered, `renderer.clearAll()` wipes all pixels and active selections in place, re-renders the empty 10,000 × 10,000 grid, and notifies the user via toast.

### D. Keyboard Shortcuts & Touch Gestures
- **Keyboard Shortcuts (Power-User & Defense)**:
  - `B` : Switch to Brush / Draw tool
  - `I` : Switch to Eyedropper / Pipette tool (or hold `Alt` while in Draw mode)
  - `H` : Switch to Hand / Pan tool
  - `E` : Quick Eraser (switches color to canvas blank `#ffffff`)
  - `G` : Toggle pixel gridlines on/off
  - `Space` (held) : Temporary pan mode
  - `1`, `2`, `3`, `4` : Quick-select brush size (1px, 3px, 5px, 9px)
  - `+` / `-` : Smooth zoom in / out
  - `0` or `C` : Recenter viewport to origin (5000, 5000)
  - `Escape` : Deselect currently inspected pixel
- **Touch & Mobile Support**:
  - 1-finger drag in Pan mode : repositions viewport smoothly.
  - 1-finger draw in Draw mode : places pixels at touch coordinate.
  - Quick tap (< 350 ms) : inspects touched pixel.
  - 2-finger pinch (pinch-to-zoom) : smooth zoom centered on touch midpoint.
  - 2-finger drag : simultaneous pan and zoom.

### E. Minimap Radar, Coordinate Jump & URL Deep Linking
- **Minimap Radar Widget (`140 × 140`)**:
  - Positioned bottom-left, shows the complete 10,000 × 10,000 canvas in miniature.
  - Highlights the current viewport frustum bounding box in cyan (`#06b6d4`).
  - Interactive: clicking or dragging on the radar immediately centers the main canvas to that location.
  - Collapsible via the header toggle `▾`.
- **Coordinate Jump ("Aller à X, Y") & URL Hash Deep Linking**:
  - Top HUD coordinate label or `📍 Aller à` button opens a modal to jump directly to any `(X, Y)` position and zoom level.
  - Viewport automatically syncs with the URL hash (`#x=5000&y=5000&z=1`), enabling instant deep linking and coordinate sharing across teams and Discord.
- **Canvas View PNG Export**:
  - A toolbar action `📷 Exporter vue` enables one-click download of the active viewport render as a PNG image file.

### F. Quality-of-Life Tools (Eyedropper, Recent Colors, Gridlines & Offline Mode)
- **Pipette / Eyedropper Tool (`I` or `Alt + Click`)**:
  - Clicking on any painted or blank canvas pixel samples its exact color (`renderer.getPixelColor(x, y)`), updates the active palette, adds it to recent colors, and automatically switches back to the brush tool with an instant toast notification.
- **Recent Colors Palette**:
  - Maintains the 6 most recently used custom colors in `localStorage` (`pixel_canvas_recent_colors`), rendered as quick-select swatches beneath the main 16-color palette.
- **Gridlines Toggle (`G` key or toolbar button)**:
  - Toggles the subtle pixel alignment grid when zoomed in ($\ge 8\times$) on or off with instant UI feedback.
- **Quick Eraser (`E` key or toolbar button)**:
  - Instantly switches the drawing color to blank white (`#ffffff`) to allow erasing or cleaning up pixels.
- **Network Offline Detection & Local Graceful Degradation**:
  - Native listener for `online` / `offline` events displaying a warning badge `⚠️ Hors-ligne` in the top HUD. Optimistic drawing continues locally without throwing errors.
- **Personal Contribution Counter (`🎯 N px`)**:
  - Real-time counter in the top HUD tracking total pixels placed by the user, persisted in `localStorage`.

---

## 3. Local Development & Testing

See the full user guide and instructions in [app/frontend/README.md](../app/frontend/README.md).

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

---

## 6. Discord OAuth2 Authentication & Session Flow (Issue #79, C07 §3.1, ADR-0009)

- **Anti-CSRF Protection**:
  - Before redirecting to Discord, the client generates a unique cryptographically random state token (`csrf_<timestamp>_<random>`) stored in `sessionStorage`.
  - When returning with `?code=...&state=...`, the client asserts strict equality before exchanging the code.
- **Backend Auth Callback Cloud Function (`app/functions/auth-callback`)**:
  - Securely reads the `DISCORD_CLIENT_SECRET` from Secret Manager.
  - Exchanges the single-use authorization code with Discord OAuth2 token endpoint (`https://discord.com/api/oauth2/token`).
  - Fetches the user's minimal Discord profile via `https://discord.com/api/users/@me` with scope `identify`.
  - **Zero Access Token Persistence**: The Discord access token is strictly discarded from memory and never stored in any database, session store, or log.
  - Mints a short-lived session token (1-hour expiration) carrying the Discord UID (`discord:<id>`) and username.
- **Client Propagation**:
  - The minted session token is stored in client memory and `sessionStorage`.
  - Transmitted to the Web Draw Proxy (`Authorization: Bearer <sessionToken>`) and Firestore listeners, linking every placed pixel to the authenticated Discord user.

---

## 7. Native Firebase Client SDK & Zero Polling Architecture (Issue #81, ADR-0008)

- **Native Real-time Provider (`FirestoreRealtimeProvider`)**:
  - Direct integration with Firebase JS SDK (`firebase/firestore`, `firebase/auth`).
  - Viewport-driven listener attachment: as the user pans or zooms, the client computes intersecting 64×64 chunks and invokes `onSnapshot(doc(firestore, 'chunks', chunkId))` to stream real-time chunk documents and deltas.
  - Chunks leaving the viewport are immediately detached via their unsubscribe handle to preserve connection quotas.
  - Subscribes to `config/system` via `onSnapshot` to react instantly to admin pause/resume events.
- **Graceful Fallback**:
  - Factory function `createRealtimeProvider()` automatically detects whether Firebase credentials (`VITE_FIREBASE_PROJECT_ID`) are present.
  - If unconfigured (e.g. offline dev, test suites, or CI runs), it falls back seamlessly to `MockRealtimeProvider`.

---

## 8. Firestore Security Rules & Firebase Hosting (Issues #78, #84, ADR-0008, ADR-0009)

- **Firestore Security Policy (`infra/serverless/firestore.rules`)**:
  - **Default Deny**: All documents are private by default (`match /{document=**} { allow read, write: if false; }`).
  - **Read Only for Authenticated Users**: `match /chunks/{chunkId}` and `match /config/{docId}` require `request.auth != null`.
  - **Zero Client Writes**: All client writes (`write: if false`) are strictly rejected. Pixel updates must pass exclusively through the API Gateway ➔ Web Draw Proxy ➔ Pub/Sub ➔ Worker pipeline.
  - **Protected Rate Limits**: `match /ratelimits/{userId}` rejects all client reads and writes (accessible only to backend workers via Admin SDK).
- **Firebase Hosting Configuration (`firebase.json`)**:
  - Serves static assets from `app/frontend/dist`.
  - Single-page application URL rewrites: `**` rewrites to `/index.html`.
  - Cache-Control headers: Immutable 1-year cache on hashed JS/CSS assets (`public, max-age=31536000, immutable`), and no-cache on `/index.html` for immediate release updates.


