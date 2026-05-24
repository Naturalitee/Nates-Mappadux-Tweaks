/**
 * rasterizeComposite — render a composite-map MapAsset into a single
 * PNG blob by drawing each tile onto an OffscreenCanvas.
 *
 * Why rasterise rather than extend the renderer to handle multiple
 * textures? Because the existing renderer + projector pipeline
 * already knows how to display ONE map image with fog / markers /
 * filter / backdrop on top. Compositing once at load time means
 * every downstream consumer (player view, scaled view, GM canvas,
 * thumbnail, bundle export) gets the multi-tile composite for free
 * via the same getBlob → blob path single-asset maps use.
 *
 * Output dimensions are derived from the first scaled tile's native
 * resolution so the composite's pixels-per-square matches that
 * master tile exactly — calibrated viewers render at the right
 * table scale automatically. Aspect ratio matches whatever was set
 * when the composite was saved (defaults to 4:3 when unset).
 *
 * v2.14.49 — initial implementation; covers single-tile +
 * multi-tile modular composites. Layered mode (z-order, reveal-
 * below FoW) layers on top of the same pipeline in a later pass.
 */

import type { MapAsset, CompositeTile } from '../types.ts';
import { MapAssetStore } from './MapAssetStore.ts';

export interface RasterizeResult {
  blob:               Blob;
  imageWidth:         number;
  imageHeight:        number;
  pixelsPerSquare:    number | null;
}

/** Output aspect when no other hint is available. Mappadux maps
 *  are usually 4:3 or 16:9; 4:3 is the more forgiving default. */
const DEFAULT_OUTPUT_ASPECT = 4 / 3;

/** Cap so we don't try to rasterise a 50 000-px-wide composite if a
 *  master tile happens to be huge. 4096 covers everyday 4K maps with
 *  margin; bigger composites can be authored but are downscaled. */
const MAX_OUTPUT_W = 4096;

export async function rasterizeComposite(asset: MapAsset): Promise<RasterizeResult | null> {
  const tiles = asset.compositeTiles ?? [];
  if (tiles.length === 0) return null;

  // Master tile = first scaled tile (i.e. has pixelsPerSquare set).
  // Its native resolution + scale fraction set the composite's
  // output pixel size so cells stay at master pps.
  let master: { tile: CompositeTile; asset: MapAsset } | null = null;
  for (const tile of tiles) {
    const ta = await MapAssetStore.get(tile.mapAssetId);
    if (!ta) continue;
    if (ta.pixelsPerSquare && ta.imageWidth && ta.imageHeight) {
      master = { tile, asset: ta };
      break;
    }
  }

  let outputW: number;
  let outputH: number;
  let pps: number | null = null;
  if (master) {
    const tileScale = master.tile.scale ?? 1;
    const masterImgW = master.asset.imageWidth ?? 0;
    // Tile occupies tileScale × outputW pixels. We want tile to render
    // at its native imageWidth so cells stay at master.pps:
    //   tileScale × outputW = master.asset.imageWidth
    //   outputW = master.asset.imageWidth / tileScale
    outputW = Math.round(masterImgW / Math.max(0.01, tileScale));
    if (outputW > MAX_OUTPUT_W) {
      // Downscale gracefully. The composite still renders correctly
      // (pps scales with outputW) but at a saner pixel budget.
      const downscale = MAX_OUTPUT_W / outputW;
      outputW = MAX_OUTPUT_W;
      pps = master.asset.pixelsPerSquare! * downscale;
    } else {
      pps = master.asset.pixelsPerSquare!;
    }
    // Aspect from the saved composite asset, falling back to default.
    const aspect = (asset.imageWidth && asset.imageHeight)
      ? asset.imageWidth / asset.imageHeight
      : DEFAULT_OUTPUT_ASPECT;
    outputH = Math.round(outputW / aspect);
  } else {
    // No scaled tile yet — emit at a sensible default. The composite
    // stays unscaled; user calibrates manually like any image map.
    outputW = 1600;
    outputH = Math.round(outputW / DEFAULT_OUTPUT_ASPECT);
  }

  // Offscreen canvas → 2D ctx. Fail soft on browsers without it
  // (none of the modern set, but worth being defensive).
  const canvas = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(outputW, outputH)
    : null;
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Solid black background fills any uncovered area — looks like a
  // letterbox / table-edge bezel at play time.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, outputW, outputH);

  // Draw each tile. Tile bitmaps are decoded one at a time and
  // closed after draw to keep memory bounded for large composites.
  // Layered mode's z-order (later pass) will sort by tile.layer
  // before iteration; modular mode draws in insertion order.
  for (const tile of tiles) {
    const tileAsset = await MapAssetStore.get(tile.mapAssetId);
    if (!tileAsset) continue;
    const blob = await MapAssetStore.getBlob(tileAsset);
    if (!blob) continue;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      continue;
    }
    const tileW = (tile.scale ?? 1) * outputW;
    const tileH = tileW * (bitmap.height / bitmap.width);
    const cx = tile.x * outputW;
    const cy = tile.y * outputH;
    ctx.save();
    ctx.translate(cx, cy);
    if (tile.rotation) ctx.rotate(tile.rotation * Math.PI / 180);
    ctx.drawImage(bitmap, -tileW / 2, -tileH / 2, tileW, tileH);
    ctx.restore();
    bitmap.close();
  }

  const out = await canvas.convertToBlob({ type: 'image/png' });
  return { blob: out, imageWidth: outputW, imageHeight: outputH, pixelsPerSquare: pps };
}
