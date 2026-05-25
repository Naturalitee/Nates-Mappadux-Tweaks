# Stagecraft (v2.16 in-progress) — Test Plan

Last updated: 2026-05-25. Beta-only. The features land in stages on
beta as patch bumps within v2.15.x; production stays at v2.15.4 until
v2.16.0 cuts.

This is a checklist you can run through to validate the Stagecraft
scaffold. Anywhere a step fails, capture the version footer + the
console (F12 → Console) and tell Claude.

---

## What's in the v2.15.5 beta

Pure addition — no existing flow should behave differently. If you
spot ANY change in non-Stagecraft behaviour, that's a regression
report.

  - **Settings → Stagecraft (Lighting + Automation)** section.
  - **Sidebar panel "Lighting / Automation"** — hidden by default;
    appears once you save at least one connection in Settings.
  - **Per-map preset/scene assignments** — pick a WLED preset or HA
    scene from a dropdown; it travels in the bundle.
  - **Map switch fires assignments** — loading a map fires the
    assigned WLED preset / HA scene. Fire-and-forget, soft-fails
    if a device is unreachable.

What is **not** in v2.15.5 (next betas):

  - Spotify Web Playback SDK integration (YouTube IFrame ships in
    v2.15.7 — see Section G).
  - Pre-flight test button polish; richer device status display.
  - HELP.md + README documentation pass.
  - Migration handling for older bundles that pre-date `.stagecraft`.
    (None needed — the field is optional and missing means "no
    assignment". Old bundles import as if they had no Stagecraft
    settings, which is the intended default.)

## What's in v2.15.6 (incremental)

  - Same as v2.15.5, plus the full Lighting/Automation panel +
    dispatcher hooks (Sections C, D, E below now testable).

## What's in v2.15.7 (Soundtracks scaffold)

  - YouTube IFrame Player wrapper (no OAuth needed).
  - Soundtracks panel (Settings → Stagecraft → Soundtracks toggle to
    show). Four slots: Pre-setup, Theme / Intro, Outro, Playlist.
  - Paste YouTube / YouTube Music URLs into slots; Play / Pause /
    Stop per slot; Playlist slot auto-advances + loops.
  - Soundtracks travel in `.mappadux` exports under `bundle.soundtracks`.

---

## A. WLED — Settings flow

A device on the LAN running WLED firmware is the minimum prerequisite.
Configure at least one preset in WLED's own UI before testing.

### A1. Add an endpoint

  - Open ☰ → Settings → expand "Stagecraft (Lighting + Automation)".
  - Under WLED endpoints, type a label (e.g. "Table strip") and a URL
    (e.g. `192.168.1.42` or `wled-table.local` — the scheme defaults
    to `http://`).
  - Click Add.
  - Expected: the row appears in the list with "(not tested yet)".

### A2. Test the endpoint

  - Click Test on the row.
  - Expected (device reachable): `OK — "<name>", WLED <version>, <N> LEDs.`
  - Expected (device unreachable): `Failed: <reason>` — usually a
    timeout or network error.
  - The browser console may show a CORS warning. WLED's stock
    firmware ships with `Access-Control-Allow-Origin: *`; if the
    request is being blocked, the firmware version is unusual or
    behind a proxy / reverse proxy that strips CORS headers.

### A3. Remove an endpoint

  - Click Remove on a row.
  - Expected: the row vanishes; the Lighting / Automation panel hides
    if this was the last connection.

---

## B. Home Assistant — Settings flow

Prerequisite: an HA instance reachable from this browser (LAN, https
preferred; http works if mixed-content allow is set). Create a
**long-lived access token** under HA → Profile → Long-Lived Access
Tokens before testing.

### B1. Save the connection

  - Settings → Stagecraft → Home Assistant section.
  - Enter the URL (e.g. `http://homeassistant.local:8123`) and paste
    the long-lived token.
  - Click Save.
  - Expected: button text becomes "Save changes"; Disconnect appears.

### B2. Disconnect

  - Click Disconnect.
  - Expected: fields clear; Save reverts.

---

## C. Sidebar panel visibility

### C1. Panel appears when configured

  - With zero connections: the "Lighting / Automation" panel should
    NOT appear in the left sidebar (between Soundboard and Markers).
  - Save a WLED endpoint OR HA connection in Settings, close Settings.
  - Expected: the panel now appears.

### C2. Panel hides when all connections removed

  - Remove all configured connections in Settings.
  - Expected: the panel disappears after Settings closes.

---

## D. Per-map assignments

Prerequisites: configured WLED endpoint(s) and/or HA. Map loaded.

