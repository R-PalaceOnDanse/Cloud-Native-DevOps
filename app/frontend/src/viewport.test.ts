import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultViewport,
  screenToWorld,
  worldToScreen,
  getVisibleWorldBounds,
  zoomAtPoint,
  panViewport,
  CANVAS_SIZE,
} from './viewport.js';

test('createDefaultViewport initializes centered on canvas', () => {
  const vp = createDefaultViewport(1000, 1000);
  assert.ok(vp.zoom > 0);
  assert.equal(vp.screenWidth, 1000);
  assert.equal(vp.screenHeight, 1000);

  // Center of screen (500, 500) should correspond to canvas center (5000, 5000)
  const centerWorld = screenToWorld(500, 500, vp);
  assert.equal(centerWorld.x, 5000);
  assert.equal(centerWorld.y, 5000);
});

test('screenToWorld and worldToScreen are reciprocal', () => {
  const vp = {
    zoom: 2.5,
    panX: 100,
    panY: 200,
    screenWidth: 800,
    screenHeight: 600,
  };

  const worldX = 42;
  const worldY = 99;

  const screen = worldToScreen(worldX, worldY, vp);
  const backToWorld = screenToWorld(screen.screenX, screen.screenY, vp);

  assert.equal(backToWorld.x, worldX);
  assert.equal(backToWorld.y, worldY);
});

test('getVisibleWorldBounds clamps to canvas size [0..10000]', () => {
  const vp = {
    zoom: 1.0,
    panX: 100, // Top-left of canvas is at screen (100, 100)
    panY: 100,
    screenWidth: 500,
    screenHeight: 500,
  };

  const bounds = getVisibleWorldBounds(vp);
  assert.ok(bounds.minX >= 0);
  assert.ok(bounds.minY >= 0);
  assert.ok(bounds.maxX <= CANVAS_SIZE);
  assert.ok(bounds.maxY <= CANVAS_SIZE);
});

test('panViewport shifts coordinates correctly', () => {
  const vp = createDefaultViewport(800, 600);
  const initialWorldAtCenter = screenToWorld(400, 300, vp);

  const panned = panViewport(50, -50, vp);
  assert.equal(panned.panX, vp.panX + 50);
  assert.equal(panned.panY, vp.panY - 50);
});

test('zoomAtPoint keeps cursor world position stable', () => {
  const vp = createDefaultViewport(800, 600);
  const cursorScreenX = 350;
  const cursorScreenY = 250;

  const worldBefore = screenToWorld(cursorScreenX, cursorScreenY, vp);
  const zoomed = zoomAtPoint(cursorScreenX, cursorScreenY, 1.5, vp);
  const worldAfter = screenToWorld(cursorScreenX, cursorScreenY, zoomed);

  assert.equal(worldBefore.x, worldAfter.x);
  assert.equal(worldBefore.y, worldAfter.y);
});
