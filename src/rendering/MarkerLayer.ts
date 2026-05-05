import type { Marker, ViewState } from '../types.ts';

const BADGE_R   = 8;   // badge circle radius in canvas px
const BADGE_HIT = 14;  // hit-test radius for badge clicks

interface Frustum { left: number; right: number; top: number; bottom: number; }

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// ── Module-level badge helpers (shared by drawMarkerShape and class) ──────────

function _badge(ctx: Ctx2D, bx: number, by: number, bg: string, txt: string): void {
  ctx.beginPath();
  ctx.arc(bx, by, BADGE_R, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth   = 1;
  ctx.stroke();
  ctx.font         = `bold ${BADGE_R * 1.1}px system-ui,sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = 'white';
  ctx.fillText(txt, bx, by + 0.5);
}

function _visibilityBadge(ctx: Ctx2D, m: Marker, bx: number, by: number): void {
  _badge(ctx, bx, by, m.hidden ? '#c0392b' : '#22c55e', m.hidden ? '✕' : '✓');
}

function _roleBadge(ctx: Ctx2D, m: Marker, bx: number, by: number): void {
  if (m.role === 'audio_source') {
    const bg  = m.audioMuted ? '#d09020' : '#0d9adb';
    const txt = m.audioMuted ? '✕' : '♪';
    _badge(ctx, bx, by, bg, txt);
  } else if (m.role === 'listener') {
    const bg  = m.trackerEnabled ? '#48d1cc' : '#7a9bb5';
    const txt = m.trackerEnabled ? '◉' : '○';
    _badge(ctx, bx, by, bg, txt);
  }
}

/**
 * Standalone marker drawing function used by both the DOM overlay (GM)
 * and the WebGL CanvasTexture (player via MarkerTexture).
 *
 * No circle background — icon is drawn in the marker's own color.
 */
export function drawMarkerShape(
  ctx: Ctx2D,
  m: Marker,
  cx: number,
  cy: number,
  r: number,
  selected: boolean,
  isGM: boolean,
  iconCache?: Map<string, ImageBitmap>,
): void {
  // 1. Ghost out hidden markers for GM
  if (isGM && m.hidden) ctx.globalAlpha = 0.4;

  // 2. Dashed selection ring
  if (selected) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
    ctx.setLineDash([6, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth   = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 3. Icon rendering
  const isImage = m.icon.startsWith('data:') || m.icon.startsWith('asset:');
  if (isImage) {
    const bmp = iconCache?.get(m.icon);
    if (bmp) {
      ctx.drawImage(bmp, cx - r, cy - r, r * 2, r * 2);
    } else {
      // Placeholder: small filled circle in marker color
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = m.color;
      ctx.fill();
    }
  } else {
    // Text / emoji rendering
    const iconPx = Math.max(12, r * 1.6);
    ctx.font         = `${iconPx}px system-ui,sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    // Stroke for readability
    ctx.strokeStyle  = 'rgba(0,0,0,0.75)';
    ctx.lineWidth    = Math.max(2, iconPx * 0.15);
    ctx.strokeText(m.icon || '?', cx, cy);
    // Fill in marker color
    ctx.fillStyle = m.color;
    ctx.fillText(m.icon || '?', cx, cy);
  }

  // 4. Label below icon — GM always sees it; players only if showLabel is set
  if (m.label && (isGM || m.showLabel)) {
    const lPx = Math.max(9, r * 0.55);
    ctx.font         = `bold ${lPx}px system-ui,sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth    = 2.5;
    ctx.strokeStyle  = 'rgba(0,0,0,0.85)';
    ctx.strokeText(m.label, cx, cy + r + 3);
    ctx.fillStyle    = 'white';
    ctx.fillText(m.label, cx, cy + r + 3);
  }

  // 5. Status badges — GM only
  if (isGM) {
    const bOff = Math.max(BADGE_R + 2, r * 0.78);
    _visibilityBadge(ctx, m, cx - bOff, cy - bOff);
    _roleBadge(ctx, m, cx + bOff, cy - bOff);
  }

  // 6. Reset alpha
  ctx.globalAlpha = 1;
}

/**
 * MarkerLayer — 2D canvas renderer for map markers.
 *
 * Used by both the GM (isGM=true, shows status badges + ghost opacity for
 * hidden markers) and the player (isGM=false, skips hidden markers entirely).
 *
 * The canvas buffer is kept in sync with the element's CSS display size via
 * ResizeObserver; the last render params are re-applied automatically on resize.
 *
 * Position math mirrors Renderer.ts setView() / updateCameraFrustum() exactly
 * so markers are always pixel-aligned with the underlying Three.js scene.
 */
export class MarkerLayer {
  readonly canvas: HTMLCanvasElement;
  private ar = 1; // map aspect ratio

  // Stored so resize can re-render without the caller needing to re-call render()
  private _markers:    Marker[]        = [];
  private _view:       ViewState | null = null;
  private _selectedId: string | null   = null;
  private _isGM:       boolean         = false;
  private _iconCache:  Map<string, ImageBitmap> | undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    const onResize = () => {
      const w = canvas.clientWidth  || 1;
      const h = canvas.clientHeight || 1;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
        this._draw();
      }
    };
    new ResizeObserver(onResize).observe(canvas);
    onResize();
  }

  setAspectRatio(ar: number): void { this.ar = ar; }

  // ── Rendering ──────────────────────────────────────────────────────────────

  render(
    markers:    Marker[],
    view:       ViewState | null,
    selectedId: string | null = null,
    isGM        = false,
    iconCache?: Map<string, ImageBitmap>,
  ): void {
    // Sync buffer to CSS size before drawing
    const w = this.canvas.clientWidth  || 1;
    const h = this.canvas.clientHeight || 1;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width  = w;
      this.canvas.height = h;
    }
    this._markers    = markers;
    this._view       = view;
    this._selectedId = selectedId;
    this._isGM       = isGM;
    this._iconCache  = iconCache;
    this._draw();
  }

  private _draw(): void {
    const { width: W, height: H } = this.canvas;
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);

    const { _markers: markers, _view: view, _selectedId: sel, _isGM: isGM, _iconCache: iconCache } = this;

    for (const m of markers) {
      if (!isGM && m.hidden) continue;
      const pos = this.project(m.position.x, m.position.y, view);
      if (!pos) continue;
      const baseR = Math.min(W, H) * 0.025 * m.size;
      this._drawMarker(ctx, m, pos.x, pos.y, baseR, m.id === sel, isGM, iconCache);
    }
  }

  private _drawMarker(
    ctx: CanvasRenderingContext2D,
    m: Marker, cx: number, cy: number, r: number,
    selected: boolean, isGM: boolean,
    iconCache?: Map<string, ImageBitmap>,
  ): void {
    drawMarkerShape(ctx, m, cx, cy, r, selected, isGM, iconCache);
  }

  // ── Coordinate mapping ─────────────────────────────────────────────────────

  /** Normalised map coords → canvas pixel position. */
  project(mx: number, my: number, view: ViewState | null): { x: number; y: number } | null {
    const f = this._frustum(view);
    const wx =  (mx - 0.5) * this.ar;
    const wy = -(my - 0.5);
    return {
      x: (wx - f.left) / (f.right - f.left) * this.canvas.width,
      y: (f.top - wy)  / (f.top  - f.bottom) * this.canvas.height,
    };
  }

  /** Canvas pixel position → normalised map coords. */
  unproject(px: number, py: number, view: ViewState | null): { x: number; y: number } {
    const f  = this._frustum(view);
    const wx = f.left + (px / this.canvas.width)  * (f.right - f.left);
    const wy = f.top  - (py / this.canvas.height) * (f.top   - f.bottom);
    return { x: wx / this.ar + 0.5, y: -wy + 0.5 };
  }

  /** Returns the topmost marker under canvas pixel (px, py), or null. */
  hitTestMarker(px: number, py: number, markers: Marker[], view: ViewState | null): Marker | null {
    for (let i = markers.length - 1; i >= 0; i--) {
      const m   = markers[i]!;
      const pos = this.project(m.position.x, m.position.y, view);
      if (!pos) continue;
      const r = Math.min(this.canvas.width, this.canvas.height) * 0.025 * m.size;
      if (Math.hypot(px - pos.x, py - pos.y) <= r + 6) return m;
    }
    return null;
  }

  /** Returns which GM badge is under canvas pixel (px, py) for the given marker. */
  hitTestBadge(
    px: number, py: number,
    marker: Marker,
    view: ViewState | null,
  ): 'hidden' | 'audio' | 'tracker' | null {
    const pos = this.project(marker.position.x, marker.position.y, view);
    if (!pos) return null;
    const r    = Math.min(this.canvas.width, this.canvas.height) * 0.025 * marker.size;
    const bOff = Math.max(BADGE_R + 2, r * 0.78);

    if (Math.hypot(px - (pos.x - bOff), py - (pos.y - bOff)) <= BADGE_HIT) return 'hidden';

    if (marker.role === 'audio_source') {
      if (Math.hypot(px - (pos.x + bOff), py - (pos.y - bOff)) <= BADGE_HIT) return 'audio';
    } else if (marker.role === 'listener') {
      if (Math.hypot(px - (pos.x + bOff), py - (pos.y - bOff)) <= BADGE_HIT) return 'tracker';
    }
    return null;
  }

  private _frustum(view: ViewState | null): Frustum {
    const W  = this.canvas.width  || 1;
    const H  = this.canvas.height || 1;
    const sa = W / H;
    const ma = this.ar;

    if (view) {
      const hw_vp = (view.viewNW / 2) * ma;
      const hh_vp =  view.viewNH / 2;
      const va    = hw_vp / Math.max(hh_vp, 0.0001);
      let hw: number, hh: number;
      if (sa > va) { hh = hh_vp; hw = hh * sa; }
      else         { hw = hw_vp; hh = hw  / sa; }
      const cx = (view.centerX - 0.5) * ma;
      const cy = -(view.centerY - 0.5);
      return { left: cx - hw, right: cx + hw, top: cy + hh, bottom: cy - hh };
    }

    // GM full-map view (mirrors Renderer.updateCameraFrustum)
    let hw: number, hh: number;
    if (sa > ma) { hh = 0.5; hw = hh * sa; }
    else         { hw = ma * 0.5; hh = hw / sa; }
    return { left: -hw, right: hw, top: hh, bottom: -hh };
  }
}
