/**
 * Main Frontend Application Entry Point.
 * Coordinates Viewport, User Input, Palette, Canvas Renderer, Discord Auth,
 * Real-time Listeners, and API Proxy client.
 * Fulfills C07 §3.1–§3.6 (Issues #77, #80, #81, #82, #83, #76).
 */

import { createDefaultViewport, screenToWorld, zoomAtPoint, panViewport, ViewportState } from './viewport.js';
import { CanvasRenderer } from './canvas.js';
import { getBrushPixels } from './brush.js';
import { RealtimeManager, MockRealtimeProvider } from './realtime.js';
import { authManager, UserProfile } from './auth.js';
import { drawApiClient } from './api.js';

// 16 Standard Palette Colors
const PALETTE_COLORS = [
  '#ffffff', '#d3d3d3', '#808080', '#000000',
  '#ff0000', '#ffa500', '#ffff00', '#00ff00',
  '#008000', '#00ffff', '#0000ff', '#000080',
  '#800080', '#ff00ff', '#ffc0cb', '#8b4513',
];

// App State
let currentColor = '#ff0000';
let currentBrushSize = 1;
let currentTool: 'draw' | 'pan' = 'draw';
let isMouseDown = false;
let isSpacePressed = false;
let lastMouseX = 0;
let lastMouseY = 0;

// Rate Limit Token Bucket State (20 tokens max, refills continuously)
let userTokens = 20;
const MAX_TOKENS = 20;
let lastRefillTime = Date.now();

// DOM Elements
const canvas = document.getElementById('viewport-canvas') as HTMLCanvasElement;
const renderer = new CanvasRenderer(canvas);
let viewport: ViewportState = createDefaultViewport(window.innerWidth, window.innerHeight);

const coordDisplay = document.getElementById('coord-display') as HTMLElement;
const zoomDisplay = document.getElementById('zoom-display') as HTMLElement;
const streamStatus = document.getElementById('stream-status') as HTMLElement;
const tokensDisplay = document.getElementById('tokens-display') as HTMLElement;
const toastContainer = document.getElementById('toast-container') as HTMLElement;
const paletteContainer = document.getElementById('palette-grid') as HTMLElement;
const customColorInput = document.getElementById('custom-color') as HTMLInputElement;
const colorHexLabel = document.getElementById('color-hex-label') as HTMLElement;
const toolDrawBtn = document.getElementById('tool-draw') as HTMLButtonElement;
const toolPanBtn = document.getElementById('tool-pan') as HTMLButtonElement;
const resetViewBtn = document.getElementById('btn-reset-view') as HTMLButtonElement;

// Auth DOM Elements
const btnDiscordLogin = document.getElementById('btn-discord-login') as HTMLButtonElement;
const userDisplay = document.getElementById('user-display') as HTMLElement;
const userName = document.getElementById('user-name') as HTMLElement;
const btnLogout = document.getElementById('btn-logout') as HTMLButtonElement;

// Inspector elements
const inspectCoords = document.getElementById('inspect-coords') as HTMLElement;
const inspectAuthor = document.getElementById('inspect-author') as HTMLElement;
const inspectTime = document.getElementById('inspect-time') as HTMLElement;
const inspectColor = document.getElementById('inspect-color') as HTMLElement;

// Real-time Provider & Manager (Zero polling, strictly event-driven)
const realtimeProvider = new MockRealtimeProvider();
const realtimeManager = new RealtimeManager(
  realtimeProvider,
  renderer,
  () => requestRender(),
  (count) => {
    if (streamStatus) {
      streamStatus.textContent = `⚡ ${count} tuiles`;
    }
  }
);

function updateTokensDisplay(): void {
  const now = Date.now();
  const elapsed = now - lastRefillTime;
  if (elapsed >= 3000) {
    const refilled = Math.floor(elapsed / 3000);
    userTokens = Math.min(MAX_TOKENS, userTokens + refilled);
    lastRefillTime = now - (elapsed % 3000);
  }
  if (tokensDisplay) {
    tokensDisplay.textContent = `🪙 ${Math.floor(userTokens)}/${MAX_TOKENS}`;
  }
}

