/**
 * drawGrid — paint the 1″ / 25 mm grid overlay onto a dedicated canvas,
 * dispatched by the viewer's profile.grid.kind discriminant.
 *
 * Four strategies cover the present-day kinds:
 *
 *   • 'none'                 — no-op. Clears the canvas and returns.
 *                              Used by viewers that don't want a grid
 *                              overlay (Player default today).
 *   • 'projector-calibrated' — fixed CSS px per inch from the projector
 *                              setup. The Scaled View primary uses this
 *                              — the grid stays at the table's
 *                              physical scale regardless of window size.
 *   • 'monitor-proportional' — scales with the monitor's mirror of the
 *                              primary's crop. Derived on the monitor
 *                              from map calibration + primaryViewNW +
 *                              own canvas width.
 *   • 'map-relative'         — scales with the current map view. Used
 *                              by the deferred Player View grid (#13
 *                              in the v2.15 scope) so the grid moves
 *                              with the map as the GM zooms / the
 *                              browser resizes.
 *
 * Phase 3c of the Viewer refactor (see [[project_dmr_viewer_refactor_design]]).
 */

import type { ProjectorSetup } from '../../projector/calibrationStorage.ts';
import type { ViewState } from '../../types.ts';
import type { GridKind } from '../ViewerProfile.ts';

export interface DrawGridContext {
  /** Discriminant — picks which strategy runs. Usually
   *  profile.grid.kind but apps can pass dynamically (e.g. ProjectorApp
   *  flips 'projector-calibrated' ↔ 'monitor-proportional' based on
   *  this.role during the refactor; profile switching arrives later). */
  kind: GridKind;

  /** Effective canvas dimensions in CSS px (account for rotation). */
  effectiveW: number;
  effectiveH: number;

  /** Whether the grid is currently switched on. Off → strategies still
   *  size/clear the canvas but don't draw lines. Lets the caller wire
   *  the canvas once and rely on this flag for show/hide. */
  enabled: boolean;
  /** CSS colour for the grid lines. */
  color:   string;

  /** Projector calibration — own pixels-per-inch for this device.
   *  Required by 'projector-calibrated'. */
  setup: ProjectorSetup | null;

  /** Map pixels per 1″ square — required by 'monitor-proportional'
   *  (uses it + primary's viewNW + map width to derive a scale). */
  mapPixelsPerSquare: number | null;
  /** Map texture intrinsic dimensions. */
  mapImageWidth:  number;
  mapImageHeight: number;

  /** Primary projector's reported view fraction — 'monitor-proportional'
   *  uses these to compute its scaled grid spacing. */
  primaryViewNW: number;
  primaryViewNH: number;

  /** Current map view (viewNW / viewNH / centerX / centerY) — required
   *  by 'map-relative'. The grid lines move with the view: if the GM
   *  zooms in to half the map width, the grid lines double in CSS-px
   *  spacing on the viewer's canvas. */
  view: ViewState | null;

  /** v2.14.18 — grid offset in MAP pixels (positive shifts right / down).
   *  Each strategy converts these into its own CSS-px-on-canvas
   *  equivalent using its scale factor. Default 0/0 (grid centred). */
  gridOffsetX?: number;
  gridOffsetY?: number;
}

/** Common bookkeeping shared by all strategies: size + clear the grid
 *  canvas. Returns the 2D context (null if unavailable / unsupported). */
function prepCanvas(
  cv: HTMLCanvasElement,
  w: number,
  h: number,
): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  cv.width  = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.width  = `${w}px`;
  cv.style.height = `${h}px`;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/** Walk a grid anchored at the CSS-px point (anchorX, anchorY) — that
 *  point sits on a gridline crossing. Lines repeat at `spacing` CSS
 *  px on both axes in both directions. The anchor may sit far outside
 *  the canvas (modulo math collapses it into [0, spacing) so we walk
 *  the minimum number of lines).
 *
 *  v2.14.29 — replaces the old strokeCentredGrid: anchoring to a
 *  map-space point (rather than the canvas centre) is what makes the
 *  grids on Player + Scaled View land on identical map pixels. The
 *  canvas-centre anchor caused them to slide with each viewer's
 *  window instead of staying glued to map coords. */
function strokeAnchoredGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  spacing: number,
  color: string,
  anchorX: number,
  anchorY: number,
): void {
  if (spacing < 2) return; // sanity — sub-pixel grids alias to noise
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const cx = ((anchorX % spacing) + spacing) % spacing;
  const cy = ((anchorY % spacing) + spacing) % spacing;
  for (let x = cx; x <= w + spacing; x += spacing) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, h);
  }
  for (let y = cy; y <= h + spacing; y += spacing) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(w, Math.round(y) + 0.5);
  }
  ctx.stroke();
}

/** Map a point in MAP pixels to its CSS-px position on a viewer's
 *  canvas, given the viewer's view (centre + viewNW/H), the map's
 *  intrinsic dimensions, and the canvas size. Used to anchor the
 *  grid to a fixed map coordinate so every viewer's gridlines fall
 *  on the same map pixels. */
function mapPointToCss(
  mx: number,
  my: number,
  view: ViewState | null,
  mapW: number,
  mapH: number,
  canvasW: number,
  canvasH: number,
): { x: number; y: number } | null {
  if (!view || view.viewNW <= 0 || view.viewNH <= 0 || mapW <= 0 || mapH <= 0) return null;
  const normX = mx / mapW;
  const normY = my / mapH;
  const viewLeft = view.centerX - view.viewNW / 2;
  const viewTop  = view.centerY - view.viewNH / 2;
  return {
    x: ((normX - viewLeft) / view.viewNW) * canvasW,
    y: ((normY - viewTop)  / view.viewNH) * canvasH,
  };
}

