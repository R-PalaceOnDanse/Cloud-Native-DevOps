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
let currentTool: 'draw' | 'pan' | 'pipette' = 'draw';
let isMouseDown = false;
let isSpacePressed = false;
let lastMouseX = 0;
let lastMouseY = 0;
let isCanvasPaused = false;
let lastClearedAtTimestamp: number | null = null;
let lastDrawnCoord: { x: number; y: number } | null = null;
let lastAttemptedCoord: { x: number; y: number } | null = null;
let lastDrawTime = 0;
const DRAG_DRAW_INTERVAL_MS = 100; // Pacing throttle when dragging to avoid spraying tokens uncontrollably
let lastErrorBlinkTime = 0;
const ERROR_BLINK_COOLDOWN_MS = 250; // Throttle re-blink animation to 250ms during continuous drag

let userPixelsCount = 0;
try {
  userPixelsCount = Number(localStorage.getItem('pixel_canvas_user_pixels_drawn') || '0');
} catch {
  userPixelsCount = 0;
}

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
const btnZoomIn = document.getElementById('btn-zoom-in') as HTMLButtonElement | null;
const btnZoomOut = document.getElementById('btn-zoom-out') as HTMLButtonElement | null;
const streamStatus = document.getElementById('stream-status') as HTMLElement;
const tokensDisplay = document.getElementById('tokens-display') as HTMLElement;
const toastContainer = document.getElementById('toast-container') as HTMLElement;
const pauseBanner = document.getElementById('pause-banner') as HTMLElement;
const brushHint = document.getElementById('brush-hint') as HTMLElement;
const paletteContainer = document.getElementById('palette-grid') as HTMLElement;
const palettePopover = document.getElementById('palette-popover') as HTMLElement | null;
const btnTogglePalette = document.getElementById('btn-toggle-palette') as HTMLButtonElement | null;
const btnClosePalette = document.getElementById('btn-close-palette') as HTMLButtonElement | null;
const activeColorIndicator = document.getElementById('active-color-indicator') as HTMLElement | null;
const customColorInput = document.getElementById('custom-color') as HTMLInputElement;
const colorHexLabel = document.getElementById('color-hex-label') as HTMLElement;
const toolDrawBtn = document.getElementById('tool-draw') as HTMLButtonElement;
const toolPanBtn = document.getElementById('tool-pan') as HTMLButtonElement;
const toolPipetteBtn = document.getElementById('tool-pipette') as HTMLButtonElement | null;
const btnToggleGrid = document.getElementById('btn-toggle-grid') as HTMLButtonElement | null;
const btnQuickEraser = document.getElementById('btn-quick-eraser') as HTMLButtonElement | null;
const recentPaletteGrid = document.getElementById('recent-palette-grid') as HTMLElement | null;
const statPixelsPainted = document.getElementById('stat-pixels-painted') as HTMLElement | null;
const networkStatus = document.getElementById('network-status') as HTMLElement | null;
const resetViewBtn = document.getElementById('btn-reset-view') as HTMLButtonElement;
const exportViewBtn = document.getElementById('btn-export-view') as HTMLButtonElement | null;

// Shortcuts Modal Elements
const btnShortcuts = document.getElementById('btn-shortcuts') as HTMLButtonElement | null;
const modalShortcuts = document.getElementById('modal-shortcuts') as HTMLElement | null;
const btnCloseShortcuts = document.getElementById('btn-close-shortcuts') as HTMLButtonElement | null;
const btnOkShortcuts = document.getElementById('btn-ok-shortcuts') as HTMLButtonElement | null;

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
const inspectSwatch = document.getElementById('inspect-swatch') as HTMLElement | null;
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
      streamStatus.textContent = `⚡ ${count} tiles`;
    }
  }
);

