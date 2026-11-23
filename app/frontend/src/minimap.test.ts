import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Minimap } from './minimap.js';
import { CanvasRenderer } from './canvas.js';
import { createDefaultViewport } from './viewport.js';

function createMockCanvas(): HTMLCanvasElement {
  const listeners: Record<string, Function[]> = {};

  const ctx = {
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  };

  const canvas = {
    width: 140,
    height: 140,
    style: { width: '140px', height: '140px' },
    getContext: () => ctx,
    addEventListener: (type: string, cb: Function) => {
      listeners[type] = listeners[type] || [];
      listeners[type]!.push(cb);
    },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 140,
      height: 140,
    }),
  } as unknown as HTMLCanvasElement;

  return canvas;
}

test('Minimap initializes with configured dimensions', () => {
  const canvas = createMockCanvas();
  let navigatedCoord: { x: number; y: number } | null = null;

  const minimap = new Minimap(canvas, {
    size: 140,
    onNavigate: (x, y) => {
      navigatedCoord = { x, y };
    },
  });

  assert.ok(minimap);
  assert.equal(canvas.style.width, '140px');
  assert.equal(canvas.style.height, '140px');
});

test('Minimap renders viewport frustum and pixel distribution without error', () => {
  const minimapCanvas = createMockCanvas();
  const mainCanvas = createMockCanvas();
  const renderer = new CanvasRenderer(mainCanvas);

  renderer.setPixel(100, 100, '#ff0000', 'alice');
  renderer.setPixel(5000, 5000, '#00ff00', 'bob');

  const minimap = new Minimap(minimapCanvas, { size: 140 });
  const viewport = createDefaultViewport(1000, 800);

  // Render should execute all drawing instructions cleanly
  assert.doesNotThrow(() => {
    minimap.render(viewport, renderer);
  });
});
