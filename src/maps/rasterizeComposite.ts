/**
 * rasterizeComposite — render a composite-map MapAsset into a single
 * PNG blob by drawing each tile onto an OffscreenCanvas.
 *
 * v2.14.49 — initial implementation; composite blob shipped over the
 * wire by GM.
 * v2.14.51 — refactored: the pixel work now lives in rasterizeFromTiles,
 * a pure function that takes a tile-input array. The MapAssetStore-
 * coupled rasterizeComposite is a thin wrapper that resolves tile
 * assets + blobs from IDB. Splitting the API lets viewer code call
 * the rasteriser directly with tile blobs received over the wire —
 * no IDB needed on the viewer side. Also: bounding-box crop so the
 * output only spans the region actually covered by tiles (saves
 * pixels when tiles cluster in one area of the editor's canvas).
 */

import type { MapAsset, CompositeTile } from '../types.ts';
import { MapAssetStore } from './MapAssetStore.ts';

export interface RasterizeResult {
  blob:               Blob;
  imageWidth:         number;
  imageHeight:        number;
  pixelsPerSquare:    number | null;
  /** v2.14.55 — composite's grid origin in output pixels. Persisted
   *  on the composite asset so the viewer's drawGrid lines up with
   *  the master tile's calibrated grid (rather than starting at the
   *  output's top-left corner). Always present alongside pps. */
  gridOffsetX:        number;
  gridOffsetY:        number;
}

/** One tile's input to the rasteriser. Caller supplies the tile
 *  placement, the underlying asset's metadata (for master / aspect
 *  math), and the bytes to draw. */
export interface TileInput {
  tile:  CompositeTile;
  asset: Pick<MapAsset, 'id' | 'pixelsPerSquare' | 'imageWidth' | 'imageHeight' | 'gridOffsetX' | 'gridOffsetY'>;
  blob:  Blob;
}

/** Output aspect when no other hint is available. */
const DEFAULT_OUTPUT_ASPECT = 4 / 3;

/** Memory guardrail on the rasteriser's output. Pixel-budget rather
 *  than width-cap so wide-and-short composites (think a long corridor
 *  tile-set) get more horizontal room than tall-and-narrow ones.
 *  v2.14.55 — was a strict 4096 width cap that single-image-thinking
 *  made too tight for multi-tile layouts. 64 MP at 4:3 ≈ 9230 × 6925
 *  (≈ 250 MB transient RGBA); generous for typical play, bounded
 *  enough to keep browsers safe.
 *
 *  Could one day evolve into viewer-aware streaming (rasterise at
 *  the viewer's canvas needs rather than a fixed budget), but the
 *  per-viewer composition path makes that a future option rather
 *  than a blocker. */
const PIXEL_BUDGET = 64 * 1024 * 1024;

/** Pure rasteriser. Doesn't touch IDB / MapAssetStore. The caller
 *  supplies everything it needs. Viewer-side and GM-side paths both
 *  call this. */
