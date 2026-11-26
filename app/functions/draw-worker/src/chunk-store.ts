/**
 * In-memory CanvasStore, used by the tests only. Production uses FirestoreCanvasStore
 * (firestore-store.ts): a function instance must not keep the grid in memory (Issue #167).
 *
 * Same rules as Firestore: 64x64 chunks, last write wins per pixel, epoch bumped by /admin clear,
 * idempotent on the event ID.
 */

import {
  CanvasStore,
  DrawResult,
  PixelWrite,
  PROCESSED_EVENTS_KEPT,
  StoredPixel,
  SystemState,
  getChunkCoordinates,
  groupByChunk,
  isValidCoordinate,
} from './store.js';

export { CHUNK_SIZE, CANVAS_SIZE, isValidCoordinate, getChunkCoordinates } from './store.js';

interface MemoryChunk {
  chunkX: number;
  chunkY: number;
  epoch: number;
  pixels: Record<string, StoredPixel>;
  processedEvents: string[];
}

export class ChunkStore implements CanvasStore {
  private readonly chunks = new Map<string, MemoryChunk>();
  private state: SystemState = { paused: false, epoch: 1, lastClearedAt: null, admins: [] };
  private lastClearEventId: string | undefined;

  constructor(admins: string[] = []) {
    this.state.admins = [...admins];
  }

  async getSystemState(): Promise<SystemState> {
    return { ...this.state, admins: [...this.state.admins] };
  }

  async setPaused(paused: boolean): Promise<void> {
    this.state.paused = paused;
  }

  async clear(eventId: string): Promise<{ epoch: number; duplicate: boolean }> {
    if (this.lastClearEventId === eventId) {
      return { epoch: this.state.epoch, duplicate: true };
    }
    this.lastClearEventId = eventId;
    this.state.epoch += 1;
    this.state.lastClearedAt = Date.now();
    this.chunks.clear();
    return { epoch: this.state.epoch, duplicate: false };
  }

  async applyDraw(eventId: string, pixels: readonly PixelWrite[], author: string, timestamp: number): Promise<DrawResult> {
    let applied = 0;
    let duplicate = false;

    for (const [chunkId, group] of groupByChunk(pixels)) {
      let chunk = this.chunks.get(chunkId);
      if (!chunk || chunk.epoch < this.state.epoch) {
        chunk = { chunkX: group.chunkX, chunkY: group.chunkY, epoch: this.state.epoch, pixels: {}, processedEvents: [] };
        this.chunks.set(chunkId, chunk);
      }
      if (chunk.processedEvents.includes(eventId)) {
        duplicate = true;
        continue;
      }
      for (const w of group.writes) {
        const existing = chunk.pixels[w.pixelKey];
        if (!existing || timestamp >= existing.timestamp) {
          chunk.pixels[w.pixelKey] = { color: w.color, author, timestamp };
          applied++;
        }
      }
      chunk.processedEvents = [...chunk.processedEvents, eventId].slice(-PROCESSED_EVENTS_KEPT);
    }
    return { applied, duplicate: duplicate && applied === 0 };
  }

  async listPixels(): Promise<PixelWrite[]> {
    const out: PixelWrite[] = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.epoch < this.state.epoch) continue;
      for (const [key, p] of Object.entries(chunk.pixels)) {
        const [lx, ly] = key.split(',').map(Number);
        out.push({ x: chunk.chunkX * 64 + lx!, y: chunk.chunkY * 64 + ly!, color: p.color });
      }
    }
    return out;
  }

  // Test helpers.
  getPixel(x: number, y: number): StoredPixel | undefined {
    if (!isValidCoordinate(x, y)) return undefined;
    const c = getChunkCoordinates(x, y);
    const chunk = this.chunks.get(c.chunkId);
    if (!chunk || chunk.epoch < this.state.epoch) return undefined;
    return chunk.pixels[c.pixelKey];
  }

  getEpoch(): number {
    return this.state.epoch;
  }

  getPauseState(): boolean {
    return this.state.paused;
  }

  setPauseState(paused: boolean): void {
    this.state.paused = paused;
  }
}