// Subscribe to global system state (pause / resume / admin clear)
realtimeManager.subscribeSystemState((state: SystemState) => {
  isCanvasPaused = state.paused;
  if (pauseBanner) {
    if (isCanvasPaused) {
      pauseBanner.classList.remove('hidden');
      showToast('⏸️ Canvas is paused: edits are temporarily suspended.', 'error');
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
    showToast('🧹 Canvas has been cleared by an administrator.', 'info');
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

const activeToastTimers = new Map<HTMLElement, number>();

function triggerTokenBatteryAlert(): void {
  const container = document.querySelector('.tokens-container');
  if (container) {
    container.classList.remove('tokens-alert');
    void (container as HTMLElement).offsetWidth;
    container.classList.add('tokens-alert');
  }
}

function showToast(message: string, type: 'info' | 'error' | 'success' | 'warning' = 'info'): void {
  if (!toastContainer) return;

  // If this is an error, deduplicate with any existing error toast so we never stack errors
  if (type === 'error') {
    const existingErrorToast = toastContainer.querySelector('.toast-error') as HTMLElement | null;
    if (existingErrorToast) {
      existingErrorToast.textContent = message;

      // Re-trigger the red blink animation
      existingErrorToast.classList.remove('toast-blink-red');
      void existingErrorToast.offsetWidth; // Force reflow
      existingErrorToast.classList.add('toast-blink-red');

      // Trigger token battery alert pulse in HUD
      triggerTokenBatteryAlert();

      // Reset auto-dismiss timer
      const oldTimer = activeToastTimers.get(existingErrorToast);
      if (oldTimer !== undefined) clearTimeout(oldTimer);

      const newTimer = window.setTimeout(() => {
        existingErrorToast.remove();
        activeToastTimers.delete(existingErrorToast);
      }, 3500);
      activeToastTimers.set(existingErrorToast, newTimer);
      return;
    }
  }

  // Deduplicate exact same message if already showing
  const existingSameToast = Array.from(toastContainer.querySelectorAll('.toast')).find(
    (el) => el.textContent === message && el.classList.contains(`toast-${type}`)
  ) as HTMLElement | undefined;

  if (existingSameToast) {
    if (type === 'error') {
      existingSameToast.classList.remove('toast-blink-red');
      void existingSameToast.offsetWidth;
      existingSameToast.classList.add('toast-blink-red');
      triggerTokenBatteryAlert();
    }
    const oldTimer = activeToastTimers.get(existingSameToast);
    if (oldTimer !== undefined) clearTimeout(oldTimer);

    const newTimer = window.setTimeout(() => {
      existingSameToast.remove();
      activeToastTimers.delete(existingSameToast);
    }, 3500);
    activeToastTimers.set(existingSameToast, newTimer);
    return;
  }

  // Create new toast element
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  if (type === 'error') {
    toast.classList.add('toast-blink-red');
    triggerTokenBatteryAlert();
  }

  toastContainer.appendChild(toast);

  const timer = window.setTimeout(() => {
    toast.remove();
    activeToastTimers.delete(toast);
  }, 3500);
  activeToastTimers.set(toast, timer);
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

// Build Palette UI & Recent Colors
const MAX_RECENT_COLORS = 6;

function loadRecentColors(): string[] {
  try {
    const raw = localStorage.getItem('pixel_canvas_recent_colors');
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((c) => typeof c === 'string' && c.startsWith('#')) : [];
  } catch {
    return [];
  }
}

let recentColors = loadRecentColors();

function addRecentColor(hex: string): void {
  const normalized = hex.toLowerCase();
  recentColors = [normalized, ...recentColors.filter((c) => c.toLowerCase() !== normalized)].slice(0, MAX_RECENT_COLORS);
  try {
    localStorage.setItem('pixel_canvas_recent_colors', JSON.stringify(recentColors));
  } catch {
    // Ignore storage quota errors
  }
  renderRecentColors();
}

function renderRecentColors(): void {
  if (!recentPaletteGrid) return;
  recentPaletteGrid.innerHTML = '';
  for (const hex of recentColors) {
    const swatch = document.createElement('div');
    swatch.className = 'recent-color-swatch';
    swatch.style.backgroundColor = hex;
    swatch.title = `Recent color: ${hex}`;
    if (hex.toLowerCase() === currentColor.toLowerCase()) {
      swatch.classList.add('selected');
    }
    swatch.addEventListener('click', () => {
      selectColor(hex);
      setTool('draw');
    });
    recentPaletteGrid.appendChild(swatch);
  }
}

function initPalette(): void {
  paletteContainer.innerHTML = '';
  PALETTE_COLORS.forEach((hex) => {
    const swatch = document.createElement('div');
    swatch.className = 'palette-color';
    swatch.style.backgroundColor = hex;
    if (hex === currentColor) swatch.classList.add('selected');

    swatch.addEventListener('click', () => {
      selectColor(hex);
      addRecentColor(hex);
    });

    paletteContainer.appendChild(swatch);
  });
  if (activeColorIndicator) {
    activeColorIndicator.style.backgroundColor = currentColor;
  }
  renderRecentColors();
}

function selectColor(hex: string): void {
  currentColor = hex;
  customColorInput.value = hex;
  colorHexLabel.textContent = hex;

  if (activeColorIndicator) {
    activeColorIndicator.style.backgroundColor = hex;
  }

  document.querySelectorAll('.palette-color').forEach((el) => {
    const div = el as HTMLElement;
    if (div.style.backgroundColor === hex || rgbToHex(div.style.backgroundColor) === hex) {
      div.classList.add('selected');
    } else {
      div.classList.remove('selected');
    }
  });

  document.querySelectorAll('.recent-color-swatch').forEach((el) => {
    const div = el as HTMLElement;
    if (div.style.backgroundColor === hex || rgbToHex(div.style.backgroundColor) === hex) {
      div.classList.add('selected');
    } else {
      div.classList.remove('selected');
    }
  });
}

customColorInput.addEventListener('change', () => {
  selectColor(customColorInput.value);
  addRecentColor(customColorInput.value);
});

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
    brushHint.textContent = `${count} pixels / stroke ⚠️ (Exceeds max capacity of ${MAX_TOKENS})`;
    brushHint.classList.add('warning');
  } else {
    brushHint.textContent = `${count} pixel${count > 1 ? 's' : ''} / stroke (${count} token${count > 1 ? 's' : ''})`;
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

// Tools switch & management
function setTool(tool: 'draw' | 'pan' | 'pipette'): void {
  currentTool = tool;
  toolDrawBtn.classList.toggle('active', tool === 'draw');
  toolPanBtn.classList.toggle('active', tool === 'pan');
  toolPipetteBtn?.classList.toggle('active', tool === 'pipette');

  if (tool === 'pan') {
    canvas.style.cursor = 'grab';
  } else if (tool === 'pipette') {
    canvas.style.cursor = 'copy';
  } else {
    canvas.style.cursor = 'crosshair';
  }
}

toolDrawBtn.addEventListener('click', () => {
  setTool('draw');
});

toolPanBtn.addEventListener('click', () => {
  setTool('pan');
});

toolPipetteBtn?.addEventListener('click', () => {
  setTool('pipette');
  showToast('💉 Eyedropper mode active: click a pixel to sample its color (or hold Alt while drawing)', 'info');
});

// Palette Popover Toggle & Close
if (btnTogglePalette && palettePopover) {
  btnTogglePalette.addEventListener('click', (e) => {
    e.stopPropagation();
    palettePopover.classList.toggle('hidden');
  });
}

if (btnClosePalette && palettePopover) {
  btnClosePalette.addEventListener('click', () => {
    palettePopover.classList.add('hidden');
  });
}

document.addEventListener('click', (e) => {
  if (palettePopover && !palettePopover.classList.contains('hidden')) {
    const target = e.target as HTMLElement;
    if (!palettePopover.contains(target) && !btnTogglePalette?.contains(target)) {
      palettePopover.classList.add('hidden');
    }
  }
});

// Zoom In & Out Buttons
if (btnZoomIn) {
  btnZoomIn.addEventListener('click', () => {
    viewport = zoomAtPoint(canvas.width / 2, canvas.height / 2, 1.25, viewport);
    realtimeManager.updateViewport(viewport);
    requestRender();
    syncUrlHash();
  });
}

if (btnZoomOut) {
  btnZoomOut.addEventListener('click', () => {
    viewport = zoomAtPoint(canvas.width / 2, canvas.height / 2, 0.8, viewport);
    realtimeManager.updateViewport(viewport);
    requestRender();
    syncUrlHash();
  });
}

// Gridlines toggle
btnToggleGrid?.addEventListener('click', () => {
  const newEnabled = !renderer.isGridLinesEnabled();
  renderer.setShowGridLines(newEnabled);
  btnToggleGrid.textContent = `Grid: ${newEnabled ? 'ON' : 'OFF'}`;
  requestRender();
  showToast(`Grid: ${newEnabled ? 'Enabled' : 'Disabled'}`, 'info');
});

// Quick Eraser (White)
btnQuickEraser?.addEventListener('click', () => {
  selectColor('#ffffff');
  setTool('draw');
  showToast('🧹 Eraser active (Color set to white #ffffff)', 'info');
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
      showToast('📷 Viewport exported successfully as PNG!', 'success');
    } catch {
      showToast('Failed to export image.', 'error');
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
  showToast(`📍 View centered on (${Math.round(x)}, ${Math.round(y)})`, 'info');
}

// Quick Preset Chips in Goto Modal
document.querySelectorAll('.preset-chip').forEach((chip) => {
  chip.addEventListener('click', (e) => {
    const target = e.currentTarget as HTMLElement;
    const x = target.dataset.x;
    const y = target.dataset.y;
    if (x && inputGotoX) inputGotoX.value = x;
    if (y && inputGotoY) inputGotoY.value = y;
  });
});

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

modalGoto?.addEventListener('click', (e) => {
  if (e.target === modalGoto) {
    closeGotoModal();
  }
});

modalGoto?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    executeGoto();
  } else if (e.key === 'Escape') {
    closeGotoModal();
  }
});

// Shortcuts Modal Handlers
function openShortcutsModal(): void {
  modalShortcuts?.classList.remove('hidden');
}

function closeShortcutsModal(): void {
  modalShortcuts?.classList.add('hidden');
}

if (btnShortcuts) {
  btnShortcuts.addEventListener('click', openShortcutsModal);
}

if (btnCloseShortcuts) {
  btnCloseShortcuts.addEventListener('click', closeShortcutsModal);
}

if (btnOkShortcuts) {
  btnOkShortcuts.addEventListener('click', closeShortcutsModal);
}

modalShortcuts?.addEventListener('click', (e) => {
  if (e.target === modalShortcuts) {
    closeShortcutsModal();
  }
});

// Discord Auth Event Listeners
authManager.onAuthStateChanged((user: UserProfile | null) => {
  if (user) {
    btnDiscordLogin.classList.add('hidden');
    userDisplay.classList.remove('hidden');
    userName.textContent = user.username;
    showToast(`Logged in as ${user.username}`, 'success');
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
  showToast('Logged out', 'info');
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
        showToast('Discord login successful!', 'success');
      } else {
        showToast(`Discord login failed: ${res.error || 'Error'}`, 'error');
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
    setTool('draw');
  } else if (e.key === 'h' || e.key === 'H') {
    setTool('pan');
  } else if (e.key === 'i' || e.key === 'I') {
    setTool('pipette');
    showToast('💉 Eyedropper mode active: click a pixel to sample its color', 'info');
  } else if (e.key === 'e' || e.key === 'E') {
    btnQuickEraser?.click();
  } else if (e.key === 'g' || e.key === 'G') {
    btnToggleGrid?.click();
  } else if (e.key === 'j' || e.key === 'J') {
    openGotoModal();
  } else if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
    openShortcutsModal();
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
      showToast(`Brush size: ${size}px`, 'info');
    }
  } else if (e.key === '+' || e.key === '=') {
    viewport = zoomAtPoint(canvas.width / 2, canvas.height / 2, 1.25, viewport);
    realtimeManager.updateViewport(viewport);
    requestRender();
    syncUrlHash();
  } else if (e.key === '-' || e.key === '_') {
    viewport = zoomAtPoint(canvas.width / 2, canvas.height / 2, 0.8, viewport);
    realtimeManager.updateViewport(viewport);
    requestRender();
    syncUrlHash();
  } else if (e.key === '0' || e.key === 'c' || e.key === 'C') {
    viewport = createDefaultViewport(canvas.width, canvas.height);
    realtimeManager.updateViewport(viewport);
    requestRender();
    syncUrlHash();
  } else if (e.key === 'Escape') {
    if (modalGoto && !modalGoto.classList.contains('hidden')) {
      closeGotoModal();
    } else if (modalShortcuts && !modalShortcuts.classList.contains('hidden')) {
      closeShortcutsModal();
    } else if (palettePopover && !palettePopover.classList.contains('hidden')) {
      palettePopover.classList.add('hidden');
    } else {
      clearInspect();
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    isSpacePressed = false;
    canvas.style.cursor = currentTool === 'pan' ? 'grab' : (currentTool === 'pipette' ? 'copy' : 'crosshair');
  }
});

canvas.addEventListener('mousedown', (e) => {
  isMouseDown = true;
  lastDrawnCoord = null;
  lastAttemptedCoord = null;
  const dpr = window.devicePixelRatio || 1;
  lastMouseX = e.clientX * dpr;
  lastMouseY = e.clientY * dpr;

  if (isSpacePressed || currentTool === 'pan' || e.button === 1) {
    canvas.style.cursor = 'grabbing';
    return;
  }

  const world = screenToWorld(lastMouseX, lastMouseY, viewport);

  // Pipette mode or Alt + click eyedropper
  if (currentTool === 'pipette' || e.altKey) {
    if (world.x >= 0 && world.x < 10000 && world.y >= 0 && world.y < 10000) {
      const pickedColor = renderer.getPixelColor(world.x, world.y);
      selectColor(pickedColor);
      addRecentColor(pickedColor);
      setTool('draw');
      showToast(`💉 Color sampled: ${pickedColor} at (${world.x}, ${world.y})`, 'info');
    }
    return;
  }

  // Draw on click (isDrag = false)
  void handleDraw(e.clientX * dpr, e.clientY * dpr, false);
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
    void handleDraw(mouseX, mouseY, true);
  }

  lastMouseX = mouseX;
  lastMouseY = mouseY;
});

window.addEventListener('mouseup', () => {
  isMouseDown = false;
  lastDrawnCoord = null;
  lastAttemptedCoord = null;
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
    lastAttemptedCoord = null;
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
      void handleDraw(touchX, touchY, true);
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
        void handleDraw(touchX, touchY, false);
      }
    }
  }
  lastDrawnCoord = null;
  lastAttemptedCoord = null;
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

