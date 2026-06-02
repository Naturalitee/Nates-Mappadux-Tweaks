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
  /** Facing in degrees clockwise from north (0–359). 0 = north. Drives:
   *  the edge-pointer position (snap-to-45° at the UI layer); and, for
   *  non-square tokens (1x2 / 2x3), the image rotates in 90° steps to stay
   *  upright relative to the footprint's long axis. Undefined ⇒ 0. */
  facing?: number;
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
  /** May this token be dragged / rotated here? Same predicate for both. */
  canDrag: (playerId: string) => boolean;
  /** Live drag updates (throttled by the caller's consumer if needed). */
  onDragMove?: (playerId: string, x: number, y: number) => void;
  /** Drag finished at this position. */
  onDragEnd?: (playerId: string, x: number, y: number) => void;
  /** Live rotation updates while the user drags the facing pointer.
   *  `facing` is degrees clockwise from north, snap-to-45°. */
  onRotateMove?: (playerId: string, facing: number) => void;
  /** Rotation finished at this facing (snap-to-45°). */
  onRotateEnd?: (playerId: string, facing: number) => void;
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

    // Facing pointer — small coloured dot at the disc edge in the facing
    // direction. Doubles as the rotation handle: drag it around the disc
    // centre to rotate (snap-to-45°). Pointer-events gated on canDrag via
    // the .pm-token--draggable class.
    const pointer = document.createElement('div');
    pointer.className = 'pm-token-pointer';
    pointer.addEventListener('pointerdown', (e) => this._onPointerDownRotate(e, m.playerId));
    el.appendChild(pointer);

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

  /** Pointerdown on the facing pointer → start a rotation drag. Computes the
   *  angle from the disc centre to the cursor in screen px, snaps to 45°,
   *  and emits onRotateMove (live) + onRotateEnd. */
  private _onPointerDownRotate(e: PointerEvent, playerId: string): void {
    if (!this.opts.canDrag(playerId)) return;
    e.preventDefault();
    e.stopPropagation();
    const entry = this.tokens.get(playerId);
    if (!entry) return;
    const disc = entry.el.querySelector<HTMLElement>('.pm-token-disc');
    if (!disc) return;
    this.draggingId = playerId; // suppresses setMarkers clobbers
    entry.el.classList.add('is-rotating');
    (e.target as Element).setPointerCapture?.(e.pointerId);

    const computeFacing = (ev: PointerEvent): number => {
      const r = disc.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top  + r.height / 2;
      const dx = ev.clientX - cx;
      const dy = ev.clientY - cy;
      // Angle clockwise from north (-y). atan2(dx, -dy) gives that directly.
      let deg = Math.atan2(dx, -dy) * 180 / Math.PI;
      if (deg < 0) deg += 360;
      return (Math.round(deg / 45) * 45) % 360;
    };

    const onMove = (ev: PointerEvent) => {
      const facing = computeFacing(ev);
      if (facing === entry.view.facing) return; // 45° steps — usually no change frame-to-frame
      entry.view = { ...entry.view, facing };
      const now = performance.now();
      if (this.opts.onRotateMove && now - this._lastMoveSent > 60) {
        this._lastMoveSent = now;
        this.opts.onRotateMove(playerId, facing);
      }
    };
    const onUp = (ev: PointerEvent) => {
      const facing = computeFacing(ev);
      entry.view = { ...entry.view, facing };
      entry.el.classList.remove('is-rotating');
      this.draggingId = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      this.opts.onRotateEnd?.(playerId, facing);
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

  /** Apply tokenSize + facing-driven dimensions to the disc. Non-square
   *  footprints have their BOUNDING RECTANGLE rotate with facing (1×2 east
   *  → 2×1 wide rectangle), but the IMAGE inside stays upright at all
   *  times — image rotation was distracting on redraws, so we only
   *  spin the rect + the pointer to indicate direction. On
   *  uncalibrated maps the disc keeps its base CSS size; only image-rot
   *  is suppressed.
   *
   *  The pointer's CSS size scales with the disc's shortest edge (50 %,
   *  clamped to [10, 40] px). That keeps the handle in proportion at
   *  every zoom — it shrinks with the disc on zoom-out and grows on
   *  zoom-in instead of staying fixed-size and dwarfing the icon. */
  private _sizeDisc(entry: TokenEntry, pxPerSq: number | null): void {
    const disc = entry.el.querySelector<HTMLElement>('.pm-token-disc');
    if (!disc) return;
    const tokenSize = entry.view.tokenSize ?? '1x1';
    const dims = parseTokenSize(tokenSize);
    const isSquare = dims.w === dims.h;
    const facing = ((entry.view.facing ?? 0) % 360 + 360) % 360;

    // Non-square footprints (1×2 / 2×3) swap their W/H when facing is closer
    // to horizontal (45–134° or 225–314°) so the long axis aligns with the
    // facing direction. The image inside does NOT rotate — only the rect.
    const facingMod180 = facing % 180;
    const swap = !isSquare && facingMod180 >= 45 && facingMod180 < 135;
    const effW = swap ? dims.h : dims.w;
    const effH = swap ? dims.w : dims.h;

    let halfLongPx: number;   // distance from disc centre to the long-axis edge
    let shortestPx: number;   // disc's shortest edge — drives pointer size
    if (pxPerSq && pxPerSq > 0) {
      const w = Math.max(12, (effW - TOKEN_FOOTPRINT_GAP_SQUARES) * pxPerSq);
      const h = Math.max(12, (effH - TOKEN_FOOTPRINT_GAP_SQUARES) * pxPerSq);
      disc.style.width  = `${w}px`;
      disc.style.height = `${h}px`;
      disc.classList.toggle('pm-token-disc--scaled', true);
      disc.classList.toggle('pm-token-disc--rect', !isSquare);
      halfLongPx = Math.max(w, h) / 2;
      shortestPx = Math.min(w, h);
    } else {
      disc.style.width  = '';
      disc.style.height = '';
      disc.classList.toggle('pm-token-disc--scaled', false);
      disc.classList.toggle('pm-token-disc--rect', !isSquare);
      halfLongPx = 13;   // matches the default 26 px disc
      shortestPx = 26;
    }

    // Image stays upright — clear any lingering rotation from earlier versions.
    const img = disc.querySelector<HTMLImageElement>('img');
    if (img) img.style.transform = '';

    // Pointer size: 50 % of the disc's shortest edge, clamped to a sane
    // range so the handle stays grabbable at very small zooms without
    // dwarfing the disc at very large ones. Square box; the arrowhead +
    // stalk live inside via clip-path.
    const arrowSize = Math.max(10, Math.min(40, shortestPx * 0.5));
    const halfArrow = arrowSize / 2;

    // Pointer placement — the box's bottom edge sits 2 px INSIDE the
    // disc edge along the facing direction. After
    // `rotate(facing) translateY(-D)`, the box centre is at D outward,
    // the bottom at D − halfArrow; for bottom = halfLongPx − 2:
    // D = halfLongPx − 2 + halfArrow.
    let halfHForAnchor: number;
    if (pxPerSq && pxPerSq > 0) {
      halfHForAnchor = Math.max(12, (effH - TOKEN_FOOTPRINT_GAP_SQUARES) * pxPerSq) / 2;
    } else {
      halfHForAnchor = 13;
    }
    entry.el.style.setProperty('--pm-facing', `${facing}deg`);
    entry.el.style.setProperty('--pm-arrow-size', `${arrowSize}px`);
    entry.el.style.setProperty('--pm-pointer-offset', `${-(halfLongPx - 2 + halfArrow)}px`);
    entry.el.style.setProperty('--pm-disc-half-h', `${halfHForAnchor}px`);
  }
}
