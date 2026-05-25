/**
 * CompositeMapEditor — modal surface for arranging tiles in a
 * composite map. v2.14.42 ships the view-only first slice (commit 1
 * of the planned 4):
 *
 *   1. View existing tiles + faint reference grid          ← THIS COMMIT
 *   2. + Add Map button (picks from library, adds a tile)
 *   3. Drag tiles to position (freeform; no snap yet)
 *   4. Select + delete tiles
 *
 * Subsequent passes layer in snap rules (90°/45°/30°/60° rotation,
 * grid-square snap for scaled tiles), layered-mode reveal-below FoW,
 * and the proper Three.js composite render path. Keeping each commit
 * narrow so Alex can sanity-check the UX as it grows.
 *
 * The editor speaks the same UX language as the Text Map editor:
 * dedicated full-screen modal, save/cancel resolution, returns the
 * updated MapAsset (or null on cancel).
 */

import type { MapAsset, CompositeTile } from '../types.ts';
import { MapAssetStore } from '../maps/MapAssetStore.ts';
import { generateId } from '../utils/id.ts';
import { attachGestures } from '../utils/Gestures.ts';

/** Caller-supplied picker for "+ Add Map". Returns null if the user
 *  cancelled the pick. The editor doesn't depend on the picker
 *  implementation — GMApp wires it to MapAssetModal.openForCompositeAddTile. */
export type PickAssetFn = () => Promise<MapAsset | null>;

/** v2.14.59 — snap a free-rotated angle (degrees, may be < 0 or
 *  > 360) to common tile-set angles. Right angles (0/90/180/270)
 *  get a generous ±5° tolerance; finer angles (multiples of 45
 *  and 30) get ±2°. Otherwise returns the angle modulo 360. */
function _snapRotation(deg: number): number {
  const wrap = (a: number) => ((a % 360) + 360) % 360;
  const distTo = (a: number, b: number) => Math.abs(wrap(a - b + 180) - 180);
  // v2.14.106 — Right-angle snap dropped to ±2° (was ±5°) so all
  // three snap families share the same tolerance. Earlier the
  // generous 5° band was making it tricky to land on near-90
  // angles deliberately offset — e.g. 87° kept snapping to 90°.
  const near90 = Math.round(deg / 90) * 90;
  if (distTo(deg, near90) <= 2) return wrap(near90);
  // 45° family (±2°): 45, 135, 225, 315.
  const near45 = Math.round(deg / 45) * 45;
  if (distTo(deg, near45) <= 2) return wrap(near45);
  // 30° family (±2°): 30, 60, 120, 150, 210, 240, 300, 330.
  const near30 = Math.round(deg / 30) * 30;
  if (distTo(deg, near30) <= 2) return wrap(near30);
  return wrap(deg);
}

export class CompositeMapEditor {
  private overlay: HTMLElement | null = null;
  private resolver: ((value: MapAsset | null) => void) | null = null;
  /** Local working copy — mutated by the editor and either saved on
   *  Save or discarded on Cancel. */
  private working: MapAsset | null = null;
  /** Per-tile blob object URLs so re-renders during interaction
   *  don't recreate them. Revoked on close. */
  private tileBlobUrls = new Map<string, string>();
  /** v2.14.62 — per-tile snapshot of {scale, scaleY} captured at
   *  modal-open. The Reset-scale button on the selected tile
   *  restores from here. Cleared on close. */
  private _originalScales = new Map<string, { scale: number | undefined; scaleY: number | undefined }>();
  /** v2.14.91 — undo / redo stacks. Each entry is a deep-cloned
   *  snapshot of compositeTiles + selectedTileId. New mutations
   *  push the BEFORE-state to the undo stack and clear redo;
   *  undo pops one to apply (and pushes current to redo for
   *  re-application). Both clear on modal close so undo never
   *  leaks past a session. */
  private _undoStack: { tiles: CompositeTile[]; selectedTileId: string | null }[] = [];
  private _redoStack: { tiles: CompositeTile[]; selectedTileId: string | null }[] = [];
  /** v2.14.43 — caller-supplied picker for "+ Add Map". */
  private pickAsset: PickAssetFn | null = null;
  /** v2.14.45 — currently-selected tile id. Click a tile to select;
   *  click the canvas background (or another tile) to swap. The
   *  selected tile shows the dashed marquee + bottom-left trashcan
   *  delete handle (Mappadux convention). */
  private selectedTileId: string | null = null;
  /** v2.14.47 — pan / zoom state for the canvas content. Pan in
   *  CSS px (translates the viewport); zoom is a multiplier. */
  private _panX = 0;
  private _panY = 0;
  private _zoom = 1;
  /** v2.14.47 — snap-to-gridline toggle. Defaults on. */
  private _snapToGrid = true;
  /** v2.14.47 — cached master cell size IN NORM (composite 0..1 coords).
   *  Recomputed each render from the first scaled tile; used by
   *  tile drag for grid snapping. Null when no scaled tile is in
   *  the composite yet. */
  private _masterCellNorm: number | null = null;
  /** v2.14.47 — live canvas dims (CSS px). Measured at render time
   *  from the .composite-editor-canvas element so the tile + grid
   *  math always uses the current footprint (the editor canvas now
   *  fills the available space rather than a fixed 1000×750 box). */
  private _canvasW = 0;
  private _canvasH = 0;
  /** Bound once — the canvas's ResizeObserver handler. */
  private _resizeObserver: ResizeObserver | null = null;

  /** Open the editor on a composite-map MapAsset. Resolves with the
   *  mutated asset on Save, or null on Cancel / Esc / X. Throws if
   *  the asset isn't a composite-map. */
  async open(asset: MapAsset, opts?: { pickAsset?: PickAssetFn }): Promise<MapAsset | null> {
    this.pickAsset = opts?.pickAsset ?? null;
    if (asset.source !== 'composite-map') {
      throw new Error('CompositeMapEditor expects a composite-map MapAsset.');
    }
    this.working = { ...asset, compositeTiles: [...(asset.compositeTiles ?? [])] };
    // v2.14.62 — snapshot per-tile scale state so the Reset button
    // can restore it. Deep-copy not needed; we store primitive fields.
    this._originalScales.clear();
    for (const t of this.working.compositeTiles ?? []) {
      this._originalScales.set(t.id, { scale: t.scale, scaleY: t.scaleY });
    }
    // v2.14.91 — start with empty undo/redo stacks. First mutation
    // pushes the initial state automatically (see _pushUndo).
    this._undoStack = [];
    this._redoStack = [];
    this.overlay = this._buildOverlay();
    document.body.appendChild(this.overlay);
    await this._renderTiles();
    this._updateUndoButtons();
    return new Promise<MapAsset | null>((resolve) => { this.resolver = resolve; });
  }

