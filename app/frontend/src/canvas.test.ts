import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CanvasRenderer } from './canvas.js';
import { createDefaultViewport } from './viewport.js';

function createMockCanvas(): HTMLCanvasElement {
  const mockCtx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
  };

  return {
    width: 800,
    height: 600,
    getContext: () => mockCtx,
  } as unknown as HTMLCanvasElement;
}

test('CanvasRenderer stores and retrieves pixel metadata', () => {
  const canvas = createMockCanvas();
  const renderer = new CanvasRenderer(canvas);

  assert.equal(renderer.getPixel(50, 50), undefined);

  renderer.setPixel(50, 50, '#ff0000', 'Alice', 1000);
  const pixel = renderer.getPixel(50, 50);
  assert.ok(pixel);
  assert.equal(pixel.color, '#ff0000');
  assert.equal(pixel.author, 'Alice');
  assert.equal(pixel.timestamp, 1000);
});

test('CanvasRenderer tracks selected pixel for inspection highlight', () => {
  const canvas = createMockCanvas();
  const renderer = new CanvasRenderer(canvas);

  assert.equal(renderer.getSelectedPixel(), null);

  renderer.setSelectedPixel({ x: 123, y: 456 });
  assert.deepEqual(renderer.getSelectedPixel(), { x: 123, y: 456 });

  renderer.setSelectedPixel(null);
  assert.equal(renderer.getSelectedPixel(), null);
});

test('CanvasRenderer applies batch of drawn pixels', () => {
  const canvas = createMockCanvas();
  const renderer = new CanvasRenderer(canvas);

  renderer.applyBatch(
    [
      { x: 1, y: 1, color: '#00ff00' },
      { x: 1, y: 2, color: '#0000ff' },
    ],
    'Bob'
  );

  assert.equal(renderer.getPixel(1, 1)?.author, 'Bob');
  assert.equal(renderer.getPixel(1, 1)?.color, '#00ff00');
  assert.equal(renderer.getPixel(1, 2)?.color, '#0000ff');
});

test('CanvasRenderer renders without error across viewport', () => {
  const canvas = createMockCanvas();
  const renderer = new CanvasRenderer(canvas);
  const viewport = createDefaultViewport(800, 600);

  renderer.setPixel(5000, 5000, '#ff0000');
  renderer.setSelectedPixel({ x: 5000, y: 5000 });

  assert.doesNotThrow(() => {
    renderer.render(viewport);
  });
});

test('CanvasRenderer clearAll removes all pixels and selections', () => {
  const canvas = createMockCanvas();
  const renderer = new CanvasRenderer(canvas);

  renderer.setPixel(10, 10, '#ffffff', 'Alice');
  renderer.setSelectedPixel({ x: 10, y: 10 });
  assert.ok(renderer.getPixel(10, 10));
  assert.ok(renderer.getSelectedPixel());

  renderer.clearAll();
  assert.equal(renderer.getPixel(10, 10), undefined);
  assert.equal(renderer.getSelectedPixel(), null);
});