function showToast(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3500);
}

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  viewport.screenWidth = canvas.width;
  viewport.screenHeight = canvas.height;
  realtimeManager.updateViewport(viewport);
  requestRender();
}

function requestRender(): void {
  renderer.render(viewport);
  zoomDisplay.textContent = `${Math.round(viewport.zoom * 100)}%`;
  updateTokensDisplay();
}

// Build Palette UI
function initPalette(): void {
  paletteContainer.innerHTML = '';
  PALETTE_COLORS.forEach((hex) => {
    const swatch = document.createElement('div');
    swatch.className = 'palette-color';
    swatch.style.backgroundColor = hex;
    if (hex === currentColor) swatch.classList.add('selected');

    swatch.addEventListener('click', () => {
      selectColor(hex);
    });

    paletteContainer.appendChild(swatch);
  });
}

function selectColor(hex: string): void {
  currentColor = hex;
  customColorInput.value = hex;
  colorHexLabel.textContent = hex;

  document.querySelectorAll('.palette-color').forEach((el) => {
    const div = el as HTMLElement;
    if (div.style.backgroundColor === hex || rgbToHex(div.style.backgroundColor) === hex) {
      div.classList.add('selected');
    } else {
      div.classList.remove('selected');
    }
  });
}

function rgbToHex(rgbStr: string): string {
  const match = rgbStr.match(/\d+/g);
  if (!match || match.length < 3) return rgbStr;
  const [r, g, b] = match.map(Number);
  return '#' + ((1 << 24) + (r! << 16) + (g! << 8) + b!).toString(16).slice(1);
}

// Brush selectors
document.querySelectorAll('.btn-brush').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.btn-brush').forEach((b) => b.classList.remove('active'));
    const target = e.currentTarget as HTMLElement;
    target.classList.add('active');
    currentBrushSize = Number(target.dataset.size || '1');
  });
});

// Tools switch
toolDrawBtn.addEventListener('click', () => {
  currentTool = 'draw';
  toolDrawBtn.classList.add('active');
  toolPanBtn.classList.remove('active');
  canvas.style.cursor = 'crosshair';
});

toolPanBtn.addEventListener('click', () => {
  currentTool = 'pan';
  toolPanBtn.classList.add('active');
  toolDrawBtn.classList.remove('active');
  canvas.style.cursor = 'grab';
});

resetViewBtn.addEventListener('click', () => {
  viewport = createDefaultViewport(canvas.width, canvas.height);
  realtimeManager.updateViewport(viewport);
  requestRender();
});

customColorInput.addEventListener('input', (e) => {
  const val = (e.target as HTMLInputElement).value;
  selectColor(val);
});

// Discord Auth Event Listeners
authManager.onAuthStateChanged((user: UserProfile | null) => {
  if (user) {
    btnDiscordLogin.classList.add('hidden');
    userDisplay.classList.remove('hidden');
    userName.textContent = user.username;
    showToast(`Connecté en tant que ${user.username}`, 'success');
  } else {
    btnDiscordLogin.classList.remove('hidden');
    userDisplay.classList.add('hidden');
    userName.textContent = '';
  }
});

btnDiscordLogin.addEventListener('click', () => {
  authManager.loginWithDiscord();
});

btnLogout.addEventListener('click', () => {
  authManager.logout();
  showToast('Déconnecté', 'info');
});

// Canvas Interaction Listeners
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const dpr = window.devicePixelRatio || 1;
  const factor = e.deltaY < 0 ? 1.25 : 0.8;
  viewport = zoomAtPoint(e.clientX * dpr, e.clientY * dpr, factor, viewport);
  realtimeManager.updateViewport(viewport);
  requestRender();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !isSpacePressed) {
    isSpacePressed = true;
    canvas.style.cursor = 'grab';
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    isSpacePressed = false;
    canvas.style.cursor = currentTool === 'pan' ? 'grab' : 'crosshair';
  }
});