/** Compute the CSS-px anchor for a grid that should align across all
 *  viewers — anchor at MAP centre + the calibration's gridOffset
 *  (also in map-px). Falls back to canvas centre + a scaled
 *  CSS-px-from-map-px offset if the view/map metadata isn't yet
 *  available (e.g. before the first view_update lands). */
function gridAnchor(
  ctx: DrawGridContext,
  spacing: number,
): { x: number; y: number } {
  const offsetMapX = ctx.gridOffsetX ?? 0;
  const offsetMapY = ctx.gridOffsetY ?? 0;
  const fromMap = mapPointToCss(
    ctx.mapImageWidth / 2 + offsetMapX,
    ctx.mapImageHeight / 2 + offsetMapY,
    ctx.view,
    ctx.mapImageWidth,
    ctx.mapImageHeight,
    ctx.effectiveW,
    ctx.effectiveH,
  );
  if (fromMap) return fromMap;
  // Fallback — pre-view state. Replicate the v2.14.18 behaviour so
  // a flash of mis-aligned grid doesn't appear during initial paint.
  const mapPxPerSq = ctx.mapPixelsPerSquare;
  const ox = mapPxPerSq && mapPxPerSq > 0 ? offsetMapX * (spacing / mapPxPerSq) : 0;
  const oy = mapPxPerSq && mapPxPerSq > 0 ? offsetMapY * (spacing / mapPxPerSq) : 0;
  return { x: ctx.effectiveW / 2 + ox, y: ctx.effectiveH / 2 + oy };
}

/** 'projector-calibrated' — fixed CSS-px-per-inch from the projector's
 *  own calibration. The Scaled View primary uses this so the grid
 *  stays at the table's physical scale (1 grid square = 1 inch =
 *  setup.pixelsPerSquare CSS pixels) regardless of window size. */
function drawProjectorCalibrated(
  cv: HTMLCanvasElement,
  ctx2d: CanvasRenderingContext2D,
  ctx: DrawGridContext,
): void {
  void cv;
  if (!ctx.setup) return;
  const spacing = ctx.setup.pixelsPerSquare;
  const anchor = gridAnchor(ctx, spacing);
  strokeAnchoredGrid(ctx2d, ctx.effectiveW, ctx.effectiveH, spacing, ctx.color, anchor.x, anchor.y);
}

/** 'monitor-proportional' — the v2.14.10 implementation:
 *
 *    spacing = mapPxPerSq * monitorCanvasW / (primaryViewNW * mapImageWidth)
 *
 *  The primary shows wMap = primaryViewNW * mapImageWidth map-px across
 *  its canvas; the monitor squeezes that same wMap into its own canvas
 *  width. Solve for "how many monitor CSS px = mapPxPerSq map-px" and
 *  you have the monitor's per-inch grid spacing.  */
function drawMonitorProportional(
  cv: HTMLCanvasElement,
  ctx2d: CanvasRenderingContext2D,
  ctx: DrawGridContext,
): void {
  void cv;
  if (!ctx.mapPixelsPerSquare || ctx.mapImageWidth <= 0 || ctx.primaryViewNW <= 0) return;
  const spacing = (ctx.mapPixelsPerSquare * ctx.effectiveW) / (ctx.primaryViewNW * ctx.mapImageWidth);
  const anchor = gridAnchor(ctx, spacing);
  strokeAnchoredGrid(ctx2d, ctx.effectiveW, ctx.effectiveH, spacing, ctx.color, anchor.x, anchor.y);
}

/** 'map-relative' — the deferred Player View grid (#13). The grid
 *  scales with the map view: if the GM zooms to half the map width,
 *  the grid lines double in CSS-px spacing on the viewer's canvas.
 *
 *    pxPerInch = mapPxPerSq * canvasW / (viewNW * mapImageWidth)
 *
 *  Same derivation as 'monitor-proportional' but with the viewer's
 *  OWN viewNW (the GM's broadcast view fraction) instead of the
 *  primary's. */
function drawMapRelative(
  cv: HTMLCanvasElement,
  ctx2d: CanvasRenderingContext2D,
  ctx: DrawGridContext,
): void {
  void cv;
  if (!ctx.view || !ctx.mapPixelsPerSquare || ctx.mapImageWidth <= 0 || ctx.view.viewNW <= 0) return;
  const spacing = (ctx.mapPixelsPerSquare * ctx.effectiveW) / (ctx.view.viewNW * ctx.mapImageWidth);
  const anchor = gridAnchor(ctx, spacing);
  strokeAnchoredGrid(ctx2d, ctx.effectiveW, ctx.effectiveH, spacing, ctx.color, anchor.x, anchor.y);
}

/** Unified entry point. Always sizes / clears the canvas (so toggling
 *  off cleanly hides the previous grid); only draws lines when
 *  `enabled` is true and the chosen strategy has the inputs it needs. */
export function drawGrid(cv: HTMLCanvasElement, ctx: DrawGridContext): void {
  const ctx2d = prepCanvas(cv, ctx.effectiveW, ctx.effectiveH);
  if (!ctx2d) return;
  if (!ctx.enabled) return;
  switch (ctx.kind) {
    case 'none':                  return;
    case 'projector-calibrated':  drawProjectorCalibrated(cv, ctx2d, ctx); return;
    case 'monitor-proportional':  drawMonitorProportional(cv, ctx2d, ctx); return;
    case 'map-relative':          drawMapRelative(cv, ctx2d, ctx);         return;
  }
}
