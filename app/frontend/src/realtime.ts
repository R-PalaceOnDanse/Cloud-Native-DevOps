/**
 * Real-time Viewport-driven Chunk Subscription Manager.
 * Fulfills Issue #81 (C07 §3.3 & ADR-0008).
 * 
 * Guarantees:
 * 1. ZERO polling: no setInterval or manual refresh loops.
 * 2. Only listens to chunks intersecting the active viewport.
 * 3. Immediately unsubscribes from chunks that leave the viewport.
 * 4. Applies incoming deltas in place on the CanvasRenderer.
 */

import { ViewportState, getVisibleWorldBounds } from './viewport.js';
import { CanvasRenderer } from './canvas.js';
import { DrawnPixel } from './brush.js';

export const CHUNK_SIZE = 64;
export const MAX_CHUNK_INDEX = 156; // floor((10000 - 1) / 64)
export const MAX_VIEWPORT_CHUNKS = 64; // Safety limit to avoid exhausting listener connections when zoomed far out

export interface RemotePixel {
  color: string;
  author: string;
  timestamp: number;
}

export interface ChunkPayload {
  chunkId: string;
  chunkX: number;
  chunkY: number;
  pixels: Record<string, RemotePixel>;
  updatedAt: number;
}

export type ChunkUpdateCallback = (payload: ChunkPayload) => void;
export type UnsubscribeCallback = () => void;

export interface RealtimeSubscriptionProvider {
  subscribe(chunkId: string, onUpdate: ChunkUpdateCallback): UnsubscribeCallback;
  publishDraw?(batch: DrawnPixel[], author: string): Promise<boolean>;
}

/**
 * Computes all chunk IDs (e.g. 'chunk_2_5') intersecting the current viewport.
 * If the viewport covers more than maxLimit chunks (e.g. at 10% zoom), it prioritizes
 * chunks closest to the center to prevent flooding Firestore listeners.
 */
export function getVisibleChunkIds(viewport: ViewportState, maxLimit = MAX_VIEWPORT_CHUNKS): string[] {
  const bounds = getVisibleWorldBounds(viewport);

  const minChunkX = Math.max(0, Math.min(MAX_CHUNK_INDEX, Math.floor(bounds.minX / CHUNK_SIZE)));
  const maxChunkX = Math.max(0, Math.min(MAX_CHUNK_INDEX, Math.floor(bounds.maxX / CHUNK_SIZE)));
  const minChunkY = Math.max(0, Math.min(MAX_CHUNK_INDEX, Math.floor(bounds.minY / CHUNK_SIZE)));
  const maxChunkY = Math.max(0, Math.min(MAX_CHUNK_INDEX, Math.floor(bounds.maxY / CHUNK_SIZE)));

  const chunks: Array<{ id: string; distanceToCenterSq: number }> = [];
  const centerChunkX = (minChunkX + maxChunkX) / 2;
  const centerChunkY = (minChunkY + maxChunkY) / 2;

  for (let cy = minChunkY; cy <= maxChunkY; cy++) {
    for (let cx = minChunkX; cx <= maxChunkX; cx++) {
      const distSq = Math.pow(cx - centerChunkX, 2) + Math.pow(cy - centerChunkY, 2);
      chunks.push({ id: `chunk_${cx}_${cy}`, distanceToCenterSq: distSq });
    }
  }

  // If within limit, return all
  if (chunks.length <= maxLimit) {
    return chunks.map((c) => c.id);
  }

  // Otherwise sort by distance to center and pick closest
  chunks.sort((a, b) => a.distanceToCenterSq - b.distanceToCenterSq);
  return chunks.slice(0, maxLimit).map((c) => c.id);
}

/**
 * Parse chunk coordinates from an ID ('chunk_12_34' -> { cx: 12, cy: 34 }).
 */
export function parseChunkId(chunkId: string): { cx: number; cy: number } | null {
  const parts = chunkId.split('_');
  if (parts.length !== 3 || parts[0] !== 'chunk') return null;
  const cx = parseInt(parts[1]!, 10);
  const cy = parseInt(parts[2]!, 10);
  if (Number.isNaN(cx) || Number.isNaN(cy)) return null;
  return { cx, cy };
}

/**
 * Viewport-driven Real-time Manager.
 */
export class RealtimeManager {
  private readonly provider: RealtimeSubscriptionProvider;
  private readonly renderer: CanvasRenderer;
  private readonly onRequestRender: () => void;
  private readonly onSubscriptionsChanged?: ((count: number) => void) | undefined;

  private activeSubscriptions: Map<string, UnsubscribeCallback> = new Map();

  constructor(
    provider: RealtimeSubscriptionProvider,
    renderer: CanvasRenderer,
    onRequestRender: () => void,
    onSubscriptionsChanged?: ((count: number) => void) | undefined
  ) {
    this.provider = provider;
    this.renderer = renderer;
    this.onRequestRender = onRequestRender;
    this.onSubscriptionsChanged = onSubscriptionsChanged;
  }