async function handleDraw(screenX: number, screenY: number, isDrag = false): Promise<void> {
  const world = screenToWorld(screenX, screenY, viewport);
  if (lastDrawnCoord && lastDrawnCoord.x === world.x && lastDrawnCoord.y === world.y) {
    return;
  }

  const now = Date.now();
  if (isDrag) {
    // If cursor has not moved to a different coordinate while dragging, skip
    if (lastAttemptedCoord && lastAttemptedCoord.x === world.x && lastAttemptedCoord.y === world.y) {
      return;
    }
    // Controlled drag pacing: avoids dumping all tokens in 20ms during quick mouse motion
    if (now - lastDrawTime < DRAG_DRAW_INTERVAL_MS) {
      return;
    }
  }

  lastAttemptedCoord = { x: world.x, y: world.y };

  updateTokensDisplay();
  const batch = getBrushPixels(world.x, world.y, currentBrushSize, currentColor);
  if (batch.length === 0) return;

  const validation = validateBrushStroke(batch.length, userTokens, MAX_TOKENS, isCanvasPaused);
  if (!validation.allowed) {
    // Distinct clicks always re-blink error toast immediately; continuous dragging throttles re-blink
    if (!isDrag || now - lastErrorBlinkTime >= ERROR_BLINK_COOLDOWN_MS) {
      lastErrorBlinkTime = now;
      showToast(validation.message || 'Unable to perform action.', 'error');
    }
    return;
  }

  lastDrawTime = now;
  lastDrawnCoord = { x: world.x, y: world.y };
  userTokens -= batch.length;
  updateTokensDisplay();

  const user = authManager.getCurrentUser();
  const author = user?.username || 'Anonymous';
  const token = authManager.getSessionToken() || (user?.id ? `user_${user.id}` : undefined);

  // 1. Optimistic local rendering
  renderer.applyBatch(batch, author);
  requestRender();
  inspectPixel(world.x, world.y);
  addRecentColor(currentColor);
  updateUserPixelsCount(batch.length);

  // 2. Broadcast via local provider
  void realtimeManager.publishDraw(batch, author);

  // 3. Dispatch to Web Draw Proxy backend pipeline
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    showToast('⚠️ Offline: pixel drawn locally, will sync when reconnected.', 'warning');
    return;
  }

  const result = await drawApiClient.submitDraw(batch, token);
  if ('error' in result && result.error) {
    showToast(result.error, 'error');
  }
}

