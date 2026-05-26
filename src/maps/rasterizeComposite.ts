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

/** Console warn threshold. The rasteriser doesn't enforce any
 *  hard cap on output dims any more (Alex's call: hardware varies,
 *  warn rather than truncate). Above this threshold we log a hint
 *  so the GM can see "this composite is heavy" in DevTools if they
 *  notice slowdown. 64 MP ≈ 9200 × 6900; typical play stays well
 *  under. Browsers will OOM eventually for truly absurd outputs;
 *  MapAssetStore.getBlob catches the error and surfaces a Missing
 *  Map Image placeholder so the GM notices + scales back. */
const WARN_PIXEL_THRESHOLD = 64 * 1024 * 1024;

/** Pure rasteriser. Doesn't touch IDB / MapAssetStore. The caller
 *  supplies everything it needs. Viewer-side and GM-side paths both
 *  call this.
 *
 *  v2.14.70 — optional `extentInputs` lets the caller pin the
 *  workspace bbox to a DIFFERENT tile set than the one being drawn.
 *  Used by the Reveal Map Layer backing rasterise so the backing PNG
 *  shares the main composite's dimensions exactly (otherwise the
 *  smaller subset crops to a different bbox and the renderer's
 *  fixed-aspect backing plane stretches it). Defaults to `inputs`
 *  when omitted — original behaviour. */
