/**
 * Main Frontend Application Entry Point.
 * Coordinates Viewport, User Input, Palette, Canvas Renderer, Discord Auth,
 * Real-time Listeners, Pixel Inspector, and API Proxy client.
 * Fulfills C07 §3.1–§3.6 (Issues #77, #80, #81, #82, #83, #76).
 */

import {
  createDefaultViewport,
  screenToWorld,
  zoomAtPoint,
  panViewport,
  centerAtWorld,
  parseUrlHash,
  formatUrlHash,
  ViewportState,
} from './viewport.js';
import { CanvasRenderer } from './canvas.js';
import { Minimap } from './minimap.js';
import { getBrushPixels, validateBrushStroke, BRUSH_PIXEL_COUNTS, BrushSize } from './brush.js';
import { RealtimeManager, SystemState } from './realtime.js';
import { createRealtimeProvider } from './firestore-provider.js';
import { authenticateFirebase } from './firebase.js';
import { authManager, UserProfile } from './auth.js';
import { drawApiClient } from './api.js';
import { formatPixelInspection } from './inspector.js';

// 16 Standard Palette Colors
const PALETTE_COLORS = [
  '#ffffff', '#d3d3d3', '#808080', '#000000',
  '#ff0000', '#ffa500', '#ffff00', '#00ff00',
  '#008000', '#00ffff', '#0000ff', '#000080',
  '#800080', '#ff00ff', '#ffc0cb', '#8b4513',
];

// App State
let currentColor = '#ff0000';
let currentBrushSize: BrushSize = 1;
let currentTool: 'draw' | 'pan' = 'draw';
let isMouseDown = false;
let isSpacePressed = false;
let lastMouseX = 0;
let lastMouseY = 0;
let isCanvasPaused = false;
let lastClearedAtTimestamp: number | null = null;
let lastDrawnCoord: { x: number; y: number } | null = null;

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
const pauseBanner = document.getElementById('pause-banner') as HTMLElement;
const brushHint = document.getElementById('brush-hint') as HTMLElement;
const paletteContainer = document.getElementById('palette-grid') as HTMLElement;
const customColorInput = document.getElementById('custom-color') as HTMLInputElement;
const colorHexLabel = document.getElementById('color-hex-label') as HTMLElement;
const toolDrawBtn = document.getElementById('tool-draw') as HTMLButtonElement;
const toolPanBtn = document.getElementById('tool-pan') as HTMLButtonElement;
const resetViewBtn = document.getElementById('btn-reset-view') as HTMLButtonElement;
const exportViewBtn = document.getElementById('btn-export-view') as HTMLButtonElement | null;

// Minimap DOM Elements
const minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement | null;
const minimapBody = document.getElementById('minimap-body') as HTMLElement | null;
const btnToggleMinimap = document.getElementById('btn-toggle-minimap') as HTMLButtonElement | null;

// Token progress fill
const tokenProgressFill = document.getElementById('token-progress-fill') as HTMLElement | null;

// Go-To Coordinates Modal Elements
const btnGoto = document.getElementById('btn-goto') as HTMLButtonElement | null;
const modalGoto = document.getElementById('modal-goto') as HTMLElement | null;
const btnCloseGoto = document.getElementById('btn-close-goto') as HTMLButtonElement | null;
const btnCancelGoto = document.getElementById('btn-cancel-goto') as HTMLButtonElement | null;
const btnConfirmGoto = document.getElementById('btn-confirm-goto') as HTMLButtonElement | null;
const inputGotoX = document.getElementById('goto-x') as HTMLInputElement | null;
const inputGotoY = document.getElementById('goto-y') as HTMLInputElement | null;
const inputGotoZoom = document.getElementById('goto-zoom') as HTMLInputElement | null;

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
const btnClearInspect = document.getElementById('btn-clear-inspect') as HTMLButtonElement;

// Real-time Provider & Manager (Zero polling, strictly event-driven)
const realtimeProvider = createRealtimeProvider();
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

// Subscribe to global system state (pause / resume / admin clear)
realtimeManager.subscribeSystemState((state: SystemState) => {
  isCanvasPaused = state.paused;
  if (pauseBanner) {
    if (isCanvasPaused) {
      pauseBanner.classList.remove('hidden');
      showToast('⏸️ Le canevas est en pause : les modifications sont temporairement suspendues.', 'error');
    } else {
      pauseBanner.classList.add('hidden');
    }
  }

  // Handle global grid reset (/admin clear)
  if (state.lastClearedAt && state.lastClearedAt !== lastClearedAtTimestamp) {
    lastClearedAtTimestamp = state.lastClearedAt;
    renderer.clearAll();
    clearInspect();
    requestRender();
    showToast('🧹 Le canevas a été réinitialisé par un administrateur.', 'info');
  }
});

