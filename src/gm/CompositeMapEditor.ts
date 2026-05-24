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

/** Caller-supplied picker for "+ Add Map". Returns null if the user
 *  cancelled the pick. The editor doesn't depend on the picker
 *  implementation — GMApp wires it to MapAssetModal.openForCompositeAddTile. */
export type PickAssetFn = () => Promise<MapAsset | null>;

/** Editor's internal compositor canvas size in CSS pixels. Tiles
 *  position in the asset's 0..1 normalised space; this constant
 *  defines the on-screen footprint of that space. */
const CANVAS_W = 1000;
const CANVAS_H = 750;

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
          <span class="composite-editor-hint">Drag tiles to position. Snap rules + rotation arrive in the next pass.</span>
        </div>
        <div class="composite-editor-canvas-wrap">
          <div class="composite-editor-canvas">
            <svg class="composite-editor-grid" xmlns="http://www.w3.org/2000/svg"></svg>
            <div class="composite-editor-tiles"></div>
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
        } else {
          this._close(null);
        }
      });
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

  /** Paint the tiles + reference grid for the current working copy. */
  private async _renderTiles(): Promise<void> {
    const tilesEl = this.overlay?.querySelector<HTMLElement>('.composite-editor-tiles');
    const gridEl  = this.overlay?.querySelector<SVGElement>('.composite-editor-grid');
    if (!tilesEl || !gridEl) return;

    // Size the inner canvas + SVG to the fixed compositor footprint.
    const canvasEl = this.overlay?.querySelector<HTMLElement>('.composite-editor-canvas');
    if (canvasEl) {
      canvasEl.style.width  = `${CANVAS_W}px`;
      canvasEl.style.height = `${CANVAS_H}px`;
    }
    gridEl.setAttribute('viewBox', `0 0 ${CANVAS_W} ${CANVAS_H}`);
    gridEl.setAttribute('width',  String(CANVAS_W));
    gridEl.setAttribute('height', String(CANVAS_H));
    tilesEl.innerHTML = '';

    // Find the first SCALED tile (i.e. its asset has pixelsPerSquare).
    // That tile's grid sets the compositor's reference grid spacing.
    const tiles = this.working?.compositeTiles ?? [];
    let masterCellPx: number | null = null;
    for (const tile of tiles) {
      const tileAsset = await MapAssetStore.get(tile.mapAssetId);
      if (!tileAsset) continue;
      if (tileAsset.pixelsPerSquare && tileAsset.imageWidth) {
        // Tile's footprint on the editor canvas:
        const tileW = (tile.scale ?? 1) * CANVAS_W;
        // pps maps to tile-px; ratio of tile-px to tileW gives cell size on canvas.
        const cellsAcross = tileAsset.imageWidth / tileAsset.pixelsPerSquare;
        masterCellPx = tileW / cellsAcross;
        break;
      }
    }
    this._drawReferenceGrid(gridEl, masterCellPx);

    // Render every tile.
    for (const tile of tiles) {
      const node = await this._renderTile(tile);
      if (node) tilesEl.appendChild(node);
    }
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
    const cx = CANVAS_W / 2;
    const cy = CANVAS_H / 2;
    const lines: string[] = [];
    for (let x = cx; x <= CANVAS_W + cellPx; x += cellPx) {
      lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${CANVAS_H}" />`);
    }
    for (let x = cx - cellPx; x >= -cellPx; x -= cellPx) {
      lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${CANVAS_H}" />`);
    }
    for (let y = cy; y <= CANVAS_H + cellPx; y += cellPx) {
      lines.push(`<line x1="0" y1="${y}" x2="${CANVAS_W}" y2="${y}" />`);
    }
    for (let y = cy - cellPx; y >= -cellPx; y -= cellPx) {
      lines.push(`<line x1="0" y1="${y}" x2="${CANVAS_W}" y2="${y}" />`);
    }
    svg.innerHTML = lines.join('');
  }

  /** Render a single tile as an absolutely-positioned <img> inside
   *  the composite canvas. Position from tile.x/y (composite-norm);
   *  size from tile.scale * canvasW preserving the asset's aspect. */
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
    const tileW  = (tile.scale ?? 1) * CANVAS_W;
    const tileH  = tileW / aspect;
    const left   = tile.x * CANVAS_W - tileW / 2;
    const top    = tile.y * CANVAS_H - tileH / 2;

    const el = document.createElement('div');
    el.className = 'composite-editor-tile';
    el.style.left      = `${left}px`;
    el.style.top       = `${top}px`;
    el.style.width     = `${tileW}px`;
    el.style.height    = `${tileH}px`;
    el.style.transform = `rotate(${tile.rotation}deg)`;
    el.innerHTML = `<img src="${url}" alt="" draggable="false" />`;
    return el;
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