function updateUserPixelsCount(added: number): void {
  userPixelsCount += added;
  try {
    localStorage.setItem('pixel_canvas_user_pixels_drawn', String(userPixelsCount));
  } catch {
    // Ignore storage errors
  }
  if (statPixelsPainted) {
    statPixelsPainted.textContent = `🎯 ${userPixelsCount} px`;
  }
}

function updateNetworkStatus(): void {
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  if (networkStatus) {
    networkStatus.classList.toggle('hidden', isOnline);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    updateNetworkStatus();
    showToast('✅ Network connection restored.', 'success');
  });

  window.addEventListener('offline', () => {
    updateNetworkStatus();
    showToast('⚠️ Network connection lost. Offline mode active.', 'error');
  });
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

  if (inspectSwatch) {
    inspectSwatch.style.backgroundColor = info.hexColor;
  }

  if (btnClearInspect) {
    btnClearInspect.classList.remove('hidden');
  }
}

function clearInspect(): void {
  renderer.setSelectedPixel(null);
  requestRender();

  inspectCoords.textContent = '—';
  inspectAuthor.textContent = 'Empty';
  inspectTime.textContent = '—';
  inspectColor.textContent = '—';
  inspectColor.style.color = '#e1e1e6';

  if (inspectSwatch) {
    inspectSwatch.style.backgroundColor = '#38bdf8';
  }

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
if (typeof window !== 'undefined') {
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('hashchange', loadFromUrlHash);
  initPalette();
  resizeCanvas();
  loadFromUrlHash();
  updateTokensDisplay();
  updateBrushHint();
  updateNetworkStatus();
  if (statPixelsPainted) {
    statPixelsPainted.textContent = `🎯 ${userPixelsCount} px`;
  }
}