canvas.addEventListener('mousedown', (e) => {
  isMouseDown = true;
  const dpr = window.devicePixelRatio || 1;
  lastMouseX = e.clientX * dpr;
  lastMouseY = e.clientY * dpr;

  if (isSpacePressed || currentTool === 'pan' || e.button === 1) {
    canvas.style.cursor = 'grabbing';
    return;
  }

  // Draw on click
  void handleDraw(e.clientX * dpr, e.clientY * dpr);
});

window.addEventListener('mousemove', (e) => {
  const dpr = window.devicePixelRatio || 1;
  const mouseX = e.clientX * dpr;
  const mouseY = e.clientY * dpr;

  const world = screenToWorld(mouseX, mouseY, viewport);
  if (world.x >= 0 && world.x < 10000 && world.y >= 0 && world.y < 10000) {
    coordDisplay.textContent = `X: ${world.x} , Y: ${world.y}`;
  } else {
    coordDisplay.textContent = `X: — , Y: —`;
  }

  if (!isMouseDown) return;

  if (isSpacePressed || currentTool === 'pan' || e.buttons === 4) {
    const dx = mouseX - lastMouseX;
    const dy = mouseY - lastMouseY;
    viewport = panViewport(dx, dy, viewport);
    realtimeManager.updateViewport(viewport);
    requestRender();
  } else if (currentTool === 'draw') {
    void handleDraw(mouseX, mouseY);
  }

  lastMouseX = mouseX;
  lastMouseY = mouseY;
});

window.addEventListener('mouseup', () => {
  isMouseDown = false;
  canvas.style.cursor = (isSpacePressed || currentTool === 'pan') ? 'grab' : 'crosshair';
});

canvas.addEventListener('click', (e) => {
  const dpr = window.devicePixelRatio || 1;
  const world = screenToWorld(e.clientX * dpr, e.clientY * dpr, viewport);
  inspectPixel(world.x, world.y);
});

async function handleDraw(screenX: number, screenY: number): Promise<void> {
  updateTokensDisplay();
  const world = screenToWorld(screenX, screenY, viewport);
  const batch = getBrushPixels(world.x, world.y, currentBrushSize, currentColor);
  if (batch.length === 0) return;

  if (userTokens < batch.length) {
    showToast(`Rate limit : ${Math.floor(userTokens)}/${batch.length} pixels disponibles. Patientez quelques secondes.`, 'error');
    return;
  }

  userTokens -= batch.length;
  updateTokensDisplay();

  const user = authManager.getCurrentUser();
  const author = user?.username || 'Anonyme';
  const token = user?.id ? `user_${user.id}` : undefined;

  // 1. Optimistic local rendering
  renderer.applyBatch(batch, author);
  requestRender();
  inspectPixel(world.x, world.y);

  // 2. Broadcast via local provider
  void realtimeManager.publishDraw(batch, author);

  // 3. Dispatch to Web Draw Proxy backend pipeline
  const result = await drawApiClient.submitDraw(batch, token);
  if ('error' in result && result.error) {
    showToast(result.error, 'error');
  }
}

function inspectPixel(x: number, y: number): void {
  if (x < 0 || x >= 10000 || y < 0 || y >= 10000) {
    inspectCoords.textContent = 'Hors champ';
    inspectAuthor.textContent = '—';
    inspectTime.textContent = '—';
    inspectColor.textContent = '—';
    return;
  }

  inspectCoords.textContent = `(${x}, ${y})`;
  const pixel = renderer.getPixel(x, y);

  if (pixel) {
    inspectAuthor.textContent = pixel.author;
    inspectTime.textContent = new Date(pixel.timestamp).toLocaleTimeString();
    inspectColor.textContent = pixel.color;
    inspectColor.style.color = pixel.color;
  } else {
    inspectAuthor.textContent = 'Vide';
    inspectTime.textContent = '—';
    inspectColor.textContent = '#ffffff (défaut)';
    inspectColor.style.color = '#ffffff';
  }
}

// Initial setup
window.addEventListener('resize', resizeCanvas);
initPalette();
resizeCanvas();
updateTokensDisplay();
