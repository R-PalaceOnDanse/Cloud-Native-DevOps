import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getVisibleChunkIds,
  parseChunkId,
  RealtimeManager,
  MockRealtimeProvider,
  CHUNK_SIZE,
} from './realtime.js';
import { createDefaultViewport, ViewportState } from './viewport.js';
import { CanvasRenderer } from './canvas.js';

// Mock minimal Canvas 2D context for Node test environment
class MockCanvasContext {
  fillRect(): void {}
  strokeRect(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
}

class MockCanvasElement {
  width = 800;
  height = 600;
  getContext(): unknown {
    return new MockCanvasContext();
  }
}

describe('Real-time Viewport & Chunk Subscription Engine (Issue #81 / C07 §3.3)', () => {
  it('correctly parses chunk ID strings', () => {
    assert.deepStrictEqual(parseChunkId('chunk_10_25'), { cx: 10, cy: 25 });
    assert.deepStrictEqual(parseChunkId('chunk_0_0'), { cx: 0, cy: 0 });
    assert.strictEqual(parseChunkId('invalid_id'), null);
    assert.strictEqual(parseChunkId('chunk_abc_def'), null);
  });

  it('calculates visible chunk IDs strictly intersecting the viewport', () => {
    // Focused viewport centered around (300, 300) with zoom=1.0 and 200x200 screen
    const viewport: ViewportState = {
      panX: -200, // minX = 200, maxX = 400
      panY: -200, // minY = 200, maxY = 400
      zoom: 1.0,
      screenWidth: 200,
      screenHeight: 200,
    };

    const chunkIds = getVisibleChunkIds(viewport);
    assert.ok(chunkIds.length > 0, 'Should find visible chunks');

    // Expected chunk range: X: floor(200/64)=3 to floor(400/64)=6
    //                      Y: floor(200/64)=3 to floor(400/64)=6 (16 chunks total <= 64 limit)
    assert.ok(chunkIds.includes('chunk_3_3'));
    assert.ok(chunkIds.includes('chunk_6_6'));
    assert.strictEqual(chunkIds.includes('chunk_0_0'), false);
    assert.strictEqual(chunkIds.includes('chunk_20_20'), false);
  });

  it('clamps visible chunk IDs to canvas boundaries [0..156]', () => {
    const outOfBoundsViewport: ViewportState = {
      panX: 1000, // negative world coordinates
      panY: 1000,
      zoom: 1.0,
      screenWidth: 800,
      screenHeight: 600,
    };

    const chunkIds = getVisibleChunkIds(outOfBoundsViewport);
    for (const id of chunkIds) {
      const parsed = parseChunkId(id);
      assert.ok(parsed !== null);
      assert.ok(parsed.cx >= 0 && parsed.cx <= 156);
      assert.ok(parsed.cy >= 0 && parsed.cy <= 156);
    }
  });

  it('subscribes only to visible chunks and unsubscribes when moving viewport away', () => {
    const mockCanvas = new MockCanvasElement() as unknown as HTMLCanvasElement;
    const renderer = new CanvasRenderer(mockCanvas);
    const provider = new MockRealtimeProvider();

    let renderCallCount = 0;
    let subscriptionCount = 0;

    const manager = new RealtimeManager(
      provider,
      renderer,
      () => { renderCallCount++; },
      (count) => { subscriptionCount = count; }
    );

    // Initial viewport focused at (0, 0)
    const viewportA: ViewportState = {
      panX: 0,
      panY: 0,
      zoom: 2.0, // Zoomed in: 800/2 = 400px visible, so chunks 0..6
      screenWidth: 800,
      screenHeight: 600,
    };

    manager.updateViewport(viewportA);
    const initialChunks = manager.getActiveChunkIds();
    assert.ok(initialChunks.length > 0);
    assert.ok(initialChunks.includes('chunk_0_0'));
    assert.strictEqual(subscriptionCount, initialChunks.length);

    // Pan viewport far away to (5000, 5000)
    const viewportB: ViewportState = {
      panX: -5000 * 2.0,
      panY: -5000 * 2.0,
      zoom: 2.0,
      screenWidth: 800,
      screenHeight: 600,
    };

    manager.updateViewport(viewportB);
    const newChunks = manager.getActiveChunkIds();

    // Verify chunk_0_0 was completely unsubscribed
    assert.strictEqual(newChunks.includes('chunk_0_0'), false);
    // Verify chunks around (5000, 5000) -> 5000/64 = 78 are subscribed
    assert.ok(newChunks.includes('chunk_78_78'));

    manager.destroy();
    assert.strictEqual(manager.getActiveSubscriptionCount(), 0);
  });

  it('receives simulated external draw (e.g. from Discord bot) and applies in place with ZERO polling', () => {
    const mockCanvas = new MockCanvasElement() as unknown as HTMLCanvasElement;
    const renderer = new CanvasRenderer(mockCanvas);
    const provider = new MockRealtimeProvider();

    let renderTriggered = false;

    const manager = new RealtimeManager(
      provider,
      renderer,
      () => { renderTriggered = true; }
    );

    // Focused Viewport covering (70, 70) -> chunk_1_1
    const viewport: ViewportState = {
      panX: -50,
      panY: -50,
      zoom: 1.0,
      screenWidth: 150,
      screenHeight: 150,
    };

    manager.updateViewport(viewport);

    // External event: Discord user draws a pixel at (70, 70) which belongs to chunk_1_1 (64+6)
    provider.simulateExternalDraw(70, 70, '#00ff00', 'DiscordBotUser#1234');

    // Verify update was pushed and applied in place to renderer
    assert.strictEqual(renderTriggered, true, 'Realtime listener should trigger canvas re-render');
    const pixel = renderer.getPixel(70, 70);
    assert.ok(pixel !== undefined);
    assert.strictEqual(pixel.color, '#00ff00');
    assert.strictEqual(pixel.author, 'DiscordBotUser#1234');

    manager.destroy();
  });

  it('notifies listeners when system state changes (pause / resume)', () => {
    const mockCanvas = new MockCanvasElement() as unknown as HTMLCanvasElement;
    const renderer = new CanvasRenderer(mockCanvas);
    const provider = new MockRealtimeProvider();
    const manager = new RealtimeManager(provider, renderer, () => {});

    let receivedPaused = false;
    const unsubscribe = manager.subscribeSystemState((state) => {
      receivedPaused = state.paused;
    });

    assert.strictEqual(receivedPaused, false);

    provider.setSystemState({ paused: true });
    assert.strictEqual(receivedPaused, true);

    provider.setSystemState({ paused: false });
    assert.strictEqual(receivedPaused, false);

    unsubscribe();
    manager.destroy();
  });
});

describe('Listeners re-opened after the sign-in', () => {
  it('restart() re-subscribes every visible chunk and the system state', () => {
    let chunkSubs = 0;
    let systemSubs = 0;
    const provider = {
      subscribe: () => { chunkSubs++; return () => {}; },
      subscribeSystemState: () => { systemSubs++; return () => {}; },
    };
    const renderer = new CanvasRenderer(new MockCanvasElement() as unknown as HTMLCanvasElement);
    const manager = new RealtimeManager(provider, renderer, () => {});
    const viewport = createDefaultViewport(800, 600);

    manager.subscribeSystemState(() => {});
    manager.updateViewport(viewport);
    const visible = manager.getActiveSubscriptionCount();
    assert.ok(visible > 0);
    assert.strictEqual(chunkSubs, visible);
    assert.strictEqual(systemSubs, 1);

    // Page loaded before the session was restored: every listener must be opened again.
    manager.restart(viewport);
    assert.strictEqual(chunkSubs, visible * 2);
    assert.strictEqual(systemSubs, 2);
    assert.strictEqual(manager.getActiveSubscriptionCount(), visible);
  });

  it('ignores stale chunks from older epochs after setEpoch()', () => {
    const provider = new MockRealtimeProvider();
    const renderer = new CanvasRenderer(new MockCanvasElement() as unknown as HTMLCanvasElement);
    let renderCalls = 0;
    const manager = new RealtimeManager(provider, renderer, () => { renderCalls++; });

    manager.setEpoch(2);

    // Stale chunk from epoch 1 must be ignored
    manager.handleChunkUpdate({
      chunkId: 'chunk_0_0',
      chunkX: 0,
      chunkY: 0,
      epoch: 1,
      pixels: { '1,1': { color: '#ff0000', author: 'alice', timestamp: 1000 } },
      updatedAt: 1000,
    });
    assert.strictEqual(renderer.getPixel(1, 1), undefined);
    assert.strictEqual(renderCalls, 0);

    // Chunk from epoch 2 must be applied
    manager.handleChunkUpdate({
      chunkId: 'chunk_0_0',
      chunkX: 0,
      chunkY: 0,
      epoch: 2,
      pixels: { '2,2': { color: '#00ff00', author: 'bob', timestamp: 2000 } },
      updatedAt: 2000,
    });
    assert.strictEqual(renderer.getPixel(2, 2)?.color, '#00ff00');
    assert.strictEqual(renderCalls, 1);
  });
});