export async function rasterizeFromTiles(
  inputs:         TileInput[],
  compositeAspect: number = DEFAULT_OUTPUT_ASPECT,
): Promise<RasterizeResult | null> {
  if (inputs.length === 0) return null;

  // Master tile = first scaled tile (has pixelsPerSquare set). Its
  // native pixel resolution + scale fraction set the working output
  // pixel size so cells stay at master pps.
  let master: TileInput | null = null;
  for (const input of inputs) {
    if (input.asset.pixelsPerSquare && input.asset.imageWidth && input.asset.imageHeight) {
      master = input;
      break;
    }
  }

  // Working dims — the "ideal" output that maps tile.x/y norm coords
  // (0..1 of compositor space) into pixels. Bounding-box crop then
  // trims this down to just the covered region.
  let workW: number;
  let workH: number;
  let pps: number | null = null;
  if (master) {
    const tileScale = master.tile.scale ?? 1;
    const masterImgW = master.asset.imageWidth ?? 0;
    // workW × tileScale = masterImgW → cell pitch stays at master.pps.
    workW = Math.round(masterImgW / Math.max(0.01, tileScale));
    workH = Math.round(workW / compositeAspect);
    // Pixel budget: downscale uniformly if we'd blow the cap.
    const pixels = workW * workH;
    if (pixels > PIXEL_BUDGET) {
      const downscale = Math.sqrt(PIXEL_BUDGET / pixels);
      workW = Math.round(workW * downscale);
      workH = Math.round(workH * downscale);
      pps = (master.asset.pixelsPerSquare ?? 0) * downscale;
    } else {
      pps = master.asset.pixelsPerSquare ?? null;
    }
  } else {
    workW = 1600;
    workH = Math.round(workW / compositeAspect);
  }

  // v2.14.55 — output spans the FULL workspace (no bbox crop).
  // Earlier (v2.14.51) we cropped to the tile envelope to save
  // pixels; that shrunk the rendered map's declared dimensions and
  // dragged the grid + the Player View rect bounds with it. The
  // composite is a TABLE — its declared extent should match the
  // workspace, with tiles placed within it and transparency
  // wherever no tile covers. Renderer composites the map plane on
  // top of the GM's backdrop, so transparency = backdrop visible.
  // Grid + viewer rect bounds now extend across the whole workspace.
  const decoded: { input: TileInput; bitmap: ImageBitmap; tileW: number; tileH: number; cx: number; cy: number }[] = [];
  for (const input of inputs) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(input.blob);
    } catch {
      continue;
    }
    const tileW = (input.tile.scale ?? 1) * workW;
    const tileH = tileW * (bitmap.height / bitmap.width);
    const cx = input.tile.x * workW;
    const cy = input.tile.y * workH;
    decoded.push({ input, bitmap, tileW, tileH, cx, cy });
  }
  if (decoded.length === 0) return null;

  const outputW = workW;
  const outputH = workH;
  const cropX = 0;
  const cropY = 0;

  // Offscreen canvas → 2D ctx. Fail soft on browsers without it.
  const canvas = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(outputW, outputH)
    : null;
  if (!canvas) {
    for (const d of decoded) d.bitmap.close();
    return null;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    for (const d of decoded) d.bitmap.close();
    return null;
  }

  // v2.14.52 — DON'T fill the background. PNG defaults to fully
  // transparent; the renderer composites the map plane on top of
  // the GM's chosen backdrop (solid colour OR animated Starfield /
  // Aurora / Embers / etc.). Filling with black here would hide
  // that — composites with L-shaped / non-rectangular layouts
  // should show the backdrop wherever no tile covers, same as a
  // letterboxed single-image map does.

  // Draw each tile, translating positions into the crop's frame.
  // Layered mode's z-order (later pass) will pre-sort decoded by
  // tile.layer; modular mode draws in insertion order.
  for (const d of decoded) {
    const localCx = d.cx - cropX;
    const localCy = d.cy - cropY;
    ctx.save();
    ctx.translate(localCx, localCy);
    if (d.input.tile.rotation) ctx.rotate(d.input.tile.rotation * Math.PI / 180);
    ctx.drawImage(d.bitmap, -d.tileW / 2, -d.tileH / 2, d.tileW, d.tileH);
    ctx.restore();
    d.bitmap.close();
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' });

  // v2.14.55 — compute composite gridOffsetX/Y so viewer drawGrid
  // aligns with the MASTER tile's calibrated grid. The convention
  // (v2.14.32): gridlines at map.x = n*K + offsetX. Set offsetX so
  // the first gridline lands on the master tile's first gridline
  // in output-pixel space.
  let gridOffsetX = 0;
  let gridOffsetY = 0;
  if (master && pps && pps > 0) {
    const masterTile     = master.tile;
    const masterAsset    = master.asset;
    const masterImgW     = masterAsset.imageWidth ?? 0;
    const masterImgH     = masterAsset.imageHeight ?? 0;
    // Display scale of master on the output: master tile renders at
    // (masterTile.scale * workW) pixels wide; its source is
    // masterImgW pixels. Ratio = how many output-pixels per
    // source-pixel.
    const displayScale = (masterImgW > 0)
      ? ((masterTile.scale ?? 1) * workW) / masterImgW
      : 1;
    // Master image-corner in output coords (cropX/Y are 0 since we
    // dropped the bbox crop, but kept here in case it returns).
    const masterCornerX = masterTile.x * workW - masterImgW * displayScale / 2 - cropX;
    const masterCornerY = masterTile.y * workH - masterImgH * displayScale / 2 - cropY;
    const masterOffXout = (masterAsset.gridOffsetX ?? 0) * displayScale;
    const masterOffYout = (masterAsset.gridOffsetY ?? 0) * displayScale;
    gridOffsetX = ((masterCornerX + masterOffXout) % pps + pps) % pps;
    gridOffsetY = ((masterCornerY + masterOffYout) % pps + pps) % pps;
  }

  return {
    blob,
    imageWidth: outputW,
    imageHeight: outputH,
    pixelsPerSquare: pps,
    gridOffsetX,
    gridOffsetY,
  };
}

/** GM-side wrapper: resolve each tile's asset + blob from IDB then
 *  hand off to rasterizeFromTiles. Returns null if no tiles or no
 *  resolvable blob. */
export async function rasterizeComposite(asset: MapAsset): Promise<RasterizeResult | null> {
  const tiles = asset.compositeTiles ?? [];
  if (tiles.length === 0) return null;
  const inputs: TileInput[] = [];
  for (const tile of tiles) {
    const tileAsset = await MapAssetStore.get(tile.mapAssetId);
    if (!tileAsset) continue;
    const blob = await MapAssetStore.getBlob(tileAsset);
    if (!blob) continue;
    inputs.push({ tile, asset: tileAsset, blob });
  }
  return rasterizeFromTiles(inputs, asset.compositeAspect ?? DEFAULT_OUTPUT_ASPECT);
}
