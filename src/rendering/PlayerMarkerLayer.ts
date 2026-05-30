/**
 * PlayerMarkerLayer (v2.17 Player Voice) — renders player tokens as a
 * screen-space DOM layer, decoupled from the WebGL marker pipeline and from
 * the saved per-map markers (player tokens live in the browser players store,
 * never in the .mappadux save file).
 *
 * Each token is a circular disc edged in the owning player's colour, with the
 * player's initial and a name label. Tokens are anchored to normalised map
 * coords and reprojected each frame so they track pan / zoom. Dragging is
 * gated by a predicate: the GM can drag any token; a player can drag only
 * their own (and only when the GM allows movable markers).
 */

import { parseTokenSize, TOKEN_FOOTPRINT_GAP_SQUARES } from '../players/playerToken.ts';

export interface PlayerMarkerView {
  playerId: string;
  name:     string;
  color:    string;
  x:        number;
  y:        number;
  /** Optional token icon — unicode glyph OR data URL. Falls back to the
   *  player's initial when neither is set. */
  iconChar?:    string;
  iconDataUrl?: string;
  /** Footprint W×H in map squares. Honoured only when getPxPerSquare returns
   *  a positive number (calibrated map). Falls back to constant CSS size
   *  on uncalibrated maps so the token stays readable at any zoom. */
  tokenSize?: import('../types.ts').TokenSize;
}

export interface PlayerMarkerLayerOptions {
  /** normalised map coord → canvas-relative CSS px (null = off-screen). */
  project: (x: number, y: number) => { x: number; y: number } | null;
  /** viewport client px → normalised map coord (null = off-map). */
  unproject: (clientX: number, clientY: number) => { x: number; y: number } | null;
  /** May this token be dragged here? */
  canDrag: (playerId: string) => boolean;
  /** Live drag updates (throttled by the caller's consumer if needed). */
  onDragMove?: (playerId: string, x: number, y: number) => void;
  /** Drag finished at this position. */
  onDragEnd?: (playerId: string, x: number, y: number) => void;
  /** Current screen-pixels-per-map-square on the active map, or null if the
   *  map is uncalibrated. Drives tokenSize → CSS-px on the active view; when
   *  null the layer falls back to constant CSS sizing from main.css. */
  getPxPerSquare?: () => number | null;
}

interface TokenEntry {
  view: PlayerMarkerView;
  el: HTMLElement;
}

export class PlayerMarkerLayer {
  private tokens = new Map<string, TokenEntry>();
  private rafId: number | null = null;
  private draggingId: string | null = null;
  private _lastMoveSent = 0;

  constructor(private container: HTMLElement, private opts: PlayerMarkerLayerOptions) {}

  /** Replace the rendered token set. Existing tokens are updated in place so a
   *  drag in progress isn't disrupted by an incoming broadcast. */
  setMarkers(markers: PlayerMarkerView[]): void {
    const seen = new Set<string>();
    for (const m of markers) {
      seen.add(m.playerId);
      const existing = this.tokens.get(m.playerId);
      if (existing) {
        // Don't clobber the position of a token the local user is dragging.
        if (this.draggingId !== m.playerId) existing.view = m;
        else existing.view = { ...existing.view, name: m.name, color: m.color };
        this._style(existing);
      } else {
        const el = this._buildToken(m);
        this.container.appendChild(el);
        this.tokens.set(m.playerId, { view: { ...m }, el });
      }
    }
    for (const [id, entry] of this.tokens) {
      if (!seen.has(id)) { entry.el.remove(); this.tokens.delete(id); }
    }
    if (this.tokens.size > 0) this._kick();
  }