  /**
   * Called whenever the viewport moves (pan or zoom).
   * Diffs currently active subscriptions with new visible chunks.
   */
  public updateViewport(viewport: ViewportState): void {
    const visibleChunkIds = new Set(getVisibleChunkIds(viewport));

    // 1. Unsubscribe from chunks no longer visible
    for (const [chunkId, unsubscribe] of this.activeSubscriptions.entries()) {
      if (!visibleChunkIds.has(chunkId)) {
        unsubscribe();
        this.activeSubscriptions.delete(chunkId);
      }
    }

    // 2. Subscribe to newly visible chunks
    for (const chunkId of visibleChunkIds) {
      if (!this.activeSubscriptions.has(chunkId)) {
        const unsubscribe = this.provider.subscribe(chunkId, (payload) => {
          this.handleChunkUpdate(payload);
        });
        this.activeSubscriptions.set(chunkId, unsubscribe);
      }
    }

    if (this.onSubscriptionsChanged) {
      this.onSubscriptionsChanged(this.activeSubscriptions.size);
    }
  }

  /**
   * Applies deltas in place from a push update.
   */
  public handleChunkUpdate(payload: ChunkPayload): void {
    const { chunkX, chunkY, pixels } = payload;
    let modified = false;

    for (const [key, meta] of Object.entries(pixels)) {
      const commaIdx = key.indexOf(',');
      if (commaIdx === -1) continue;
      const lx = parseInt(key.substring(0, commaIdx), 10);
      const ly = parseInt(key.substring(commaIdx + 1), 10);

      if (Number.isNaN(lx) || Number.isNaN(ly)) continue;

      const gx = chunkX * CHUNK_SIZE + lx;
      const gy = chunkY * CHUNK_SIZE + ly;

      this.renderer.setPixel(gx, gy, meta.color, meta.author, meta.timestamp);
      modified = true;
    }

    if (modified) {
      this.onRequestRender();
    }
  }

  /**
   * Publishes a local draw to the backend proxy.
   */
  public async publishDraw(batch: DrawnPixel[], author: string): Promise<boolean> {
    if (this.provider.publishDraw) {
      return this.provider.publishDraw(batch, author);
    }
    return true;
  }

  public getActiveSubscriptionCount(): number {
    return this.activeSubscriptions.size;
  }

  public getActiveChunkIds(): string[] {
    return Array.from(this.activeSubscriptions.keys());
  }

  public destroy(): void {
    for (const unsubscribe of this.activeSubscriptions.values()) {
      unsubscribe();
    }
    this.activeSubscriptions.clear();
    if (this.onSubscriptionsChanged) {
      this.onSubscriptionsChanged(0);
    }
  }
}

/**
 * In-memory Mock Provider for local testing, demo, and CI verification.
 * Allows simulating bidirectional real-time draws (e.g. Discord bot events).
 */
export class MockRealtimeProvider implements RealtimeSubscriptionProvider {
  private listeners: Map<string, Set<ChunkUpdateCallback>> = new Map();
  private chunkState: Map<string, Record<string, RemotePixel>> = new Map();

  public subscribe(chunkId: string, onUpdate: ChunkUpdateCallback): UnsubscribeCallback {
    if (!this.listeners.has(chunkId)) {
      this.listeners.set(chunkId, new Set());
    }
    const set = this.listeners.get(chunkId)!;
    set.add(onUpdate);

    // Initial snapshot push if chunk has pixels
    const existing = this.chunkState.get(chunkId);
    if (existing) {
      const coords = parseChunkId(chunkId);
      if (coords) {
        onUpdate({
          chunkId,
          chunkX: coords.cx,
          chunkY: coords.cy,
          pixels: existing,
          updatedAt: Date.now(),
        });
      }
    }

    return () => {
      set.delete(onUpdate);
      if (set.size === 0) {
        this.listeners.delete(chunkId);
      }
    };
  }

  /**
   * Simulates a pixel draw arriving from an external source (such as Discord bot or another user).
   */
  public simulateExternalDraw(x: number, y: number, color: string, author: string): void {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const lx = x % CHUNK_SIZE;
    const ly = y % CHUNK_SIZE;
    const chunkId = `chunk_${cx}_${cy}`;

    let chunk = this.chunkState.get(chunkId);
    if (!chunk) {
      chunk = {};
      this.chunkState.set(chunkId, chunk);
    }

    chunk[`${lx},${ly}`] = {
      color,
      author,
      timestamp: Date.now(),
    };

    const listeners = this.listeners.get(chunkId);
    if (listeners && listeners.size > 0) {
      const payload: ChunkPayload = {
        chunkId,
        chunkX: cx,
        chunkY: cy,
        pixels: { [`${lx},${ly}`]: chunk[`${lx},${ly}`]! },
        updatedAt: Date.now(),
      };
      for (const listener of listeners) {
        listener(payload);
      }
    }
  }

  public async publishDraw(batch: DrawnPixel[], author: string): Promise<boolean> {
    for (const p of batch) {
      this.simulateExternalDraw(p.x, p.y, p.color, author);
    }
    return true;
  }
}
