# Markers & Audio — Design Plan

This document covers the full design for the Markers and Audio features across multiple
iterations. Each iteration is a shippable increment. Later iterations build on earlier ones.

---

## Overview

Two interconnected systems:

1. **Markers** — icons/tokens placed on the map by the GM. Players see non-hidden markers
   at the correct map position. Markers can be selected, moved, and configured in real time.

2. **Audio** — two modes:
   - *Background*: a single ambient loop playing at flat volume on the player screen.
   - *Positional*: markers act as audio sources or as the listener. Volume on the player
     screen is calculated from the listener-to-source distance (inverse square law).
     An optional **Tracker** on the listener renders sonar-style pings for nearby sources.

---

## Data Model

### Marker (revises the existing stub)

```typescript
export type MarkerRole = 'default' | 'listener' | 'audio_source';

export interface Marker {
  id: string;
  role: MarkerRole;

  // Position in normalised map coords (0–1 on each axis)
  position: { x: number; y: number };

  // Visual
  label:  string;           // character / place name
  icon:   string;           // emoji, or future: asset ID
  color:  string;           // hex, used for ring/background
  size:   number;           // 1.0 = default

  // Visibility
  hidden:           boolean; // GM hides from players (quick-toggle)
  hiddenFromTracker: boolean; // does NOT suppress the marker visually — only hides it
                              // from the Tracker sonar ping (audio_source markers only)

  // Audio source fields (role === 'audio_source')
  audioTrackId:       string | null; // references AudioTrack.id in the library
  audioLoop:          boolean;       // default true
  audioMuted:         boolean;
  audioMaxDistance:   number;        // normalised map units; radius of the dB circle

  // Listener fields (role === 'listener'; only one listener allowed per session)
  trackerEnabled:     boolean;
  trackerScale:       number; // 0.1–2.0; multiplier for how quickly pings return
                              // (lower = farther range, slower return; higher = closer range,
                              //  faster return).  1.0 is a neutral default.
}
```

### AudioTrack (new — lives in IndexedDB, not in session state)

```typescript
export interface AudioTrack {
  id:       string;
  name:     string;
  mimeType: string;        // 'audio/mpeg', 'audio/ogg', etc.
  data:     ArrayBuffer;   // raw file bytes — stored in IDB, sent over P2P on demand
  loop:     boolean;       // stored preference; overridden per source marker
  duration: number | null; // seconds, decoded lazily
}
```

### SessionState additions

```typescript
// Add to SessionState:
markers:         Marker[];
backgroundAudio: {
  trackId:  string | null;
  volume:   number;          // 0–1
  loop:     boolean;         // default true
  playing:  boolean;
} | null;
```

### P2P messages (new)

```typescript
export interface MsgMarkerUpdate {
  type:    'marker_update';
  payload: Marker[];           // full array always (no partial patches)
}

export interface MsgAudioUpdate {
  type:    'audio_update';
  payload: {
    background: SessionState['backgroundAudio'];
    // Marker audio state is embedded in the marker array — no separate field needed.
  };
}

export interface MsgAudioTrack {
  type:    'audio_track';
  id:      string;
  name:    string;
  mimeType: string;
  loop:    boolean;
  // Binary data travels as the second arg (ArrayBuffer) same as map images.
}
```

---

## Iteration 1 — Markers Foundation (target: v2.3.0)

**Goal:** GM can place, move, hide, and delete markers. Players see them.

### GM — Map interactions

- **Right-click on map canvas** → context menu → "Add marker here" → creates a marker at
  that map position with sensible defaults and immediately selects it.
- **"Add Marker" button** in the Markers sidebar panel → creates a marker at map centre and
  selects it (same as right-click, just centred).
- **Click a marker** on the map → selects it. A small HUD appears directly above the marker
  with two icon-buttons:
  - 👁 Hide/Show (toggles `hidden`)
  - ✕ Delete
  (These are the "quick access" controls the user requested. All other settings are in the
  sidebar.)
- **Drag a selected marker** → moves it in real time. Position updates broadcast to players
  on `pointerup` (not every `pointermove` — avoids flooding the P2P channel).
- **Drag an unselected marker** → first click selects, then user can drag (two-click intent
  avoids accidental moves).

### GM — Marker status badges (always visible on GM canvas, not shown to players)

Every marker on the GM map carries small badge icons that give an at-a-glance state
summary without needing to select the marker. These are rendered at a fixed small size
(~12 px) in the corners of the marker circle and are **clickable shortcuts** — clicking
a badge toggles that state immediately, identical to changing the value in the sidebar.

