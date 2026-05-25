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

  - Soundtracks (Spotify / YouTube Music) — pack-level, not per-map.
  - Pre-flight test button polish; richer device status display.
  - HELP.md + README documentation pass.
  - Migration handling for older bundles that pre-date `.stagecraft`.
    (None needed — the field is optional and missing means "no
    assignment". Old bundles import as if they had no Stagecraft
    settings, which is the intended default.)

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
