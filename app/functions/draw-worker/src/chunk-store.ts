/**
 * Chunk Storage and Transactional Pixel Updates.
 * Fulfills Issues #51, #58, #140 (C06 §4).
 * 
 * Guarantees:
 * 1. 10,000 x 10,000 grid partitioned into 64x64 chunks (157 x 157 = 24,649 chunks max).
 * 2. Last-Write-Wins (LWW) conflict resolution by timestamp.
 * 3. Grid Epoch precedence: higher epoch overrides older epochs.
 * 4. Idempotency: duplicate eventId ignored.
 * 5. Delta documents created with 5-minute TTL.
 */

export const CHUNK_SIZE = 64;
export const CANVAS_SIZE = 10000;

export interface StoredPixel {
  color: string;
  author: string;
  updatedAt: number;
  epoch: number;
}

export interface ChunkDocument {
  chunkId: string;
  chunkX: number;
  chunkY: number;
  epoch: number;
  pixels: Record<string, StoredPixel>; // Keyed "localX,localY"
  processedEventIds: string[];
  updatedAt: number;
}

export interface DeltaDocument {
  id: string;
  chunkId: string;
  pixels: Array<{
    x: number;
    y: number;
    color: string;
    author: string;
    updatedAt: number;
  }>;
  createdAt: number;
  expiresAt: number; // TTL timestamp (default +300s)
}

export function isValidCoordinate(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < CANVAS_SIZE && y >= 0 && y < CANVAS_SIZE;
}

export function getChunkCoordinates(x: number, y: number): { chunkX: number; chunkY: number; localX: number; localY: number; chunkId: string } {
  if (!isValidCoordinate(x, y)) {
    throw new RangeError(`Coordinates (${x}, ${y}) are out of canvas bounds [0..${CANVAS_SIZE - 1}].`);
  }
  const chunkX = Math.floor(x / CHUNK_SIZE);
  const chunkY = Math.floor(y / CHUNK_SIZE);
  const localX = x % CHUNK_SIZE;
  const localY = y % CHUNK_SIZE;
  const chunkId = `chunk_${chunkX}_${chunkY}`;

  return { chunkX, chunkY, localX, localY, chunkId };
}

export class ChunkStore {
  private readonly chunks: Map<string, ChunkDocument> = new Map();
  private readonly deltas: Map<string, DeltaDocument[]> = new Map();
  private currentEpoch = 1;
  private isPaused = false;
  private lastClearedAt = 0;

  public getEpoch(): number {
    return this.currentEpoch;
  }

  public setEpoch(epoch: number): void {
    this.currentEpoch = epoch;
    this.lastClearedAt = Date.now();
  }

  public getPauseState(): boolean {
    return this.isPaused;
  }

  public setPauseState(paused: boolean): void {
    this.isPaused = paused;
  }

  public getLastClearedAt(): number {
    return this.lastClearedAt;
  }

  public getOrCreateChunk(chunkId: string, chunkX: number, chunkY: number): ChunkDocument {
    let chunk = this.chunks.get(chunkId);
    if (!chunk) {
      chunk = {
        chunkId,
        chunkX,
        chunkY,
        epoch: this.currentEpoch,
        pixels: {},
        processedEventIds: [],
        updatedAt: Date.now(),
      };
      this.chunks.set(chunkId, chunk);
    }
    return chunk;
  }

  /**
   * Applies a batch of drawn pixels to their respective chunks transactionally.
   */
  public applyDraw(
    eventId: string,
    pixels: Array<{ x: number; y: number; color: string }>,
    author: string,
    timestamp = Date.now()
  ): { applied: number; duplicate: boolean } {
    if (pixels.length === 0) return { applied: 0, duplicate: false };

    // 1. Group pixels by chunk
    const grouped = new Map<string, Array<{ x: number; y: number; localX: number; localY: number; color: string; chunkX: number; chunkY: number }>>();

    for (const p of pixels) {
      const coord = getChunkCoordinates(p.x, p.y);
      const list = grouped.get(coord.chunkId) || [];
      list.push({
        x: p.x,
        y: p.y,
        localX: coord.localX,
        localY: coord.localY,
        color: p.color,
        chunkX: coord.chunkX,
        chunkY: coord.chunkY,
      });
      grouped.set(coord.chunkId, list);
    }

    let totalApplied = 0;

    // 2. Process each chunk transactionally
    for (const [chunkId, chunkPixels] of grouped) {
      const first = chunkPixels[0]!;
      const chunk = this.getOrCreateChunk(chunkId, first.chunkX, first.chunkY);

      // Check event idempotency
      if (chunk.processedEventIds.includes(eventId)) {
        return { applied: 0, duplicate: true };
      }

      const deltaList: Array<{ x: number; y: number; color: string; author: string; updatedAt: number }> = [];

      for (const p of chunkPixels) {
        const key = `${p.localX},${p.localY}`;
        const existing = chunk.pixels[key];

        // LWW conflict resolution:
        // 1. Higher epoch wins
        // 2. Same epoch: higher timestamp wins
        let shouldOverwrite = false;
        if (!existing) {
          shouldOverwrite = true;
        } else if (this.currentEpoch > existing.epoch) {
          shouldOverwrite = true;
        } else if (this.currentEpoch === existing.epoch && timestamp >= existing.updatedAt) {
          shouldOverwrite = true;
        }

        if (shouldOverwrite) {
          chunk.pixels[key] = {
            color: p.color,
            author,
            updatedAt: timestamp,
            epoch: this.currentEpoch,
          };
          deltaList.push({
            x: p.x,
            y: p.y,
            color: p.color,
            author,
            updatedAt: timestamp,
          });
          totalApplied++;
        }
      }

      // Mark eventId as processed (capped to last 100 for memory bound)
      chunk.processedEventIds.push(eventId);
      if (chunk.processedEventIds.length > 100) {
        chunk.processedEventIds.shift();
      }
      chunk.updatedAt = timestamp;

      // 3. Create delta document (Issue #58) with 5-minute TTL (300s)
      if (deltaList.length > 0) {
        const deltaDoc: DeltaDocument = {
          id: `delta_${timestamp}_${eventId.slice(0, 8)}`,
          chunkId,
          pixels: deltaList,
          createdAt: timestamp,
          expiresAt: timestamp + 300_000,
        };
        const existingDeltas = this.deltas.get(chunkId) || [];
        existingDeltas.push(deltaDoc);
        this.deltas.set(chunkId, existingDeltas);
      }
    }

    return { applied: totalApplied, duplicate: false };
  }

  public getPixel(x: number, y: number): StoredPixel | undefined {
    if (!isValidCoordinate(x, y)) return undefined;
    const { chunkId, localX, localY } = getChunkCoordinates(x, y);
    const chunk = this.chunks.get(chunkId);
    if (!chunk) return undefined;
    const p = chunk.pixels[`${localX},${localY}`];
    // Pixels from prior epochs are treated as cleared
    if (p && p.epoch < this.currentEpoch) return undefined;
    return p;
  }

  public getDeltas(chunkId: string): DeltaDocument[] {
    return this.deltas.get(chunkId) || [];
  }
}

export const defaultChunkStore = new ChunkStore();
