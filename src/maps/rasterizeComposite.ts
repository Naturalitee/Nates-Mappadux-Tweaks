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
}

/** One tile's input to the rasteriser. Caller supplies the tile
 *  placement, the underlying asset's metadata (for master / aspect
 *  math), and the bytes to draw. */
export interface TileInput {
  tile:  CompositeTile;
  asset: Pick<MapAsset, 'id' | 'pixelsPerSquare' | 'imageWidth' | 'imageHeight'>;
  blob:  Blob;
}

/** Output aspect when no other hint is available. */
const DEFAULT_OUTPUT_ASPECT = 4 / 3;

/** Cap so we don't try to rasterise a 50 000-px-wide composite if a
 *  master tile happens to be huge. 4096 covers everyday 4K maps with
 *  margin. */
const MAX_OUTPUT_W = 4096;

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
    if (workW > MAX_OUTPUT_W) {
      const downscale = MAX_OUTPUT_W / workW;
      workW = MAX_OUTPUT_W;
      pps = (master.asset.pixelsPerSquare ?? 0) * downscale;
    } else {
      pps = master.asset.pixelsPerSquare ?? null;
    }
    workH = Math.round(workW / compositeAspect);
  } else {
    workW = 1600;
    workH = Math.round(workW / compositeAspect);
  }

  // Compute bounding box in WORKING pixel space — only the region
  // tiles actually cover gets rasterised. Saves output pixels when
  // tiles cluster in a corner of the editor canvas; lets the GM
  // place tiles anywhere without paying for empty pixels.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  // Pre-decode bitmaps once so we can compute aspects + draw without
  // re-decoding. close() each after the draw to keep memory bounded.
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
    // Bounding box uses an axis-aligned envelope of the rotated rect.
    // For now use the rect's circumscribed circle so any rotation
    // still fits — radius = sqrt(tileW² + tileH²) / 2.
    const r = Math.sqrt(tileW * tileW + tileH * tileH) / 2;
    if (cx - r < minX) minX = cx - r;
    if (cy - r < minY) minY = cy - r;
    if (cx + r > maxX) maxX = cx + r;
    if (cy + r > maxY) maxY = cy + r;
  }
  if (decoded.length === 0) return null;

  // Clamp the bbox so the output never claims pixels outside the
  // working frame (saves the rasteriser from negative-coord draws).
  const cropX = Math.max(0, Math.floor(minX));
  const cropY = Math.max(0, Math.floor(minY));
  const cropR = Math.min(workW, Math.ceil(maxX));
  const cropB = Math.min(workH, Math.ceil(maxY));
  const outputW = Math.max(1, cropR - cropX);
  const outputH = Math.max(1, cropB - cropY);

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
  return { blob, imageWidth: outputW, imageHeight: outputH, pixelsPerSquare: pps };
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