  /** v2.14.91 — Capture the CURRENT state into the undo stack
   *  BEFORE a mutation runs. Clears redo (any new action
   *  invalidates the redo path). Cap at 100 entries so a long
   *  drag session doesn't grow without bound. */
  private _pushUndo(): void {
    if (!this.working) return;
    this._undoStack.push({
      tiles: JSON.parse(JSON.stringify(this.working.compositeTiles ?? [])) as CompositeTile[],
      selectedTileId: this.selectedTileId,
    });
    if (this._undoStack.length > 100) this._undoStack.shift();
    this._redoStack = [];
    this._updateUndoButtons();
  }

  private _snapshotCurrent(): { tiles: CompositeTile[]; selectedTileId: string | null } {
    return {
      tiles: JSON.parse(JSON.stringify(this.working?.compositeTiles ?? [])) as CompositeTile[],
      selectedTileId: this.selectedTileId,
    };
  }

  private async _undo(): Promise<void> {
    if (!this.working || this._undoStack.length === 0) return;
    this._redoStack.push(this._snapshotCurrent());
    const snap = this._undoStack.pop()!;
    this.working = { ...this.working, compositeTiles: snap.tiles };
    this.selectedTileId = snap.selectedTileId;
    this._updateUndoButtons();
    await this._renderTiles();
  }

  private async _redo(): Promise<void> {
    if (!this.working || this._redoStack.length === 0) return;
    this._undoStack.push(this._snapshotCurrent());
    const snap = this._redoStack.pop()!;
    this.working = { ...this.working, compositeTiles: snap.tiles };
    this.selectedTileId = snap.selectedTileId;
    this._updateUndoButtons();
    await this._renderTiles();
  }

  private _updateUndoButtons(): void {
    const undoBtn = this.overlay?.querySelector<HTMLButtonElement>('[data-action="undo"]');
    const redoBtn = this.overlay?.querySelector<HTMLButtonElement>('[data-action="redo"]');
    if (undoBtn) undoBtn.disabled = this._undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = this._redoStack.length === 0;
  }

  private _close(value: MapAsset | null): void {
    for (const url of this.tileBlobUrls.values()) URL.revokeObjectURL(url);
    this.tileBlobUrls.clear();
    this._originalScales.clear();
    this._undoStack = [];
    this._redoStack = [];
    this._closeTileContextMenu();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    this.resolver?.(value);
    this.resolver = null;
  }

