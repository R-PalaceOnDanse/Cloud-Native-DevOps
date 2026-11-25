# ADR-0017 — Frontend technology stack and Canvas 2D rendering

- **Status**: Accepted
- **Date**: 2026-11-22
- **Deciders**: project owner, team approval through pull request review
- **Supersedes**: none
- **Resolves**: Issue #67 (Part of Epic #114 / C07 §3.4)

## Context

The canvas frontend must render a collaborative grid of at least 10,000 × 10,000 pixels (`[0..9999, 0..9999]`), supporting smooth zoom (from 5% overview to 5000% single-pixel focus) and pan, sub-pixel accuracy, real-time delta updates, and brush tools. The frontend must be lightweight, compile fast, share types with the backend, and run purely client-side on serverless hosting (ADR-0009).

## Options considered

1. **Strict TypeScript + Vite + HTML5 Canvas 2D with Frustum Culling** — A lightweight custom rendering engine using native HTML5 Canvas 2D context. Only pixels visible in the current viewport bounding box are drawn on each frame. Logic (coordinate projection, zoom, brush geometry) is completely separated from DOM elements and tested in Node without a browser.
2. **TypeScript + WebGL (Three.js / Pixi.js / custom shaders)** — High GPU throughput for millions of particles. However, it requires custom shader compilation, WebGL context loss handling on mobile devices, and significantly higher code complexity for a 2D tile grid.
3. **Component UI framework (React / Vue / Svelte) with SVG or HTML DOM pixels** — Creating DOM elements or SVG nodes per pixel is strictly forbidden: a 10,000 × 10,000 grid would generate up to $10^8$ DOM nodes, immediately crashing browser memory.

## Decision

Option 1: **Strict TypeScript + Vite + HTML5 Canvas 2D**.

- **Frustum Culling**: `getVisibleWorldBounds` calculates visible world coordinates from the viewport transformation (`panX`, `panY`, `zoom`). Only visible pixels are drawn during `render()`.
- **Zero Framework Bloat**: No heavy UI frameworks. The entire production JavaScript bundle is under 15 KiB (gzipped ~4.5 KiB) and builds in under 300 ms.
- **Type Sharing**: Strict TypeScript (`zero any`) aligns coordinate models and chunking math (`toChunkCoordinates`, `64×64` chunk size) directly with `@teampasx/common` and Cloud Functions.
- **Testability**: Coordinate transformations and brush math are 100% testable in automated Node.js tests (`node:test`) without requiring headless Chrome or jsdom.

## Consequences

- Positive: 60 FPS smooth rendering across desktop and mobile; minimal memory footprint; sub-300ms builds; zero runtime dependencies; easy static hosting via Firebase Hosting / Cloud Storage CDN.
- Negative / trade-offs accepted: Full overview (0.05x zoom) with hundreds of thousands of painted pixels requires limiting listener subscriptions to viewport center (ADR-0008) to prevent exceeding Firestore connection quotas.
