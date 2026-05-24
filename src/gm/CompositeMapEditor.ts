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

export class CompositeMapEditor {
  private overlay: HTMLElement | null = null;
  private resolver: ((value: MapAsset | null) => void) | null = null;
  /** Local working copy — mutated by the editor and either saved on
   *  Save or discarded on Cancel. */
  private working: MapAsset | null = null;
  /** Per-tile blob object URLs so re-renders during interaction
   *  don't recreate them. Revoked on close. */
  private tileBlobUrls = new Map<string, string>();
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
    this.overlay = this._buildOverlay();
    document.body.appendChild(this.overlay);
    await this._renderTiles();
    return new Promise<MapAsset | null>((resolve) => { this.resolver = resolve; });
  }

  private _close(value: MapAsset | null): void {
    for (const url of this.tileBlobUrls.values()) URL.revokeObjectURL(url);
    this.tileBlobUrls.clear();
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
          <button type="button" class="btn btn--primary btn--sm" data-action="add-map" title="Pick another tile from your library and drop it on the compositor canvas.">+ Add Map</button>
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
          this._close(this.working);
        } else if (action === 'add-map') {
          void this._handleAddMap();
        } else if (action === 'reset-view') {
          this._panX = 0; this._panY = 0; this._zoom = 1;
          this._applyTransform();
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

    const onEsc = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        document.removeEventListener('keydown', onEsc);
        this._close(null);
      }
    };
    document.addEventListener('keydown', onEsc);

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

  /** Faint grey grid covering the whole compositor canvas at the
   *  first scaled tile's cell pitch. No-op when no tile has scale
   *  info yet (unscaled-only composite). */
  private _drawReferenceGrid(svg: SVGElement, cellPx: number | null): void {
    svg.innerHTML = '';
    if (!cellPx || cellPx < 4) return;
    // Centre the grid on the canvas centre (origin = master tile's
    // centre) so subsequent tiles snap visually around it. Walk
    // outward in both directions to fill the whole canvas.
    const cx = this._canvasW / 2;
    const cy = this._canvasH / 2;
    const lines: string[] = [];
    for (let x = cx; x <= this._canvasW + cellPx; x += cellPx) {
      lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${this._canvasH}" />`);
    }
    for (let x = cx - cellPx; x >= -cellPx; x -= cellPx) {
      lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${this._canvasH}" />`);
    }
    for (let y = cy; y <= this._canvasH + cellPx; y += cellPx) {
      lines.push(`<line x1="0" y1="${y}" x2="${this._canvasW}" y2="${y}" />`);
    }
    for (let y = cy - cellPx; y >= -cellPx; y -= cellPx) {
      lines.push(`<line x1="0" y1="${y}" x2="${this._canvasW}" y2="${y}" />`);
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
    const tileH  = tileW / aspect;
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
    el.style.transform = `rotate(${tile.rotation}deg)`;
    el.innerHTML = `<img src="${url}" alt="" draggable="false" />`;
    if (isSelected) {
      // v2.14.45 — Mappadux convention: red trashcan handle pinned
      // at bottom-left apex of the selected object. Same SVG pattern
      // as FogEditor / markers / text-map elements.
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
      trash.addEventListener('pointerdown', (ev) => {
        // Trashcan beats drag — stop the drag handler from claiming
        // this pointer event before delete fires.
        ev.stopPropagation();
      });
      trash.addEventListener('click', (ev) => {
        ev.stopPropagation();
        void this._deleteTile(tile.id);
      });
      el.appendChild(trash);
    }
    this._bindTileDrag(el, tile.id);
    el.addEventListener('click', (ev) => {
      // Select on click. The drag handler also fires pointerdown, but
      // a click only synthesises if the pointer didn't move far.
      ev.stopPropagation();
      void this._selectTile(tile.id);
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

  /** Remove the tile from the working copy + re-render. */
  private async _deleteTile(id: string): Promise<void> {
    if (!this.working) return;
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
      const onMove = (ev: PointerEvent) => {
        const dxNorm = (ev.clientX - startX) * cssToNormX;
        const dyNorm = (ev.clientY - startY) * cssToNormY;
        let nx = startNX + dxNorm;
        let ny = startNY + dyNorm;
        // Snap to the master grid if enabled + available.
        if (this._snapToGrid && this._masterCellNorm && this._masterCellNorm > 0) {
          const cell = this._masterCellNorm;
          // Grid origin = canvas centre (matches _drawReferenceGrid).
          nx = Math.round((nx - 0.5) / cell) * cell + 0.5;
          ny = Math.round((ny - 0.5) / cell) * cell + 0.5;
        }
        const tileW = parseFloat(el.style.width);
        const tileH = parseFloat(el.style.height);
        el.style.left = `${nx * this._canvasW - tileW / 2}px`;
        el.style.top  = `${ny * this._canvasH - tileH / 2}px`;
        tile.x = nx;
        tile.y = ny;
      };
      const onUp = (ev: PointerEvent) => {
        el.releasePointerCapture(ev.pointerId);
        el.style.cursor = 'grab';
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
    this.working = {
      ...this.working,
      compositeTiles: [...tiles, tile],
    };
  }

  private _esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