### D1. Pick a WLED preset

  - Open the Lighting / Automation panel.
  - For each configured WLED endpoint, a dropdown lists its presets
    fetched live from the device (`Loading presets…` shows briefly).
  - Pick a preset.
  - Expected:
    - The WLED device immediately runs the preset (because saving the
      assignment doesn't fire — only the map switch / Fire button does).
      Actually wait — saving DOES NOT fire automatically; you have to
      click "Fire now (test)" or switch maps.
    - The dropdown shows the chosen preset.

### D2. Pick a Home Assistant scene/script

  - Same flow; the HA row groups entities by domain (Scenes / Scripts /
    Automations).
  - Expected: dropdown shows your choice.

### D3. None / clear assignment

  - Pick "(none — do nothing on this map)" on any dropdown.
  - Expected: subsequent map switches no longer fire that device.

### D4. Refresh devices

  - Click "Refresh devices" — re-pulls preset / entity lists from
    the configured devices.
  - Useful after authoring new presets in WLED or new scenes in HA.

### D5. Fire now (test)

  - Click "Fire now (test)" — fires every assignment for the active
    map immediately.
  - Expected: lights change / HA scene runs, status line confirms.

---

## E. Map switch behaviour

### E1. Loading a map fires assignments

  - Assign different WLED presets to two different maps.
  - Switch between them via the Map dropdown.
  - Expected: lights change on each switch, immediately.

### E2. Same-map reload does NOT re-fire

  - Edit a handout map or do something that triggers an in-place
    map reload.
  - Expected: lights do NOT re-strobe; the dispatcher's
    `_lastStagecraftFiredMapId` guard suppresses duplicate fires.

### E3. Unreachable device doesn't block map switch

  - Turn off the WLED device (or use a deliberately-wrong endpoint).
  - Switch maps.
  - Expected: map switch completes normally; a `[stagecraft] WLED ...`
    warning appears in the console; no UI freeze, no error toast.

---

## F. Bundle round-trip

### F1. Export carries assignments

  - Assign a WLED preset to a map.
  - ☰ → Save Map Pack… → save the bundle.
  - Open the saved `.mappadux` in a text editor; search for
    `"stagecraft"`. Expected: present, with the per-map assignment
    visible.

### F2. Import preserves assignments

  - Load the saved bundle in a different browser (or after a Delete
    All Data).
  - Add the SAME WLED endpoint (or a different one — preset
    references are by id, so they only resolve if the recipient has
    a device with matching preset ids; for cross-machine reuse, name
    discipline matters more than the technical round-trip).
  - Open the previously-assigned map.
  - Expected: the per-map dropdown shows the assigned preset.

### F3. Bundle does NOT carry connection details

  - In the exported `.mappadux`, search for the WLED endpoint URL
    or the HA token.
  - Expected: NEITHER appears anywhere. Only the per-map preset id /
    HA entity id reference travels. Tokens and URLs stay in
    localStorage on each machine.

---

## Regression smoke tests

Things to spot-check that should be unaffected:

  - Library / Add Map / Composite Editor / Text Map Editor — all
    behave identically to v2.15.4.
  - Save / Load Map Pack on a pack WITHOUT Stagecraft assignments —
    bundle is byte-comparable to the v2.15.4 export.
  - Player / Scaled View — no Stagecraft chrome should appear; this
    is GM-only.
  - GM-canvas undo / redo, marker chrome, composite layering — all
    fine on top of v2.15.4 production behaviour.

---

## G. Soundtracks (YouTube) — v2.15.7

### G1. Enable the panel

  - Settings → Stagecraft → Soundtracks subsection.
  - Tick "Enable Soundtracks panel".
  - Close Settings.
  - Expected: a new **Soundtracks** panel appears in the sidebar
    above the Lighting / Automation panel.

### G2. Add a YouTube track to a slot

  - Open the Soundtracks panel — four slots: Pre-setup, Theme / Intro,
    Outro, Playlist.
  - Paste a YouTube URL into a slot's input (e.g.
    `https://www.youtube.com/watch?v=dQw4w9WgXcQ` or
    `https://music.youtube.com/watch?v=...` or just the 11-char id).
  - Click Add (or press Enter).
  - Expected: the track appears in the slot's list.