  clearAll(): void {
    for (const t of this.tokens.values()) t.el.remove();
    this.tokens.clear();
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  private _buildToken(m: PlayerMarkerView): HTMLElement {
    const el = document.createElement('div');
    el.className = 'pm-token';
    el.style.setProperty('--pm-color', m.color);

    const disc = document.createElement('div');
    disc.className = 'pm-token-disc';
    this._fillDisc(disc, m);
    el.appendChild(disc);

    const label = document.createElement('div');
    label.className = 'pm-token-label';
    label.textContent = m.name;
    el.appendChild(label);

    el.addEventListener('pointerdown', (e) => this._onPointerDown(e, m.playerId));
    return el;
  }

  /** Populate the disc with image / glyph / initial-letter as appropriate. */
  private _fillDisc(disc: HTMLElement, m: PlayerMarkerView): void {
    disc.replaceChildren();
    disc.classList.toggle('pm-token-disc--has-image', !!m.iconDataUrl);
    disc.classList.toggle('pm-token-disc--has-glyph', !m.iconDataUrl && !!m.iconChar);
    if (m.iconDataUrl) {
      const img = document.createElement('img');
      img.src = m.iconDataUrl;
      img.alt = '';
      img.draggable = false;
      disc.appendChild(img);
      return;
    }
    if (m.iconChar) {
      disc.textContent = m.iconChar;
      return;
    }
    disc.textContent = (m.name.trim()[0] ?? '?').toUpperCase();
  }

  private _onPointerDown(e: PointerEvent, playerId: string): void {
    if (!this.opts.canDrag(playerId)) return;
    e.preventDefault();
    e.stopPropagation(); // don't start a map pan / long-press
    const entry = this.tokens.get(playerId);
    if (!entry) return;
    this.draggingId = playerId;
    entry.el.classList.add('is-dragging');
    (e.target as Element).setPointerCapture?.(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const n = this.opts.unproject(ev.clientX, ev.clientY);
      if (!n) return;
      const x = Math.max(0, Math.min(1, n.x));
      const y = Math.max(0, Math.min(1, n.y));
      entry.view = { ...entry.view, x, y };
      const now = performance.now();
      if (this.opts.onDragMove && now - this._lastMoveSent > 60) {
        this._lastMoveSent = now;
        this.opts.onDragMove(playerId, x, y);
      }
    };
    const onUp = () => {
      entry.el.classList.remove('is-dragging');
      this.draggingId = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      this.opts.onDragEnd?.(playerId, entry.view.x, entry.view.y);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  private _style(entry: TokenEntry): void {
    entry.el.style.setProperty('--pm-color', entry.view.color);
    const disc = entry.el.querySelector<HTMLElement>('.pm-token-disc');
    if (disc) this._fillDisc(disc, entry.view);
    const label = entry.el.querySelector<HTMLElement>('.pm-token-label');
    if (label) label.textContent = entry.view.name;
    entry.el.classList.toggle('pm-token--draggable', this.opts.canDrag(entry.view.playerId));
  }

  private _kick(): void {
    if (this.rafId !== null) return;
    const tick = () => {
      const pxPerSq = this.opts.getPxPerSquare?.() ?? null;
      for (const entry of this.tokens.values()) {
        const p = this.opts.project(entry.view.x, entry.view.y);
        if (!p) { entry.el.style.display = 'none'; continue; }
        entry.el.style.display = '';
        entry.el.style.left = `${p.x}px`;
        entry.el.style.top  = `${p.y}px`;
        this._sizeDisc(entry, pxPerSq);
      }
      this.rafId = this.tokens.size > 0 ? requestAnimationFrame(tick) : null;
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** Apply tokenSize-driven dimensions to the disc.
   *
   *  - Calibrated map (pxPerSq > 0): disc is `dims.w × dims.h × pxPerSq × 0.75`,
   *    so adjacent tokens don't visually butt up. Square footprints render as
   *    circles; non-square footprints as rounded rectangles.
   *  - Uncalibrated map (pxPerSq null/0): clear inline sizing so the base CSS
   *    constant size from main.css applies — tokens stay readable at any zoom. */
  private _sizeDisc(entry: TokenEntry, pxPerSq: number | null): void {
    const disc = entry.el.querySelector<HTMLElement>('.pm-token-disc');
    if (!disc) return;
    const tokenSize = entry.view.tokenSize ?? '1x1';
    const dims = parseTokenSize(tokenSize);
    const isSquare = dims.w === dims.h;
    if (pxPerSq && pxPerSq > 0) {
      // Constant gap (in squares) shaved off each axis so the visual gap
      // between adjacent tokens stays the same at every size: 1x1 → 0.75
      // squares, 2x2 → 1.75, 3x3 → 2.75. The min keeps unscaled-equivalent
      // sizes legible even when the map is zoomed far out.
      const w = Math.max(12, (dims.w - TOKEN_FOOTPRINT_GAP_SQUARES) * pxPerSq);
      const h = Math.max(12, (dims.h - TOKEN_FOOTPRINT_GAP_SQUARES) * pxPerSq);
      disc.style.width  = `${w}px`;
      disc.style.height = `${h}px`;
      disc.classList.toggle('pm-token-disc--scaled', true);
      disc.classList.toggle('pm-token-disc--rect', !isSquare);
    } else {
      disc.style.width  = '';
      disc.style.height = '';
      disc.classList.toggle('pm-token-disc--scaled', false);
      disc.classList.toggle('pm-token-disc--rect', false);
    }
  }
}