// Minimap Radar Initialization
let minimap: Minimap | null = null;
if (minimapCanvas) {
  try {
    minimap = new Minimap(minimapCanvas, {
      size: 140,
      onNavigate: (worldX, worldY) => {
        viewport = centerAtWorld(worldX, worldY, viewport.zoom, viewport);
        realtimeManager.updateViewport(viewport);
        requestRender();
        syncUrlHash();
      },
    });
  } catch (err) {
    console.warn('Minimap initialization skipped:', err);
  }
}

if (btnToggleMinimap && minimapBody) {
  btnToggleMinimap.addEventListener('click', () => {
    const isCollapsed = minimapBody.classList.toggle('collapsed');
    btnToggleMinimap.textContent = isCollapsed ? '▸' : '▾';
  });
}

function syncUrlHash(): void {
  if (typeof window === 'undefined') return;
  const hash = formatUrlHash(viewport);
  window.history.replaceState(null, '', hash);
}

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
  if (tokenProgressFill) {
    if (userTokens >= MAX_TOKENS) {
      tokenProgressFill.style.width = '100%';
      tokenProgressFill.classList.remove('empty');
    } else {
      const progressPercent = Math.min(100, Math.floor(((now - lastRefillTime) / 3000) * 100));
      tokenProgressFill.style.width = `${progressPercent}%`;
      if (userTokens < 1) {
        tokenProgressFill.classList.add('empty');
      } else {
        tokenProgressFill.classList.remove('empty');
      }
    }
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
  if (minimap) {
    minimap.render(viewport, renderer);
  }
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

function updateBrushHint(): void {
  if (!brushHint) return;
  const count = BRUSH_PIXEL_COUNTS[currentBrushSize] || 1;
  if (count > MAX_TOKENS) {
    brushHint.textContent = `${count} pixels / coup ⚠️ (Dépasse la réserve max de ${MAX_TOKENS})`;
    brushHint.classList.add('warning');
  } else {
    brushHint.textContent = `${count} pixel${count > 1 ? 's' : ''} / coup (${count} token${count > 1 ? 's' : ''})`;
    brushHint.classList.remove('warning');
  }
}

// Brush selectors
document.querySelectorAll('.btn-brush').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.btn-brush').forEach((b) => b.classList.remove('active'));
    const target = e.currentTarget as HTMLElement;
    target.classList.add('active');
    currentBrushSize = Number(target.dataset.size || '1') as BrushSize;
    updateBrushHint();
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
  syncUrlHash();
});