export async function rasterizeFromTiles(
  inputs:         TileInput[],
  compositeAspect: number = DEFAULT_OUTPUT_ASPECT,
  extentInputs?:  TileInput[],
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

  // v2.14.56 — Reference scale: how many output pixels equal "1.0
  // norm" along the editor canvas. Tiles store position + size in
  // norm coords (0..1 of editor canvas at save time); the rasteriser
  // converts to pixels via this scale.
  let refW: number;
  let refH: number;
  if (master) {
    const tileScale = master.tile.scale ?? 1;
    const masterImgW = master.asset.imageWidth ?? 0;
    // refW × tileScale = masterImgW → master tile renders at its
    // native imageWidth → cell pitch = master.pps.
    refW = masterImgW / Math.max(0.01, tileScale);
    refH = refW / compositeAspect;
  } else {
    refW = 1600;
    refH = refW / compositeAspect;
  }

  // Pre-decode tiles + compute their pixel extents at reference
  // scale. Workspace = tile bounding box only. v2.14.57 — previously
  // the workspace also included the editor canvas's 0..1 norm area
  // as a floor, which 'pinned' the output wider than the actual
  // tile footprint. Alex's call: composite extent should be where
  // the tiles actually are, not where the editor frame happened to
  // be. Tiles will be shifted by -minLeft / -minTop so the
  // top-left-most tile lands at output (0, 0).
  const decoded: { input: TileInput; bitmap: ImageBitmap; cxRef: number; cyRef: number; tileWref: number; tileHref: number }[] = [];
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const input of inputs) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(input.blob);
    } catch {
      continue;
    }
    const tileWref = (input.tile.scale ?? 1) * refW;
    // v2.14.62 — if the GM unlocked aspect + dragged height
    // independently, tile.scaleY (fraction-of-canvas-HEIGHT) wins
    // over the asset's native aspect. refH IS the height of the
    // editor's reference canvas, so scaleY * refH is the matching
    // pixel height. Absent scaleY = locked aspect default
    // (derive from bitmap dims as before).
    const tileHref = input.tile.scaleY != null
      ? input.tile.scaleY * refH
      : tileWref * (bitmap.height / bitmap.width);
    const cxRef = input.tile.x * refW;
    const cyRef = input.tile.y * refH;
    decoded.push({ input, bitmap, cxRef, cyRef, tileWref, tileHref });
  }
  if (decoded.length === 0) return null;

  // v2.14.70 — bbox is computed from extentInputs (if given), not
  // `inputs`. Reveal-layer backing rasterises pass the FULL tile
  // set as extentInputs so the backing PNG matches the main
  // composite's dimensions exactly; the renderer can then mount
  // the backing on a same-aspect plane without stretching.
  //
  // v2.15.29 — bbox now respects tile rotation. A rotated tile
  // (e.g. a 45° diamond piece) extends OUTSIDE its un-rotated
  // rectangle; the previous code used `cx ± w/2` axis-aligned
  // which cropped the actual rendered shape at output time
  // (visible as a truncated diamond on broadcast viewers). The
  // closed-form rotated-AABB is `|w·cos θ| + |h·sin θ|` wide and
  // `|w·sin θ| + |h·cos θ|` tall — the tightest bounding box
  // around the rotated rectangle.
  const extentSource = extentInputs ?? inputs;
  for (const input of extentSource) {
    const tileWref = (input.tile.scale ?? 1) * refW;
    const aspect = (input.asset.imageWidth && input.asset.imageHeight)
      ? input.asset.imageWidth / input.asset.imageHeight
      : 1;
    const tileHref = input.tile.scaleY != null
      ? input.tile.scaleY * refH
      : tileWref / aspect;
    const cxRef = input.tile.x * refW;
    const cyRef = input.tile.y * refH;
    const rotRad = (input.tile.rotation ?? 0) * Math.PI / 180;
    const absC = Math.abs(Math.cos(rotRad));
    const absS = Math.abs(Math.sin(rotRad));
    const aabbW = tileWref * absC + tileHref * absS;
    const aabbH = tileWref * absS + tileHref * absC;
    minX = Math.min(minX, cxRef - aabbW / 2);
    maxX = Math.max(maxX, cxRef + aabbW / 2);
    minY = Math.min(minY, cyRef - aabbH / 2);
    maxY = Math.max(maxY, cyRef + aabbH / 2);
  }
  if (minX === Infinity) return null;  // extentSource produced no usable inputs

  // Workspace = bounding-box extent at reference scale. Tiles shift
  // by -min so the leftmost / topmost lands at (0, 0) in output.
  // v2.14.56 — no enforced cap. pps stays at master.pps; output
  // dims = the full workspace. Heavy composites will be slow; the
  // timer below warns the GM in DevTools, and OOM fallback in
  // MapAssetStore.getBlob shows Missing Map Image so the GM
  // notices + scales back if their hardware can't cope.
  const outputW = Math.max(1, Math.round(maxX - minX));
  const outputH = Math.max(1, Math.round(maxY - minY));
  const cropX   = minX;
  const cropY   = minY;
  const pps: number | null = master ? (master.asset.pixelsPerSquare ?? null) : null;

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

  // Time the rasterise so we can warn on heavy / sluggish composites.
  const t0 = performance.now();

  // Draw each tile. cxRef/cyRef are reference-scale pixel positions
  // in the workspace; shift by -min so the leftmost/topmost lands
  // at output 0. Layered mode's z-order (later pass) will pre-sort
  // decoded by tile.layer; modular mode draws in insertion order.
  for (const d of decoded) {
    const cxOut    = d.cxRef - cropX;
    const cyOut    = d.cyRef - cropY;
    ctx.save();
    ctx.translate(cxOut, cyOut);
    if (d.input.tile.rotation) ctx.rotate(d.input.tile.rotation * Math.PI / 180);
    // v2.14.59 — Apply flip AFTER rotation so the mirror is in the
    // tile's local frame (matches the editor's preview which scales
    // the inner content div).
    const sx = d.input.tile.flipH ? -1 : 1;
    const sy = d.input.tile.flipV ? -1 : 1;
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    ctx.drawImage(d.bitmap, -d.tileWref / 2, -d.tileHref / 2, d.tileWref, d.tileHref);
    ctx.restore();
    d.bitmap.close();
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' });

  // Sluggishness telemetry — warn the GM in DevTools if the rasterise
  // took a noticeable chunk of time. Above the pixel threshold we
  // always warn; below, we warn only on slow runs. Helps the GM
  // understand why a save felt heavy.
  const elapsed = performance.now() - t0;
  const pixels  = outputW * outputH;
  if (pixels > WARN_PIXEL_THRESHOLD || elapsed > 1500) {
    console.warn(
      `[composite rasterise] ${outputW}×${outputH} (${(pixels / 1_000_000).toFixed(0)} MP) ` +
      `from ${inputs.length} tile(s) in ${elapsed.toFixed(0)}ms. Slow composites get heavier ` +
      `as you add tiles or use higher-resolution masters; reduce tile count or master scale to lighten.`,
    );
  }

  // v2.14.55 — compute composite gridOffsetX/Y so viewer drawGrid
  // aligns with the MASTER tile's calibrated grid. Convention
  // (v2.14.32): gridlines at map.x = n*K + offsetX. Set offsetX so
  // the first gridline lands on the master tile's first gridline
  // in output-pixel space.
  let gridOffsetX = 0;
  let gridOffsetY = 0;
  if (master && pps && pps > 0) {
    const masterTile  = master.tile;
    const masterAsset = master.asset;
    const masterImgW  = masterAsset.imageWidth ?? 0;
    const masterImgH  = masterAsset.imageHeight ?? 0;
    const masterTileWout = (masterTile.scale ?? 1) * refW;     // output px wide
    const masterTileHout = masterImgW > 0
      ? masterTileWout * (masterImgH / masterImgW)
      : masterTileWout;
    // Display scale: output px per master source px.
    const displayScale = masterImgW > 0 ? masterTileWout / masterImgW : 1;
    // Master image corner in WORKSPACE coords, then shift by -crop.
    const masterCornerXout = (masterTile.x * refW - masterTileWout / 2) - cropX;
    const masterCornerYout = (masterTile.y * refH - masterTileHout / 2) - cropY;
    const masterOffXout = (masterAsset.gridOffsetX ?? 0) * displayScale;
    const masterOffYout = (masterAsset.gridOffsetY ?? 0) * displayScale;
    gridOffsetX = ((masterCornerXout + masterOffXout) % pps + pps) % pps;
    gridOffsetY = ((masterCornerYout + masterOffYout) % pps + pps) % pps;
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
  const inputs = await _resolveTileInputs(asset);
  if (inputs.length === 0) return null;
  return rasterizeFromTiles(inputs, asset.compositeAspect ?? DEFAULT_OUTPUT_ASPECT);
}

/** Reveal-layer backing rasterise. Produces the composite WITHOUT
 *  the tiles that are visually "on top". The renderer shows the
 *  backing through alpha holes the GM paints with the Reveal Map
 *  Layer brush, or globally via the upper-layer transparency slider.
 *
 *  v2.15.15 — A tile belongs to the BACKING if at least one OTHER
 *  tile (drawn later, so visually above it) overlaps it. Tiles
 *  with nothing above them are "topmost" and get excluded.
 *
 *  Earlier (v2.14.70 .. v2.15.14) excluded only the single LAST
 *  tile in the array. That worked for two-tile stacks but broke
 *  the moment two top tiles each covered the same bottom — only
 *  one became transparent under the slider; the other stayed
 *  fully opaque because it ended up in the backing.
 *
 *  Returns null when no overlap exists / no resolvable tiles. */
export async function rasterizeRevealBacking(asset: MapAsset): Promise<RasterizeResult | null> {
  const tiles = asset.compositeTiles ?? [];
  if (tiles.length < 2) return null;
  const fullInputs = await _resolveTileInputs(asset);
  if (fullInputs.length < 2) return null;

  const { backingTileIndices } = await import('./compositeOverlap.ts');
  const assetById = new Map<string, MapAsset>();
  for (const inp of fullInputs) assetById.set(inp.asset.id, inp.asset as MapAsset);

  const canvasAspect = asset.compositeAspect ?? DEFAULT_OUTPUT_ASPECT;
  const covered = backingTileIndices(tiles, (id) => assetById.get(id), canvasAspect);
  if (covered.size === 0) return null;

  // Filter fullInputs to the subset whose source tile is covered.
  // (fullInputs may skip unresolvable tiles, so we map back by id.)
  const idToIndex = new Map<string, number>();
  tiles.forEach((t, i) => idToIndex.set(t.id, i));
  const drawnInputs = fullInputs.filter((inp) => {
    const i = idToIndex.get(inp.tile.id);
    return i !== undefined && covered.has(i);
  });
  if (drawnInputs.length === 0) return null;

  return rasterizeFromTiles(drawnInputs, canvasAspect, fullInputs);
}

/** Internal — fetch + decode every tile's asset + blob for the
 *  composite. Skips tiles whose asset or blob can't be resolved
 *  (treating them as visually absent). */
async function _resolveTileInputs(asset: MapAsset): Promise<TileInput[]> {
  const tiles = asset.compositeTiles ?? [];
  const inputs: TileInput[] = [];
  for (const tile of tiles) {
    const tileAsset = await MapAssetStore.get(tile.mapAssetId);
    if (!tileAsset) continue;
    const blob = await MapAssetStore.getBlob(tileAsset);
    if (!blob) continue;
    inputs.push({ tile, asset: tileAsset, blob });
  }
  return inputs;
}