### G3. Play / Pause / Stop a slot

  - Click Play on a slot containing tracks.
  - Expected: a hidden YouTube IFrame plays the first track. (You
    don't see it; you hear it.)
  - The slot's Play button switches to Pause; the active track is
    highlighted.
  - Click Pause → audio pauses.
  - Click Stop → audio stops, the slot returns to idle state.

### G4. Playlist auto-advance

  - Add 2+ tracks to the Playlist slot.
  - Click Play.
  - When a track ends, the next track auto-plays.
  - At the end of the list, it loops back to the first track.
  - Non-Playlist slots (Pre-setup / Theme / Outro) play once and stop.

### G5. Soundtracks survive map switches

  - Start the Playlist slot.
  - Switch maps via the Map dropdown.
  - Expected: music keeps playing. The per-map Audio panel
    (Soundboard) continues to be the short-term audio layer; the
    Soundtracks layer is independent and persistent.

### G6. Bundle round-trip

  - Add tracks; Save Map Pack.
  - Open the `.mappadux` file in a text editor; search for
    `"soundtracks"`. Expected: the slot structure with track refs
    is present at the top level.
  - Load the pack in a fresh browser; expected: the Soundtracks
    panel shows the same tracks once you enable it.

### G7. Disable the panel

  - Settings → uncheck "Enable Soundtracks panel".
  - Expected: the panel disappears; any currently-playing track stops.

### G8. Known YouTube quirks

  - Some videos are not embeddable (rights holder restrictions).
    YouTube IFrame logs an error to the console; the track will
    silently fail to start. Try a different video.
  - First-time start may pause briefly while the YouTube IFrame
    script loads (a few hundred kB from `youtube.com`).
  - YouTube ads will play if the video has them. Mappadux can't
    skip them — that's a YouTube-side decision.

---

## H. QLC+ (DMX lighting) — v2.15.10

Prerequisite: a QLC+ instance reachable from this browser. Enable
QLC+'s Web Interface (Functions → Web Interface in the QLC+ menu)
— it opens a port on `:9999` by default. Author at least one
Function (scene / chaser / etc.) in QLC+ before testing.

### H1. Add the connection

  - Settings → Stagecraft → QLC+ subsection.
  - Enter the URL — bare host like `192.168.1.50` works (port + path
    default to `:9999/qlcplusWS`). Full `ws://...` URLs also accepted.
  - Click Save, then Test.
  - Expected: Test reports `OK — N Functions reported.`
  - On failure: timeout suggests the device is unreachable; network
    error suggests the Web Interface isn't enabled in QLC+.

### H2. Lighting / Automation panel — QLC+ row

  - With a QLC+ connection saved, the Lighting / Automation panel
    shows a third row: `QLC+:` with a dropdown grouped by Function
    type (Scene / Chaser / Collection / Sequence / RGBMatrix / EFX /
    Audio / Video / Show / Script).
  - Pick a Function.
  - Click "Fire now (test)" — the Function should start on the DMX
    rig.

### H3. Map switch fires the QLC+ Function

  - Assign different Functions to two different maps.
  - Switch maps — each fires its assigned Function.

### H4. Known QLC+ quirks

  - QLC+ doesn't expose CORS headers on its WebSocket the way
    browsers expect for cross-origin secure contexts. Mappadux runs
    over HTTPS in production (`www.mappadux.com`) but QLC+ runs over
    plain WebSocket (`ws://`). **Browsers block ws:// from https://
    pages** — that's the "mixed content" rule. If you're hitting
    Mappadux on `https://`, the QLC+ connection will fail. Two
    workarounds: (a) run Mappadux from `http://localhost:5173` for
    dev / `npm run dev`; (b) put a reverse proxy in front of QLC+
    that terminates TLS to expose `wss://`.
  - Functions list message format is pipe-separated triples
    `<id>|<name>|<type>`. If a Function name contains a literal
    `|`, parsing may go sideways. Avoid pipes in QLC+ Function
    names if possible.

## Banked for v2.16 (not yet built)

  - **Spotify Web Playback SDK** — alongside YouTube. Premium-
    account OAuth (PKCE).
  - **Crossfade between Playlist tracks** — needs a second
    YouTube IFrame to fade between.
  - **YouTube oEmbed title lookup** — display real track titles
    instead of `YouTube: <videoId>`.

## Known limitations / not-yet

  - The dispatcher fires on EVERY state-notify with `map` change,
    deduplicated by last-fired-map-id. If the GM switches maps
    rapidly back-and-forth (A → B → A → B), each switch fires.
    That's probably correct behaviour but worth confirming.
  - HA `automation` triggering uses `/api/services/automation/trigger`
    (not `turn_on`). Untested against a live HA — confirm a script
    or scene first.
  - WLED preset list is cached per-session (per endpoint). If you
    author a new preset in WLED while Mappadux is open, click
    Refresh devices on the panel to see it.
  - No "what's currently playing" display — Mappadux is fire-and-
    forget; the device's own UI is the source of truth.
