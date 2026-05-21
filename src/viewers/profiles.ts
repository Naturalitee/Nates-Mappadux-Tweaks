/**
 * Built-in Viewer profiles + a lookup registry so callers can resolve a
 * profile by id (e.g. from a URL parameter or a stored preference).
 *
 * Phase 1: data only. Nothing consumes these yet — PlayerApp and
 * ProjectorApp continue to run their current code paths. Phase 2 will
 * have the new Viewer class read these profiles to drive its boot.
 *
 * Adding a new profile = define a new constant here, register it in the
 * Map, document it. No other code changes required at the data layer.
 */

import type { ViewerProfile } from './ViewerProfile.ts';

/** Standard player browser window — the URL late-joiners scan into.
 *
 *  - View comes from the GM's broadcast (centerX/Y + viewNW/H as set).
 *  - Resize fits whatever crop the GM has chosen into the new canvas.
 *  - No grid overlay today; deferred #13 will flip `grid.kind` to
 *    'map-relative' and add the renderer for it.
 *  - Filter renders unconditionally — players see whatever the GM has
 *    set as the player-facing visual mood.
 *  - Marker labels render only when the per-marker showLabel is true. */
export const PROFILE_PLAYER: ViewerProfile = {
  id:                'player',
  description:       'Player browser window — fit-to-window, GM-driven crop, full transitions.',
  broadcastTarget:   'player',

  view: {
    source:          'broadcast',
    onResize:        'fit',
    onMapAspect:     'follow-broadcast',
  },
  grid:        { kind: 'none' },
  filter:      { gate: 'always-on' },
  transitions: { mode: 'full' },

  chrome: {
    fullscreenBtn:       true,
    muteIndicator:       true,
    roomCodeInput:       true,
    monitorBadge:        false,
    calibrationSetupBtn: false,
    calibrationWarning:  false,
    holdScreenQr:        true,
    qrTarget:            'self',
  },
  markerLabel: { rule: 'showLabel-only' },
  interact:    { panZoom: false, resetViewBtn: false },  // flip true to enable #1 player zoom/pan
};

/** Primary Scaled View — calibrated table-scale display. The first
 *  projector window to connect for a session gets this role.
 *
 *  - View comes from the calibration math (map pxPerSq vs projector
 *    pxPerSq vs canvas dims). 1″ on the map projects as 1″ on the
 *    physical surface.
 *  - Resize preserves the physical scale: a bigger window reveals more
 *    of the map (or empty space around it); pixels stay calibrated.
 *  - Grid drawn in projector CSS pixels per inch — fixed in
 *    screen-space, locked to the projector's calibration.
 *  - Filter gated by the GM's Disable-Filter toggle so the table can
 *    show clean battlemaps while players still see filtered views.
 *  - No transitions; cuts straight to each new frame. */
export const PROFILE_SCALED: ViewerProfile = {
  id:                'scaled',
  description:       'Primary Scaled View — calibrated 1″/25 mm display on a TV / under-table screen / projector.',
  broadcastTarget:   'projector',

  view: {
    source:          'calibrated',
    onResize:        'preserve-scale',
    onMapAspect:     'recompute',
  },
  grid:        { kind: 'projector-calibrated' },
  filter:      { gate: 'projector-toggle' },
  transitions: { mode: 'cut-to-frame' },

  chrome: {
    fullscreenBtn:       true,
    muteIndicator:       false,
    roomCodeInput:       true,
    monitorBadge:        false,
    calibrationSetupBtn: true,
    calibrationWarning:  true,
    holdScreenQr:        true,
    qrTarget:            'player',
  },
  markerLabel: { rule: 'showLabel-only' },
  interact:    { panZoom: false, resetViewBtn: false },
};

/** Secondary Scaled View "monitor" — mirrors the primary's calibrated
 *  crop, fit-to-window in its own canvas.
 *
 *  Sits halfway between the player and scaled-primary semantics:
 *
 *  - Crop is calibration-derived (via the primary's reported viewNW/H),
 *    NOT a separate calibration of its own. Monitors don't calibrate.
 *  - Resize fits-to-window since the crop is already chosen.
 *  - Grid scales proportionally with the monitor's window (matches
 *    Alex's v2.14.10 monitor-grid implementation).
 *  - Filter follows the primary — Disable-Filter on the primary
 *    propagates to monitors automatically through the broadcast.
 *  - Carries the monitor badge ("PROJECTOR MONITOR N") and no
 *    calibration setup affordance. */
export const PROFILE_SCALED_MONITOR: ViewerProfile = {
  id:                'scaled-monitor',
  description:       'Secondary monitor — mirrors the primary Scaled View\'s crop fit-to-window.',
  broadcastTarget:   'projector',

  view: {
    source:          'mirror-primary',
    onResize:        'fit',
    onMapAspect:     'follow-broadcast',
  },
  grid:        { kind: 'monitor-proportional' },
  filter:      { gate: 'follow-primary' },
  transitions: { mode: 'cut-to-frame' },

  chrome: {
    fullscreenBtn:       true,
    muteIndicator:       false,
    roomCodeInput:       false,
    monitorBadge:        true,
    calibrationSetupBtn: false,
    calibrationWarning:  false,
    holdScreenQr:        true,
    qrTarget:            'player',
  },
  markerLabel: { rule: 'showLabel-only' },
  interact:    { panZoom: false, resetViewBtn: false },
};

/** Profile registry. Keyed by `id` so callers can resolve a profile
 *  string (e.g. from a URL param) to a profile object. */
const PROFILES: ReadonlyMap<string, ViewerProfile> = new Map([
  [PROFILE_PLAYER.id,         PROFILE_PLAYER],
  [PROFILE_SCALED.id,         PROFILE_SCALED],
  [PROFILE_SCALED_MONITOR.id, PROFILE_SCALED_MONITOR],
]);

/** Look up a profile by id. Returns null when unknown — callers should
 *  surface a clear error rather than silently fall back. */
export function getViewerProfile(id: string): ViewerProfile | null {
  return PROFILES.get(id) ?? null;
}

/** Enumerate all registered profiles. Used by future diagnostics /
 *  settings UI. */
export function allViewerProfiles(): ViewerProfile[] {
  return Array.from(PROFILES.values());
}