  private _buildOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-dialog composite-editor-dialog">
        <div class="modal-header">
          <span class="modal-title">Composite Map Editor — ${this._esc(this.working?.filename ?? '')}</span>
          <button type="button" class="modal-close" data-action="cancel">×</button>
        </div>
        <div class="composite-editor-toolbar">
          <label class="composite-editor-name-label" title="Rename this composite map. Applied on Save.">
            <span>Name:</span>
            <input type="text" class="composite-editor-name-input" value="${this._esc(this.working?.filename ?? '')}" />
          </label>
          <button type="button" class="btn btn--primary btn--sm" data-action="add-map" title="Pick another tile from your library and drop it on the compositor canvas.">+ Add Map</button>
          <!-- v2.14.91 — Undo / Redo pair. Per-modal-session: the
               stack starts empty when the editor opens and clears
               when it closes. Disabled when the relevant stack is
               empty. Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z also work. -->
          <div class="composite-editor-undo-group">
            <button type="button" class="btn btn--ghost btn--xs ui-icon-btn" data-action="undo" title="Undo (Ctrl+Z)" disabled>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>
            </button>
            <button type="button" class="btn btn--ghost btn--xs ui-icon-btn" data-action="redo" title="Redo (Ctrl+Y)" disabled>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/></svg>
            </button>
          </div>
          <span class="composite-editor-mode-label">${this.working?.compositeMode === 'layered' ? 'Layered' : 'Modular'} mode</span>
          <label class="composite-editor-snap-toggle" title="When on, tiles snap their centre to the nearest reference-grid intersection while you drag. Off = freeform placement.">
            <input type="checkbox" data-action="snap" ${this._snapToGrid ? 'checked' : ''} />
            <span>Snap to grid</span>
          </label>
          <button type="button" class="btn btn--ghost btn--xs" data-action="reset-view" title="Reset pan + zoom to defaults.">Reset View</button>
          <span class="composite-editor-hint">Drag tiles to position. Drag empty canvas to pan; wheel / pinch to zoom.</span>
        </div>
        <div class="composite-editor-canvas-wrap">
          <div class="composite-editor-canvas">
            <div class="composite-editor-viewport">
              <svg class="composite-editor-grid" xmlns="http://www.w3.org/2000/svg"></svg>
              <div class="composite-editor-tiles"></div>
            </div>
          </div>
        </div>
        <div class="composite-editor-footer">
          <button type="button" class="btn btn--ghost btn--sm" data-action="cancel">Cancel</button>
          <button type="button" class="btn btn--primary btn--sm" data-action="save">Save</button>
        </div>
      </div>
    `;

    overlay.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset['action'];
        if (action === 'save') {
          if (this.working) {
            // v2.14.51 — capture canvas aspect for the rasteriser.
            // v2.14.53 — also commit any rename done in the Name input.
            const nameInput = overlay.querySelector<HTMLInputElement>('.composite-editor-name-input');
            const nextName = nameInput?.value.trim();
            this.working = {
              ...this.working,
              ...(this._canvasH > 0 ? { compositeAspect: this._canvasW / this._canvasH } : {}),
              ...(nextName ? { filename: nextName } : {}),
            };
          }
          this._close(this.working);
        } else if (action === 'add-map') {
          void this._handleAddMap();
        } else if (action === 'reset-view') {
          this._panX = 0; this._panY = 0; this._zoom = 1;
          this._applyTransform();
        } else if (action === 'undo') {
          void this._undo();
        } else if (action === 'redo') {
          void this._redo();
        } else if (action === 'cancel') {
          this._close(null);
        }
      });
    });
    // v2.14.47 — snap-to-grid checkbox.
    const snapEl = overlay.querySelector<HTMLInputElement>('input[data-action="snap"]');
    snapEl?.addEventListener('change', () => {
      this._snapToGrid = snapEl.checked;
    });

    // v2.14.91 — Ctrl+Z / Cmd+Z = undo; Ctrl+Y or Ctrl+Shift+Z = redo.
    // Bound at document level so the shortcut works regardless of
    // which inner element has focus.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        this._close(null);
        return;
      }
      if (!(ev.ctrlKey || ev.metaKey)) return;
      const k = ev.key.toLowerCase();
      // Don't intercept while the user's typing in an input — they
      // expect native browser undo on text fields.
      const target = ev.target as Element | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (k === 'z' && !ev.shiftKey) {
        ev.preventDefault();
        void this._undo();
      } else if ((k === 'z' && ev.shiftKey) || k === 'y') {
        ev.preventDefault();
        void this._redo();
      }
    };
    document.addEventListener('keydown', onKey);

    return overlay;
  }

  /** Paint the tiles + reference grid for the current working copy.
   *  v2.14.47 — canvas dims measured live; first call also wires
   *  pan/zoom gestures + a ResizeObserver so the canvas always
   *  reflects the available space and tiles re-render to suit. */
  private async _renderTiles(): Promise<void> {
    const tilesEl = this.overlay?.querySelector<HTMLElement>('.composite-editor-tiles');
    const gridEl  = this.overlay?.querySelector<SVGElement>('.composite-editor-grid');
    const canvasEl   = this.overlay?.querySelector<HTMLElement>('.composite-editor-canvas');
    const viewportEl = this.overlay?.querySelector<HTMLElement>('.composite-editor-viewport');
    if (!tilesEl || !gridEl || !canvasEl || !viewportEl) return;

    // Measure live so the editor uses whatever footprint the layout
    // gave it (toolbar / footer subtract from the dialog's space).
    const rect = canvasEl.getBoundingClientRect();
    this._canvasW = Math.max(1, rect.width);
    this._canvasH = Math.max(1, rect.height);

    // First-render-only setup: bind canvas-background click → deselect,
    // bind pan/zoom gestures, observe canvas resizes.
    if (!canvasEl.dataset['initBound']) {
      canvasEl.dataset['initBound'] = 'true';
      canvasEl.addEventListener('click', (ev) => {
        // Only deselect if the click hit canvas/viewport empty space,
        // not a tile (its own handler stopPropagation's).
        if ((ev.target as Element).closest('.composite-editor-tile')) return;
        void this._deselect();
      });
      this._bindBackgroundGestures(canvasEl);
      // Re-render on resize so live dims stay in sync.
      this._resizeObserver = new ResizeObserver(() => {
        const r = canvasEl.getBoundingClientRect();
        if (r.width === this._canvasW && r.height === this._canvasH) return;
        void this._renderTiles();
      });
      this._resizeObserver.observe(canvasEl);
    }

    // The viewport is the same logical size as the canvas; pan/zoom
    // happens via a CSS transform on it. Tiles + grid live inside.
    viewportEl.style.width  = `${this._canvasW}px`;
    viewportEl.style.height = `${this._canvasH}px`;
    this._applyTransform();

    gridEl.setAttribute('viewBox', `0 0 ${this._canvasW} ${this._canvasH}`);
    gridEl.setAttribute('width',  String(this._canvasW));
    gridEl.setAttribute('height', String(this._canvasH));
    tilesEl.innerHTML = '';

    // Find the first SCALED tile — sets the compositor's master grid.
    const tiles = this.working?.compositeTiles ?? [];
    let masterCellPx: number | null = null;
    this._masterCellNorm = null;
    for (const tile of tiles) {
      const tileAsset = await MapAssetStore.get(tile.mapAssetId);
      if (!tileAsset) continue;
      if (tileAsset.pixelsPerSquare && tileAsset.imageWidth) {
        const tileW = (tile.scale ?? 1) * this._canvasW;
        const cellsAcross = tileAsset.imageWidth / tileAsset.pixelsPerSquare;
        masterCellPx = tileW / cellsAcross;
        this._masterCellNorm = masterCellPx / this._canvasW;
        break;
      }
    }
    this._drawReferenceGrid(gridEl, masterCellPx);

    for (const tile of tiles) {
      const node = await this._renderTile(tile);
      if (node) tilesEl.appendChild(node);
    }
  }

  /** Apply current pan/zoom to the viewport via CSS transform. */
  private _applyTransform(): void {
    const viewportEl = this.overlay?.querySelector<HTMLElement>('.composite-editor-viewport');
    if (!viewportEl) return;
    viewportEl.style.transform       = `translate(${this._panX}px, ${this._panY}px) scale(${this._zoom})`;
    viewportEl.style.transformOrigin = '0 0';
  }

  /** v2.14.47 — pan/zoom gestures on the canvas. Tile drags still
   *  win on tile targets (shouldStart filters); background drags
   *  pan; wheel zooms around cursor; two-finger zooms + pans. */
  private _bindBackgroundGestures(canvasEl: HTMLElement): void {
    let panStart = { x: 0, y: 0 };
    attachGestures(canvasEl, {
      shouldStart: (e) => {
        // Tile drags own the tile element. Everything else pans.
        return !(e.target as Element).closest('.composite-editor-tile');
      },
      onDrag: (e) => {
        if (e.phase === 'start') {
          panStart = { x: this._panX, y: this._panY };
          canvasEl.style.cursor = 'grabbing';
        } else if (e.phase === 'move') {
          this._panX = panStart.x + e.dx;
          this._panY = panStart.y + e.dy;
          this._applyTransform();
        } else {
          canvasEl.style.cursor = 'grab';
        }
      },
      onWheel: ({ clientX, clientY, factor }) => {
        // Zoom around the cursor: keep the world point under it pinned.
        // v2.14.48 — invert factor. attachGestures' convention is
        // factor < 1 = "zoom in" semantically (shrinking view) so the
        // calibration modal's viewBox math works. But the compositor
        // applies factor to a CSS transform scale where < 1 visibly
        // SHRINKS content. Multiplying directly produced reversed
        // feel (wheel-up zoomed OUT). Dividing fixes the direction
        // to match every other zoomable surface.
        const rect = canvasEl.getBoundingClientRect();
        const cx = clientX - rect.left;
        const cy = clientY - rect.top;
        const worldX = (cx - this._panX) / this._zoom;
        const worldY = (cy - this._panY) / this._zoom;
        const newZoom = Math.max(0.2, Math.min(8, this._zoom / factor));
        this._panX = cx - worldX * newZoom;
        this._panY = cy - worldY * newZoom;
        this._zoom = newZoom;
        this._applyTransform();
      },
      onTwoFinger: (e) => {
        // Two-finger pinch + drag — common touch gesture.
        if (e.phase === 'start') {
          panStart = { x: this._panX, y: this._panY };
        } else if (e.phase === 'move') {
          // Zoom around the gesture's starting midpoint relative to canvas.
          const rect = canvasEl.getBoundingClientRect();
          const cx = e.midX - rect.left;
          const cy = e.midY - rect.top;
          const worldX = (cx - panStart.x) / this._zoom;
          const worldY = (cy - panStart.y) / this._zoom;
          const targetZoom = Math.max(0.2, Math.min(8, this._zoom * e.scale));
          this._panX = cx - worldX * targetZoom + e.panDx;
          this._panY = cy - worldY * targetZoom + e.panDy;
          this._zoom = targetZoom;
          this._applyTransform();
        }
      },
    });
    canvasEl.style.cursor = 'grab';
  }

  /** Faint grey grid centred on the canvas, extending well beyond
   *  the editor's bounds so it reads as a visual guide rather than a
   *  hard limit. v2.14.52 — was previously clipped to canvasW/H;
   *  Alex's note: 'the checkerboard is not the limit, it is a
   *  guide; needs to extend the full pane'. Now drawn over a 5× area
   *  so panning / zooming out reveals more grid in every direction.
   *  Tiles still position in canvas-norm (0..1) space; placement
   *  doesn't change, only the visual extent of the helper grid. */
  private _drawReferenceGrid(svg: SVGElement, cellPx: number | null): void {
    svg.innerHTML = '';
    if (!cellPx || cellPx < 4) return;
    const cx = this._canvasW / 2;
    const cy = this._canvasH / 2;
    const extentX = this._canvasW * 3;  // half-width either side of cx
    const extentY = this._canvasH * 3;
    const minX = cx - extentX;
    const maxX = cx + extentX;
    const minY = cy - extentY;
    const maxY = cy + extentY;
    const lines: string[] = [];
    for (let x = cx; x <= maxX; x += cellPx) {
      lines.push(`<line x1="${x}" y1="${minY}" x2="${x}" y2="${maxY}" />`);
    }
    for (let x = cx - cellPx; x >= minX; x -= cellPx) {
      lines.push(`<line x1="${x}" y1="${minY}" x2="${x}" y2="${maxY}" />`);
    }
    for (let y = cy; y <= maxY; y += cellPx) {
      lines.push(`<line x1="${minX}" y1="${y}" x2="${maxX}" y2="${y}" />`);
    }
    for (let y = cy - cellPx; y >= minY; y -= cellPx) {
      lines.push(`<line x1="${minX}" y1="${y}" x2="${maxX}" y2="${y}" />`);
    }
    svg.innerHTML = lines.join('');
  }

  /** Render a single tile as an absolutely-positioned <img> inside
   *  the composite canvas. Position from tile.x/y (composite-norm);
   *  size from tile.scale * canvasW preserving the asset's aspect.
   *  v2.14.44 — also binds a pointerdown drag handler that mutates
   *  tile.x/y while the pointer moves; no snap rules yet (freeform). */
  private async _renderTile(tile: CompositeTile): Promise<HTMLElement | null> {
    const tileAsset = await MapAssetStore.get(tile.mapAssetId);
    if (!tileAsset) return null;
    const blob = await MapAssetStore.getBlob(tileAsset);
    if (!blob) return null;
    let url = this.tileBlobUrls.get(tile.id);
    if (!url) {
      url = URL.createObjectURL(blob);
      this.tileBlobUrls.set(tile.id, url);
    }

    const aspect = (tileAsset.imageWidth && tileAsset.imageHeight)
      ? tileAsset.imageWidth / tileAsset.imageHeight
      : 1;
    const tileW  = (tile.scale ?? 1) * this._canvasW;
    // v2.14.62 — if the user has unlocked aspect + dragged height
    // independently, scaleY (fraction-of-canvasH) is set + wins
    // over native aspect. Otherwise tileH derives from the asset's
    // native aspect (locked behaviour, the default).
    const tileH  = tile.scaleY != null
      ? tile.scaleY * this._canvasH
      : tileW / aspect;
    const left   = tile.x * this._canvasW - tileW / 2;
    const top    = tile.y * this._canvasH - tileH / 2;

    const isSelected = tile.id === this.selectedTileId;
    const el = document.createElement('div');
    el.className = `composite-editor-tile${isSelected ? ' composite-editor-tile--selected' : ''}`;
    el.dataset['tileId'] = tile.id;
    el.style.left      = `${left}px`;
    el.style.top       = `${top}px`;
    el.style.width     = `${tileW}px`;
    el.style.height    = `${tileH}px`;
    // v2.14.59 — outer transform = rotation. Inner content gets the
    // flip scale so the chrome (trash / flip btns / rotation handle)
    // isn't mirrored along with the image.
    el.style.transform = `rotate(${tile.rotation}deg)`;
    const sx = tile.flipH ? -1 : 1;
    const sy = tile.flipV ? -1 : 1;
    el.innerHTML = `
      <div class="composite-editor-tile-content" style="transform: scale(${sx}, ${sy});">
        <img src="${url}" alt="" draggable="false" />
      </div>
    `;
    if (isSelected) {
      // v2.14.45 — Mappadux convention: red trashcan handle pinned
      // at bottom-left apex of the selected object.
      const trash = document.createElement('button');
      trash.type = 'button';
      trash.className = 'composite-editor-tile-trash';
      trash.title = 'Delete this tile from the composite.';
      trash.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>
          <line x1="10" y1="11" x2="10" y2="17"/>
          <line x1="14" y1="11" x2="14" y2="17"/>
          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
        </svg>`;
      trash.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); });
      trash.addEventListener('click', (ev) => { ev.stopPropagation(); void this._deleteTile(tile.id); });
      el.appendChild(trash);

      // v2.14.59 — Flip H + Flip V buttons on the top corners.
      const flipH = document.createElement('button');
      flipH.type = 'button';
      flipH.className = `composite-editor-tile-flip composite-editor-tile-flip--h${tile.flipH ? ' is-active' : ''}`;
      flipH.title = 'Mirror this tile horizontally (left ↔ right).';
      flipH.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="6 4 2 12 6 20"/>
          <polyline points="18 4 22 12 18 20"/>
          <line x1="12" y1="2" x2="12" y2="22"/>
        </svg>`;
      flipH.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); });
      flipH.addEventListener('click', (ev) => { ev.stopPropagation(); void this._toggleFlip(tile.id, 'h'); });
      el.appendChild(flipH);

      const flipV = document.createElement('button');
      flipV.type = 'button';
      flipV.className = `composite-editor-tile-flip composite-editor-tile-flip--v${tile.flipV ? ' is-active' : ''}`;
      flipV.title = 'Mirror this tile vertically (top ↔ bottom).';
      flipV.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="4 6 12 2 20 6"/>
          <polyline points="4 18 12 22 20 18"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
        </svg>`;
      flipV.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); });
      flipV.addEventListener('click', (ev) => { ev.stopPropagation(); void this._toggleFlip(tile.id, 'v'); });
      el.appendChild(flipV);

      // v2.14.59 — Rotation handle: ball above top-centre, dashed
      // stem connecting to the tile edge. Drag to rotate; snaps to
      // 0/90/180/270 (±5°) and 30/45/60/etc (±2°).
      const rotStem = document.createElement('div');
      rotStem.className = 'composite-editor-tile-rotate-stem';
      el.appendChild(rotStem);
      const rotHandle = document.createElement('button');
      rotHandle.type = 'button';
      rotHandle.className = 'composite-editor-tile-rotate-handle';
      rotHandle.title = 'Drag to rotate this tile. Snaps to common angles.';
      rotHandle.innerHTML = `
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-3-6.7"/>
          <polyline points="21 4 21 9 16 9"/>
        </svg>`;
      this._bindRotateDrag(rotHandle, el, tile.id);
      el.appendChild(rotHandle);

      // v2.14.62 — Manual resize cluster, anchored bottom-right:
      //   [reset]        ← top of the stack
      //   [lock-aspect]  ← middle
      //   [resize-grab]  ← bottom-right corner (the drag handle)
      // The lock-aspect toggle defaults ON (tile.lockAspect ?? true).
      // Reset restores the tile's scale + scaleY to the values it had
      // when the editor opened (or 0.25 if it was added in this session).
      const locked = (tile.lockAspect ?? true);

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'composite-editor-tile-reset';
      resetBtn.title = 'Reset this tile\'s scale to the value it had when you opened the editor (or the default for tiles added this session).';
      resetBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7"/>
          <polyline points="3 4 3 9 8 9"/>
        </svg>`;
      resetBtn.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); });
      resetBtn.addEventListener('click', (ev) => { ev.stopPropagation(); void this._resetScale(tile.id); });
      el.appendChild(resetBtn);

      const lockBtn = document.createElement('button');
      lockBtn.type = 'button';
      lockBtn.className = `composite-editor-tile-lock${locked ? ' is-active' : ''}`;
      lockBtn.title = locked
        ? 'Aspect ratio LOCKED — dragging the resize handle keeps the tile\'s native proportions. Click to unlock and resize width / height independently.'
        : 'Aspect ratio UNLOCKED — width and height resize independently. Click to re-lock to native proportions.';
      lockBtn.innerHTML = locked
        ? `
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="1"/>
            <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
          </svg>`
        : `
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="1"/>
            <path d="M8 11V7a4 4 0 0 1 7.5-2"/>
          </svg>`;
      lockBtn.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); });
      lockBtn.addEventListener('click', (ev) => { ev.stopPropagation(); void this._toggleLockAspect(tile.id); });
      el.appendChild(lockBtn);

      const resizeHandle = document.createElement('button');
      resizeHandle.type = 'button';
      resizeHandle.className = 'composite-editor-tile-resize';
      resizeHandle.title = 'Drag to resize this tile. Lock the aspect ratio (icon above) to keep native proportions.';
      resizeHandle.innerHTML = `
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="9 21 21 21 21 9"/>
          <line x1="21" y1="21" x2="11" y2="11"/>
        </svg>`;
      this._bindResizeDrag(resizeHandle, el, tile.id, tileAsset.imageWidth, tileAsset.imageHeight);
      el.appendChild(resizeHandle);
    }
    this._bindTileDrag(el, tile.id);
    el.addEventListener('click', (ev) => {
      // Select on click. The drag handler also fires pointerdown, but
      // a click only synthesises if the pointer didn't move far.
      ev.stopPropagation();
      void this._selectTile(tile.id);
    });
    // v2.14.66 — right-click any tile → select + open layer context
    // menu. Array index = z-order (last drawn = on top), so the menu
    // actions reorder compositeTiles in place; the rasteriser inherits
    // the new order on save since it draws in array order too.
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void this._openTileContextMenu(tile.id, ev.clientX, ev.clientY);
    });
    return el;
  }

  /** Click a tile → it becomes the selected one; click again on the
   *  same tile → no-op (stays selected); click another → swap;
   *  click empty canvas background → deselect. */
  private async _selectTile(id: string): Promise<void> {
    if (this.selectedTileId === id) return;
    this.selectedTileId = id;
    await this._renderTiles();
  }

  private async _deselect(): Promise<void> {
    if (this.selectedTileId === null) return;
    this.selectedTileId = null;
    await this._renderTiles();
  }

  /** v2.14.59 — toggle a tile's horizontal or vertical mirror flag
   *  and re-render so the inner content scale + button active-state
   *  refresh. */
  private async _toggleFlip(id: string, axis: 'h' | 'v'): Promise<void> {
    const tile = this._findTile(id);
    if (!tile) return;
    this._pushUndo();
    if (axis === 'h') tile.flipH = !tile.flipH;
    else              tile.flipV = !tile.flipV;
    await this._renderTiles();
  }

  /** v2.14.59 — rotation drag. Pointerdown on the rotate handle →
   *  compute angle from tile centre to pointer on every move → set
   *  tile.rotation, apply snap. Tile centre is the bounding-rect
   *  centre (rotation pivot is centre via transform-origin default). */
  private _bindRotateDrag(handle: HTMLElement, tileEl: HTMLElement, tileId: string): void {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const tile = this._findTile(tileId);
      if (!tile) return;
      // v2.14.91 — snapshot BEFORE the drag so undo reverts to the
      // pre-rotation state once the drag commits.
      this._pushUndo();
      handle.setPointerCapture(e.pointerId);
      const rect = tileEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top  + rect.height / 2;
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - cx;
        const dy = ev.clientY - cy;
        // atan2(dy, dx) in screen coords (Y goes DOWN). Convert to
        // CSS rotation degrees with the "rotation 0 = handle up"
        // convention: rotation = atan2 + 90.
        const deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        const snapped = _snapRotation(deg);
        tile.rotation = snapped;
        // Live-update transform without a full re-render.
        tileEl.style.transform = `rotate(${snapped}deg)`;
      };
      const onUp = (ev: PointerEvent) => {
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup',     onUp);
        handle.removeEventListener('pointercancel', onUp);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup',     onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  /** v2.14.62 — flip the per-tile aspect lock + re-render so the
   *  icon swaps and the next resize drag uses the new mode. */
  private async _toggleLockAspect(id: string): Promise<void> {
    const tile = this._findTile(id);
    if (!tile) return;
    this._pushUndo();
    const currentlyLocked = (tile.lockAspect ?? true);
    tile.lockAspect = !currentlyLocked;
    // Re-locking after a free-aspect drag: drop scaleY so the next
    // render goes back to native aspect (otherwise the tile would
    // stay "stretched" with no visible cause). The user's width
    // (tile.scale) is preserved.
    if (tile.lockAspect) {
      delete tile.scaleY;
    }
    await this._renderTiles();
  }

  /** v2.14.62 — restore the tile's scale + scaleY to the values
   *  captured when the editor opened (or 0.25 for tiles added this
   *  session). Position / rotation / flip are NOT touched. */
  private async _resetScale(id: string): Promise<void> {
    const tile = this._findTile(id);
    if (!tile) return;
    this._pushUndo();
    const snap = this._originalScales.get(id);
    if (snap) {
      if (snap.scale  == null) delete tile.scale;  else tile.scale  = snap.scale;
      if (snap.scaleY == null) delete tile.scaleY; else tile.scaleY = snap.scaleY;
    }
    await this._renderTiles();
  }

  /** v2.14.62 — resize drag. Bottom-right handle; pointerdown
   *  captures the current scale + cursor; pointermove updates
   *  scale (and scaleY when unlocked) live. The handle math uses
   *  the tile's own corner-to-pointer distance so the resize feels
   *  pinned to the dragged corner regardless of rotation. */
  private _bindResizeDrag(
    handle:    HTMLElement,
    tileEl:    HTMLElement,
    tileId:    string,
    nativeW:   number | undefined,
    nativeH:   number | undefined,
  ): void {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const tile = this._findTile(tileId);
      if (!tile) return;
      // v2.14.91 — snapshot BEFORE the resize so undo reverts to
      // the pre-drag scale state.
      this._pushUndo();
      handle.setPointerCapture(e.pointerId);
      // Snapshot start state — drag math is relative so partial drags
      // compound cleanly with later drags.
      const startScale  = tile.scale ?? 1;
      const startScaleY = tile.scaleY;
      const aspect = (nativeW && nativeH) ? (nativeW / nativeH) : 1;
      // Distance from tile centre to the resize-handle's start point,
      // in CSS px / current zoom. We measure with respect to the
      // tile's centre + the cursor's offset from start so the corner
      // tracks the cursor even when tile.rotation isn't zero.
      const tileRect = tileEl.getBoundingClientRect();
      const cx = tileRect.left + tileRect.width / 2;
      const cy = tileRect.top  + tileRect.height / 2;
      const startCornerDx = e.clientX - cx;
      const startCornerDy = e.clientY - cy;
      // Inverse-rotate the corner vector into the tile's local frame
      // so we can map cursor motion to width / height deltas cleanly.
      const rotRad = -(tile.rotation ?? 0) * Math.PI / 180;
      const cos = Math.cos(rotRad);
      const sin = Math.sin(rotRad);
      const startLocalX = startCornerDx * cos - startCornerDy * sin;
      const startLocalY = startCornerDx * sin + startCornerDy * cos;
      // CSS px → norm conversion uses live dims / current zoom.
      const cssToNormW = 1 / (this._canvasW * this._zoom);
      const cssToNormH = 1 / (this._canvasH * this._zoom);
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - cx;
        const dy = ev.clientY - cy;
        const localX = dx * cos - dy * sin;
        const localY = dx * sin + dy * cos;
        // Width / height multipliers from local-frame motion: how
        // much the tile's HALF-extent in each axis grew.
        const wMult = startLocalX !== 0 ? localX / startLocalX : 1;
        const hMult = startLocalY !== 0 ? localY / startLocalY : 1;
        const locked = (tile.lockAspect ?? true);
        if (locked) {
          // Uniform scale: pick the larger multiplier so the corner
          // stays under the cursor (the dominant axis wins).
          const m = Math.max(0.01, Math.max(wMult, hMult));
          tile.scale = Math.max(0.01, startScale * m);
          delete tile.scaleY;
          const newW = tile.scale * this._canvasW;
          const newH = newW / aspect;
          tileEl.style.width  = `${newW}px`;
          tileEl.style.height = `${newH}px`;
          tileEl.style.left   = `${tile.x * this._canvasW - newW / 2}px`;
          tileEl.style.top    = `${tile.y * this._canvasH - newH / 2}px`;
        } else {
          tile.scale = Math.max(0.01, startScale * Math.max(0.01, wMult));
          // scaleY baseline: existing scaleY, or derived from native
          // aspect at start. Multiply by hMult.
          const baselineScaleY = startScaleY ?? ((startScale * this._canvasW / aspect) / this._canvasH);
          tile.scaleY = Math.max(0.01, baselineScaleY * Math.max(0.01, hMult));
          const newW = tile.scale * this._canvasW;
          const newH = tile.scaleY * this._canvasH;
          tileEl.style.width  = `${newW}px`;
          tileEl.style.height = `${newH}px`;
          tileEl.style.left   = `${tile.x * this._canvasW - newW / 2}px`;
          tileEl.style.top    = `${tile.y * this._canvasH - newH / 2}px`;
        }
        // Touch the conversion locals so TS doesn't flag them unused
        // in builds; they're kept for future "snap resize to grid"
        // work (would convert px deltas to norm cells).
        void cssToNormW; void cssToNormH;
      };
      const onUp = (ev: PointerEvent) => {
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup',     onUp);
        handle.removeEventListener('pointercancel', onUp);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup',     onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  /** v2.14.66 — Open the layer-reorder context menu pinned at the
   *  cursor. Selects the tile too (matches the right-click-selects
   *  convention used by most graphics apps). Menu actions reorder
   *  the compositeTiles array in place; since both the editor
   *  paint loop and the rasteriser iterate in array order, the new
   *  z-stack takes effect immediately + survives Save. */
  private async _openTileContextMenu(id: string, clientX: number, clientY: number): Promise<void> {
    await this._selectTile(id);
    const tiles = this.working?.compositeTiles ?? [];
    const idx = tiles.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const total = tiles.length;
    // Position of this tile in the z-stack — last in array = on top,
    // first = at the back. Display as 1..N from the back for the GM
    // (matches "send to back" = 1, "bring to front" = N).
    const zFromBack = idx + 1;

    // Close any previously-open menu before opening a new one.
    this._closeTileContextMenu();

    const menu = document.createElement('div');
    menu.className = 'composite-editor-tile-context-menu';
    menu.dataset['for'] = id;
    const atFront = idx === total - 1;
    const atBack  = idx === 0;
    menu.innerHTML = `
      <div class="composite-editor-context-header">Layer ${zFromBack} / ${total}</div>
      <button type="button" data-act="front" ${atFront ? 'disabled' : ''}>Bring to Front</button>
      <button type="button" data-act="forward" ${atFront ? 'disabled' : ''}>Bring Forward</button>
      <button type="button" data-act="backward" ${atBack ? 'disabled' : ''}>Send Backward</button>
      <button type="button" data-act="back" ${atBack ? 'disabled' : ''}>Send to Back</button>
      <div class="composite-editor-context-sep"></div>
      <button type="button" data-act="duplicate" title="Add a new tile that reuses the same map image (no extra storage). Position / rotation / scale are copied with a slight offset so the duplicate doesn't perfectly overlap.">Duplicate Tile</button>
      <button type="button" data-act="delete" class="composite-editor-context-danger">Delete tile</button>
    `;
    document.body.appendChild(menu);

    // Position inside viewport — flip left / up if the menu would
    // overflow on the right / bottom edges.
    const menuRect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = (clientX + menuRect.width  > vw) ? Math.max(4, vw - menuRect.width  - 4) : clientX;
    const top  = (clientY + menuRect.height > vh) ? Math.max(4, vh - menuRect.height - 4) : clientY;
    menu.style.left = `${left}px`;
    menu.style.top  = `${top}px`;

    menu.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const act = btn.dataset['act'];
        this._closeTileContextMenu();
        if (act === 'delete')         void this._deleteTile(id);
        else if (act === 'front')     void this._moveTileInStack(id, 'front');
        else if (act === 'forward')   void this._moveTileInStack(id, 'forward');
        else if (act === 'backward')  void this._moveTileInStack(id, 'backward');
        else if (act === 'back')      void this._moveTileInStack(id, 'back');
        else if (act === 'duplicate') void this._duplicateTile(id);
      });
    });

    // Outside-click + Esc close. Capture-phase + raf so the click
    // that opened the menu doesn't immediately close it.
    requestAnimationFrame(() => {
      const onDocClick = (ev: MouseEvent) => {
        if (!menu.contains(ev.target as Node)) {
          this._closeTileContextMenu();
        }
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') this._closeTileContextMenu();
      };
      document.addEventListener('mousedown', onDocClick, true);
      document.addEventListener('keydown', onKey);
      menu.dataset['cleanup'] = '1';
      (menu as unknown as { _cleanup: () => void })._cleanup = () => {
        document.removeEventListener('mousedown', onDocClick, true);
        document.removeEventListener('keydown', onKey);
      };
    });
  }

  /** Remove the tile context menu if one is open. Cleans up its
   *  outside-click + Esc listeners. */
  private _closeTileContextMenu(): void {
    const menu = document.querySelector<HTMLElement>('.composite-editor-tile-context-menu');
    if (!menu) return;
    const cleanup = (menu as unknown as { _cleanup?: () => void })._cleanup;
    if (cleanup) cleanup();
    menu.remove();
  }

  /** v2.14.94 — Right-click → Duplicate Tile. Reuses the same
   *  underlying mapAssetId so there's NO asset copy (zero extra
   *  bytes in storage / on the wire). Clones the tile's position,
   *  rotation, scale, flip + lock-aspect state, then nudges the
   *  duplicate's centre by a small offset so it doesn't perfectly
   *  overlap. New tile lands on TOP of the z-stack so the GM can
   *  immediately see + drag it. */
  private async _duplicateTile(id: string): Promise<void> {
    if (!this.working) return;
    const tiles = this.working.compositeTiles ?? [];
    const src = tiles.find((t) => t.id === id);
    if (!src) return;
    this._pushUndo();
    // Cheap drift: 3% of canvas norm in both axes. Small enough that
    // the duplicate reads as "the same tile, just moved over a tad",
    // big enough that the GM sees it landed.
    const offset = 0.03;
    const dup: CompositeTile = {
      ...src,
      id: generateId(),
      x: Math.max(0.02, Math.min(0.98, src.x + offset)),
      y: Math.max(0.02, Math.min(0.98, src.y + offset)),
    };
    // Carry the source tile's reset-scale baseline forward so a
    // later "reset scale" on the duplicate restores the same value
    // the source would restore to (not a fresh "from when this
    // tile was added" baseline).
    const srcSnap = this._originalScales.get(src.id);
    this._originalScales.set(dup.id, srcSnap
      ? { scale: srcSnap.scale, scaleY: srcSnap.scaleY }
      : { scale: src.scale, scaleY: src.scaleY });
    this.working = {
      ...this.working,
      compositeTiles: [...tiles, dup],
    };
    this.selectedTileId = dup.id;
    await this._renderTiles();
  }

  /** v2.14.66 — Reorder a tile within compositeTiles. Convention:
   *  array index = z-order, last = on top.
   *    'front'    → move to end of array
   *    'forward'  → swap with next neighbour
   *    'backward' → swap with previous neighbour
   *    'back'     → move to start of array
   *  No-op if the tile is already at the limit for the requested
   *  direction. */
  private async _moveTileInStack(id: string, dir: 'front' | 'forward' | 'backward' | 'back'): Promise<void> {
    if (!this.working) return;
    const tiles = [...(this.working.compositeTiles ?? [])];
    const idx = tiles.findIndex((t) => t.id === id);
    if (idx < 0) return;
    this._pushUndo();
    const [removed] = tiles.splice(idx, 1);
    if (!removed) return;
    let newIdx = idx;
    if      (dir === 'front')    newIdx = tiles.length;       // last slot after splice
    else if (dir === 'back')     newIdx = 0;
    else if (dir === 'forward')  newIdx = Math.min(tiles.length, idx + 1);
    else if (dir === 'backward') newIdx = Math.max(0, idx - 1);
    tiles.splice(newIdx, 0, removed);
    this.working = { ...this.working, compositeTiles: tiles };
    await this._renderTiles();
  }

  /** Remove the tile from the working copy + re-render. */
  private async _deleteTile(id: string): Promise<void> {
    if (!this.working) return;
    this._pushUndo();
    const tiles = (this.working.compositeTiles ?? []).filter((t) => t.id !== id);
    this.working = { ...this.working, compositeTiles: tiles };
    if (this.selectedTileId === id) this.selectedTileId = null;
    // Drop the blob URL — gone for good unless re-added.
    const url = this.tileBlobUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      this.tileBlobUrls.delete(id);
    }
    await this._renderTiles();
  }

  /** v2.14.44 — drag-to-position. Captures the pointer; computes a
   *  delta from the drag-start position (in CSS px of the editor
   *  canvas) and converts to composite-norm coords for mutation.
   *  Live-updates the tile element's CSS during the drag.
   *  v2.14.47 — accounts for current zoom; applies snap-to-grid when
   *  the toggle is on and a master cell size is known. */
  private _bindTileDrag(el: HTMLElement, tileId: string): void {
    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const tile = this._findTile(tileId);
      if (!tile) return;
      // v2.14.91 — snapshot BEFORE the position drag so undo reverts
      // to the pre-drag location.
      this._pushUndo();
      const startX = e.clientX;
      const startY = e.clientY;
      const startNX = tile.x;
      const startNY = tile.y;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
      // CSS px → norm uses live canvas dim ÷ current zoom so motion
      // matches the cursor regardless of pan/zoom state.
      const cssToNormX = 1 / (this._canvasW * this._zoom);
      const cssToNormY = 1 / (this._canvasH * this._zoom);

      // v2.14.83 — Centre-snap targets. Captured ONCE at drag start
      // (matching tiles don't change during a single drag) — every
      // tile with the same on-screen pixel dimensions (within 2%
      // tolerance) becomes a snap point at its centre. The common
      // layered-composite case is two tiles of identical size
      // stacked perfectly; this makes that snap-into-place feel
      // automatic without the GM having to nudge.
      const draggingW = parseFloat(el.style.width);
      const draggingH = parseFloat(el.style.height);
      const matchTol  = 0.02;
      const centreSnaps: { x: number; y: number }[] = [];
      const allTileEls = this.overlay?.querySelectorAll<HTMLElement>('.composite-editor-tile') ?? [];
      for (const otherEl of Array.from(allTileEls)) {
        if (otherEl === el) continue;
        const otherW = parseFloat(otherEl.style.width);
        const otherH = parseFloat(otherEl.style.height);
        if (!isFinite(otherW) || !isFinite(otherH) || otherW <= 0 || otherH <= 0) continue;
        if (Math.abs(otherW - draggingW) / draggingW > matchTol) continue;
        if (Math.abs(otherH - draggingH) / draggingH > matchTol) continue;
        const otherId = otherEl.dataset['tileId'];
        if (!otherId) continue;
        const otherTile = this._findTile(otherId);
        if (!otherTile) continue;
        centreSnaps.push({ x: otherTile.x, y: otherTile.y });
      }
      // Snap radius in norm — generous enough to "magnet" the tile
      // when the GM is clearly going for the same centre, tight
      // enough that they can still freeform-place adjacent.
      const centreSnapRadius = 0.04;

      const onMove = (ev: PointerEvent) => {
        const dxNorm = (ev.clientX - startX) * cssToNormX;
        const dyNorm = (ev.clientY - startY) * cssToNormY;
        let nx = startNX + dxNorm;
        let ny = startNY + dyNorm;
        // v2.14.83 — Centre-snap takes priority over grid-snap.
        // If the cursor lands inside the magnet zone around a
        // matching tile's centre, lock to that centre exactly.
        let snappedToCentre = false;
        for (const m of centreSnaps) {
          if (Math.abs(nx - m.x) < centreSnapRadius && Math.abs(ny - m.y) < centreSnapRadius) {
            nx = m.x;
            ny = m.y;
            snappedToCentre = true;
            break;
          }
        }
        // Snap to the master grid if enabled + available — and the
        // centre-snap didn't already lock the position.
        // v2.14.58 — _masterCellNorm is the cell size in X-norm
        // (= cellPx / canvasW). For non-square editor canvases the Y
        // norm equivalent differs (= cellPx / canvasH). Using the
        // X-norm for Y snapped tiles at the wrong spacing — close
        // enough that single placements looked fine, but vertical
        // stacks landed with a fractional-cell gap because the snap
        // grid in Y was at 75%-cell intervals (for a 4:3 canvas)
        // rather than full-cell. Now uses per-axis snap pitches that
        // match the actually-drawn grid pixels.
        if (!snappedToCentre && this._snapToGrid && this._masterCellNorm && this._masterCellNorm > 0 && this._canvasH > 0) {
          const cellNormX = this._masterCellNorm;
          const cellNormY = this._masterCellNorm * (this._canvasW / this._canvasH);
          // Grid origin = canvas centre (matches _drawReferenceGrid).
          nx = Math.round((nx - 0.5) / cellNormX) * cellNormX + 0.5;
          ny = Math.round((ny - 0.5) / cellNormY) * cellNormY + 0.5;
        }
        const tileW = parseFloat(el.style.width);
        const tileH = parseFloat(el.style.height);
        el.style.left = `${nx * this._canvasW - tileW / 2}px`;
        el.style.top  = `${ny * this._canvasH - tileH / 2}px`;
        // Visual indicator: green outline when the tile is locked to
        // a matching centre. Lets the GM SEE the snap engaged.
        el.classList.toggle('composite-editor-tile--centre-snap', snappedToCentre);
        tile.x = nx;
        tile.y = ny;
      };
      const onUp = (ev: PointerEvent) => {
        el.releasePointerCapture(ev.pointerId);
        el.style.cursor = 'grab';
        // v2.14.83 — Clear the centre-snap indicator on drop; the
        // tile keeps its snapped position but the chrome should
        // settle back to its normal selection state.
        el.classList.remove('composite-editor-tile--centre-snap');
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup',     onUp);
        el.removeEventListener('pointercancel', onUp);
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup',     onUp);
      el.addEventListener('pointercancel', onUp);
    });
  }

  /** Find a tile in the working copy by id. Mutating the returned
   *  object mutates the working copy — used by drag-to-position. */
  private _findTile(id: string): CompositeTile | null {
    if (!this.working) return null;
    return (this.working.compositeTiles ?? []).find((t) => t.id === id) ?? null;
  }

  /** v2.14.43 — "+ Add Map" handler. Asks the caller-supplied picker
   *  for an asset; on a pick, append it as a new tile and re-render.
   *  Without a picker (e.g. tests, or wiring not provided) this is
   *  silently a no-op. */
  private async _handleAddMap(): Promise<void> {
    if (!this.pickAsset || !this.working) return;
    const asset = await this.pickAsset();
    if (!asset) return;
    this._pushUndo();
    this._addTile(asset);
    await this._renderTiles();
  }

  /** Append a tile for the given asset to the working composite.
   *  Subsequent tiles cascade slightly so they don't perfectly
   *  overlap the first one — drag-to-position arrives in commit 3. */
  private _addTile(asset: MapAsset): void {
    if (!this.working) return;
    const tiles = this.working.compositeTiles ?? [];
    // Cascade offset: each new tile starts 5% down + 5% right of
    // the previous-tile-count's position. Just enough that the GM
    // sees the new tile sitting outside the previous one's centre.
    const n = tiles.length;
    const offset = Math.min(0.04 * n, 0.4);
    const tile: CompositeTile = {
      id:         generateId(),
      mapAssetId: asset.id,
      x:          0.5 + offset,
      y:          0.5 + offset,
      rotation:   0,
      scale:      0.25,
    };
    // v2.14.62 — record this tile's freshly-set scale as the Reset
    // target so a later "reset scale" restores 0.25 rather than the
    // first-drag value.
    this._originalScales.set(tile.id, { scale: tile.scale, scaleY: tile.scaleY });
    this.working = {
      ...this.working,
      compositeTiles: [...tiles, tile],
    };
  }

  private _esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