| Badge position | Icon | Meaning | Click action |
|---|---|---|---|
| Top-left | 👁 (solid) | Visible to players | Toggle `hidden` |
| Top-left | 👁‍🗨 (struck) | Hidden from players | Toggle `hidden` |
| Top-right | 🔊 (green) | Audio source, playing | Toggle `audioMuted` |
| Top-right | 🔇 (amber) | Audio source, muted | Toggle `audioMuted` |
| Top-right | 📡 (cyan) | Listener with tracker on | Toggle `trackerEnabled` |

Rules:
- The **visibility badge** is always shown on every marker (it always has a state).
- The **audio/tracker badge** is only shown if the marker has `role === 'audio_source'`
  (and has a track assigned) or `role === 'listener'` — otherwise that corner is empty.
- Badge icons are drawn slightly outside the marker circle edge so they don't obscure
  the main icon.
- On hover over a badge, a small tooltip confirms the action ("Click to hide from players",
  "Click to mute audio", etc.).
- Badge hit targets are generously sized (~20 px) despite the small visual icon to make
  them easy to click without selecting the marker body itself.

### GM — Sidebar panel (new "Markers" section)

- **Marker dropdown** at the top of the panel: lists all markers by label. Selecting one
  from the dropdown selects it on the map (solves the overlapping-marker problem).
- **Below the dropdown — selected marker controls** (auto-saved on every change):
  - Label (text input)
  - Icon (emoji picker or free-text — 1–2 emoji)
  - Color (colour swatch)
  - Size (slider 0.5–3.0)
  - Hidden toggle (mirrors the map HUD button)
  - Role selector (Default / Listener / Audio Source) — grayed out audio roles until
    Iteration 3.
- **"Add Marker" button** at the bottom of the panel.

### Player — Rendering

- A new `#markers-canvas` (2D canvas, `position: absolute; inset: 0; pointer-events: none;
  z-index: 5`) sits above the Three.js renderer canvas but below the transition canvas.
- `MarkerLayer` class subscribes to the current marker array and the current `ViewState`.
  On any change it redraws all non-hidden markers.
- Position mapping: normalised marker coords → map world space → clip through ViewState
  camera frustum → canvas pixel. Uses the same maths as `setView()` in Renderer.ts to
  ensure marker positions always align with the map image.
- Markers render as: filled circle (color), 1px white ring, emoji icon centred, small label
  below. Size param scales the circle radius.
