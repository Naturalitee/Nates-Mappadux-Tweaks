/**
 * computeView — pick a ViewState from raw inputs, dispatched by the
 * viewer's profile.view.source discriminant.
 *
 * Three strategies cover the three real implementations:
 *
 *   • 'broadcast'      — use the broadcast view as-is (Player). Pass-through;
 *                        the GM has already chosen the crop.
 *   • 'calibrated'     — derive viewNW/H from calibration math (Scaled
 *                        primary). When the projector viewport is in
 *                        'full' mode, short-circuit to the full-map view
 *                        regardless of calibration availability.
 *   • 'mirror-primary' — mirror the primary projector's reported viewNW/H
 *                        fit-to-window (Scaled monitor).
 *
 * Phase 3b of the Viewer refactor (see [[project_dmr_viewer_refactor_design]]).
 */

import type { ProjectorSetup } from '../../projector/calibrationStorage.ts';
import type { ProjectorViewport, ViewState } from '../../types.ts';
import type { ViewSource } from '../ViewerProfile.ts';

/** Inputs for the computeView strategies. The viewer collects whatever
 *  pieces it has access to (some are profile-specific — broadcastView
 *  is only relevant for the 'broadcast' source; primaryViewNW only for
 *  'mirror-primary'), and each strategy reads the fields it needs. */
export interface ComputeViewContext {
  /** Discriminant — picks which strategy runs. Usually mirrors the
   *  profile.view.source field but apps can override at runtime
   *  (e.g. ProjectorApp picks 'mirror-primary' vs 'calibrated' based
   *  on its current `role`, even though both share the SCALED profile
   *  family during the refactor). */
  source: ViewSource;

  /** Projector viewport state — mode, centerX/Y, rotation. Required
   *  for 'calibrated' and 'mirror-primary'. Pass a default-shaped
   *  object for 'broadcast' (it's ignored). */
  projectorViewport: ProjectorViewport;

  /** Map pixels per 1″/25 mm square — the per-map calibration. Null
   *  on uncalibrated maps; the 'calibrated' strategy then falls back
   *  to the full-map view. */
  mapPixelsPerSquare: number | null;
  /** Map texture intrinsic dimensions in pixels. */
  mapImageWidth:  number;
  mapImageHeight: number;

  /** Projector setup — own pixels-per-inch calibration for this
   *  device. Null on monitors (they don't calibrate) or on a
   *  projector pre-calibration. */
  setup: ProjectorSetup | null;

  /** Effective canvas dimensions in CSS px, accounting for rotation.
   *  ('Effective' = swap W↔H for 90/270 rotation.) */
  effectiveW: number;
  effectiveH: number;

  /** Background colour to fold into the returned ViewState. */
  backgroundColor: string;

  /** Primary projector's reported view fraction — populated only when
   *  this viewer is mirroring. Defaults to 1/1 (full map) so the
   *  monitor still shows SOMETHING on initial connect before the
   *  primary's first view_update lands. */
  primaryViewNW: number;
  primaryViewNH: number;

  /** Last broadcast view from the GM — used by the 'broadcast'
   *  strategy. Null between connection + first view_update; the
   *  caller is expected to handle that case (return a sentinel
   *  ViewState or skip the apply). */
  broadcastView: ViewState | null;
}

/** Default ViewState used as the safety fallback (full map, no
 *  calibration). centerX/Y at the map middle, full extent both axes. */
function fullMapView(bg: string): ViewState {
  return { centerX: 0.5, centerY: 0.5, viewNW: 1, viewNH: 1, backgroundColor: bg };
}

/** 'broadcast' — return the GM's chosen view directly. The caller has
 *  to handle the null case (between connect and first view_update). */
export function computeViewBroadcast(ctx: ComputeViewContext): ViewState | null {
  return ctx.broadcastView;
}

/** 'calibrated' — the Scaled View primary's view-derivation:
 *
 *    wMap = effectiveW * (mapPxPerSq / projectorPxPerSq)
 *    viewNW = wMap / mapImageWidth
 *    viewNH = effectiveH * (mapPxPerSq / projectorPxPerSq) / mapImageHeight
 *
 *  viewNW / viewNH are intentionally NOT clamped to 1 — when the
 *  window is bigger than the calibrated map footprint, viewNW > 1
 *  spans the camera frustum past the map plane and the empty world
 *  beyond reads as background colour (so the map sits at calibrated
 *  size with padding around it; v2.14.9 fix).
 *
 *  Falls back to the full-map view when 'full' mode is set or when
 *  any calibration input is missing. */
export function computeViewCalibrated(ctx: ComputeViewContext): ViewState {
  const bg = ctx.backgroundColor;
  if (ctx.projectorViewport.mode === 'full') return fullMapView(bg);

  if (ctx.setup && ctx.mapPixelsPerSquare && ctx.mapImageWidth > 0 && ctx.mapImageHeight > 0) {
    const ratio  = ctx.mapPixelsPerSquare / ctx.setup.pixelsPerSquare;
    const wMap   = ctx.effectiveW * ratio;
    const hMap   = ctx.effectiveH * ratio;
    const viewNW = wMap / ctx.mapImageWidth;
    const viewNH = hMap / ctx.mapImageHeight;
    return {
      centerX: ctx.projectorViewport.centerX,
      centerY: ctx.projectorViewport.centerY,
      viewNW,
      viewNH,
      backgroundColor: bg,
    };
  }
  return fullMapView(bg);
}

/** 'mirror-primary' — Scaled View monitor mirrors the primary's
 *  reported viewNW / viewNH fit-to-window. centerX/Y also come from
 *  the projector viewport (which the GM broadcasts to monitors via
 *  projector_viewport_update). */
export function computeViewMirrorPrimary(ctx: ComputeViewContext): ViewState {
  return {
    centerX: ctx.projectorViewport.centerX,
    centerY: ctx.projectorViewport.centerY,
    viewNW:  ctx.primaryViewNW,
    viewNH:  ctx.primaryViewNH,
    backgroundColor: ctx.backgroundColor,
  };
}

/** Unified dispatch — pick the strategy by `ctx.source` and return its
 *  ViewState. The 'broadcast' branch can return null (no view yet);
 *  the other two always return a ViewState (calibrated falls back to
 *  full-map if its inputs aren't ready). */
export function computeView(ctx: ComputeViewContext): ViewState | null {
  switch (ctx.source) {
    case 'broadcast':      return computeViewBroadcast(ctx);
    case 'calibrated':     return computeViewCalibrated(ctx);
    case 'mirror-primary': return computeViewMirrorPrimary(ctx);
  }
}