if (exportViewBtn) {
  exportViewBtn.addEventListener('click', () => {
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `pixel-canvas-export-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      showToast('📷 Image de la vue exportée avec succès !', 'success');
    } catch {
      showToast('Échec de l\'exportation de l\'image.', 'error');
    }
  });
}

// Go-To Coordinates Modal Handlers
function openGotoModal(): void {
  if (!modalGoto) return;
  const center = screenToWorld(viewport.screenWidth / 2, viewport.screenHeight / 2, viewport);
  if (inputGotoX) inputGotoX.value = String(Math.max(0, Math.min(9999, center.x)));
  if (inputGotoY) inputGotoY.value = String(Math.max(0, Math.min(9999, center.y)));
  if (inputGotoZoom) inputGotoZoom.value = String(Math.round(viewport.zoom * 100));
  modalGoto.classList.remove('hidden');
  inputGotoX?.focus();
}

function closeGotoModal(): void {
  modalGoto?.classList.add('hidden');
}

function executeGoto(): void {
  const x = Number(inputGotoX?.value || '5000');
  const y = Number(inputGotoY?.value || '5000');
  const zoomPct = Number(inputGotoZoom?.value || '100');
  const targetZoom = Math.max(0.05, Math.min(50, zoomPct / 100));

  viewport = centerAtWorld(x, y, targetZoom, viewport);
  realtimeManager.updateViewport(viewport);
  requestRender();
  syncUrlHash();
  closeGotoModal();
  showToast(`📍 Vue déplacée vers (${Math.round(x)}, ${Math.round(y)})`, 'info');
}

if (btnGoto) {
  btnGoto.addEventListener('click', openGotoModal);
}

if (coordDisplay) {
  coordDisplay.addEventListener('click', openGotoModal);
}

if (btnCloseGoto) {
  btnCloseGoto.addEventListener('click', closeGotoModal);
}

if (btnCancelGoto) {
  btnCancelGoto.addEventListener('click', closeGotoModal);
}

if (btnConfirmGoto) {
  btnConfirmGoto.addEventListener('click', executeGoto);
}

modalGoto?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    executeGoto();
  } else if (e.key === 'Escape') {
    closeGotoModal();
  }
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
    const token = authManager.getSessionToken();
    if (token) {
      void authenticateFirebase(token);
    }
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

// Check for OAuth return parameters (?code=...&state=...)
if (typeof window !== 'undefined' && window.location.search) {
  const urlParams = new URLSearchParams(window.location.search);
  const authCode = urlParams.get('code');
  const authState = urlParams.get('state');
  if (authCode && authState) {
    window.history.replaceState({}, document.title, window.location.pathname);
    void authManager.handleOAuthReturn(authCode, authState).then((res) => {
      if (res.success) {
        showToast('Connexion Discord réussie !', 'success');
      } else {
        showToast(`Échec connexion Discord : ${res.error || 'Erreur'}`, 'error');
      }
    });
  }
}

// Canvas Interaction Listeners
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const dpr = window.devicePixelRatio || 1;
  const factor = e.deltaY < 0 ? 1.25 : 0.8;
  viewport = zoomAtPoint(e.clientX * dpr, e.clientY * dpr, factor, viewport);
  realtimeManager.updateViewport(viewport);
  requestRender();
  syncUrlHash();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    return;
  }

  if (e.code === 'Space' && !isSpacePressed) {
    isSpacePressed = true;
    canvas.style.cursor = 'grab';
  } else if (e.key === 'b' || e.key === 'B') {
    currentTool = 'draw';
    toolDrawBtn.classList.add('active');
    toolPanBtn.classList.remove('active');
    canvas.style.cursor = 'crosshair';
  } else if (e.key === 'h' || e.key === 'H') {
    currentTool = 'pan';
    toolPanBtn.classList.add('active');
    toolDrawBtn.classList.remove('active');
    canvas.style.cursor = 'grab';
  } else if (['1', '2', '3', '4'].includes(e.key)) {
    const sizeMap: Record<string, BrushSize> = { '1': 1, '2': 3, '3': 5, '4': 9 };
    const size = sizeMap[e.key];
    if (size) {
      currentBrushSize = size;
      document.querySelectorAll('.btn-brush').forEach((btn) => {
        const el = btn as HTMLElement;
        if (el.dataset.size === String(size)) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      });
      updateBrushHint();
      showToast(`Pinceau : ${size}px`, 'info');
    }
  } else if (e.key === '+' || e.key === '=') {
    viewport = zoomAtPoint(canvas.width / 2, canvas.height / 2, 1.25, viewport);
    realtimeManager.updateViewport(viewport);
    requestRender();
  } else if (e.key === '-' || e.key === '_') {
    viewport = zoomAtPoint(canvas.width / 2, canvas.height / 2, 0.8, viewport);
    realtimeManager.updateViewport(viewport);
    requestRender();
  } else if (e.key === '0' || e.key === 'c' || e.key === 'C') {
    viewport = createDefaultViewport(canvas.width, canvas.height);
    realtimeManager.updateViewport(viewport);
    requestRender();
  } else if (e.key === 'Escape') {
    clearInspect();
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
  lastDrawnCoord = null;
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
  lastDrawnCoord = null;
  canvas.style.cursor = (isSpacePressed || currentTool === 'pan') ? 'grab' : 'crosshair';
  syncUrlHash();
});

// Touch and mobile gestures (pinch-to-zoom, touch pan, touch draw)
let initialPinchDistance = 0;
let initialPinchMidpoint = { x: 0, y: 0 };
let lastTouchX = 0;
let lastTouchY = 0;
let touchStartTime = 0;

canvas.addEventListener('touchstart', (e) => {
  const dpr = window.devicePixelRatio || 1;
  if (e.touches.length === 1) {
    const touch = e.touches[0]!;
    lastTouchX = touch.clientX * dpr;
    lastTouchY = touch.clientY * dpr;
    touchStartTime = Date.now();
    lastDrawnCoord = null;
  } else if (e.touches.length === 2) {
    const t1 = e.touches[0]!;
    const t2 = e.touches[1]!;
    const dx = (t2.clientX - t1.clientX) * dpr;
    const dy = (t2.clientY - t1.clientY) * dpr;
    initialPinchDistance = Math.hypot(dx, dy);
    initialPinchMidpoint = {
      x: ((t1.clientX + t2.clientX) / 2) * dpr,
      y: ((t1.clientY + t2.clientY) / 2) * dpr,
    };
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const dpr = window.devicePixelRatio || 1;

  if (e.touches.length === 2) {
    const t1 = e.touches[0]!;
    const t2 = e.touches[1]!;
    const dx = (t2.clientX - t1.clientX) * dpr;
    const dy = (t2.clientY - t1.clientY) * dpr;
    const dist = Math.hypot(dx, dy);

    if (initialPinchDistance > 0 && dist > 0) {
      const factor = dist / initialPinchDistance;
      const clampedFactor = Math.max(0.85, Math.min(1.15, factor));
      viewport = zoomAtPoint(initialPinchMidpoint.x, initialPinchMidpoint.y, clampedFactor, viewport);
      initialPinchDistance = dist;
      realtimeManager.updateViewport(viewport);
      requestRender();
    }
  } else if (e.touches.length === 1) {
    const touch = e.touches[0]!;
    const touchX = touch.clientX * dpr;
    const touchY = touch.clientY * dpr;
    const dx = touchX - lastTouchX;
    const dy = touchY - lastTouchY;

    if (currentTool === 'pan') {
      viewport = panViewport(dx, dy, viewport);
      realtimeManager.updateViewport(viewport);
      requestRender();
    } else if (currentTool === 'draw') {
      void handleDraw(touchX, touchY);
    }

    lastTouchX = touchX;
    lastTouchY = touchY;
  }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  const dpr = window.devicePixelRatio || 1;
  if (e.touches.length === 0 && e.changedTouches.length === 1) {
    const touch = e.changedTouches[0]!;
    const elapsed = Date.now() - touchStartTime;
    const touchX = touch.clientX * dpr;
    const touchY = touch.clientY * dpr;
    const dist = Math.hypot(touchX - lastTouchX, touchY - lastTouchY);

    if (elapsed < 350 && dist < 15 * dpr) {
      const world = screenToWorld(touchX, touchY, viewport);
      inspectPixel(world.x, world.y);
      if (currentTool === 'draw') {
        void handleDraw(touchX, touchY);
      }
    }
  }
  lastDrawnCoord = null;
});

canvas.addEventListener('click', (e) => {
  const dpr = window.devicePixelRatio || 1;
  const world = screenToWorld(e.clientX * dpr, e.clientY * dpr, viewport);
  inspectPixel(world.x, world.y);
});

if (btnClearInspect) {
  btnClearInspect.addEventListener('click', () => {
    clearInspect();
  });
}

async function handleDraw(screenX: number, screenY: number): Promise<void> {
  const world = screenToWorld(screenX, screenY, viewport);
  if (lastDrawnCoord && lastDrawnCoord.x === world.x && lastDrawnCoord.y === world.y) {
    return;
  }

  updateTokensDisplay();
  const batch = getBrushPixels(world.x, world.y, currentBrushSize, currentColor);
  if (batch.length === 0) return;

  const validation = validateBrushStroke(batch.length, userTokens, MAX_TOKENS, isCanvasPaused);
  if (!validation.allowed) {
    showToast(validation.message || 'Action impossible.', 'error');
    return;
  }

  lastDrawnCoord = { x: world.x, y: world.y };
  userTokens -= batch.length;
  updateTokensDisplay();

  const user = authManager.getCurrentUser();
  const author = user?.username || 'Anonyme';
  const token = authManager.getSessionToken() || (user?.id ? `user_${user.id}` : undefined);

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
  renderer.setSelectedPixel({ x, y });
  requestRender();

  const pixel = renderer.getPixel(x, y);
  const info = formatPixelInspection(pixel, x, y);

  inspectCoords.textContent = info.coordsText;
  inspectAuthor.textContent = info.authorText;
  inspectTime.textContent = info.timeText;
  inspectColor.textContent = info.colorText;
  inspectColor.style.color = info.hexColor;

  if (btnClearInspect) {
    btnClearInspect.classList.remove('hidden');
  }
}

function clearInspect(): void {
  renderer.setSelectedPixel(null);
  requestRender();

  inspectCoords.textContent = '—';
  inspectAuthor.textContent = 'Vide';
  inspectTime.textContent = '—';
  inspectColor.textContent = '—';
  inspectColor.style.color = '#e1e1e6';

  if (btnClearInspect) {
    btnClearInspect.classList.add('hidden');
  }
}

function loadFromUrlHash(): void {
  if (typeof window === 'undefined' || !window.location.hash) return;
  const parsed = parseUrlHash(window.location.hash);
  if (parsed) {
    const targetX = parsed.x ?? 5000;
    const targetY = parsed.y ?? 5000;
    const targetZoom = parsed.zoom !== undefined ? parsed.zoom : viewport.zoom;
    viewport = centerAtWorld(targetX, targetY, targetZoom, viewport);
    realtimeManager.updateViewport(viewport);
    requestRender();
  }
}

// Initial setup
window.addEventListener('resize', resizeCanvas);
window.addEventListener('hashchange', loadFromUrlHash);
initPalette();
resizeCanvas();
loadFromUrlHash();
updateTokensDisplay();
updateBrushHint();