- Players never receive `gmOnly`-hidden markers — the GM filters the array before
  broadcasting (or the broadcast includes all markers and the player filters `hidden === true`
  — simpler: just don't send hidden markers to save bandwidth).

### P2P

- `marker_update` broadcasts the full marker array whenever ANY marker changes.
- `full_state` already includes `markers: []` — now populated.

---

## Iteration 2 — Background Audio (target: v2.4.0)

**Goal:** GM uploads audio files. One ambient track loops on the player screen.

### Audio Library (GM only — stored in IndexedDB)

- New IDB object store `audioTracks` keyed by `id`.
- **"Audio Library" panel** in the GM sidebar (collapsible, below Markers):
  - Upload button → file picker (accept audio/*) → stores in IDB.
  - List of uploaded tracks with: name, duration, delete button.
  - Name is editable in place.
- No cloud storage — all audio is local to the GM's browser and transferred to players on
  demand via P2P.

### Background Audio controls (GM sidebar)

Within the Audio Library panel (or a sub-section):
- Dropdown: "Background Track" — pick from library or "None".
- Loop toggle (default on).
- Volume slider (0–100%, default 80%).
- Play/Pause button.

When the GM selects a track, a `MsgAudioTrack` message is sent first (if the player doesn't
already have it cached) followed by a `MsgAudioUpdate` with the new background state. The
player caches received track data in its own IDB store so subsequent sessions don't need
re-transfer.

### Player — Background Audio

- `AudioPlayer` class wraps the Web Audio API.
- On `audio_update` with a background track ID: look up the track in local IDB. If not
  found, request it from the GM via a data-channel message. When received, decode and
  start playback.
- Respects loop, volume, playing state.
- Auto-pauses when the browser tab is hidden (Page Visibility API) — resumes on focus.

---

## Iteration 3 — Positional Audio (target: v2.5.0)

**Goal:** Markers can be audio sources. One marker is the listener. Distance drives volume.

### Marker roles

**Listener** (one per session):
- Represents the party's position on the map.
- The player screen uses the listener's position as the audio "ear".
- Only the GM can set a marker's role to Listener; only one marker can hold this role at
  a time (selecting a new Listener auto-demotes the previous one to Default).

**Audio Source**:
- Plays a looping audio track with volume scaled by distance to the Listener.
- GM sidebar controls for the selected audio-source marker:
  - Track picker (from library) + Upload shortcut
  - Loop toggle (default on)
  - Mute toggle (quick silence without losing the track selection)
  - Max Distance slider → renders a dB circle on the GM's map showing the radius at which
    the audio will be barely audible. The circle is drawn on the GM's canvas only.
  - "Hidden from Tracker" toggle (see Iteration 4)

### Volume formula

```
distance = euclidean distance between listener and source in normalised map coords

if distance >= maxDistance:
    volume = 0
else:
    // Inverse-square roll-off, clamped
    refDistance = maxDistance * 0.1   // full volume within 10% of max range
    volume = clamp(refDistance² / distance², 0, 1) * sourceGain
```

The Web Audio API's `PannerNode` with `distanceModel: 'inverse'` and `refDistance` /
`maxDistance` uniforms handles this natively. Each audio source gets its own `PannerNode`
whose position is updated whenever the marker moves or the listener moves.

### dB Circle on GM map

When an audio-source marker is selected and has a `maxDistance > 0`, the GM canvas draws:
- A dashed circle centred on the marker, radius = `maxDistance` (converted to canvas pixels
  through the same viewport transform used by MarkerLayer).
- Label: "max range" in small text above the circle.
- The circle updates in real time as the Max Distance slider is dragged.

### Player implementation

- `AudioPlayer` (from Iteration 2) gains a `setListenerPosition(x, y)` method and a
  `setSources(markers)` method.
- On `marker_update`: `AudioPlayer.setSources(...)` reconciles the source list — creates
  new `AudioBufferSourceNode` + `PannerNode` pairs for new sources, updates positions for
  moved ones, stops removed ones.
- Listener position update: on `marker_update` where a marker has `role === 'listener'`,
  update `AudioContext.listener` position (or a virtual listener node).

---

## Iteration 4 — Tracker (target: v2.6.0)

**Goal:** The listener marker can emit sonar-style pings that return from audio sources.

### Concept

When `trackerEnabled` is true on the Listener:
- The player screen displays a circular sonar display overlaid in a corner (configurable
  size; default small, maybe 200×200 px, bottom-right).
- Every N seconds (configurable via `trackerScale`) a ping "sweeps" outward from the centre.
- Any non-hidden, non-`hiddenFromTracker` audio-source marker within detectable range causes
  a "return blip" at the correct bearing and distance from the listener.
- Return delay is proportional to distance: `returnDelay = distance / trackerScale` (seconds).
- Blips fade over ~2 seconds (phosphor-glow effect matching the Terminal Clear aesthetic).

### GM controls (on the Listener marker in the sidebar)

- **Tracker toggle** — enable/disable.
- **Scale slider** (0.2–2.0, default 1.0):
  - Low values = large effective range, slow returns (wide-area sweep).
  - High values = short range, fast returns (close-quarters scan).
- The dB circles of nearby sources are visible on the GM map when the listener is selected,
  helping the GM calibrate.

### Player rendering

- New `TrackerDisplay` class — renders to a small `<canvas>` element overlaid in the
  player view (absolute position, not the main canvas).
- Sweep animation: rotating line at constant angular velocity (one revolution per `2/trackerScale` seconds).
- Blip rendering: small phosphor-green dot at polar coords `(bearing, distance * scale_factor)`.
  Blips appear with a brief bright flash then decay. Multiple blips from the same source
  accumulate across sweeps (a trail of fading dots, classic sonar style).
- Audio-source markers that are `audioMuted` or `hidden` do NOT produce blips.
- `hiddenFromTracker` also suppresses blips (allows GM to have sources the tracker cannot
  detect — e.g. a creature stalking the party).

---

## Open Questions / Deferred

| Question | Decision needed |
|---|---|
| Audio transfer size limit | Suggest 10 MB per track for now; warn on upload |
| Player audio auto-play policy | Browsers block auto-play; show a "tap to enable audio" overlay if AudioContext is suspended |
| Marker zones (`zone` type) | Deferred — polygon regions are a bigger feature |
| Marker notes (`note` type) | Deferred — requires a popover UI |
| Tracker display position | Make it configurable (corner selector) in Iteration 4 |
| Multiple listeners | Not planned; only one listener per session |
| Audio panning (stereo L/R) | Handled natively by PannerNode if needed in a future pass |

---

## Implementation Order Summary

| Iteration | Version | Scope |
|---|---|---|
| 1 | v2.3.x | Markers: place/move/hide/delete, player rendering, sidebar panel |
| 2 | v2.4.x | Audio library (IDB), background ambient track, P2P transfer |
| 3 | v2.5.x | Positional audio (listener + sources), distance volume, dB circle |
| 4 | v2.6.x | Tracker: sonar display, ping sweep, blip returns |
