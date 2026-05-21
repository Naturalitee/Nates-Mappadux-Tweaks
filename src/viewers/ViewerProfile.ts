/**
 * Viewer profile — a capability template for a remote viewer window.
 *
 * Before v2.15 the Player and Scaled (projector) windows were two parallel
 * top-level apps (`PlayerApp`, `ProjectorApp`) that did ~80% the same work in
 * parallel. Every cross-cutting fix had to land twice and any new viewer
 * variant — most obviously the "scaled-monitor" mode which sits halfway
 * between the two — needed both apps tweaked.
 *
 * The Viewer abstraction is a single class driven by a profile object. The
 * profile names a small set of capability flags + behavioural discriminants;
 * the Viewer reads those at boot to assemble the right chrome and to dispatch
 * the variant-specific logic (view computation, grid drawing, etc.).
 *
 * Adding a new viewer kind = adding a new profile constant and (if needed) a
 * new strategy implementation. The Viewer itself stays untouched.
 *
 * Phase 1 (this file): the type. No code uses it yet — PlayerApp and
 * ProjectorApp keep running. Phase 2 will lift the common Viewer surface,
 * Phase 3 will wire the profile into dispatch. See
 * [[project_dmr_viewer_refactor_design]] in the project memory.
 */

/** Stable identifier for a profile. String-typed (not a closed union) so we
 *  can register new profiles without touching this file. */
export type ViewerProfileId = string;

/** Top-level broadcast target the GM uses for `view_placeholder` and any
 *  other message that needs to distinguish "player view" from "projection
 *  view". Two values today; matches the existing message taxonomy. */
export type BroadcastTarget = 'player' | 'projector';

/** How the viewer derives its visible map crop. */
export type ViewSource =
  /** Take centerX/Y/viewNW/H straight from the broadcast view state. The
   *  GM drives what the player sees. */
  | 'broadcast'
  /** Compute viewNW/H from the calibration math (map pxPerSq vs projector
   *  pxPerSq vs canvas dims) so the rendered map sits at calibrated
   *  physical size regardless of window size. */
  | 'calibrated'
  /** Mirror the primary projector's crop. centerX/Y + viewNW/H come from
   *  the primary's reported viewport, then fit-to-window in this canvas. */
  | 'mirror-primary';

/** What to do when the viewer's own canvas resizes. */
export type ResizeBehaviour =
  /** Re-fit whatever crop we have into the new canvas dimensions. The map
   *  content scales with the window. */
  | 'fit'
  /** Re-derive viewNW/H from calibration so the map content stays at the
   *  same physical CSS-px-per-inch and the canvas reveals more / less of
   *  the surrounding map and padding. */
  | 'preserve-scale';

/** What to do when a new map arrives with a different aspect ratio. */
export type MapAspectBehaviour =
  /** Trust the broadcast view; the GM has computed crops for the new map's
   *  aspect already. */
  | 'follow-broadcast'
  /** Recompute the calibrated crop after the new map texture loads (the
   *  v2.14.8 fix for the projector). */
  | 'recompute';

/** Grid overlay kind. */
export type GridKind =
  /** No grid overlay drawn on this viewer. */
  | 'none'
  /** 1" / 25 mm grid drawn at the projector's calibrated CSS pixels per
   *  square. Fixed in screen-space regardless of map content. The primary
   *  Scaled View uses this. */
  | 'projector-calibrated'
  /** 1" / 25 mm grid sized proportionally to the monitor's mirror of the
   *  primary's crop — spacing derived from primary's mapPxPerSq, this
   *  monitor's canvas width, primary's viewNW, and the map's pixel width.
   *  Scaled View monitors use this. */
  | 'monitor-proportional'
  /** 1" / 25 mm grid sized in MAP coordinates so it scales with the map as
   *  the window resizes. The deferred #13 Player View grid uses this. */
  | 'map-relative';

/** How the visual filter is gated. */
export type FilterGate =
  /** Filter always renders. Player view default. */
  | 'always-on'
  /** Filter renders only when projectorViewport.filterEnabled is true. The
   *  GM's Disable-Filter toggle drives this for the Scaled View. */
  | 'projector-toggle'
  /** Whatever the primary projector is doing. Monitor views follow. */
  | 'follow-primary';

/** Transition rendering depth. */
export type TransitionMode =
  /** Full TransitionEngine — animated reveals etc. Player has this. */
  | 'full'
  /** Cut directly to the final frame; no animations. Projector + monitors
   *  use this (per the existing handout_reveal handler). */
  | 'cut-to-frame';

/** Rule for whether to render a marker's text label. The marker's hidden
 *  flag is independent — hidden markers never render at all (they go
 *  through the broadcastMarkers filter on the GM side). This rule applies
 *  to NOT-hidden, labeled markers. */
export type MarkerLabelRule =
  /** Only when the marker's per-marker showLabel is true. Player default. */
  | 'showLabel-only'
  /** Always when the marker has a label, regardless of showLabel.
   *  Reserved for views that want every named entity visible (e.g. a
   *  future GM-secondary-screen variant). */
  | 'always-when-labeled';

/** Hold-screen QR target. The faff overlay (shown when the GM bypasses
 *  broadcast) carries a "Not connected, yet?" QR. The URL it points at
 *  differs by viewer kind. */
export type HoldScreenQrTarget =
  /** This window's own URL (e.g. a player window's player URL). */
  | 'self'
  /** The PLAYER URL derived from this window's room code. Used by Scaled
   *  View / monitor windows since late-joiners scan the QR to become
   *  players, not projectors. */
  | 'player';

/** Capability flags for optional chrome elements. The Viewer reads these
 *  at boot and conditionally constructs each piece. */
export interface ViewerChromeCaps {
  /** Floating bottom-right fullscreen toggle. */
  fullscreenBtn:        boolean;
  /** Audio mute / unmute toast indicator. Player has it. */
  muteIndicator:        boolean;
  /** Room-code input panel shown when the URL fragment is empty. */
  roomCodeInput:        boolean;
  /** Red "PROJECTOR MONITOR N" badge in the corner. Monitor only. */
  monitorBadge:         boolean;
  /** "Calibrate" button to open the ProjectorCalibrationModal. Scaled
   *  primary only — monitors don't have their own calibration. */
  calibrationSetupBtn:  boolean;
  /** Top-banner "Map not calibrated" warning when running in scaled mode
   *  without a calibrated map. */
  calibrationWarning:   boolean;
  /** "Not connected, yet?" QR + URL panel inside the faff hold screen. */
  holdScreenQr:         boolean;
  /** What URL the hold-screen QR encodes. */
  qrTarget:             HoldScreenQrTarget;
}

/** Interactivity capabilities — pan, zoom, reset. Reserved for the
 *  deferred #1 Player View pan/zoom work. Off everywhere today. */
export interface ViewerInteractCaps {
  panZoom:         boolean;
  resetViewBtn:    boolean;
}

/** Complete viewer profile. Pure data; no behaviour lives here — the
 *  Viewer reads these fields and dispatches accordingly. */
export interface ViewerProfile {
  id:                ViewerProfileId;
  description:       string;
  broadcastTarget:   BroadcastTarget;

  view: {
    source:          ViewSource;
    onResize:        ResizeBehaviour;
    onMapAspect:     MapAspectBehaviour;
  };

  grid: {
    kind:            GridKind;
  };

  filter: {
    gate:            FilterGate;
  };

  transitions: {
    mode:            TransitionMode;
  };

  chrome: ViewerChromeCaps;
  markerLabel: { rule: MarkerLabelRule };
  interact:    ViewerInteractCaps;
}
