# Changelog

## v2.16.42 — 2026-05-31

### Retired the giant "Tap to start audio" prompt

The pre-interaction full-bleed "🔇 Muted — tap anywhere to start
audio" overlay is gone. It was a workaround for older browser
autoplay policies — modern browsers accept the connect-button click
(and pop-out via window.open) as user activation. The small mute
icon at the top-right is now the single affordance: transparent
until clicked, click to toggle. Same icon, same place, just no
giant prompt taking over the screen first.

PiP iframes (`?pip=1`) skip the mute indicator entirely and stay
silently muted — audio in a 33 %-canvas preview is pointless and
the indicator was dominating the small frame. Pop-out windows from
the PiP carry no flag, so they get sound + the small toggle.

## v2.16.41 — 2026-05-31

### GM canvas drops the animated backdrop layer

Backdrop shader (Starfield / Aurora / Embers / etc.) no longer
renders on the GM canvas. The basic background colour still
applies. Saves CPU + GPU on the GM workspace and cleans up the
view — the PiP preview shows what the player + projector
audiences see, so the GM no longer needs to run the shader twice.

The backdrop config still travels through `state.view.backdrop` so
the `view_update` broadcast carries it to the audience views
unchanged.

## v2.16.40 — 2026-05-31

### Inline Player View preview (PiP) on the GM canvas

- **New "Show Player View" pill at the bottom-left of the canvas.** Click
  to open an inline preview frame — 33 % canvas-width at 16:9, defaults
  to the bottom-left, draggable anywhere on the canvas with the position
  persisted across reloads (`dmr_pip_position`).
- **Header chrome on the inline frame**: minimise back to the pill,
  pop-out to a standalone window. Pop-out reopens the pill so the GM
  can spawn another inline preview as many times as wanted — useful when
  one window is already on a second display and the GM wants a local
  preview of what's showing there.
- **"Open Player Window" button retired** from the Player Views panel.
  Replaced entirely by the PiP overlay's pop-out chrome. One concept,
  one place.
- **Iframe loads the player URL with `?gmPreview=1`** so the inline
  preview is a viewer of the live state — no identify modal, no
  player-only UI, no token. Same flag the old preview popup used.
- **Defaults to open on first session** so a new GM immediately sees
  what their players see. State persists (`dmr_pip_visible`).

## v2.16.39 — 2026-05-31

### Unified side-panel control builders

- **New `src/gm/sideParamRows.ts`** — single canonical implementation
  of `buildColorRow`, `buildSliderRow`, `buildToggleRow`, and
  `buildSelectRow`. Lifts the shape, classes, label-column width, and
  tooltip behaviour from Backdrop / MapFX (where the look was already
  the way we wanted) so every side panel renders identical markup.
- **`FilterPanel` + `TransitionPanel` rebuilt on top of it.** The
  colour pickers, sliders, and toggles in Visual Filter and Map
  Transition now match Backdrop and MapFX exactly — same row layout,
  same hover tooltip, same alignment. Filter's collapsible param
  groups stay (only filters need them); everything inside is uniform.
- **`GMApp._buildShader*` wrappers now delegate to the shared
  builders** so the canonical version is the only place the markup
  lives. Wrappers stay around for the kind-label suffix + the
  0/1↔boolean conversion for shader toggles — small adapters over
  the shared core.

Going forward, any new tunable surface uses these builders by
default. Drift across panels can't accumulate any more — there's
literally only one row implementation now.

## v2.16.38 — 2026-05-31

### Map Transition joins the kind-row + side-panel pattern

Inline `<select>` for the transition kind picker; sliders icon opens
the side panel with the transition's params. Matches Backdrop, MapFX
and Visual Filter — every panel with the "pick a kind + tune its
params" shape now lives on the same framework.

## v2.16.37 — 2026-05-31

### Visual Filter joins the new design language

- **Visual Filter promoted to the kind-row pattern.** Inline `<select>`
  for the filter picker on the Visual Filter panel; sliders icon next
  to it opens the side panel with the "Tint Player Markers" toggle
  (gated by markers-on-this-map) + all the filter's parameter controls.
  Matches Backdrop and MapFX exactly.
- **FilterPanel rebuilds inside the side panel** on each open, so the
  inline `#filter-params` container is gone. State stays in
  `state.filter.params` as before — every change writes through live;
  closing the side panel is the implicit save.
- **Click-to-close on the canvas now reliably dismisses the side panel.**
  The outside-click listener switched from bubbling `mousedown` to
  capture-phase `pointerdown`, matching the rest of the GM's input
  pipeline. The bubbling path was occasionally getting consumed by
  the gesture handlers downstream.

## v2.16.36 — 2026-05-31

### Side panel slides from the sidebar; width follows UI scale

- **Reanchored.** The side panel now slides out from BEHIND the
  sidebar (anchored to its right edge, hidden behind it when closed)
  rather than appearing from the far-right edge of the screen. Feels
  like a continuation of the sidebar instead of a disconnected overlay
  on the other side of the canvas.
- **UI-scale-aware.** Width is `calc(340px * var(--ui-scale))`, so
  Settings → UI Scale dials the panel up / down in lock-step with
  the sidebar. Max-width still respects the available viewport area.
- **Implicit save-and-close on canvas click.** Already worked by
  virtue of the outside-click dismiss; the change handlers on every
  control write through to state live, so closing the panel is the
  full commit. Explicit X / Escape still close.

## v2.16.35 — 2026-05-31

### Side-panel framework + Backdrop / MapFX first users

- **New right-edge side-panel framework** (`src/gm/SidePanel.ts`,
  `.side-panel` CSS). Slides in from the right, single panel at a
  time, header + scrollable body, outside-click / Escape / X button
  to close. Re-usable foundation that the Visual Filter, Player Voice
  threads, and any future "configure this thing" surface will hang
  off.
- **Backdrop kind picker promoted from popover to inline `<select>`**
  on the Map panel row. The tune button (sliders) opens the side
  panel with Background colour + the kind's params; switching the
  kind from the dropdown auto-refreshes the panel body + title.
- **MapFX kind picker promoted from popover to inline `<select>`** on
  the FoW panel row, with the same side-panel treatment. The kind
  picker no longer needs to live inside the popover — it lives
  exactly where the GM looks for it.
- **`FxPopover` kept around as dead code** so anything still depending
  on the old call shape doesn't break; will be removed in a follow-up
  once the rest of the sweep (Visual Filter, etc.) settles.

## v2.16.34 — 2026-05-31

### Design language sweep — adjacent "+" + sliders for tune

- **"+" button beside each picker** on Map / Markers / Display rows.
  The "Add new..." sentinel that used to live at the bottom of the
  dropdown is gone — easy to miss, slow to discover. The adjacent
  icon button is the standard pattern (Stripe, Linear, GitHub, Material).
- **Sparkle → sliders icon** on Backdrop and MapFX (FoW) tune buttons.
  Sparkle reads as "fancy effect", not "configure parameters". The
  sliders-horizontal Lucide glyph is the standard "tune parameters"
  affordance — matches what people are used to in audio plugins,
  dashboards, and settings dashes.

Next on the design sweep: a generic right-edge side-panel framework
(v2.16.35), then promote Visual Filter's param controls into it
(v2.16.36), then the same treatment for Backdrop + FoW tune popovers
and the Player Voice messaging threads when each lands.

## v2.16.33 — 2026-05-31

### Sidebar simplify — reorg + Player Connection retired

- **Map Selection promoted to the top of the sidebar.**
- **Player Connection panel deleted.** The QR + URL display, the
  player-count line, the broker-error notice, and the Open Player
  Window button all lived there. The hold screen players see when
  they can't reach the GM picks up the URL responsibility; the
  per-row green pulse indicators on the Players panel already give
  the count feedback at a glance; Open Player Window relocated.
- **Scaled View renamed to Player Views.** The single panel now houses
  everything broadcast-to-audience: Open Player Window (relocated),
  Display picker, rotation, Disable Filters, etc.
- **Two broadcast-bypass switches collapsed into one.** The Player
  Views header toggle now hides BOTH player and projector audiences
  simultaneously when off. Was prone to leaving half the audience
  in the hold screen and the other half live.
- **Player Voice panel deleted.** Messaging surface returns as a
  right-edge slide-out triggered by per-row unread badges on the
  Players panel when we revisit messaging functionality. Until then
  the existing panel's empty list adds nothing.

## v2.16.32 — 2026-05-31

### Visual Filter — honest label, gated visibility

- **"Affect Player Markers" renamed to "Tint Player Markers".** The CSS
  approximation only reproduces the colour half of a filter (palette
  shift / brightness / contrast / blur) — none of the procedural
  scanlines / grain / animation can be expressed in DOM `filter:` land.
  The new label says what the toggle actually does so it doesn't
  oversell.
- **Toggle only appears when this map has at least one player marker.**
  Hidden by default in HTML; flipped on alongside marker placement so
  it doesn't clutter the panel on maps where the option would be a no-op.

## v2.16.31 — 2026-05-31

### Small icons go inline; GM reset leaves a breathing margin

- **SVG-derived icons no longer race over PeerJS.** Player-icon delivery
  used a chunked binary transport (header + JSON + binary chunks) for
  every icon regardless of size — and during multi-player identify
  cycles, back-to-back small-icon broadcasts could intermittently lose
  a delivery. Icons whose `data:` URL is ≤ 10 KB now ride INLINE on the
  JSON message (single frame, atomic), which covers the SVG-derived
  ones that were affected. Bitmap icons larger than 10 KB still use
  chunked transport as before. The receiver already supported both
  paths.
- **GM workspace reset leaves a small breathing margin.** First paint
  and Reset View now sit at scale 0.95 instead of 1.0, so the map has
  a few-pixel border around every edge — easier to reach the panel
  icons that hug the workspace edges. Player + projector views still
  fill their canvases. 'R' key + Reset View button both honour the new
  default.

## v2.16.30 — 2026-05-31

### Patch E — optional filter pass over player tokens

Per-map toggle in the Visual Filter panel: **Affect Player Markers**.
When on, the player + projector views apply a CSS approximation of the
active filter to the player-marker-layer DOM overlay so tokens visually
participate in night-vision green, candlelight warmth, thermal, horror,
mist, etc. — without the GM having to rebuild them as WebGL sprites.

- **Default off.** Remembered per map (stored on `FilterState`).
- **Mapping table** in `src/filters/cssApproximations.ts` covers the
  filters where CSS `filter` primitives translate well (tints, blurs,
  contrast / brightness shifts). Stylisation filters (watercolour, oil,
  parchment, hand-drawing) have no faithful CSS analogue and return
  empty — the toggle still flips but produces no visible change for
  those. Tune individual approximations in that one file as the look
  evolves.
- **GM preview included.** The toggle applies the same CSS to the GM's
  own player-marker layer, so the GM sees the same look the player +
  projector will render.
- **Bypass-aware on the projector.** When the projector's per-viewport
  filter gate is off, the marker-layer filter is cleared too — keeps
  the table-screen tokens clean if the projector's been put into
  no-filter mode.

## v2.16.29 — 2026-05-31

### Fix — zoom anchor stays glued off-centre

After v2.16.28 the player view fills the canvas when zoomed in (clip
pass suppressed), but wheel + pinch + drag-pan were still computing
world coordinates from the GM-defined viewport's normalised dims —
so off-centre zooms drifted because the rendered view extended past
those dims in one axis. Now the gesture handlers anchor on the
EFFECTIVE viewport (canvas-aspect extension), so the world point under
the cursor / centroid stays glued through the gesture regardless of
where on the canvas you anchor. Drag-pan also uses the effective
viewport, so a full-canvas-wide drag moves by the full canvas width
of world instead of the smaller GM-viewport width.

## v2.16.28 — 2026-05-31

### Zoom fixes — projector locked; player zoom-in fills the canvas

- **Projector is now scale-locked on touchscreens too.** The projector
  view is calibrated to the physical table; mouse-wheel zoom was
  already disabled, but native pinch-zoom + double-tap-zoom +
  pull-to-refresh were still active on touchscreen-mounted browsers
  (TV / tablet projectors). Added `touch-action: none` +
  `overscroll-behavior: none` on `body.projector-view` to lock the
  scale.
- **Player zoom-in no longer bars the view to the GM aspect.** The
  renderer's clip pass blacks out canvas pixels outside the GM-defined
  viewport's aspect so the player sees the GM's framing at the
  broadcast view. That's the right behaviour when fully zoomed out —
  but when the player zooms in, those bars were still cropping the
  image even though the player had explicitly asked for a closer
  look. The clip pass is now suppressed whenever the player has a
  local override active: the camera already draws the full canvas
  area, so disabling the clip simply exposes the extra map content
  filling the canvas edge-to-edge. Bars come back when the player
  hits Reset View.

## v2.16.27 — 2026-05-31

### Fix — pinch-zoom no longer snaps back on release

Touch pinch-zoom on the player view was being silently undone the
moment a finger lifted. The Gestures helper dispatched
`onTwoFinger({phase:'end', scale:1, panDx:0, panDy:0})` — a synthetic
"reset" — which the player handler applied verbatim, restoring the
override to the gesture-start state. Wheel-zoom and mouse-pan were
unaffected because they don't go through the two-finger path.

Now the helper remembers the LAST observed scale + pan during move
and replays them on end, so consumers see the final pinch state and
the zoom persists. Mouse-wheel + drag-pan behaviour unchanged.

## v2.16.26 — 2026-05-31

### Pointer scales with disc; bounding rect rotates again

- **Pointer size is now relative to disc size.** Square box scaled to
  50 % of the disc's shortest edge, clamped to [10, 40] px. Keeps the
  handle in proportion at every zoom — tiny on zoomed-out unscaled
  maps, generous on big calibrated tokens. No more "arrow larger than
  the icon" at low zoom.
- **Non-square bounding rectangle rotates with facing again** (1×2 east
  → 2×1 wide rect, 2×3 east → 3×2). Only the image inside stays
  upright — earlier ask preserved. Disc-dim swap snaps at the
  closer-to-horizontal vs closer-to-vertical boundary so the
  orientation matches the facing direction.

## v2.16.25 — 2026-05-31

### Fat arrow, upright images, icon self-heal

- **Rotation pointer doubled in width** (16 → 32 px) — much easier to
  grab on touch. Height unchanged so it doesn't intrude further past
  the disc edge.
- **Non-square images stay upright now.** 1×2 / 2×3 tokens no longer
  flip the image (or swap disc dimensions) when facing changes — only
  the pointer rotates to indicate facing direction. The "long axis
  follows facing" affordance was distracting on redraws; matches the
  square-token behaviour.
- **Icon self-heal.** Player markers now carry a `hasIcon: true` flag
  when the GM has an image-form icon stored. Receivers (players and
  projector) check on every `player_markers` arrival: if the GM says
  there's an icon but the local cache is empty, they send a
  `player_icon_request` upstream and the GM resends just that icon.
  Recovers from dropped chunked-binary deliveries and tokens that
  arrived before the layer was mounted. Debounced per playerId (5 s
  cooldown).

## v2.16.24 — 2026-05-31

### Pointer feels grippier; projector icon diagnostics

- **Rotation handle is now a tick + arrowhead** sitting fully outside
  the disc, attached by a short stalk that overlaps the disc edge by
  2 px so the join reads as integrated. Bigger hit-target (16×20 box,
  clip-path includes the stalk), so the handle is much easier to grab
  on touch — both on the GM and on the player.
- **Discs shrunk to make room.** Default uncalibrated disc 30 px →
  26 px. Calibrated tokens: footprint gap widened from 0.25 → 0.35
  squares (1x1 now fills 65 % of a square, 2x2 = 165 %, 3x3 = 265 %).
  Same constant-gap rule as before, just a little more breathing room
  for the protruding pointer.
- **Projector bitmap icons — diagnostic log added.** A `console.info`
  on every `player_icon_update` arrival reports which transport
  delivered (peerjs blob vs BC dataUrl vs clear), and whether the
  layer + markers are ready to consume it. If the projector is still
  missing bitmap icons after this drop, the projector console will
  tell us where the chain breaks.

## v2.16.23 — 2026-05-30

### Polish — pointer feels attached, local previews receive icons

- **Facing pointer is now an integrated triangle.** Replaces the floating
  coloured dot with a clip-path triangle that straddles the disc edge —
  base inside the disc, tip just outside — so it reads as a feature of
  the token rather than a separate UI element. Same drag-to-rotate
  handle, same 45° snap.
- **Same-browser preview / projector windows seed Player Voice state
  on connect.** A freshly-opened GM-side preview or projector pop-up
  was rendering identified players as initial-letter fallbacks until
  the next live update, because state-of-record (markers + icons)
  lived in PlayerRegistry, not in the cached `full_state`. Added a
  `Host.onLocalRequestState` hook fired alongside the BC `full_state`
  response; GMApp consumes it by re-broadcasting markers + all per-
  player icons so the local view catches up on join.
- **Defensive `touch-action: none` on token disc + pointer.** Prevents
  the browser from claiming a finger that grazes a token disc for
  native pinch-zoom during a multi-touch gesture on phones.

## v2.16.22 — 2026-05-30

### Patch D — token facing pointer + rotation handle

Each player token can now have a facing direction, set by dragging a
small coloured dot at the disc edge.

- **Facing pointer.** A small dot sits on the disc edge in the direction
  the token is facing. Doubles as the rotation handle — drag it around
  the disc centre to rotate. Snaps to 45° increments.
- **Image rotates in 90° steps for non-square footprints.** A 1x2 token
  facing east becomes 2x1 (image rotated 90°, footprint dims swap) so
  the image stays upright relative to the rectangle's long axis. Square
  footprints (1x1, 2x2, 3x3) only rotate the pointer; the image stays
  put. Matches your earlier note: pointer snaps 45°, image snaps 90°.
- **Player + GM both have the handle**, gated by the same "Let players
  move their own token" setting as drag. Live updates flow from player
  → GM the same way drag updates do, including the cancel-move button
  on the Players panel row (which now restores both position AND
  facing).

## v2.16.21 — 2026-05-30

### Fix — projector now receives token icons on connect

`projector_hello` wasn't firing the equivalent of the player-identify
state-seeding (markers, icons, initiative). A projector window opened
after the GM had set icons would never receive them and tokens
displayed the initial-letter fallback. Now mirrors the identify dispatch:
on `projector_hello`, the GM rebroadcasts current player markers, all
player icons, and the current initiative state, so a fresh projector
catches up on the full Player Voice picture.

## v2.16.20 — 2026-05-30

### Fix — remote players see icons; non-square tokens are rounded rectangles

Two related fixes after live testing on a Pixel.

- **Remote players were seeing the initial-letter fallback instead of the
  picked icon.** Same root cause as the earlier wire-format bug: the icon
  path I added re-encoded the assembled PNG bytes back into a base64 data
  URL inside Guest, but maps and soundboard simply hand the assembled
  bytes to the consumer as a Blob arg (faster, less code, proven). The
  icon path now follows that pattern — Player / Projector wrap the
  assembled bytes in `new Blob([…], { type: 'image/png' })` and stash a
  `URL.createObjectURL` reference in the per-player icon cache.
- **Removed the 64×64 downscale.** The chunked transport handles
  arbitrary sizes (it carries map blobs), so artificial shrinking was
  costing icon quality for no benefit. Icons now rasterise at native
  resolution capped at 500px longest-side (sized for a 3×3 token at
  HiDPI). SVGs always render at the cap regardless of intrinsic size.
- **Non-square tokens are rounded rectangles**, not ovals. The CSS
  override was being declared before the base `.pm-token-disc` rule and
  losing the cascade. Moved to after the base + added `overflow: hidden`
  so icon images are properly clipped to the disc shape rather than
  bleeding past it.
- **`object-fit: cover`** on the disc image, so the whole disc is filled
  cleanly with the icon (was `contain`, which letterboxed non-square
  footprints in their own background colour).

## v2.16.19 — 2026-05-30

### Player Voice on the Projector + size-badge + corrected sizing math

- **Projector view now renders Player Voice content.** It was missing the
  v2.17 rendering layers entirely. The Scaled / Projector view now shows
  player tokens (with their icons), ping pulses, and the atmospheric
  initiative rail — same set the player view shows. Messaging /
  identification / roll prompts stay out of the projector by design
  (it's a read-only table screen, not a participant).
- **Size dropdown becomes a small badge** at the bottom-left of the icon
  button, mirroring the colour badge at the bottom-right. The current
  footprint label (e.g. "1x1") is the only thing visible day-to-day; the
  native select dropdown opens on click. Frees more space on each row.
- **Corrected sizing math.** Was a uniform 75% of footprint, which gave
  a 25%-each-side border at 3x3 that read as wasted space. Now a
  *constant* 0.25-square gap is shaved off each axis regardless of size:
  1x1 = 0.75 squares (75%), 2x2 = 1.75 squares (175%), 3x3 = 2.75 squares
  (275%). Adjacent tokens have the same breathing room at every size.

## v2.16.18 — 2026-05-30

### Patch C — token footprint sizes on calibrated maps

Each player can now have a token footprint set in map squares — 1x1
(default), 1x2, 2x2, 2x3, or 3x3. A small dropdown on every Players panel
row picks it.

- **Only honoured on calibrated maps.** When the active map has a pixels-
  per-square set, the token scales to fit its W×H footprint at 75% of the
  square area (so adjacent tokens don't visually butt up). Scales live
  with zoom — the RAF redraw already running for token positions reads
  the current map-px-per-square each frame.
- **On uncalibrated maps the token keeps its constant CSS size** so it
  stays readable regardless of zoom. The size picker still shows the
  chosen value; it's just dormant until you switch to a calibrated map.
- **Square footprints render as circles** (1x1, 2x2, 3x3). **Non-square
  footprints render as rounded rectangles** (1x2, 2x3) so icon images
  have more room to read.
- **The same scaling applies to player views**, so what the GM sees and
  what each player sees match exactly on calibrated maps.

Patch D will add facing / rotation, including the 90°-image rotation for
non-square footprints so they sit upright relative to their long axis.

## v2.16.17 — 2026-05-30

### Polish — colour propagation + named disconnect status

- **Colour / name changes from the Players panel now refresh tokens
  immediately.** The previous version only re-broadcast the roster, so the
  player marker layer (GM AND remote views) kept the old colour until the
  next event that triggered a marker refresh (a map switch, a token drag,
  etc.). The same on-the-fly refresh remote players already got when they
  re-identified is now applied to GM-side edits.
- **Disconnect status uses the player's real name.** Was "Player
  disconnected (3572b4e9…)"; now reads "Thorin disconnected" if they've
  introduced themselves, falling back to the peer hash for connections
  that never identified (a stale tab, a connection that errored mid-handshake).

## v2.16.16 — 2026-05-30

### Fix + polish — token icons no longer break remote map loads

The v2.16.15 icon picker shipped icons inline inside `player_markers`. With
multiple raster icons the JSON payload could exceed the PeerJS DataChannel
~16KB message limit, which silently broke the channel for remote players
— maps stopped loading on the phone any time a custom icon was assigned.

This patch:

- **Splits icons off** into a dedicated `player_icon_update` message,
  chunked over the wire the same way soundboard audio and map blobs are.
  Individual icons can be any size; player views cache by playerId and
  merge into the marker view as they arrive. Map loading is no longer
  affected by icon size.
- **Downscales picked icons to 64×64 PNG** at pick time so the chunked
  payload stays small (and re-broadcasts on every new joiner stay
  cheap). Quality is fine at the 30–60px display size of a token disc.
- **Player identify modal now shows the GM-allocated icon** in the
  preview disc when one is set, so the player sees the finished look of
  their token while editing their name / character / colour.
- **Combined colour + icon control on the Players panel.** The standalone
  colour picker is gone; the icon button is the main control, with a
  small colour-input badge attached to its bottom-right edge. Click the
  icon body to open the asset library, click the badge to change the
  identity colour. Hover reveals a clear-icon × at the top-right. Frees
  up panel width and keeps related controls visually together.

## v2.16.15 — 2026-05-30

### Player Voice — token icon picker

Each player can now have an icon on their token instead of the initial
letter fallback.

- A new icon-pick button on every Players panel row opens the same image
  asset library marker icons use. Pick a glyph (unicode), a tintable
  game-icons-style SVG, a custom multi-colour SVG, or a full-colour
  raster — all four render correctly. Tintable SVGs are baked white at
  pick time so they contrast with the disc's dark coloured background;
  raster and multi-colour SVGs render in their own colours.
- Hover the icon preview to reveal a small × button that clears the
  selection — the token falls back to the player's initial.
- The icon travels with the player token (player views render the same
  image on their atmospheric tokens) and is stored only in the browser
  players store, never in the .mappadux save file — consistent with the
  rest of the player marker system.

## v2.16.14 — 2026-05-30

### Identity polish — custom colour, taken-colour badge, mobile resume

Three fixes folded into a single beta push:

- **Custom colour swatch now works on desktop too.** The previous version
  used a hidden `<input type="color">` triggered by `.click()`, which is
  reliably broken on desktop Chrome (it silently no-ops). The "+" swatch
  is now the colour input itself, styled to match the palette tiles with
  a rainbow gradient. Click it on any device and the system's standard
  colour picker opens directly — no intermediate menu.
- **Taken-colour badge.** A small dark dot with the other player's initial
  appears on palette tiles whose colour is already in use. Picking a
  taken colour is still allowed (clashing doesn't break anything); the
  badge is just a friendly heads-up so you can pick a distinct identity
  without having to memorise everyone else's choice.
- **Mobile resume reconnects.** When a phone tab is hidden for more than
  10 seconds (locked screen, background app, OS battery saver), the
  WebRTC channel often dies silently — PeerJS doesn't always get a close
  event, so the page silently loses its connection until the user
  refreshes. The player view now watches `visibilitychange` and on resume
  after a long hide, proactively tears down + reconnects via the saved
  room code. A brief "Reconnecting…" status appears; everything's back
  within a couple of seconds.

## v2.16.13 — 2026-05-30

### Fix — upstream PeerJS messages from remote players were silently dropped

The wire was asymmetric. The Host has always JSON-stringified outgoing
messages before `conn.send`, but the Guest was sending raw objects.
PeerJS is configured with `serialization: 'raw'` (so it doesn't repack
our chunked binary blobs), which means upstream objects went straight
into `RTCDataChannel.send(object)` — and Chromium throws on that, since
the channel only accepts strings / ArrayBuffer. The throw was swallowed
silently inside PeerJS, so `player_identify`, `player_ping`,
`player_message`, `player_marker_move`, `initiative_roll`, and
`projector_hello` from any remote (network-only) peer simply never
arrived. BroadcastChannel (same-browser / localhost) was unaffected,
which is why every test from the GM's own machine worked.

Guests now JSON.stringify upstream payloads; the Host's `conn.on('data')`
parses incoming strings and still accepts raw objects for back-compat.

This explains the "phone connects, name shows in the modal, but never
appears in the Players panel" symptom — identify reached the data
channel and got rejected before it ever left the device.

## v2.16.12 — 2026-05-30

### Identify hardening + diagnostics

Player identify is now resent on every `full_state` arrival — which fires
on initial connect, every reconnect, and every map change — so a remote
player whose on-connect send is lost (flaky network, GM not ready yet)
gets picked up on the next state push. Cheap; registry.identify is an
upsert so re-sends are idempotent.

Both sides log to DevTools when identify goes out / comes in
(`[player] identify sent` / `[gm] player_identify received`) so we can
tell from the console which leg of the trip is failing if the player
still doesn't land in the Players panel. The player view also briefly
shows "Connected as <character>" so it's visible without DevTools.

## v2.16.11 — 2026-05-30

### Fixes — Forget-me button + click-to-unmute in preview

- **"Forget me" button** in the player identify modal (footer, left side, red).
  Confirms, sends a player_forget_me message asking the GM to drop the
  registry record + any placed tokens, clears local identity + player id,
  and reloads. Useful when testing flow gets stuck behind sticky state on
  the player device, or when you want to swap who's playing on a shared
  tablet.
- **Click-to-unmute now works in the GM preview popup.** v2.16.9 gated the
  first-click handler on preview mode, which also blocked the browser's
  autoplay-policy unmute path — meaning the preview popup couldn't get its
  audio pipeline started. Removed the gate; click-to-unmute always works.

## v2.16.10 — 2026-05-30

### Fix — real player tabs incorrectly treated as GM preview

The same-browser BroadcastChannel signal used in v2.16.9 to detect the GM
preview popup was firing on real phone players in the wild, suppressing
their UI and (silently) short-circuiting their `player_identify` send so
they never appeared in the GM Players panel.

Switched to an explicit `?gmPreview=1` URL flag the "Open Player Window"
launcher appends. Phones / laptops connecting via the QR never carry it,
so they're always treated as real players regardless of any local state.
The override setting under Settings → Player Voice still flips preview
behaviour off when you want the popup to act like a real player view.

## v2.16.9 — 2026-05-30

### Player Voice — identity polish + GM preview mode

A focused polish pass on the identity surface and a new "preview window"
mode for the GM's own same-browser player popup.

- **Identify modal: live preview disc.** A circular preview next to "Your
  colour" shows exactly what your token / chat chip / initiative card will
  look like, updating as you type and pick.
- **Identify modal: adaptive copy.** First time you connect: "Introduce
  yourself" + "Join". Re-opening to edit: "Update your details" + "Save".
- **Identify modal: custom colour as the last swatch.** A rainbow "+" tile
  at the end of the palette opens the system colour picker — the separate
  "Custom" row is gone.
- **Identity pill: pulse pre-identity, dim once set.** When you haven't
  introduced yourself the pill pulses to draw the eye and stays bright.
  Once you've set it, the pill matches the existing fullscreen-button
  fade pattern: dim by default, bright on hover.
- **Identity pill: character name first.** The pill shows your character
  name (the in-fiction handle) with the player name as a fallback. The GM
  Players panel keeps both fields visible — handy when you forget who's
  playing whom.
- **GM preview mode.** Your own "Open Player Window" popup is in the same
  browser as you, so it isn't a real player. By default the popup hides
  identity prompts, the pill, message toasts, the right-click action
  menu, and the initiative roll prompt — and disables left-click and pan
  on the map. Only the fullscreen + reset-view buttons stay live. You
  still see the map, tokens, pings, and the atmospheric initiative rail
  exactly as a player would. Real player tabs on phones / laptops /
  remote browsers are unaffected (BroadcastChannel is the signal —
  network-only players never trigger it). Settings → Player Voice →
  "Show full player UI in same-browser preview windows" flips this off
  when you want the preview to behave as a real player view for testing.
- **Players panel: bigger pulsing online dot.** 8px → 10px with a soft
  pulse on connected players so presence reads at a glance.
- **Action menu: utility entries.** Right-click / long-press now also
  surfaces "Introduce yourself / Change your name + colour", "Toggle
  fullscreen", and "Reset view to GM's" (when applicable), so the corner
  buttons and the menu are two routes to the same things.

## v2.16.8 — 2026-05-29

### Player Voice — fanned-deck initiative tracker

The final v2.17 piece, per the system-agnostic fanned-deck spec plus the
edge-pinnable dual-axis addendum.

- **Open it from the hamburger menu** ("Initiative Tracker"). The tracker
  overlays whichever edge of the GM view it's pinned to — bottom/top for a
  horizontal fan, left/right for a vertical one. Drop-down pickers in the
  controls bar swap edge and sort mode live.
- **Three zones, GM-side:** the **active rail** (fanned overlapping cards
  scaling the active card up + dimming spent ones), the **threat bench**
  (A–F reserve enemies the GM clicks to drop into the rail), and the
  **unallocated tray** (ghost cards for players who haven't rolled, kept
  separate from the live rail).
- **Sort modes:** numeric high→low (d20 default), numeric low→high
  (roll-under / speed priority), or manual / freeform. Drag-and-drop
  reorder flips the mode to manual automatically.
- **ROUND END anchor card** sits at the rear; advancing past it
  automatically clears every spent flag and parks the marker at the back
  for the next round.
- **Right-click a card** to jump it to the front (sudden reactions, boss
  phase triggers). **× on a card** returns enemies to the threat bench and
  drops player cards to the unallocated tray, both cleared and ready to
  re-place.
- **Call for Initiative** broadcasts a roll-prompt to every connected
  player. They type their result (number, "Fast", whatever fits the
  system) and it slots into the rail in the right place for the current
  sort mode — colour and name come from their persistent identity.
- **Split view:** the GM sees mechanical values (big numbers or threat
  letters); players see an atmospheric face — coloured tabs + names for
  players, uniform charcoal "???" tabs + "Opposition" for enemies, no
  numbers anywhere.
- **State persists in your browser** between refreshes (localStorage); it
  is not part of the Map Pack save file, matching the rest of Player Voice.

Lots of UI finessing still to do; the functionality is broadly intact.

## v2.16.7 — 2026-05-29

### Player Voice — LLM suggestions pre-fetch on message arrival

When the reply assistant is enabled and reachable, suggestions are now
generated the moment a player message lands — by the time the GM opens
the reply box, the chips are usually already sitting there. Silent if the
endpoint is down; the manual "Suggest replies" button still surfaces
explicit errors.

## v2.16.6 — 2026-05-29

### Player Voice — LLM connection test + model picker

A quick polish pass on the GM reply assistant's setup. Settings → Player
Voice → Reply assistant now has:

- **Test connection button.** Hits `/v1/models` on the configured endpoint
  and shows whether it's reachable + CORS-friendly, so you can confirm LM
  Studio is running and serving before you actually rely on it during a
  session.
- **Auto-populated model dropdown.** A successful test lists every model
  the endpoint advertises; click one to fill the Model field. The text
  field stays the source of truth so a model the server hasn't loaded yet
  doesn't blank your saved choice.
- **Stale-marker.** Edit the base URL or API key and the dropdown clears
  so you re-test against the new endpoint rather than picking from a list
  that no longer applies.

## v2.16.5 — 2026-05-29

### Player Voice — player tokens

Each player can have a token on the map — a circular marker edged in their
identity colour, showing their initial and name.

- **GM places them, per map.** A pin button on each row of the Players panel
  drops that player's token on the current map; click again to remove it.
  Drag it anywhere to position it. Maps aren't linked, so each map shows only
  the tokens you placed on it.
- **Browser-only, no setup churn.** Tokens and their positions live in your
  browser, never in the Map Pack save file — so sharing or re-importing a
  pack never carries your table's tokens, and you never have to rebuild a
  player's token from scratch.
- **Players can move their own.** When enabled (Settings → Player Voice), a
  player can drag their own token from their view; you see it move live and
  get a "send it back" button to undo the move. Turn the setting off to keep
  placement entirely in your hands.

## v2.16.4 — 2026-05-29

### Player Voice — LLM reply assistant

The Player Voice panel can now draft replies for you. On any player message,
click "Suggest replies" to get a few editable options — use one as-is, tweak
it, or ignore them and type your own.

- **Bring your own model.** Works with any OpenAI-compatible endpoint: a
  local LM Studio server (no key needed) or a hosted provider like
  OpenRouter (key + model). Configure it in Settings → Player Voice. The API
  key is stored only in your browser and never leaves it (not even in Map
  Pack exports), and appears in the API Keys list for housekeeping.
- **Editable prompt.** The assistant ships with a GM-tuned prompt that asks
  for four distinct response options (a green light, a complication, a hard
  stop, and a dramatic choice — each ending in a skill-roll cue). The whole
  prompt is editable so you can tune it to your model and your table, with a
  one-click reset to the default.
- **Suggestions are starting points.** Clicking a suggestion drops it into
  the reply box; nothing is sent until you hit Send.

## v2.16.3 — 2026-05-29

### Player Voice — private messages

Players can now talk to the table without breaking the fiction out loud.
Right-click / long-press the map and pick who to message.

- **To the GM, or to another player.** Messaging a player is relayed
  through the GM and always copied to the GM's panel, so nothing happens
  behind the screen.
- **GM Player Voice panel.** Incoming messages collect in a new panel with
  a red unread-count badge on its header (it clears when you open the
  panel). Each message has an inline reply box so you can answer a player
  directly.
- **Player-side toasts.** Messages arriving at a player view (a GM reply,
  or another player's note) appear as a colour-coded toast that stays until
  the player dismisses it.
- **GM toggle.** Settings → Player Voice can switch messaging off; the
  option then disappears from the players' map menu.

Same-machine player windows are deduped so a message isn't processed twice
when it arrives over both local and network channels.

## v2.16.2 — 2026-05-29

### Player Voice — pings

Players can now point at the map. Right-click (or long-press on touch) a
spot on the player view and choose "Ping here".

- **Zeroing-in pulse.** The ping shows as concentric rings converging onto
  the point in the player's identity colour — a deliberate "look here"
  gesture rather than a radar blip. Every connected player sees it.
- **Different lifetimes per side.** On player views the pulse fades after
  ~10 seconds. On the GM screen it stays put, labelled with the player's
  name, until the GM dismisses it with its delete button — so a ping during
  a busy moment isn't missed.
- **Tracks the map.** Pulses are anchored to map coordinates, so they stay
  on the right spot as anyone pans or zooms their own view.
- **GM toggle.** A new Settings → Player Voice section lets the GM switch
  pings off; player views hide the option when it's disabled.

## v2.16.1 — 2026-05-29

### Player Voice — named & persistent players (foundation)

First slice of the v2.17 Player Voice work, landing on beta. Players who
join are no longer anonymous: the session now has a roster of persistent
players that survives map switches and reconnects.

- **Self-identify on connect.** A player who scans the QR is asked once for
  their name, character name, and an identity colour. Black / near-black is
  rejected — that range is reserved for the GM and (later) initiative
  threats. A floating identity button on the player view lets them change
  any of it and re-announce at any time.
- **Persistent players.** Identities are keyed by a device-persisted id and
  stored in a new global `players` store, so the same person keeps the same
  record across maps and sessions. Re-identifying on reconnect updates the
  existing record rather than creating a duplicate.
- **GM Players panel.** A new "Players" panel lists everyone — connected
  players (with a live online dot) and offline table-mates the GM adds by
  hand for people without their own device. Each row is inline-editable
  (name, character, colour) and removable.
- **Roster sync.** The GM broadcasts the roster to all player views, laying
  the channel that upcoming patches (pings, private messages, player markers,
  the initiative tracker) build on.

Security is intentionally absent here, consistent with the rest of the
LAN-trust P2P model.

## v2.16.0 — 2026-05-26

### Soundtracks — pack-level background music

The v2.16 headline. Mappadux now hosts a Soundtracks panel that
plays YouTube and Spotify content as the running score for a
session, distinct from the per-map Soundboard. Highlights:

- **Two providers.** YouTube / YouTube Music (no user sign-in;
  IFrame Player handles playback) and Spotify (Web Playback SDK +
  Web API, requires a Premium account and a one-time Developer
  App registration walked through in Settings). Both providers
  run side-by-side; the panel multiplexes one slot at a time.
- **N user-defined slots** with a permanent Silence anchor at the
  top. Each slot holds a single track or a full playlist / album.
  Selecting a slot crossfades from whatever was playing.
- **Loop / Shuffle / Restart-vs-Resume** per slot. Shuffled
  playlists start on a random track (cue + shuffle + jump, not
  loadPlaylist + setShuffle which used to play track 0 first).
- **Shuffle-stable resume** for playlists. Switching away mid-
  track captures the specific track URI; switching back replays
  that exact track at the saved position, then hands off to the
  playlist (re-shuffled) for the rest. Works on both providers —
  Spotify gets it natively via `/me/player/play`'s `offset`
  parameter; YouTube via a single-video load + post-end handoff.
- **Start / End trim** for single tracks. Click the "Start" /
  "End" label while a track is playing to grab the current
  playhead position; type a value to override. End is actively
  enforced — looping single tracks stop / restart cleanly at the
  chosen point. Tick marks on the progress bar mark the trim
  points; clicking anywhere on the bar seeks.
- **External transport awareness.** Pausing via a Bluetooth
  remote, OS media keys, or lock screen flips the panel's pause
  icon so the GM can resume from the GM UI without it being out
  of sync with the speaker.
- **Spotify runtime auth probe.** On panel open we probe the
  access-token path; if the refresh token has been revoked
  (Spotify side, or after long inactivity) the panel surfaces an
  inline Reconnect button next to the existing status hint.

Track URLs travel in `.mappadux` bundles. Spotify Client ID and
OAuth tokens stay on the machine and never leak through bundle
exports.

### Settings polish

- Settings dialog widened to 840px (was 560px) and the body now
  actually scrolls when too tall (`min-height: 0` unlocks
  overflow inside a flex column).
- Spotify Client ID appears in the API Keys list alongside the
  Freesound key, with per-row Delete buttons (rather than a
  single shared Delete-all underneath) so the list scales as
  more service keys land.
- New Spotify setup walkthrough explains we use both Web
  Playback SDK and Web API, lists the OAuth scopes that will be
  granted, and points out the multi-Redirect-URI trick so one
  Developer App can cover beta + production for a single user.

### Stagecraft (Lighting + Automation) — still in-progress

The WLED / Home Assistant / QLC+ Settings sections remain
hidden behind the in-progress feature toggle. Headed for v2.18
once the hardware-test pass lands.

### Other fixes

- Composite map AABB used a tile's raw width/height even when
  the tile was rotated, which truncated rotated-tile bounding
  boxes. Now uses `|w·cos θ| + |h·sin θ|`.
- Multi-tile map reveal sometimes failed to repaint on the
  player view; the renderer's hot-refresh of the backing
  uniform was missing a `needsRender = true`.
- Single-track loop went silent after the first iteration
  because the zero-duration crossfade was a no-op that left the
  engine pinned at volume 0. Snap to target on instant fades.

## v2.15.4 — 2026-05-25

Followup to v2.15.1's overlap-gated layering: edge-touching tiles
(grid-snapped, butted side-by-side) were registering as overlapping
because the snap path leaves the stored x / y a few floating-point
ULPs off the nominal edge. Strict `<` in the AABB test treated that
sliver as overlap. Added a 0.001 (composite-norm) epsilon so tiles
have to overlap by more than ~0.1% of canvas in both axes before
counting as layered. Still catches every genuine overlap; ignores
the float noise.

(v2.15.2 + v2.15.3 were diagnostic-only — log lines to locate this
bug. The logs are gone in v2.15.4.)

## v2.15.1 — 2026-05-25

Same-day patch caught during post-release testing — three reported
symptoms turned out to be one bug.

- **Compositor layer back/forward no longer needs a follow-up click
  to repaint.** The layer-order context menu used to call the full
  `_renderTiles()` path which wiped innerHTML and forced each tile
  to re-decode its image, leaving the old order painted for a frame
  until the next user gesture flushed it. Replaced with a targeted
  DOM-node reorder via `appendChild` — moves nodes without
  re-decoding, paints immediately.
- **Layered status now resets when overlaps are removed.** Removing
  all overlapping geometry from a layered composite used to leave
  the map stuck as layered: the rasteriser generated a reveal-layer
  backing blob whenever there were 2+ tiles, regardless of whether
  any actually overlapped. So the Reveal Map Layer brush kept its
  behaviour, the library Layered pill kept showing (via a separate
  but accidentally-consistent live check), and the GM view rendered
  with the backing plane mounted. Now the rasteriser checks
  overlap before generating the backing — no overlap, no backing,
  no layered behaviour.
- **Overlap detection lives in one place.** Shared
  `src/maps/compositeOverlap.ts` is used by both the library pill
  and the rasteriser so they can never drift. Existing composites
  with a stale backing blob from before this fix self-heal on the
  next Save through the Composite Map editor.

## v2.15.0 — 2026-05-25

### Map Compositor — tile maps together, layered or modular

The v2.15 headline. You can now combine multiple map images into
a single playable map — side-by-side for modular layouts (towns,
overland regions), or stacked for layered effects (a roof over an
interior; a magical illusion over a chamber). Highlights:

- **Composite Map editor.** New full-screen modal you reach via
  "+ Create a New Composite Map" in the library. Drag tiles to
  position; rotate (snaps to 90 / 45 / 30 degree families); resize
  from the corner with aspect-lock + reset-to-default; flip
  horizontally / vertically. Snap-to-grid by default so tiles align
  on the master tile's grid pitch.
- **Right-click any tile** for the layer menu: Bring to Front /
  Forward / Send Backward / Send to Back, plus Delete. Stack order
  survives Save + carries to every viewer.
- **"Layered" pill** appears next to "Composite" on library rows
  whenever a composite's tiles overlap — signals that the layered-
  composite tools (below) light up on this map.
- **Reveal Map Layer brush.** Pick it from the MapFX dropdown
  (next to Make Transparent). On a layered composite, painting
  exposes the tile directly underneath; on non-layered maps it's
  a visual no-op. Marching-ant border draws purple to read clearly
  over the revealed content.
- **Upper-layer transparency slider** (GM-only) on the Map panel
  for layered composites. Fade the top tile globally to preview
  what's beneath without painting brushes — never visible to
  players.

### Blood Splatter transition

A new map-change transition for horror games. Pick any colour
from the colour picker, and dial lightning intensity from 0
(none) to 100 (frequent strikes that illuminate the scene).

### Run multiple GMs side-by-side

- **`?instance=NAME`** in the URL opens a fully isolated
  Mappadux: its own IndexedDB, its own broadcast channel, its
  own player / projector spawn URLs. Two tabs no longer share
  state or stomp each other's player windows on close.
- Spawn a new instance from the hamburger menu ("New Mappadux
  instance"). Each instance picks a word-pair name (e.g.
  "amber-falcon") so the URL bar tells you which is which.

### Editors aligned to one chrome language

- The Composite Map Editor, Text Map Editor, and Marker
  selection chrome all share the same conventions: move handle
  top-left, rotation handle above with a stem (snaps ±2° to
  90 / 45 / 30 degree families), flip-V badge top-centre,
  flip-H badge right-edge mid-height, delete handle bottom-left,
  resize handle bottom-right.
- **Text-map elements rotate + flip + lock-aspect** just like
  composite tiles. Image element bounding-box drag respects the
  lock-aspect toggle; unlock and the image stretches to the box.
- **Per-modal undo / redo** in the Composite and Text Map
  editors — stack lives for the duration of the modal session
  so a slip during a layout pass doesn't lose ten minutes of
  work.

### Undo on the GM canvas itself

Two semi-transparent buttons land top-centre of the workspace
(or Ctrl/Cmd+Z and Ctrl/Cmd+Y). Covers fog / MapFX polygons
and marker placements; brush strokes coalesce to one undo
entry so a single Ctrl+Z is enough to wipe a run-on stroke.
Stack clears on map switch.

### Library polish

- **Click pills to filter.** Above the My Library list, a row of
  clickable pills mirrors the asset tags (Composite, Layered,
  Text, Animated, Stored, Unused, Scaled, ...). Click a pill to
  narrow the view; multi-select ANDs the filters; Clear chip
  appears on the right when any filter is active.
- **Hazard markers for missing maps.** If a map in your selection
  list points at an asset that's been deleted (or didn't ride
  along in a bundle import), the row now flags itself with a
  warning glyph and orange text instead of silently masquerading
  as a normal image map.
- **Flat-stroke icons** replaced the older glyph icons (edit
  pencil, download arrow, remove X) across the Map / Image /
  Sound asset modals. Inherits the host button colour so danger
  buttons go red, ghost buttons go dim.

### Smaller fixes you may notice

- Grid colour you pick in the Map panel now actually sticks across
  reloads (previously broadcast in-session but never persisted).
- Full-map view's "drag the move handle to pop a 50% rect"
  shortcut removed — was jarring after the broader rect-edit
  improvements; use the explicit view presets / resize handles
  instead.
- Clone Map now keeps "+ Add New Map" at the very bottom of the
  dropdown after cloning.
- reveal_layer brush polygons no longer revert to plain fog on
  reload (storage migration was dropping the unknown kind).
- Composite maps now survive .mappadux export / import — the
  bundle schema was missing every composite-specific field, so
  earlier round-trips would deliver an empty shell. Layered-mode
  reveal-backing PNG travels too.
- Calibration HxV input now actually rewrites the grid pps
  (was reading back the bounded line and computing the wrong
  pixels-per-square).
- "Unused" pill on the Map Library now counts composite tiles
  as real usages. Previously a map asset used ONLY as a tile
  inside a composite (never as a top-level map) reported
  Unused, so the GM could safely-delete it and quietly break
  the composite. Iterates to a fixpoint so nested composites
  propagate usage through every level.

## v2.14.36 — 2026-05-24

### View-windows refactor to unify, calibration improvements + fixes

Stopgap production cut bundling the v2.15-prep beta work. No faff
release this time — v2.15 (Map Compositor) will carry the proper
one. Headline: the rescaling lockup is fixed, the grid is now
genuinely shared across viewers, and the calibration screen is a
proper step rather than a buried checkbox. Highlights:

- **Rescaling no longer locks up the session.** Recalibrating the
  active map while a Player or Scaled View popup was connected was
  stalling the GM for up to 10–14 seconds. Three render targets
  (calibration modal SVG, GM canvas, popup canvas) were all
  decoding the full-resolution map texture in parallel. The
  calibration modal now suspends the GM + popup render loops and
  drops outbound broadcasts for the duration of the modal — only
  the modal renders the map until you commit.
- **#13 Player View grid icon + renderer.** Calibrated 1″ grid
  overlay on the Player View, toggled from the rect's chrome icon.
- **#1 Player zoom/pan with bounds.** Players can wheel-zoom +
  drag-pan + pinch-zoom their own view, clamped inside the GM's
  broadcast crop. Bottom-right Reset button snaps back.
- **Grid is now genuinely map-anchored.** Single algorithm across
  Player + Scaled View primary + Scaled View monitor: walk
  gridlines in map-pixel space and ride the renderer's projection.
  Identical map pixels carry identical gridlines on every viewer.
- **Calibration grid panel.** Prominent Preview Grid / Establish
  Origin button (icon state swap on/off), per-map colour picker,
  visible nudge hint. Shift+drag the map to align the grid origin;
  arrows for fine nudge (Shift+arrow ×10, Esc resets). Saved to
  the asset; every viewer adopts the colour + offset.
- **Shared grid colour.** Per-map (`MapAsset.gridColor`) instead of
  per-view; one swatch in the Map panel drives every viewer. The
  old per-projector 1″ Grid Overlay section is gone — the rect
  chrome icon is the source of truth for Show Grid.
- **Mute is now a real button.** First click anywhere still unmutes
  (autoplay-policy gesture); after that, the small icon-only mute
  button is the toggle, fading to a low-opacity chrome glyph after
  5s. Pan/zoom no longer wrestles with mute.
- **Swap Map Asset (#26).** New "Swap Asset…" in the Map panel.
  Replace the underlying image while fog, markers, audio, and view
  stay attached.
- **PWA stops sitting in 'waiting'.** New service worker now
  activates on next reload via `skipWaiting` + `clientsClaim`
  instead of holding for every Mappadux tab to close.
- A handful of smaller fixes (Show Grid icon gated by rect
  selection, late-joiner `full_state` carries grid colour + offset,
  Scale button + Scaled pill restored for textmaps, projection
  popup gestures no longer fight browser-level pinch).

## v2.14.20 — 2026-05-22

### Mute toggle becomes a real button — no more click-anywhere

The Player View has historically piggybacked on the autoplay
unblock: clicking ANYWHERE toggled mute. Cute when it was the only
interaction the player had, awful now that pan/zoom is live —
every drag-and-release ended up muting/unmuting the audio.

New behaviour: the mute indicator is now a two-state element.

**Pre-interaction** (page just loaded, audio still muted): big
top-right prompt — "🔇 Muted — tap anywhere to start audio".
Non-interactive itself; the document-wide click handler is a
ONE-SHOT that unmutes on the first user gesture and then removes
itself. This satisfies the autoplay policy without staking out
the whole canvas as a mute toggle.

**Post-interaction**: the same element collapses to an icon-only
button (`🔊` / `🔇`) in the same top-right slot. Fully visible
for 5s after each state change, then fades to 0.25 opacity to
match the Fullscreen button. Hover brings it back to 1. Clicking
it toggles mute — and ONLY clicking it.

New `ViewerOpts.onMuteToggle` callback hands button clicks back
to `PlayerApp._toggleMute`. New `Viewer.markMuteInteractive()`
flips the indicator into its post-interaction state.

No faff (beta push).

## v2.14.19 — 2026-05-22

### Player zoom/pan — gesture capture fix

v2.14.18 bound the wheel + pointer handlers to `#renderer-canvas`, but
on Windows Chrome and some mobile browsers the gesture was reaching
the browser viewport instead of our handler — pinch zoomed the whole
page (including the chrome buttons), and mouse wheel did nothing.

Three-part fix: gestures now bind to `document.body` (nothing can sit
above it); `body.player-view` declares `touch-action: none` +
`overscroll-behavior: none`; meta viewport gets `user-scalable=no` so
browser pinch is hard-disabled. Coordinate math still uses the
renderer canvas's bounding rect so the zoom-around-cursor and
zoom-around-pinch-centroid behaviour is unchanged.

`shouldStart` gate added so taps on the Connect panel, Fullscreen
button, and Reset View button keep their native click handling.

No faff (beta push).

## v2.14.18 — 2026-05-22

### Player View zoom + pan (#1)

The next v2.15-scope item: players can now zoom and pan their own
screens, but only within the crop the GM has prescribed. Small-screen
players get to lean in on detail without the GM having to broadcast
a new view to everybody.

Wheel-zoom centres on the cursor; click-drag pans; pinch-zoom + two-
finger pan on touch. All deltas are clamped against the GM's
broadcast `viewNW/H` and centre so the player can never see anything
outside what the GM has shared. Minimum override size caps at 5%
of the broadcast width (~20× zoom-in from a full crop).

A low-key `↺ Reset view` button appears bottom-right whenever the
player has deviated from the GM's view — click to snap back. The
button also hides automatically if the player wheel-zooms all the
way back to the broadcast rect.

GM view changes mid-session preserve the player's local override
(re-clamping it into the new bounds), so the GM nudging the camera
doesn't yank a zoomed-in player out of their detail view. A
`map_change` clears the override — fresh map = fresh view.

PROFILE_PLAYER.interact now declares `panZoom: true, resetViewBtn:
true`. PlayerApp routes every view application (full_state,
map_change, view_update, handout_reveal, video_bundle, context
recovery) through a single `_applyEffectiveView` that composes
broadcast + override and updates the renderer, markers, grid, and
reset-button visibility atomically.

No faff (beta push).

## v2.14.17 — 2026-05-22

### Player View grid, calibration show-grid + border nudge

Three v2.15-scope items in one beta cut. Two minor (the grid +
nudge in MapCalibrationModal); one bigger (#13 — the Player
View grid that the Phase 3c refactor pre-built the renderer for).

**Player View grid icon + renderer (#13).** New Show Grid icon on
the orange Player View rect chrome (matching the Scaled View
one), only on calibrated maps. Toggle drives the new
`ViewState.playerGridEnabled` flag; broadcast on the standard
view_update path; PlayerApp draws via the `map-relative` strategy
from Phase 3c. Grid is genuinely map-relative — spacing scales
with the GM's broadcast view fraction so the lines move with the
map on window resize / GM zoom. Independent of the Scaled View
grid (which stays at fixed CSS-px per inch).

**Show Grid toggle during calibration.** New checkbox in
MapCalibrationModal header. When ticked, overlays a lime-green
1″ grid on the map preview using the current pps. Lets the GM
eyeball the calculated spacing against any grid drawn on the map
itself before committing. Redraws live on line drag, H/V input,
DPI pick, and N (squares) input change.

**Border-offset nudge.** New `gridOffsetX/Y` field on MapAsset.
With Show Grid on, arrow keys nudge the calibration grid by 1
map-pixel (Shift+arrow for 10); Esc resets. The saved offset
travels alongside `mapPixelsPerSquare` in every broadcast path
(`full_state`, `map_change`, `map_meta_update`) and the drawGrid
strategies now honour it — `projector-calibrated`,
`monitor-proportional`, and `map-relative` all convert the
map-pixel offset into their own CSS-px scale before walking the
gridlines. Lets bordered maps align the in-app grid with the
map's own drawn gridlines once and have it stick across viewers.

No faff (beta push).

## v2.14.16 — 2026-05-22

### Settings: enable transitions & animations on Scaled View

The Scaled View has always cut straight to the final frame on a
map switch or handout reveal — the rationale being that animated
transitions on a physical table screen feel jarring during play.
The post-refactor Viewer abstraction made this a profile flag,
which means it's now a setting the GM can flip per-session
without a code change.

  - New Settings → Scaled View section with an "Enable transitions
    & animations" toggle. Off by default.
  - Backed by a `mappadux:scaled_view_transitions` localStorage
    flag (per-machine, like the other performance/display
    preferences).
  - ProjectorApp reads the flag at boot, swaps PROFILE_SCALED's
    transitions.mode to 'full' for this session, and passes the
    new `#transition-canvas` element from projector.html through
    to Viewer. Viewer constructs the TransitionEngine.
  - map_change and handout_reveal handlers now check
    `viewer.transitionEngine` — when present, they route through
    the engine (with the same _pendingMapLoad serialisation
    Player uses to avoid the "reveal snaps to end" race). When
    absent (default), they cut to frame as before.

Toggle in Settings → Scaled View applies to the NEXT Scaled View
window the GM opens — existing windows keep their current
behaviour until reopened.

No faff (beta push).

## v2.14.15 — 2026-05-22

### Monitor badge: above the grid, renamed Scaled View Monitor

The 1" grid overlay sat at z-index 40, the monitor badge at 35 — so
gridlines drew across the badge text on monitor windows, making it
hard to read. Bumped `.monitor-badge` to z-index 50 so the badge
sits above the grid.

Also renamed the badge text from "Projector Monitor N" to "Scaled
View Monitor N" — completes the projector→scaled-view rename Alex
asked for in v2.14.2.

No faff (beta push).

## v2.14.14 — 2026-05-22

### Fix: Scaled View defaults to scaled mode on a calibrated map

`setMapAssetCalibration` auto-flips `projectorViewport.mode` to
`'full'` when the GM switches to an uncalibrated map, but never
flipped back when the GM later switched to a calibrated map. So
opening a Scaled View while the stored mode was `'full'` showed
the calibrated map fit-to-window instead of at table scale.

Fix: a one-shot `_ensureCalibratedMapStartsScaled()` helper runs
right before each Scaled View window opens (both the primary
dropdown-pick path and the Open Scaled View Monitor button). If
the active map is calibrated and the stored mode is `'full'`, it
flips back to `'scaled'` before broadcasting the viewport update,
so the new window comes up at table scale.

No faff (beta push).

## v2.14.13 — 2026-05-22

### Viewer refactor (under-the-hood, no behaviour change)

Five-commit refactor preparing the ground for the v2.15.0 Map
Compositor work. PlayerApp + ProjectorApp had drifted into ~80%
duplicate logic with three behavioural variants (player /
scaled-primary / scaled-monitor). Every cross-cutting fix landed
twice, and adding new viewer kinds meant editing both files.

The refactor introduces a single `Viewer` class driven by a
`ViewerProfile` (a capability template: broadcast target, view
source, resize behaviour, grid kind, filter gate, transition
mode, chrome flags, etc.). Three baseline profiles cover today:
`player`, `scaled`, `scaled-monitor`. One class + profile data
per the "simplify where possible" steer.

**Phase 1** (`1fa7379`) — types + profile constants. Inert.

**Phase 2** (`169aacd`) — chrome surface (lifecycle BroadcastChannel
close, fullscreen button, faff hold-screen with QR, mute indicator)
lifted from both apps into Viewer.

**Phase 3a** (`dd294f7`) — Renderer + MarkerOverlay + MarkerSprites
+ MarkerTexture + TransitionEngine construction lifted into Viewer.
Profile-driven options handle the differences (Player's
preserveDrawingBuffer, Projector's initialFilterEnabled=false /
videoStallEscalation=false, cut-to-frame vs full transitions).
Viewer fans out `onMapLoaded` to subscribers after updating the
marker pipeline aspect.

**Phase 3b** (`f70b668`) — `computeView` strategies extracted to
`src/viewers/strategies/computeView.ts`. Three implementations:
`broadcast` (Player pass-through, reserved), `calibrated` (Scaled
primary's calibration math — the v2.14.9 unclamped form), and
`mirror-primary` (Scaled monitor). ProjectorApp dispatches by
role; identical behaviour.

**Phase 3c** (`9c24711`) — `drawGrid` strategies extracted to
`src/viewers/strategies/drawGrid.ts`. Four implementations: `none`,
`projector-calibrated`, `monitor-proportional`, and **new**
`map-relative`. The last one's the renderer for the Player View
grid (#13 in the v2.15 scope) — wiring a grid canvas + flipping
`PROFILE_PLAYER.grid.kind` will finish #13 in a small follow-up.

Both apps behave identically to v2.14.12. Design memo + phase plan
in project memory ([[project_dmr_viewer_refactor_design]]).

Remaining v2.15.0 work after this lands:
  - #13 Player View grid (small follow-up, renderer ready)
  - #1 Player zoom/pan (adds a new computeView strategy)
  - #9 Multi-upload + bulk attribution (Compositor-adjacent)
  - Map Compositor headline + Swap-Map-Asset sub-feature
  - Profile-switching at runtime (small Viewer addition)

No faff (beta push).

## v2.14.12 — 2026-05-20

### Fix: tolerance slider knocking fill out

v2.14.11 patched the click-event path that was re-enabling markers
pointer capture after a fill commit. Alex caught the same root
cause hitting a different trigger: dragging the Tolerance slider
re-fires `state.setFog` → `syncPolygons` → `emitMode` → GMApp's
`onModeChange` callback. The callback ran
`markerEditor.setPointerCapture(!drawing)` — `drawing` is
`FogEditor.enabled` (polygon mode), `false` in fill mode, so the
markers canvas flipped back to `pointer-events: auto`. Next canvas
click hit the markers canvas instead of triggering another fill.
PAINTING stayed lit (correctly — fill was still armed
internally), but Alex's experience was "I'm out of paint mode".

Root-cause fix: widen the callback's "fog is editing" check to
include `_actionInProgress`. Markers stay disabled whenever ANY
fog tool is armed (polygon / brush / fill), not just polygon mode.
The slider can refine the last fill without disturbing the
re-armed state, and another canvas click lays the next fill.

## v2.14.11 — 2026-05-20

### Fix: Fill re-arm losing pointer capture after first commit

Alex caught this on v2.14.10 testing: PAINTING stayed lit after a
fill, the slider continued working, but the cursor reverted from
`cell` (the fill `+`) to `grab` (the GM canvas pan cursor), and a
second canvas click did nothing. Two clicks on PAINTING / Paint /
PAINTING were needed to re-engage.

Root cause: after `_commitOverlayFill` completes its re-arm, the
SAME pointer's `click` event fires immediately afterwards (the
pointerdown's `preventDefault()` doesn't always suppress the
synthesized click). The FogEditor's click handler called
`handlePointerTap` → `trySelect`, which **selected the polygon
that was just filled**. Selection fired `emitMode` with
`hasSelection: true`. The GMApp's `onModeChange` callback then ran
`markerEditor.setPointerCapture(!drawing)` — `drawing` is `false`
in fill mode, so this flipped the markers canvas back to
`pointer-events: auto`. The markers canvas sits above the fog
canvas, so the user lost the `cell` cursor and the next click hit
the markers canvas instead of triggering another fill.

The actual re-arm logic in `_endActionAndRearm` was working
correctly all along; the click event's side effect was silently
undoing the pointer-capture release.

Fix: the FogEditor `click` and `touchend` handlers now short-
circuit when `fillActive` is true, matching the existing guard for
`brushActive`. Fill clicks are owned by the pointerdown path
exclusively — no fall-through to the legacy polygon-tap selection.

## v2.14.10 — 2026-05-20

### Three fix-needed items from Alex's structured v2.15-scope review

**#7 — Grid on Scaled View monitor windows.** Monitors mirror the
primary's crop fit-to-window, so their grid spacing scales by the
ratio of monitor-canvas to primary-crop. Derivable on the monitor
from values it already has:

```
monitorSpacing = mapPxPerSq * monitorCanvasW / (primaryViewNW * mapImageWidth)
```

`primaryViewNW * mapImageWidth` is the map-pixel width the primary
is showing. The monitor squeezes that same width into its own
canvas, so dividing it into the monitor's canvas width gives map-px
per monitor-CSS-px; multiply by `mapPxPerSq` to get monitor-CSS-px
per inch (= grid spacing). No new P2P messages needed — the
monitor already has `primaryViewNW`, `mapPxPerSq`, and
`mapImageWidth` from the existing relay path.

**#10 — Aspect-ratio lock actually locks now.** Two bugs in one:
the constraint code was correct but `state.view.aspectLocked` was
being silently dropped after each resize-drag move. The resize
handler builds the new view by spreading from
`viewportEditor.getView()`, which never had `aspectLocked` written
to it — only `state.view` did. So on every move event,
`state.setView(next)` overwrote state with a view missing the
`aspectLocked` field. The lock disengaged on the first move,
which is exactly Alex's "unselects itself the moment you resize".
Fix: when the lock toggles, also mirror it into the
`viewportEditor` so subsequent `...getView()` spreads carry it.

**#14 — Fill is sticky again, with a clearer "armed" cue.** v2.14.6
went single-shot to give a "committed" cue after the destructive
flood-fill. The downside was you lost the tolerance-slider
fine-tune flow Alex wanted — slide tolerance, see the fill update,
slide more, click for next fill. Back to sticky. To make the
armed state unambiguous (since the sticky button alone wasn't
enough signal), the Paint and Erase buttons now swap their label
to **PAINTING** / **ERASING** when active, via CSS `::before`
content keyed off the `is-active` class.

## v2.14.9 — 2026-05-20

### Scaled View calibration — actual root cause this time

v2.14.8 fixed two real bugs (resize-ordering + map-switch aspect)
but Alex's screenshots showed the calibration was still wrong.
The remaining cause was a `Math.min(1, ...)` clamp in
`_computeViewState`:

```
const viewNW = Math.min(1, wMap / this.mapImageWidth);
const viewNH = Math.min(1, hMap / this.mapImageHeight);
```

The intent was "viewNW is a fraction of the visible map". But the
moment the projector window grew bigger than what calibration
would fill with the *entire* map (i.e. `wMap > mapImageWidth`),
`viewNW` capped at 1 — the renderer then showed the full map
fit-to-window, which is exactly the player-style scaling Alex saw.
The grid stayed correct because it draws in CSS pixels against
the projector's own calibration, independent of the camera.

Fix: drop the clamp. When the window is bigger than the calibrated
map footprint, `viewNW` is allowed to exceed 1 and the camera
frustum spans wider than the map plane. The map renders at its
calibrated physical size and the world beyond the plane reads as
the background colour — empty space surrounds the map instead of
the map stretching to fill the window. Calibration now holds at
any window size; the only thing that changes is how much of the
map (or how much padding) fits in view.

## v2.14.8 — 2026-05-20

### Fix: Scaled View calibration lost on window resize

A nasty regression Alex caught — the whole point of Scaled View is
that resizing the projector window changes WHICH part of the map
fills the window, but keeps each map pixel at the calibrated
physical size (1″ on the map = 1″ on the table). Instead the
projector was scaling the map content with the window, defeating
the calibration.

Root cause was an ordering issue between the Renderer's internal
`ResizeObserver` (which fires on every canvas resize and re-applies
the *currently stored* view) and the projector's `window.resize`
listener (which is what actually recomputes `viewNW` from new
dimensions). During an interactive drag, the renderer's RO could
fire before the new view was computed, paint with stale `viewNW`
against the new canvas size — which is exactly fit-to-window
player-style scaling.

Fix: register a second `ResizeObserver` in ProjectorApp on the
renderer canvas. It fires *after* the renderer's own RO in the
same RO batch (so before any paint) and re-calls `_applyView()`
to drive a fresh `viewNW`. The renderer's stale-view setView still
runs first, but the final `setView` before rAF carries the
correct camera frustum, so the next paint is calibrated.

The grid overlay was unaffected (it's drawn against the projector's
own calibration in CSS pixels, not via the Three.js camera), which
is why "the grid lines stay the right size" while the map scaled.

**Also — map-switch path was paying the same cost.** `_applyView()`
fires synchronously inside the `map_change` handler, but at that
point `renderer.loadMap(blob)` has only kicked off; the texture
is still decoding and `renderer.aspectRatio` still carries the
PREVIOUS map's aspect, so the frustum gets sized wrong on the
first paint of the new map. Wired `_applyView()` into the
`onMapLoaded` callback as well, so the camera re-fits the new
map's aspect the moment the texture lands. Likely the root cause
of "returning to a map doesn't update the projection view
correctly".

## v2.14.7 — 2026-05-20

### Contemporary Paper ruling inversion (real fix this time)

The v2.14.6 "fix" still produced an inverted mask in Alex's beta
testing — gridlines stayed transparent, the spaces between them
filled with the ruling colour. Root cause: my smoothstep calls had
edge0 > edge1, which the GLSL ES 1.0 spec marks as **undefined
behaviour**. Different drivers / browsers compute it differently;
on Alex's setup the result came out inverted.

v2.14.7 uses the unambiguous form `1.0 - smoothstep(0.0, halfLine,
dist)` — edge0 < edge1, well-defined everywhere. Mask is now
reliably 1 ON the line and 0 off it, regardless of GPU driver.

Also nudged the line thickness up a touch (`halfFracY = cellY * 0.10`
clamped to 0.0015–0.020 of vUv-Y, up from 0.06 / 0.012) so the lines
actually read as lines rather than whiskers at the default settings.

## v2.14.6 — 2026-05-20

### Bug hunt round 2

Another fix-everything-Alex-spotted pass from the v2.14.5 retest.

**Fill is single-shot, not sticky.** Flood-fill is destructive enough
that the GM wants a "committed" cue (Paint button cleared) before
the next click. Polygon and Brush stay sticky. Tolerance-refinement
state still survives the clear, so the slider keeps tweaking the
just-placed fill until another action.

**Uncalibrated projector now shows its rect on the GM canvas.** When
a projector is connected and the active map is uncalibrated, the
projector renders the whole map in fit-to-window 'full' mode. The
GM-side rect used to require calibration to draw at all; now it
renders as the full map outline whenever the projector is in 'full'
mode, so the GM can see "this is what's projecting" regardless.

**Contemporary Paper — Ruling overhaul.**
  - The mask was inverted: gridlines stayed transparent and the
    spaces between them got filled. Grid showed as dot
    intersections (the only spots where both axes' fills met),
    Lined showed as filled stripes. Distance-to-nearest-gridline
    is now 0 ON the line and grows toward cell middles, so
    `smoothstep(halfLine, 0, dist)` produces the correct
    "lit on the line, dark off it" pattern.
  - **Dots** is now its own picker option (intersection points
    only). Grid / Lined / Dots are all distinct.
  - **Spacing** is now normalised: the slider is "Lines (per
    height)" — Player and Scaled View show identical ruling
    regardless of canvas resolution. Cells stay square in screen
    space via aspect-ratio derivation.
  - Paper grain is also vUv-based now (was resolution-locked),
    matching ruling for cross-view consistency.

### Known carry-over

- **Other filters with resolution-dependent looks** — many of the
  shipped filters (rain, scanlines, mist, etc.) use the
  `resolution` uniform, so they render with different visual scale
  on a Player window and a Scaled View window of different sizes.
  This is intentional for some (scanlines look natural at any
  physical resolution) but probably not for others. Per-filter
  triage on Alex's report.
- Player View Show Grid icon (#13), Grid on monitors — still
  pending from v2.14.5.

## v2.14.5 — 2026-05-20

### General bug hunt from beta testing

A fix-everything-Alex-spotted patch. Most touches are surface
(chrome positions, copy, single-line behaviour fixes); the calibration
modal got a small UX pass too.

**Viewport chrome — eye icon repositioned.** The view-broadcast eye
moved from "floating above the rect" to ON the rect's top frame,
between the Move and Maximise icons (left: 30px). Maximise shifted
to left: 60px so all three sit in a tidy row. The eye also gained
a third state: **greyed** when nothing is connected on the other
end (no Player window open, or no Scaled View connected) — clicking
still works for pre-setting, but the visual signals "no audience".

**Hold-Screen QR on the Scaled View too.** The "Not connected,
yet?" panel that v2.14.4 added to the Player view now also appears
on the Scaled View / projector hold screen. Both QRs point at the
PLAYER URL (the same URL late-joiners scan to join as a player),
not the projector's URL.

**Calibration modal — DPI dropdown sticks, Current: updates live.**
Picking a DPI from the dropdown now keeps the dropdown showing
your picked value, even when the H × V back-fill produces a pps
that's slightly off the chosen DPI (the round-trip rounding used
to clear the dropdown). The "Current:" line at the bottom now
tracks what would actually be saved as you change inputs, instead
of frozen on the saved-at-open-time value.

**Polygon-mode FoW Paint is sticky for real.** Pre-v2.14.5
`FogEditor.closePolygon` always called its own `this.disable()`
after committing, which clobbered the GMApp-side re-arm. The
disable() now only runs in the legacy fallback (no
polygon-complete handler set) — when the handler IS set, the
handler owns the post-commit state. Polygon mode now keeps Paint
lit and lets you queue another polygon, matching brush mode.

**"Projector" → "Display" in the Scaled View user-facing copy.**
The side-panel label, dropdown picker title, calibration modal
heading, and launch / monitor button text all now say "Display"
or "Scaled View" instead of "Projector". The underlying internal
names (ProjectorApp, ProjectorViewport, calibrationStorage, etc.)
are unchanged.

**Contemporary Paper filter polish.**
  - **Torn edges** now paint **black** where the page is torn
    away, instead of dropping alpha to 0 (which let whatever sat
    behind bleed through as white patches).
  - **Ruling picker simplified** to Blank / Lined / Grid. The
    blue / black variants are now a single **Line Colour** picker
    — pick whatever colour you want.
  - **Lines are much more visible** by default: opacity floor
    raised, line width grows mildly with spacing so wider grids
    don't look like razor-thin scratches.

### Known carry-over (deferred to a later release)

- **Player View Show Grid icon (#13)** — needs new player-side
  grid rendering that resizes with the map view. Not in v2.14.5.
- **Grid on Scaled View monitor windows** — needs data flow from
  primary projector to monitors so they can draw a proportionally-
  scaled grid. Not in v2.14.5.

## v2.14.4 — 2026-05-20

### Viewport cluster polish, new filter, Hold-Screen QR

A third same-day patch wrapping up viewport-chrome polish + a new
filter + the hold-screen recruitment QR.

**16:9 button moved to the bottom-right viewport cluster.** Was
top-row (next to maximise); now it lives below the ratio-lock,
above the resize handle. Resize → ratio-lock → 16:9 all in the
same area on the Player View rect. Colour states: default chrome
when not at 16:9, **green** when at 16:9, **ghosted green** when
at 16:9 + ratio-lock engaged (the snap is moot), **greyed** when
not at 16:9 + ratio-lock engaged (the snap would fight the lock).

**Contemporary Paper filter.** New visual filter — sibling to
Parchment Fantasy but pitched at present-day handouts. Axes:
paper tint + grain + brightness, ruling (blank / lined / graph
blue / graph black) with spacing and opacity sliders, ink-blots,
smudge, crumple, torn edges. All procedural — no bundled paper
texture file.

**"Not connected, yet?" panel on the player hold screen.** When
the GM mutes the player view, the faff-overlay placeholder now
carries a framed QR + URL panel below the random message. The
currently-connected player's `window.location.href` IS the URL
latecomers would scan, so it works without any new P2P
plumbing. Turns the GM's second screen / any already-connected
player's hold screen into a recruitment poster for late joiners.

## v2.14.3 — 2026-05-20

### Viewport chrome cluster + calibration master-follower

A follow-up release the same day as v2.14.2, focused on direct-
manipulation chrome on the Player and Scaled View rects plus the
last piece of the calibration UX rework.

**Calibration is now line ↔ H/V ↔ DPI master-follower.** v2.14.2
made H/V and DPI bidirectional; v2.14.3 brings the ruler line into
the same loop. Drag the line and the H, V, and DPI inputs back-
fill; type H/V or pick a DPI and the line auto-positions
horizontally across the map middle with length N × pps. Last-
touched of {line, H/V, DPI} is the master; the other two follow.
N (the "this line is X squares" input) stays at the user's value
(default 10) — it's independent, just scales what the line
represents.

**Move Projection View button retired; rect carries its own move
handle.** The scaled view's projector rect on the GM canvas now
has a small green move handle pinned to its top-left corner. Drag
from there to reposition. The previous edit-mode flow (OK/Cancel
buttons, click-outside auto-commit, full-canvas pointer capture)
is gone. The canvas stays `pointer-events: none` so pan/zoom,
marker selection, and fog painting pass through everywhere except
the handle itself. The side panel's `+ Open Projector Monitor…`
button is renamed `+ Open Scaled View Monitor…` and takes the
prominent slot the move button used to occupy.

**Aspect-ratio lock toggle on the Player View rect.** Padlock-
rectangle icon at the bottom-right of the rect chrome, above the
resize handle. Engaged = the resize handle preserves the rect's
current W:H ratio (one axis drives, the other follows the
constraint). Off = free resize. State persists per map in
`ViewState.aspectLocked` and broadcasts via the existing view
sync path. Distinct from the existing one-shot 16:9 snap button.

**View-broadcast eye icon on both rects.** Top-left of each
viewport rect (just above the move handle, outside the rect) now
carries an eye icon that mirrors the panel-header bypass toggle.
Eye open = the view is being broadcast; eye closed (red) = the
view shows the faff placeholder. Click either the eye or the
header switch and both update.

**Show Grid icon on the Scaled View rect.** New grid icon below
the move handle, only emitted when the active map is calibrated.
Clicking flips the `gridEnabled` projector-viewport flag through
the same broadcast path as the side-panel `Show grid` toggle, so
both stay in sync. The Player View grid (resizes with the map on
window resize) is a separate piece of work — needs new player-
side rendering.

**Map Compositor data-model scaffold.** Type-only foundation for
the v2.15 headline feature: `CompositeTile` interface,
`MapAsset.source` gains `'composite-map'`, and `compositeTiles[]`
+ `compositeMode` ('modular' | 'layered') optional fields land on
`MapAsset`. No editor, renderer, or dropdown entry yet — just the
shape so storage / bundle export / migration code can be staged
without churn when the editor lands. All fields are additive and
optional; existing assets load unchanged.

## v2.14.2 — 2026-05-20

### Multi-fix beta release — calibration UX, sticky paint, GM-side names, lifecycle

**Map calibration rebuilt around a self-reactive H/V + DPI pair.**
The calibration modal grew a third row: **DPI dropdown** with the
common values (60, 70 VTT, 75, 100 VTT, 140 VTT, 150, 300). Picking
a DPI back-fills H and V from the map's actual pixel dimensions.
Typing in only H or only V auto-fills the empty side at 1:1 (square
grid), which incidentally kills the `<line> attribute x1: Expected
length, "-Infinity"` console error that the empty-default-zero state
used to throw. When H × V works out to one of the common DPIs the
feedback flips green and labels the match ("matches 100 (VTT) DPI"),
so a quick "does this look right?" reads at a glance. The ruler
line stays the manual fallback — line ↔ H/V/DPI master-follower
sync is the v2.14.3 piece.

**Fog Paint / Erase is sticky again, the right way.** Pre-v2.14
the action button stayed lit after a commit but the underlying
action sometimes wasn't actually armed — clicking the lit button
did nothing for one tick. v2.14 went single-shot (button cleared
after every commit) which fixed the inconsistency but broke the
"keep dropping polys" flow. v2.14.2 re-arms cleanly: every commit
runs `_endAction` (full state reset) then `_startAction` (re-arm)
in the same tick, so the button stays lit, the editor is in the
correct state for the next stroke, and clicking the button or
switching Drawing Mode is the explicit exit. Polygon, brush, and
fill modes all behave consistently.

**Marker names on the GM map, independent of player visibility.**
New per-marker toggle **Show Name on GM map** (default ON) sits
alongside the existing Show Name on player map (default off). The
GM-side name survives the marker being hidden from players — useful
for tracking where each NPC / trap / clue sits even when invisible
to the table. Locked markers fade their name to dim chrome so
background-prop labels stay quiet.

**Locked-marker badge cluster decluttered.** Locked markers now
only display the eye / speaker / sensor badges when the
corresponding feature is **on**. A locked-and-hidden prop drops the
eye; a locked-and-muted source drops the speaker. Live (unlocked)
markers always show the full row.

**Projection View renamed to Scaled View** across the UI (panel
title, HELP heading, README) — terminology change ahead of the
v2.15 work where Scaled View takes on more roles than just
projector output.

**UI scale slider floor lowered to 50%** (from 75%) for users on
small screens or who want more map real-estate.

**Asset library Upload tabs gain a storage hint.** Both Map and
Audio Upload tabs now spell out that uploads are saved locally in
the map pack and travel with bundle exports / work offline.

**Beta channel welcome MOTD.** First launch on a beta host (not
www.mappadux.com or localhost) now shows a warning-style modal
explaining that features may come and go, but maps should stay
compatible. Dismissed once per browser.

**Spawned windows close with the GM.** Closing the main Mappadux
GM window now broadcasts a `gm-closing` signal on a dedicated
`mappadux:lifecycle` BroadcastChannel; Player, Scaled View, and
Calibration popups listen on it and self-close. Same-origin only;
remote players over P2P aren't affected.

## v2.14.1 — 2026-05-18

### Marker resize — upper cap removed

The on-canvas marker resize handle used to clamp at 8× base size,
inherited from when there was an explicit slider with that range.
With the slider gone the cap was just an arbitrary ceiling, and a GM
prepping a Mothership session ran into it trying to stretch a
ventilation-system token across the map.

Cap is gone. The handle now scales freely; markers can legitimately
end up larger than the screen for room-scale hazards, oversized
vehicles, or environmental overlays. Lower bound stays in place (a
small floor so the marker remains grabbable). The sprite canvas has
its own internal pixel-budget ceiling so memory stays sane at
extreme sizes — markers just get a touch softer when stretched well
beyond their texture footprint.

## v2.14.0 — 2026-05-17

### New onboarding pack + smaller fixes

**Getting Started pack refreshed.** New default bundle ships an
eight-step onboarding flow as handouts the GM lands on at first
launch:

  1. Welcome
  2. No Logins. WTF?
  3. Player Connections
  4. Map Selection and...
  5. Making Stuff Look Fancy (starfield backdrop, CRT-collapse reveal)
  6. Griffinholm (image map with fog of war, audio, mist filter)
  7. Markers, Sound & Motion
  8. Rons-Moto-1979 — Encounter (Mothership-style scenario: 12
     markers, 10 fog polys, 3 audio sources, motion tracker, retro
     sci-fi green filter)

`lastMapId` points at "1. Welcome" so a fresh install opens on
context, then the GM moves through the tutorial sequentially.
Demonstrates every major surface: FoW + MapFX, Backdrops, filters,
transitions, markers, soundboard, motion tracker, handout
animations.

**Per-backdrop-kind drafts.** Tuning a backdrop's sliders, then
switching kinds, then switching back, now restores the previous
kind's values. Earlier the params dropped on every switch and the
GM had to re-dial. Stashed in view.backdropDrafts[kind]; mirrors
MapFX's per-kind shaderParams behaviour. Per-map; travels in
.mappadux exports via the existing ViewState path.

**Paint button clears after every commit.** Each polygon close,
brush stroke release, or fill click now clears the green Paint
highlight so the GM gets visible "operation completed" feedback.
Drawing-mode toggle (Polygon / Brush / Fill) remains the sticky
preference. Fill's Tolerance slider still refines the last-placed
polygon via a new `preserveFillState` opt on _endAction.

**New handout from hamburger Asset Library auto-selects.** The
"Map Asset Library…" hamburger entry used a no-op onPick, so a
handout created from there saved to IDB but left the dropdown
stale and the map unselected. Both library entry points now route
through openAddMapDialog — pick / create from either, get the same
insert + select + load.

**Delete All Data wider sweep.** Earlier only `dmr_*` localStorage
keys were wiped; `mappadux:*` keys (projector calibrations,
drawing mode pref, broadcast audio toggle, fullscreen-seen flag,
etc.) survived. Settings copy reads "wipes everything including
local settings — acts like a fresh install"; the prefix filter now
matches.

**Backdrop + FoW row styling unified.** Both surfaces now share
`.fog-row--kind`: `[Backdrop] [None] [✨]` and
`[Type] [Fog of War] [✨]`. Removed the wide param-row gap on the
Backdrop side; added a "Type" label on the FoW side; same flex
treatment on both.

**Local fonts: 12 catalog faces now bundled.** The
@fontsource/* packages ship the woff2 bytes inside the app bundle,
precached by the PWA service worker. Mappadux's Small Asset
Library principle ("SAVE HERE") now holds for fonts too — the 12
catalog families work fully offline, no Google CDN dependency for
the built-in set. User-added Browse-Google-Fonts entries keep
streaming; uploaded woff2/ttf blobs keep the FontFace API path.

  - Rasteriser walks `document.styleSheets` to inline the bundled
    woff2 bytes into the SVG document so handout PNGs render
    locally too (was hitting Google's CDN per render via the
    inline-from-css fetch).
  - Bundle export schema gained `fontFamily` — user-added Google
    Fonts now round-trip through .mappadux exports.

**Migration covers every overlay kind.** The
`SUPPORTED_KINDS` allowlist in migrations.ts hadn't been kept up
with the OverlayKind union — firestorm, aurora, embers, noise,
and transparent polygons were silently coerced to fog on reload.
Allowlist updated; new kinds round-trip cleanly. Pre-v2.14 saves
that had already lost their non-fog kinds aren't recoverable
(data was overwritten with 'fog' previously).

**Live backdrop changes propagate to player windows.** Player
view_update handler missed setBackdrop, so backdrop kind / param
edits required a player reconnect to apply. Now mirrors map_change
behaviour and tweaks reach the player instantly.

**Smaller fixes.** Bg-colour persistence on transparent textmaps
(auto-sample no longer overwrites user picks on reload); UI scale
slider in Settings → Display (75–150% scales the whole sidebar in
proportion); new text-element font inheritance from selected /
last-on-page element; logo etymology surfaces on the brand icon
tooltip.

## v2.13.1 — 2026-05-17

### Text Map editor — font dropdown + new-text inheritance

Two handout-editor bug fixes flagged during v2.13 testing.

**Font dropdown floor is now the 12 bundled catalog families.** The
dropdown previously relied on the ImageAssetStore as source of
truth, with a 3-string fallback (Cinzel / Georgia / Times New
Roman) when the store was empty. Any deployment whose IDB pre-
dated a catalog addition — or that had run Delete All Data between
seedings — silently lost fonts from the dropdown, and the set
differed across machines depending on when the seed had last
landed. Switched the floor to BASE_FONTS, built from BUNDLED_FONTS
directly + the two system serifs, so the 12 catalog families are
always present regardless of store state. User-added Image-Library
fonts append below. The Google Fonts CSS request also pre-loads
the full floor so previews render even when the seed missed.

**New text elements inherit the full font style.** Earlier only
the session-wide last-picked font family + colour carried over;
size and alignment had to be re-set on every new box. Now `+ Text`
inherits fontFamily / fontScale / color / textAlign from the
currently-selected text element (if any), or the most recent text
element on the page, or the session-wide scalars, or page defaults
— in that priority order. Bold / italic / underline live inline
in the html body and still can't carry to an empty new element.

## v2.13.0 — 2026-05-17

### Transparency, persistence, UI scale

Smaller release than v2.12 — three threads that fit together cleanly.

**Make Transparent — new MapFX kind.** A polygon kind that doesn't
draw anything visible; instead it punches alpha holes through the
map. The clip-pass downstream mixes the active backdrop in behind
the holes, so a Make-Transparent patch on any image map becomes a
window through to whatever backdrop the GM has chosen. Pair with a
Starfield backdrop for a constellation chart, an Ocean backdrop for
a ship's deckplan, etc. Renderer uses CustomBlending with src=Zero
on both RGB and alpha — RGB factors leave the destination untouched
while the alpha factors do `dstAlpha *= (1 - srcAlpha)`, so the
shader's mask coverage scales the alpha-removal linearly.

**Background colour persists across reloads.** The auto-sample
heuristic ("if bg is `#000000`, sample the map's top-left pixel")
couldn't tell "user never picked anything" from "user picked black"
from "user picked something we lost". On a transparent textmap the
sample also returned `#000000` (alpha-0 pixels decode as RGB 0,0,0),
so the state could quietly churn black-over-black on every reload
and mask a persistence race. Replaced with an explicit
hasSavedConfig signal from loadForMap; the auto-sample only fires
on a map's *first* ever load. Also: a transparent sampled pixel no
longer writes anything, leaving the default `#000000` in place.

**Migrations preserve every MapFX kind.** Caught while testing
Make Transparent: areas marked transparent came back as opaque fog
after a refresh. The migration's `SUPPORTED_KINDS` allowlist hadn't
been kept up with the OverlayKind union — firestorm, aurora,
embers, noise, and transparent all coerced to fog on load. Silent
data loss. Allowlist now covers every kind with a comment pinning
it to types.ts so a future addition surfaces the same hazard.
(Pre-v2.13 saves can't be recovered — the data was already
overwritten with 'fog' at the previous save.)

**Live backdrop changes propagate to player windows.** The player's
view_update handler called `setView` but not `setBackdrop`. Because
the renderer rebuilds the clip-pass when the backdrop kind changes
on a separate code path, bg-colour edits ticked the uniform but
backdrop kind / param tweaks needed the player to disconnect and
reconnect before taking effect. Mirror the map_change handler:
setView, then setBackdrop with msg.payload.backdrop ?? null.

**Brush mode is now sticky.** Each brush stroke commits and the
next drag starts a fresh stroke without re-clicking Paint —
matches Fill's behaviour and resolves the "Brush button still
glowing after I dragged once" confusion. Brush erase the same way.

**UI scale slider in Settings → Display.** New 75–150% slider
scales the whole left-hand sidebar in proportion: fonts, padding,
borders, icons, popovers all scale together via CSS `zoom` on
`#sidebar`. The grid column also scales — `--sidebar-width: calc(280px
* var(--ui-scale))` in main.css — so the column footprint shrinks
or grows in lockstep with the contents. The map canvas itself is
untouched. Persists in `dmr_ui_scale`. Default 100%; double-click
the slider to reset.

**Make Transparent is also visible through transparent textmaps.**
Combining the v2.12 transparent-paper handout option with a
backdrop produces a "see through" handout where the backdrop fills
everywhere the page is transparent. Plus a Make-Transparent patch
on the same handout extends the effect to image maps too.

**Logo tooltip.** The brand icon now carries the Latin etymology
(mappa + dux = map guide; also a duck on a map) in addition to the
share-link hint.

**Smaller fixes.** Brush mode is sticky like Fill. Live view edits
(bg colour, backdrop kind, backdrop params) reach connected players
without forcing a reconnect. MOTD popup system stays in place
(empty version disables it for v2.13; ready for the first future
release that wants to surface a message).

**Help.md** catches up with the unified Fog of War & MapFX surface
(kinds, drawing modes, sparkle popover, paint-another-like-this,
Make Transparent) and adds Display + Performance Settings sections.

## v2.12.x — 2026-05-17

### Backdrops + MapFX unification + UI consolidation

Major refactor and feature expansion since 2.12.0. The Backdrop and
MapFX subsystems now share a single shader source per effect, and
the GM tunes both via the same compact sparkle-button popover
pattern. New shaders added, all old ones expanded.

**Unified shader architecture.** Each shareable effect lives in
`src/mapfx/shaders/<id>/fragment.glsl` with a `BEGIN backdrop-
shareable` marker block. The MapFX path keeps its polygon-mask
wrapper at the bottom; the new `src/rendering/backdrops/fromMapFx
.ts` wrapper lifts the marker block into the clip-pass and
composites the result over `uBgColor` using the kind's blend mode.
Texture passthrough (uNoise) shares the MapFX shader registry
cache. End result: one place to tweak any effect — no more drift
between the polygon-painted version and the bars version.

**Every backdrop-suitable MapFX kind is now also a backdrop.**
Eleven backdrops available (alphabetised): Aurora, Coloured Flames,
Embers, Firestorm, Magic Portal, Magical Light, Mist / Smoke,
Noise, Ocean, Starfield, Thundercloud. Picking any of them from
the Map panel's sparkle button fills the bars with the same visual
the GM paints on the map. The MapFX-only kinds are Fog of War
(just a flat fill) and River (its directional flow needs the
larger map view to read).

- **Noise** — new MapFX kind + Backdrop. Colourable TV-static,
  cheap (single hash per fragment), reads as scintillation /
  haunted-screen / magical interference depending on tint.
- **Aurora / Embers** — new MapFX kinds added alongside the
  backdrop variants that landed earlier in 2.12. Same algorithms;
  GM paints aurora curtains or rising sparks as regions on the
  map.
- **Firestorm Scale** — new slider amplifies the volumetric
  raymarch coverage so the GM can dial inferno-level density that
  fills the canvas.
- **Starfield Glow** — slider exposed on both MapFX + Backdrop;
  0 collapses haloed orbs to crisp pinpoint stars, 1 keeps the
  original Shadertoy look.

**Backdrop dropdown alphabetised** for scannability now that the
list has grown to 11. 'None (solid colour)' stays pinned at the
top.

**Sparkle-popover UI on both sides.** The GM panel rows for FoW
and Map both compressed to `[active name] [✦ sparkle]`. The
sparkle opens a popover hosting the kind dropdown + Colour (or
Background) row + Edge Fade + the active effect's params. Old
inline kind dropdown and inline colour swatch removed — single
source of truth, single editing surface. The same `FxPopover`
component drives both popovers.

**Per-kind in-use indicator.** Green '●' prefix + accent colour
on every kind that has at least one polygon on the current map's
fog state. Visible inside the popover dropdown.

**Slider drag-capture protection.** Each popover's onChange paths
flip a suppress flag so the structural refresh hooks skip the
DOM rebuild mid-drag — sliders no longer stutter or drop pointer
capture.

**Textmap transparent paper option.** Tick "Transparent" next to
the Paper colour to rasterise the textmap with a clear alpha
channel; the underlying GM canvas shows through any gaps in the
body. (Note: making backdrop effects specifically visible behind
a transparent map requires a follow-up renderer change; the
rasterised PNG with alpha is the foundation.)

**FX param dump helper** at `window.mappaduxDumpFx()` for capturing
the GM's tuned per-kind drafts + active backdrop params as paste-
friendly JSON. Cached on `window._mppFxLast`.

**MOTD popup.** Edit `src/motd/motd.ts` (version + title + body)
to surface a one-off message on first launch after a version
bump. Auto-suppressed during first-install when the About dialog
auto-opens.

**Bug fixes.** Fog of War defaults to hard edge (Edge Fade 0).
Firestorm Speed slider now actually does something (was dead
because the shader ignored `uSpeed`). MapFX panel active-kind
label refreshes on backdrop change. Various smaller UI tweaks.

**Acknowledgements expanded** with the new shaders + the dual-mode
attributions.

## v2.12.0 — 2026-05-14

### Immersion: unified overlay system + nine MapFX shaders

v2.12 collapses Fog of War and the MapFX painting tools into one
unified polygon system, then layers eight shader-driven effects on
top of it. Every shape the GM paints is a polygon with a `kind` —
fog and MapFX are interchangeable, so the GM can use flame as fog,
swirl mist over a battlefield, drop a starfield over a sci-fi map,
or open a magic portal mid-encounter. Paint with click-polygon or
brush; commit with single-shot Paint / Erase actions.

#### Nine overlay kinds

All shader-driven kinds are GM-tintable, animated where appropriate,
and self-contained except where noted:

- **Fog of War** — the original, kept as just another kind in the
  registry. Same polygon list, same draw tools, click priority
  guaranteed (always wins overlap selection).
- **Coloured Flames** — Promethean by nimitz, CC-BY-NC-SA. Per-poly
  intensity + scale; GM tints the flames any colour from natural
  orange to soulfire blue, green wisp, purple eldritch.
- **River** — Pierco's "A river" fork, CC-BY-NC-SA. Per-poly
  intensity, scale, speed, **direction** (compass radians, every
  river bends differently). Refracted bed texture under the
  shimmering surface.
- **Ocean** — afl_ext, MIT. Procedural waves with per-poly
  intensity, scale, speed, wave-height. Sun locked for stable
  ambience; tint via uColor for blood seas / void oceans.
- **Magical Light** — in-house. Soft radial glow + animated swirls
  + twinkling particles, additive blend. Per-poly intensity, scale,
  speed, swirls, particles. Tint chooses the light hue.
- **Starfield** — Deadtotem's "StarField practice", CC-BY-NC-SA.
  Eight parallax layers, per-poly intensity, scale, speed (up to
  warp), **direction** (head-on approach → sideways → receding).
- **Magic Portal** — Delincoter's "Magic Portal", CC-BY-NC-SA.
  Continuous-open energy disc with event-horizon centre; per-poly
  intensity, scale, speed; tint for any portal colour.
- **Thundercloud** — mahalis's "thundercloud", CC BY-NC. Cool slate
  body with random lightning flashes; per-poly intensity, scale,
  speed, **lightning** (flash brightness; tint controls flash hue,
  not body — keeps the storm-cloud look consistent).
- **Smoke / Mist** — deusnovus's Smooth Fog Shader, CC-BY-NC-SA.
  Two-FBM domain-warp drifting wisps; per-poly intensity, scale,
  speed, **direction**.

#### Per-polygon everything

Every overlay property is per-polygon and persists through reloads:

- **Colour** — selecting a polygon snaps the swatch to its colour;
  edits update that polygon immediately. With no selection, the
  swatch drives the "next new polygon" draft. The GM's last-tuned
  values carry forward.
- **Shader params** — same pattern. Selected polygon's sliders show
  its values; tweaking updates that polygon; new polygons inherit
  the kind's draft. River direction, ocean wave-height, light
  swirls all behave the same way.
- **Paint-another-like-this** — if Paint is clicked with a polygon
  selected, the new polygon inherits the exemplar's colour and
  shader params. Rows of identical campfires, a consistent river
  flow, evenly-tuned fog patches — no re-tuning per shape.
- **Morph kind via dropdown** — change the dropdown while a polygon
  is selected and that polygon's kind morphs in place. "This FoW
  patch is actually flames"; "this fire pool should be cool mist".
  The shader plane recreates with the new kind's GLSL.

#### Edge Fade — universal soft edges

A single Edge Fade slider in the panel softens any polygon's outline
organically, baked into the alpha mask at rasterise time. Slider
range 0..0.20 with 0.10 default at the midpoint — the calibrated
sweet spot that removes pixelation cleanly on every kind. Works for
fog and every shader kind uniformly; zero per-frame cost.

#### Click priority by dropdown order

When polygons overlap, clicking selects by kind priority (fog first,
then MapFX kinds in dropdown order, then most-recently created as
tiebreaker). A fog patch under a fire pool can always be reached.
The dropdown order doubles as the priority order — natural mental
model.

#### Editor UX

- **Drawing Mode toggle** — Polygon or Brush, sticky across reloads
  via localStorage (not bundle state).
- **Brush size** in CSS pixels so zooming in gives finer detail
  painting for free.
- **Selection-only handles** — trashcan glyph at bottom-left of any
  selected polygon (FogEditor + future polish sweep across editors).
- **No more centre-of-poly selector icons** — interior clicks select
  any kind, panel auto-opens to the picked polygon's kind, swatch
  + sliders snap to its values.
- **Hint as tooltip** — panel header carries the workflow hint on
  hover; no permanent panel space taken.

#### Generic self-sample infrastructure

Any shader that declares `uniform sampler2D uMap` automatically
receives the map texture + a per-plane `uMapUv` (the polygon's
bbox in map-UV) so the shader can sample the rendered map
underneath the polygon. Used as opt-in refraction-bed for future
"river over the GM's painted river" mode (toggle ships in v2.12;
default off).

#### Persistence

The migration in `storage/migrations.ts` preserves `holes`,
`shaderParams`, and `edgeFade` through map reloads + bundle export
/ import. Pre-v2.12 polygons gain `kind: 'fog'` automatically;
polygons with removed kinds (dev placeholders) coerce to fog so
existing shapes survive.

#### Acknowledgements

`ACKNOWLEDGEMENTS.md` now credits the Shadertoy creators behind
every adapted shader (nimitz, Pierco, afl_ext, Deadtotem, Delincoter,
deusnovus, mahalis) with their original Shadertoy URLs, licences,
and sub-attributions for the noise / hash primitives they relied on
(iq, David Hoskins). Each shader file's header also carries an
"Adaptation notes" block describing what was changed for top-down
battlemap use.

#### Animated backdrops (in the bars)

The letterbox / pillarbox area around the map used to be a dead
solid colour. v2.12 turns it into per-pack territory:

- **Theme → Backdrop dropdown** in the Customise pack… dialog,
  alongside Mode + Accent. First kind shipped is a slow drifting
  **Starfield** (Deadtotem, CC-BY-NC-SA) — ideal for sci-fi packs,
  blooms softly behind the map without ever overlaying it.
- Implemented as a clip-pass shader injection — the rectangle inside
  the GM's viewport keeps showing the composed map untouched; the
  starfield only paints the dead bars.
- Backdrop choice travels with the bundle via `ThemeConfig.backdrop`.
  Adding new kinds is a single registry entry in
  `src/rendering/backdrops/`.
- Player / Projector broadcast of the backdrop choice is a v2.13
  follow-up; the GM canvas reads it today.

#### Animated maps (webm / mp4)

Map assets are no longer image-only:

- Upload a `.webm` or `.mp4` through the same drop zone you'd use
  for a PNG. The library treats it as a regular MapAsset — same
  calibration flow, same fog editor, same marker workflow.
- The renderer detects video via a magic-byte sniff (EBML for webm,
  ftyp atom for mp4) and wraps it in a `THREE.VideoTexture`. Looped,
  muted, autoplaying — no user gesture needed.
- Magic Wand fill samples the current video frame so flood-fill
  works against whatever the GM is actually looking at.
- Per-file upload cap raised from 50 MB → 200 MB to fit short loops
  comfortably; the file picker accept attribute extended.
- Player / Projector broadcast of video bytes (and frame sync) is
  a v2.13 follow-up; the GM canvas plays today.

#### Sliders are "feel" controls

Visible numeric readouts have been stripped from every "feel"
slider in the GM UI — Filter, Transition, MapFX, Text Map element
toolbar. The number lives on the slider's `title` attribute for
share / screenshot use; the chrome stays uncluttered so users
trust the touch and stop precision-twiddling.

---

## v2.11.0 — 2026-05-13

### Workspace pan/zoom, a rebuilt direct-manipulation UX, and tablet-as-screen

v2.11 turns the GM canvas into a real workspace and rebuilds every
selection / handle interaction around one consistent design language.
The biggest practical win is **tablet-as-screen**: any device on the
LAN — a phone, a spare tablet, a laptop — opens the player view in a
browser and becomes a fully functional second screen. Pack your
gaming laptop and two tablets and you have a complete three-screen
in-person VTT setup in a bag: laptop as the GM screen, one tablet
flat on the table as the calibrated 1″-scale projector / floorplan,
and the other facing the players for handouts and reveals.

#### GM canvas workspace

- **Mouse drag-pan** — click + drag anywhere on the canvas (away from
  handles / markers) to pan the camera. Cursor flips to "grabbing".
- **Wheel zoom + keyboard pan** — scroll-wheel zooms around the
  cursor; arrow keys pan; R resets. Carried over from earlier A4 work.
- **Touch gestures** — two-finger pinch to zoom + pan, single-touch
  still reserved for editors (fog draw, marker handles).
- **Off-screen indicator pills** — when a player / projector rect is
  panned out of the visible workspace a colour-matched pill appears
  at the wrapper edge with a rotating arrow pointing to the rect.
  Click recentres the camera on it.
- **Reset view pill** — small bottom-right affordance that appears
  only when the camera is off identity. Click restores the default
  centred fit.

#### Direct-manipulation rebuild — markers and viewport rectangles

The marker panel's separate label / icon / size / role inputs are
gone in favour of on-canvas chrome. Every marker now carries:

- **Move handle** at the top-left corner (drag = move + select).
- **Badge row** along the top edge — visibility, audio role, motion
  role; live indicators of state, click to toggle.
- **Resize + rotate handles** at the bottom-right and top edges when
  selected.
- **Locked enforcement** — locked markers ignore handle drags and
  show greyed badges as display-only.
- **Per-marker sprite layer** — each marker renders into its own
  Three.js sprite with an unbounded-resolution canvas texture, so
  large markers stay crisp even at deep player-side zoom levels.

The player and projector viewport rectangles speak the same language:

- **Move handle** at the top-left, **resize handle** at the bottom-
  right (player only — projector size is calibration-locked),
  **aspect-lock (16:9)** and **maximise / restore** buttons on the
  right edge.
- **"Pop" shortcut** — grabbing the move handle on a full-map player
  rect snaps it to 50% map dimensions centred, so a maximised rect
  becomes draggable in one gesture.
- **Selection is handle-only** — clicking inside the rect no longer
  steals selection, so canvas clicks fall through to markers, fog
  selection, and mouse drag-pan as expected.

#### Side panel rework

- **Player View panel retired** — every action it carried is now a
  handle click on the rect. The broadcast toggle ("GM is faffing"
  placeholder) moved to the **Player Connection** panel header
  (Session was renamed for clarity).
- **Background Colour** folded into Map Selection alongside the
  other per-map settings.
- **Projection View panel** auto-collapses when the projector rect
  is deselected.
- **Blackout button retired** — broadcast toggle covers the same
  need with a friendlier UX (and the legacy `'black'` projection
  mode normalises to `'full'` on load for backward compatibility).

#### EditableSelect — in-place rename combobox

A new custom combobox wraps every renamable dropdown:

- **Map dropdown**, **Marker dropdown**, **Projector calibration
  picker** — selected option's label is editable inline. Click to
  rename, Enter commits, Esc reverts, chevron opens the menu.
- The separate "Name" input rows in the Map and Marker panels are
  gone; the dropdown IS the rename field.
- **Native `<select>` baseline** — unified styling across every
  modal dropdown (licence pickers, calibration LFD selects, Text
  Map font / aspect, Freesound duration) so the visual family is
  consistent without per-control wrapping.

#### Fullscreen UX

- The exit-fullscreen button on player + projector grows to ~50vmin
  in `:fullscreen` state and stays fully visible — a generous tap
  target so dismounting fullscreen from a tablet doesn't require
  precision aiming at a 20px corner button.

#### Text Map editor

- **Element chrome unified** with the marker / viewport rect design:
  move handle top-left, resize bottom-right, delete badge top-right,
  selection cue = dashed outline + soft veil.

#### Calibration board (mobile)

- **Pinch + drag-pan** on the manual calibration board so tablet
  users can zoom in on a crowded grid to place endpoints precisely.

#### Image Assets Library

- Stream B landed earlier in v2.11 — a third first-class asset
  library alongside Maps and Sounds, with the same library / web-
  link / upload / connector taxonomy. Includes the **Lucide** icon
  set (MIT) and **game-icons.net** (CC-BY 3.0) as built-in
  connectors with proper attribution flow-through to the unified
  credits modal.
- **Icon-picker preview prefetch threshold** raised from 12 → 30,
  giving previews sooner without slamming the jsDelivr CDN on
  wide 2-char searches.

#### Text Maps (Handouts)

- Stream C landed earlier in v2.11 — text-map / handout entries are
  a new map type with a rich element editor, multiple aspect
  presets, font picker, and animated reveal transitions.

#### Internals

- **CanvasTransform** controller — a pure-math pan/zoom model
  shared between the GM workspace, the calibration board, and any
  future zoomable surface.
- **Gestures** helper extended with a `pointerType` field on
  drag events so consumers can filter mouse vs touch without going
  back to the raw PointerEvent.
- **Renderer** gained mapNormToCanvasCss / canvasCssToMapNorm /
  worldToScreen / setCameraTransform so the editors (Fog, Marker,
  Viewport, ProjectorViewport) all route through one source of
  truth for screen ↔ map coordinate translation.

## v2.10.5 — 2026-05-11

Feature:
- **Map scale auto-detect + legacy retrofit** — on import (Upload and Web
  Links tabs) Mappadux now guesses each map's grid size and 1″ scale from
  a stack of three signals: any `[WxH]` pattern in the filename or map
  name (range [5, 200]); embedded image DPI parsed from PNG `pHYs` or
  JPEG JFIF density (clipped to a [50, 600] px/sq range); and the GCD of
  the image dimensions, assuming square cells. Candidates are scored
  with bonuses for standard DPIs (75/150/300 most, 72/100/200 next),
  signal alignment, and "nice" round numbers.
  - **Scaled** (yellow badge, auto-applied) when at least one strong
    external signal (DPI or filename) confirms a standard-DPI candidate.
  - **AutoScaled** (orange badge) when the detector picked a best guess
    but the score gap is narrow, or when the user picked an option from
    the new candidate dialog.
  - **No grid** (grey badge) when the user explicitly opted a map out
    of scaling — handouts, world maps, stat blocks, etc. Also offered as
    the bottom row in the candidate dialog.
  - Ambiguous imports (multiple candidates tied, no tiebreaker) open a
    small radio-list dialog showing the top three options plus the
    no-grid opt-out. Skip leaves the map uncalibrated for manual work.
  - A new **retrofit pass** runs every time a `.mappadux` (or legacy
    `.json`) pack loads — quietly auto-detects scale on any map in the
    pack that lacks it, so older packs upgrade themselves on first
    open. Status bar reports the count: *"Auto-scaled 4, 2 need a look"*.
  - The Calibrate flow now stamps `scaleConfidence: 'manual'` so the
    auto-detector treats hand-calibrated maps as authoritative and
    never overrides them.
  - Per-asset "No grid" toggle in the library editor flips the opt-out
    immediately; clicking the No-grid pill on a map clears the opt-out
    and opens the manual Calibrate modal.

Fix:
- **Projection View** — Open Projector / Open Projector Monitor buttons
  no longer fail with "Waiting for P2P… try again in a moment." on cold
  load. The buttons gated on `Host.roomCode`, which only became available
  after the PeerJS broker handshake completed — fast on localhost dev,
  noticeably slower on production HTTPS, so clicks that came in early
  hit the warning branch and never reached `window.open`. `Host` now
  tracks the requested peer ID synchronously inside `start()` and the
  `roomCode` getter returns it immediately, so the projector window
  launches right away and connects to the same-browser GM over
  BroadcastChannel without waiting on the broker. Remote-projector /
  remote-player PeerJS paths unchanged.

Fix:
- **Projector kept the previous map's filter on map swap** — the
  projector's `map_change` handler updated markers, fog, and dimensions
  but never re-read `msg.filter`, so swapping to a map with "none"
  selected left the prior map's filter applied until the user toggled
  the dropdown off and back on. Now mirrors the player path: pulls the
  incoming filter from `map_change` and re-applies.

Polish:
- **Projector overlay warnings fade** — the "Waiting for GM to load a
  map…" and "Map not calibrated…" messages now fade out 5 seconds after
  first appearing. The GM-side UI still shows these conditions
  persistently, so the projection window doesn't need to keep nagging
  over what's being shown. Re-fires (and re-fades) on the next
  transition into the warning state.

## v2.10.4 — 2026-05-10

Docs:
- **screenshot.png** refreshed to show the v2.10 GM interface.

## v2.10.3 — 2026-05-10

Docs:
- **HELP.md** brought up to v2.10. New **App Menu (☰)** section covers
  Save / Save Encrypted / Load Map Pack, Customise pack…, New Map
  Pack…, Settings…, About…, and `?bundle=<URL>` sharing. Session,
  Map, Markers, and Soundboard entries updated for the v2.10 UI
  (Map Pack name field, dropdown-sentinel + Add patterns, ⬇ download
  buttons, QR-click-to-copy, "X players connected" line, hamburger
  as the home for pack-level actions). Projector section unchanged
  bar a small note that the LFD calibration step now points users at
  the Projector path when their screen isn't listed.

## v2.10.2 — 2026-05-10

Docs:
- **ACKNOWLEDGEMENTS.md** rewritten as the Mappadux attribution system's
  own output for the default *Getting Started* pack — 15 audio sources
  (Freesound, mix of CC0 / CC-BY / CC-BY-NC) and 3 map sources, all
  with creator / licence / source-URL. Practising what we preach.
- **README.md** — removed the stale "Future Plans" section (the lone
  Lighting bullet); release history reference kept.

## v2.10.1 — 2026-05-10

Hotfix on the v2.10.0 rollout:

- **Removed the wildcard `vercel.json` redirect** that 301-ed every
  path from `dynamic-map-renderer-v2.vercel.app` to `www.mappadux.com`.
  Subresource requests (.js / .css / manifest) were getting cross-
  origin-redirected, and CORS blocked them — assets failed to load on
  the legacy origin. Domain redirect is now configured at the Vercel
  dashboard level, which scopes it to top-level HTML navigation and
  leaves subresource requests untouched.
- **Bundle: `lastMapId`** added. The map the creator was viewing when
  they saved now travels in the pack and is restored on import — gated
  to map ids actually present in the bundle so stale references fall
  through to the first-map default rather than stranding the recipient.

## v2.10.0 — 2026-05-10

### Customisation, distribution, and a clean home for app-level actions

v2.10 is the "make this feel like a real product you'd share" release. The
hamburger menu becomes the home for everything pack-level; map packs gain
encryption, gzip compression, custom branding, theming, and URL-based
sharing; and the asset libraries finally let you pull individual assets
back out.

#### Hamburger menu

- New ☰ button in the GM sidebar brand block, hosts all pack-level
  actions. Click-outside / Escape closes. Items can flag themselves as
  `danger` (red) for destructive entries.
- Entries (in order): **Save Map Pack…**, **Save Encrypted Pack…**,
  **Load Map Pack**, **Customise pack…**, **New Map Pack…** (red),
  **Settings…**, **About…** (footer).
- Old in-panel **Save to File** / **Load Maps File** buttons removed —
  the bundle flows live here now.

#### Map Pack format

- Saved bundles use a branded **`.mappadux`** extension. Load dialog
  accepts both `.mappadux` and legacy `.json`.
- File is **gzipped** before write (CompressionStream); typical pack size
  drops ~10–25%. Bigger relative win on the encrypted path where base64
  inflation used to dominate.
- Save fires the native OS save picker (`window.showSaveFilePicker`
  where supported, anchor fallback elsewhere). Custom
  `application/x-mappadux-pack` MIME so the picker doesn't pad the filter
  with `.exe` / `.com` / `.bin` like generic octet-stream does.
- New pack-level `packName` field, edited in the Map Selection panel
  ("Map Pack" input) and pre-filled into save filenames as a slug. Default
  bundle seeds the name as **"Getting Started"**.

#### Optional password encryption

- New hamburger entry **Save Encrypted Pack…**. Web Crypto AES-GCM with
  a PBKDF2-derived key (200k iterations, SHA-256). Per-file random
  salt + IV.
- Wrong password on load surfaces a generic "Wrong password or corrupt
  file" — no leakage about which it was. AES-GCM tag does the integrity
  check, no separate HMAC.
- Bundle JSON gets gzipped *before* encryption so encrypted files are
  smaller too.
- Decryption is checked BEFORE wiping the workspace, so cancelling at
  the password prompt leaves your current pack intact.

#### Customisable splash + About

- New **About…** dialog (auto-opens on first run / on every Load Map
  Pack). Display mode shows the creator's title / banner image / rich
  description body / links, then a fixed Mappadux footer (Discord,
  Ko-fi, GitHub, mappadux.com, MIT licence).
- New **Customise pack…** dialog (edit mode) lets creators set per-pack:
  - Title, banner image with **drag-to-pan crop picker** for off-aspect
    images, rich body text.
  - Rich-text toolbar: **B / I / U**, align left/centre/right, bullets,
    numbered list, font (System/Serif/Mono/Display), colour picker.
  - Up to N creator links (Patreon, socials, Kickstarter, etc.).
- Output sanitised via a strict allow-list (`p, br, b/strong, i/em, u, ul,
  ol, li, span, font, div` + filtered `style`) so loading a community
  pack can't inject script or load remote resources.
- New default body is a friendly origin-story intro that emphasises the
  built-in attribution flow.

#### Theme

- Per-pack **Theme** section in Customise mode: Dark/Light segmented
  toggle + custom accent colour picker with hex echo and Reset.
- CSS-variable driven; hover/dim shades derive automatically from the
  live `--accent` via `color-mix()`. Map render area unaffected — chrome
  only.
- Edits apply **live** during the dialog so you see the result; Cancel
  reverts to whatever was active when the dialog opened.

#### New Map Pack + Settings

- **New Map Pack…** (red) clears the workspace and starts an empty pack
  with a name you choose — no Getting Started re-seed.
- **Settings…** dialog with three sections:
  - **Storage** — live IndexedDB usage / quota readout, persistence
    status, "Request persistent storage" button.
  - **API Keys (this browser only)** — lists stored credentials (Freesound)
    with redacted previews; bulk delete; messaging that keys never travel
    in pack exports.
  - **Danger Zone** — **Delete DB** (wipe IDB, keep API keys + calibration,
    reload) and **Delete All Data** (wipe IDB + every `dmr_*` localStorage
    entry, reload). Reloads instead of in-place reset so state guarantees
    are simple.

#### Per-asset download

- ⬇ button on every locally-stored row in **Map Library** and **Sound
  Library** — pulls the original blob back out as a file download with a
  sensible filename. Routes through the same `showSaveFilePicker` path
  as Save Map Pack so you can pick where the asset lands.

#### Bundle URL load

- `?bundle=<URL>` startup parameter loads a pack from a URL instead of
  default-seeding. If your IDB already has content, you get a three-way
  prompt: **Save current, then load** / **Discard and load** / **Cancel**.
  Param is stripped from the URL after handling so a reload doesn't
  re-trigger.

#### Bundle data audit + fixes

- `MapAsset.pixelsPerSquare` and `calibrationLine` were being **dropped**
  on bundle export for locally-stored map assets — calibration didn't
  survive save/load. Fixed: both fields now travel in the bundle and
  round-trip correctly.
- Stored audio: `attributionLink` was being dropped on export. Fixed.
- Custom icons: `addedAt` was being dropped. Fixed (with sensible
  fallback for older bundles).

#### Session panel tighten-up

- Old visible **Room Code** row removed. Code is shown on hover (QR
  tooltip).
- **Copy Player URL** is now a small white bar to the left of the QR;
  the QR itself is also clickable to copy.
- "Players connected" count below the QR; pluralisation handled
  automatically. Disconnect path was missing a notify call when
  `conn.on('error')` fired — fixed; count now updates on any disconnect.

#### Vercel routing

- `vercel.json` now redirects `dynamic-map-renderer-v2.vercel.app` →
  `https://www.mappadux.com/` (301). Deep links preserved.

#### Misc

- Map Selection, Marker, and Projector dropdowns unified on a single
  **+ Add New X** sentinel pattern (bold-green action option at the
  bottom). Standalone Add buttons removed.
- LFD calibration step now tells the user to switch to the Projector
  path if their screen / resolution isn't listed.

## v2.9.0 — 2026-05-10

### Mappadux brand + Projector / Battlemap mode

The big rebrand and the v2.9 projector feature land together. The product
name is now **Mappadux** ("VTT@Home"); the package, repo folder, and
default Vercel slug stay as `dynamic-map-renderer-v2` for now (custom
domain `mappadux.com` is purchased and queued for setup). Page titles,
GM sidebar brand block, player connect heading, and PWA manifest all
carry the new name.

The much larger story is **Projector / Battlemap mode** — render a
calibrated crop of the active map at true table scale on an under-table
screen or down-projector, so a 1″ creature on the map actually projects
as 1″ on the surface and miniatures occupy real-world inches.

#### Map calibration

- Per-asset `pixelsPerSquare`, expressed as **1″ / 25 mm** grid squares
  (not 5'/D&D-square — that's a separate concept).
- New **Map Calibration Modal**: drag two endpoint crosshairs across a
  known-distance line on the map, type how many squares it represents.
  Saves both the resulting `pixelsPerSquare` AND the original endpoints
  so re-editing picks up where you left off.
- Fullscreen SVG editor with scroll-zoom (zoom-toward-cursor) and
  drag-pan; uses `getScreenCTM()` so endpoint pointer math is correct
  regardless of `preserveAspectRatio` letterboxing.
- Orange-base + green marching-ants visual on the calibration line, with
  oversize crosshairs that grab where the cursor actually clicks.

#### Projector calibration

- Per-device setup persisted in `localStorage`
  (`dmr_projector_setups`, `dmr_projector_active`). One device can hold
  multiple named setups — Game Room TV, Garage Projector, etc.
- Two calibration paths in a guided 3-step wizard:
    - **Large Format Display** — pick diagonal inches + resolution from
      dropdowns, the math computes pixels-per-inch automatically.
    - **Projector** — full-bleed live grid + coarse/fine sliders.
      Hold a ruler against the projection surface and dial it in.
- **Standalone calibration window** (`/calibrate.html`) — calibration
  is meaningless unless it physically projects at scale, so the modal
  opens as its own popup with a hint banner: *"Drag this window onto
  your projector or under-table screen, then toggle Fullscreen — the
  grid you'll see in the next step needs to be physically projected
  at scale before you can ruler it."*
- Saved → window auto-closes; the GM's Projector dropdown picks up
  the new setup via a `storage` event.

#### Projector window (`/projector.html`)

- Joins the GM as a P2P Guest (BroadcastChannel for same-browser, PeerJS
  for remote). Receives the active map and renders a
  `setup.pixelsPerSquare × map.pixelsPerSquare` crop centred on
  `projectorViewport.centerX/Y`.
- Three render modes (mutually exclusive): **scaled** (calibrated crop
  at table scale), **full** (fit-to-window, ignore calibration), or
  **black** (mute the surface during a transition).
- **0° / 90° / 180° / 270° rotation** of the rendered output via CSS
  transform — for fitting a portrait map onto a landscape projector.
  Effective dimensions swap for 90 / 270, used by the calibration math
  so the crop math stays right at any rotation.
- **1″ grid overlay** (toggle + colour picker) — anchored to projector
  calibration only, ignores map scale. Lines spaced at the projector's
  `pixelsPerSquare` CSS pixels, centred on the window so the middle of
  the projection is always a grid intersection.
- **Disable Filters** switch — defaults to off (filters apply by
  default, so the projector mirrors the player view). Toggle on for
  battlemap-pure unfiltered output. Master gate via
  `Renderer.setFilterEnabled` so the filter pass is bypassed entirely.
- **Auto-fade controls** — the setup label / fullscreen / recalibrate
  panel fades to opacity 0 after 10 s of mouse inactivity. Movement
  brings it back to 0.3; hover raises it to full. Table players don't
  see lingering UI chrome.
- **Markers are MAP-fixed** on the projector (not screen-fixed) — a
  token sized for one grid square stays one grid square physically,
  regardless of how zoomed the projector crop is.

#### Multi-projector (primary + monitors)

- First projector to connect = **primary**. Drives the GM's orange/green
  rectangle and uses its own calibration to render at table scale.
- Subsequent projectors = **monitors**. Mirror the primary's exact crop
  fit-to-window. Skip their own calibration. The monitor's canvas is
  constrained to the primary's aspect ratio via a CSS variable, white
  pad fills the bars, and a TV-bezel frame welds to the canvas (not
  the window) so what's *inside* the bezel matches the primary 1:1.
- Big red bottom-left **PROJECTOR MONITOR N** badge always at full
  opacity; fullscreen icon stays bottom-right and forced to icon-only.
- Closing the primary tears down the whole projection — a
  `projector_shutdown` message is broadcast to every monitor, which
  call `window.close()` themselves. No auto-promotion.
- Each window picks a `clientId` uuid and sends it in `projector_hello`;
  the GM addresses per-projector state via `projector_role` messages
  (broadcast, filtered by `targetId`). Monitors get fresh
  `primaryViewNW/NH/Aspect` whenever the primary's situation changes.

#### Projection View panel — single-control workflow

- Replaces the multi-button launch UI with one **Projector** dropdown:
    - **No Projection** (default — selecting again closes all)
    - One option per saved calibration setup
    - **+ Calibrate New Projector…** (opens the calibration popup)
- Default state shows just the dropdown + an intro paragraph
  explaining the feature. The full controls (Move Projection View,
  Black Out / Full Map, Disable Filters, Rotation, 1″ Grid, Open
  Projector Monitor, Recalibrate this Map) only appear when a primary
  is live.
- All toggles use the same iOS-style switches as the rest of the app.
- The launch button switches from primary blue to ghost style once a
  primary is connected, signalling its purpose has shifted from "open
  projection" to "open monitor".
- Touching any other control while moving the projection rectangle
  implicitly commits — matches the user's mental model that going
  somewhere else means *I'm done*. (Same auto-commit applied to the
  Player View edit mode for consistency.)

#### Calibration sync + error states

- Live recalibration of an in-use map fires `map_meta_update` so the
  primary projector re-crops at the new scale; monitors get a fresh
  `primaryView*` via `projector_role`.
- GM warning banner when the active map has no `pixelsPerSquare`.
- Projector "Waiting for GM to load a map…" overlay when no map yet.
- Projector top banner *"Map not calibrated — projection is
  fit-to-window, not at table scale"* when scaled mode lacks
  calibration.

#### Cosmetic alignment

- Fullscreen toggle is at **bottom-right** across player / projector /
  calibration windows. One spot to learn for the whole app.
- Calibration modal dropped its top-right "Saved picker / + New /
  Delete" actions — the GM dropdown now manages saved setups.
- Calibration name input capped to 28ch to nudge users toward short,
  memorable names that fit comfortably in the dropdown.

### Backlog seeded for later

- `.md`-as-map "text handouts" (calligraphic parchment / line printer /
  green-screen terminal renderings of markdown).
- Animated volumetric fog of war — keep the polygon system, swap the
  flat alpha for drifting noise.
- GM canvas zoom/pan + workspace overlay model (queued alongside the
  eventual map-mosaicing work).

## v2.8.0 — 2026-05-10

### Asset Management Refresh

A from-scratch overhaul of how the app stores, shares, and credits its audio
and image assets. The user-facing TL;DR: every audio sound and every map image
is now tracked separately from the maps that use them, so one image can back
multiple maps with their own fog / markers / tracker config, and remote-source
assets (Freesound, Web Links) only travel in your data pack when you say so.

#### Sounds — `My Library` overhaul

- **Web Links tab** in the Add Sound dialog. Paste comma / newline / space
  delimited URLs to audio files; each is validated via an `<audio>` probe
  with `crossOrigin='anonymous'` and a 15 s timeout. Valid ones land in your
  library tagged **URL**; the file streams from the source at runtime.
- **Tag pills** on every library row — `Freesound` (green), `URL` (blue),
  `Stored` (grey, additive). Stored = "this asset will travel with bundle
  exports". Uploads are always Stored; Freesound and URL items become Stored
  only when you explicitly click **Store**.
- **Store button** per row promotes a remote asset to fully-local. Bulk
  variants in the footer:
    - **Store All Used** — only assets actually referenced somewhere
    - **Store All** — every non-stored asset
    - **Delete All Unused** — permanently remove the un-referenced ones
- **Trash chip** `[!]` next to library rows that no map references.
  Hover-tooltip explains they're safe to delete.
- **Editable attribution** on Upload + URL rows (Freesound rows are locked).
  Pen icon next to the licence opens an inline form: Licence dropdown
  (CC0 / CC-BY / CC-BY-SA / CC-BY-NC / CC-BY-NC-SA / CC-BY-ND / CC-BY-NC-ND
  / Permission Granted / Other), Attribution text, Link URL.
- **Attributions modal** moved out of the Soundboard panel into both
  libraries' footers as **ℹ Attributions & Licences**. Now shows separate
  **Audio assets** and **Map assets** sections with a clipboard-friendly
  **Copy All** button.

#### Maps — `Map / MapAsset` split

- **Map / MapAsset entity split** under the hood. A `StoredMap` is now a
  named instance pointing at a separate `MapAsset` that owns the actual
  image. Two named maps can share one image asset with their own fog /
  markers / audio / tracker config.
- **`+ Add New Map` dialog** replaces the lone Upload button. Three tabs:
    - **My Library** — every MapAsset, with `URL` / `Stored` tags,
      pixel dimensions, hover-preview thumbnail, per-row Store /
      Use / Delete + the same trash chip / inline editor / footer
      bulk-action buttons as the Sounds library.
    - **Web Links** — paste image URLs, validate via `Image()` probe.
    - **Upload** — drop a PNG / JPG / WebP, name it, add.
- **Name field under the dropdown** — live-edit the active map's display
  name; the dropdown label updates as you type.
- **Clone Map** alongside a renamed **Delete Map**. Clone copies the per-map
  config (fog, markers, audio slots, tracker) with regenerated marker / slot
  IDs, sharing the same MapAsset (no image duplication). Append `- copy` to
  the name (de-duped).
- **`⚠ Fix Missing Map` button** appears when the current map's asset isn't
  retrievable (deleted, broken Web Link, offline + uncached). Reuses the
  Add Map dialog to relink — the map's other settings are preserved.
- **Procedural placeholder** image rendered at the asset's cached
  `imageWidth × imageHeight` so fog / marker / viewport coords stay
  positioned correctly during the missing state.

#### Bundle format (`bundleSchema: 2`)

- New `mapInstances`, `storedMapAssets`, `remoteMapAssets`, `storedAudio`,
  `remoteAudio` fields. **Stored** assets travel with their blobs; **URL**
  assets travel as metadata-only and re-fetch on the recipient.
- Legacy fields (`maps[]`, `uploadedAudio[]`, `freesoundAudio[]`) still
  written for back-compat — older clients can still read v2.8 bundles.
- `Load Maps File` clears every asset library before importing, so two
  bundles loaded back-to-back don't accumulate strays.

#### Footer & misc

- **Storage gauge** in the bottom corner shows `XX.X / YYY MB` of browser
  storage used (via `navigator.storage.estimate()`). Refreshes every 30 s,
  tints orange past 80 % of quota.
- **DB schema** bumped to v4 with an idempotent upgrade callback that
  self-heals stuck-version states from interrupted earlier upgrades.
- **`@vercel/analytics`** added behind a build-time `__VERCEL_DEPLOY__`
  flag (`process.env.VERCEL === '1'`). Vercel deploys get privacy-friendly
  page-view tracking; self-hosters and local dev get a fully analytics-free
  bundle (verified — no `@vercel/analytics` strings in `dist/` on a
  non-Vercel build).

### Refactors

- New `MapAssetStore` facade mirroring `AudioAssetStore` (runtime cache for
  non-stored URL fetches, `store()` / `getBlob()` priority chain,
  `getAttributions()`, `readDimensions()`, `update(id, patch)`).
- `assetUsage.ts` gains `getUsedMapAssetIds()` alongside the existing audio
  + icon helpers, used by the Map Library trash tracking.

---

## v2.7.0 — 2026-05-09

### New Features

- **Motion Tracker** — periodic radar / sonar / sensor sweep layered on top of the marker system. Use it for _Aliens_-style motion sensors, submarine sonar, sci-fi sensor sweeps, magical scrying — any "I'm here" pulse mechanic.
  - **Roles** — markers can now be assigned a **Motion Source** or **Motion Tracker** role independently of any audio role they hold (so a single marker can be e.g. both an Audio Source and a Motion Source). One Tracker per map; sources are unlimited.
  - **Scan loop** — every _Ping rate_ seconds the tracker emits an outgoing ping. A ring expands from the tracker for _Scan speed_ seconds and, as it crosses each Motion Source, fires a return blob + return ping at the moment of contact.
  - **Concurrent rings** — when rate < speed, multiple ring fronts coexist on screen simultaneously.
  - **Per-map persistence** — the tracker's range, rate, speed, colour, and assigned ping sounds are stored on the map state and carry forward as defaults to any new map created after.
  - **Logarithmic range slider** — slider position 0..1 maps to range 0.05..4.0 (Y-axis-normalised map units), giving fine control at the low end where most useful values live. The selected tracker shows a dotted preview ring in the configured colour as you drag the slider.
  - **Blob modes** — each Motion Source picks its own tracker view: **Single blob** (one circle the size of the source's icon), **Multi-blob (few)** (3–5 medium scattered blobs), or **Multi-blob (many)** (7–13 small scattered blobs, similar overall footprint). Cluster shapes are deterministically randomised per source so each contact looks unique but stays stable while it fades.
  - **Audio return only mode** — toggle "Audio return only (no blobs)" to get audible pings without visual contacts — for spookier reveals.
  - **Outgoing & return ping sounds** — assign any sound from your library (Library / Freesound / Upload) to the outgoing ping (fires when a scan starts) and return ping (fires when a source is detected). Independent volume sliders for each. Two CC0 sounds are bundled and seeded into every library by default — no setup needed to get the classic motion-tracker feel.
  - **Player passthrough** — the expanding ring and return blobs render through the same Three.js plane as the markers, so all visual filters (Parchment, CRT, Watercolour, etc.) apply to them. Audio plays on connected players too. Late-joining or refreshed players sync immediately.
  - **Hit-area underlay** — return blobs render beneath the marker icons so the source token stays clearly visible on top of its detection splash.

### Refactors & Architecture

- **Multi-role marker schema** — single `marker.role` field replaced by a roles object (`roles: { audio?, motion? }`) so a marker can independently participate in several interaction systems. Versioned migration framework introduced (`STATE_VERSION` 1 → 2) with a migrator chain in `src/storage/migrations.ts` — replaces ad-hoc field guards previously inline in `loadForMap`.
- **MarkerInteraction registry** — marker-driven systems (positional audio, motion tracker) live in `src/gm/markerInteractions/` as plug-in modules implementing a common `MarkerInteraction` interface. Each owns its runtime state and reacts to `onMarkersChanged` / `onMapLoaded` / `reset`. Adding a new interaction is now a single new file.
- **AssetSourceConnector** — generic interface (`src/audio/connectors/`) decouples the asset picker UI from any specific source. Freesound is the first connector; Web Links and other APIs slot in cleanly without modal rewrites.
- **State helpers** — `StateManager.updateMarker(id, patch)` and `updateMarkers(updater)` consolidate the marker-mutation pattern across GMApp.

### Visuals & Polish

- **Marker panel reshuffle** — Name → Locked → Hide from players → **Marker Icon** subsection (Icon, Colour, Size, Show Name) → Marker Sounds → Marker Motion → Clone/Delete. Dividers above the action buttons.
- **Badge colour scheme** — sources blue (muted: purple), listeners/trackers green (muted: red). Hidden marker eye stays red/green.
- **Marker icons on player view** — pre-squash on the texture so they render as true circles after the texture-to-plane stretch on non-square maps; multiplied by `viewNH` so they stay screen-fixed regardless of how zoomed the player view is.
- **Audio "max range" → "sound limit"** label on the audio source range circle to disambiguate from tracker range.

### Fixes

- **Load Maps File wipe** — bundle import now also wipes the audio asset library and custom icon library before importing the new bundle, so two bundles loaded back-to-back don't accumulate assets.
- **Last-opened map** — the GM remembers which map was active and re-opens it on reload, instead of always defaulting to the first map.

---

## v2.6.0 — 2026-05-07

### New Features

- **Marker audio — positional audio sources** — markers can now be assigned a role of _Audio Source_ or _Listener_. Audio Sources play a looping or randomised sound whose volume falls off with distance to the Listener marker. The listener position is determined by another marker set to the Listener role (typically the player character). Volume falloff is calculated in real time as either marker is dragged.
  - **Assign sound** — click the new "Assign Sound" button in the marker properties panel to pick any sound from My Library.
  - **Playback modes** — Once / Loop / Random (same scheduler as the Soundboard).
  - **Volume** — per-source volume slider and a per-role mute toggle.
  - **Max distance** — configurable radius slider beyond which the source is inaudible.
  - **Preloading** — all audio-source buffers for the current map are preloaded on map load so positional audio starts immediately.
  - **P2P broadcast** — `positional_play` / `positional_stop` / `positional_volume` messages keep player-side audio in sync as markers move.
- **Clone Marker** — a **Clone Marker** button sits alongside Delete Marker. Creates an exact copy of the selected marker offset by +0.02 in both axes, with " - copy" appended to the label. Useful for quickly placing groups of identical tokens.
- **Player auto-reconnect** — if the GM refreshes or the P2P connection drops, the player window automatically attempts to reconnect with exponential back-off (2 s → 4 s → 8 s → 16 s → 30 s cap). The status bar shows "Reconnecting… (Ns, attempt N)" while retrying.
- **Freesound pagination** — search results now show a **More results… (N remaining)** button when the API returns more than one page. Each click appends the next batch of 20 without clearing the existing results. The status line tracks how many are shown vs total.
- **Delete custom icon** — a **✕ Delete custom icon** button appears below **+ Upload custom icon** in the icon picker when custom icons exist. Clicking it enters delete mode (icons turn red-bordered); clicking any custom icon removes it from IndexedDB and the in-memory cache. **← Cancel delete** exits without removing anything.

### Fixes

- **Bundle import state clobber** — importing a bundle file (`Load Maps File`) no longer discards the freshly-imported per-map configs. Previously, `loadMap` flushed the old in-memory session state to IDB after the import wrote fresh configs with the same map IDs — silently overwriting markers, audio slots, and player view with stale data. Fixed by calling `StateManager.resetForImport()` before repopulating the map list, ensuring the flush in `loadMap` is a no-op.
- **Soundboard slot/audio restore** — discrete state mutations (markers, audio, transitions) now trigger an immediate IDB write rather than waiting for the 400 ms debounce. This closes the window where a page refresh could occur before the debounced write fired and wipe the last change.

---

## v2.5.0 — 2026-05-06

### New Features
- **Soundboard** — each map now has a per-map Soundboard panel (between Fog of War and Markers). Add up to 10 slots per page (pageable for more). Each slot has a play/stop button, loop toggle, individual volume slider, and a remove button.
- **Freesound integration** — search Freesound.org directly from the app (requires a free API key, stored in `localStorage` only — never exported). Results show duration, username, and license. Duration filter dropdown: ≤10s / ≤20s / ≤30s (default) / ≤60s / ≤120s / Any length. Preview before importing.
- **Sound library** — imported sounds are stored in IndexedDB and shared across all maps. The "My Library" tab in the picker lets you reuse any previously imported sound on any map with one click.
- **Attribution tracking** — the "ℹ Attributions" button in the Soundboard panel lists all Freesound attribution strings and license labels so CC-BY compliance is always accessible.
- **Broadcast to players** — soundboard play/stop events are sent over P2P so players hear audio in real time. A "Broadcast to players" toggle in the panel silences remote delivery for in-person play.
- **Auto-reload** — if a sound blob is missing from local storage, the engine silently re-downloads it from Freesound before flagging the slot as unavailable.
- **Player autoplay recovery** — if the browser blocks autoplay, a "Click anywhere to enable audio" hint appears on the player screen and retries on the next interaction.
- **P2P snapshot** — currently-playing slots travel in `full_state` and `map_change` so players who connect mid-session hear what's already playing.

---

## v2.4.0 — 2026-05-05

### Changes
- **Sidebar panel order** — Fog of War → Markers → Player View → Filter → Background Colour.
- **Panel headings** — brighter text, bolder weight, subtle blue-tinted background; hover lifts to full white. Makes sections easier to scan.
- **Auto-open Markers panel** — clicking any marker on the canvas opens the Markers sidebar panel if it is collapsed.
- **Auto-open Fog panel** — entering fog draw mode or selecting a polygon opens the Fog of War panel if it is collapsed.

---

## v2.3.5 — 2026-05-05

### Fixes
- **Markers on map change** — switching maps now sends the new map's markers (and any custom icon blobs) atomically inside `map_change`, the same way fog/filter/view already travel. Previously `marker_update` was never broadcast on a map switch, so players kept the previous map's markers until a manual drag triggered a sync.

---

## v2.3.4 — 2026-05-05

### Changes
- **Custom icons sent to players** — custom uploaded icons are now transmitted over P2P. The GM encodes each referenced `asset:uuid` icon to a data URL and includes it in `marker_update` and `full_state` messages; the player decodes each entry to an `ImageBitmap` and caches it by key, skipping any already cached. This mirrors the pattern planned for audio asset delivery.

---

## v2.3.3 — 2026-05-05

### Changes
- **Show Name toggle** — each marker now has a "Show Name on player map" checkbox (default off). When off, the player map shows the icon only; the GM always sees the label regardless of this setting.

---

## v2.3.2 — 2026-05-05

### Fixes
- **Player marker Y-axis** — markers placed at the top of the GM map now appear at the top on the player screen. `MarkerTexture` was applying `(1 − y)` before drawing, which double-inverted the coordinate (Three.js `CanvasTexture` with `flipY=true` already handles the canvas→UV flip). Fixed to `cy = y * H`.

---

## v2.3.1 — 2026-05-05

### Changes
- **Markers subject to filters** — player marker layer moved from a 2D canvas DOM overlay into the Three.js scene as Plane 2 (CanvasTexture), so all GLSL post-processing filters (parchment, retro sci-fi, watercolor, etc.) are applied to markers the same as the map and fog layers.
- **Icon picker** — replaced the free-text icon input with a click-to-open picker grid. Includes 46 preset Unicode symbols (shapes, chess/card suits, circled numbers ①–⑳, check/cross marks). Custom icons can be uploaded (resized to 64×64), are stored in IndexedDB, and are included in map bundle exports/imports for full portability.
- **Icon visual redesign** — removed the filled circle background. Icons now render directly in the marker's chosen colour with a dark stroke outline for readability. Default icon changed from 📍 to ◆. Image icons (custom uploads) use `asset:<uuid>` keys and render as-is.
- **Asset storage** — added `assets` store helpers (`saveAsset`, `getAllAssets`, `deleteAsset`) to the IndexedDB layer. Custom icons (`type: 'icon'`) are included in bundle export/import alongside maps.

---

## v2.3.0 — 2026-05-05

### New Features
- **Markers / tokens** — GMs can now place, move, and manage tokens on the map.
  - **Add** — click "+ Add Marker" in the sidebar or right-click the map to place a marker at any position.
  - **Drag** — click and drag any marker to reposition it; position is broadcast to players on release.
  - **Select** — click a marker to select it; its properties appear in the Markers sidebar panel.
  - **Sidebar controls** — edit name, icon (emoji), colour, and size. Toggle "Hide from players" to ghost the marker on the GM canvas while hiding it entirely from the player view.
  - **GM status badges** — each marker shows two clickable mini-badges: visibility (green ✓ / red ✕) and a role badge for audio sources (♪) and listeners (◉). Clicking a badge toggles the property directly on the canvas.
  - **HUD buttons** — a floating mini-toolbar above the selected marker offers one-click toggle-visibility and delete.
  - **Marker dropdown** — the sidebar dropdown lists all markers; selecting from it highlights the marker on the canvas.
  - **Player view** — players see all non-hidden markers rendered at their correct map-relative positions regardless of zoom or viewport offset. Markers re-project automatically on view changes.
  - **Persistence** — markers are saved per-map in IndexedDB and restored on reload.
  - **P2P broadcast** — marker changes are broadcast as `marker_update`; hidden markers are filtered out before transmission.

---

## v2.2.4 — 2026-05-05

### Changes
- **Scanline → Terminal Clear** — redesigned from a simple line sweep to an 80×25 character-grid wipe (configurable 40–160 cols, 10–50 rows). Each cell flashes phosphor green before being cleared, with a multi-cell fade band preceding the clear front. Cleared left-to-right, top-to-bottom. Configurable duration 500ms–6s.
- **Diagonal wipe polygon fix** — corrected vertex ordering for both `diag_tl` and `diag_tr` which previously produced self-crossing polygons and visible artifacts. Full case analysis for all five geometric phases (triangle → landscape quad → portrait quad → pentagon → full fill).
- **Wipe direction labels** — arrows now indicate movement direction (e.g. `→ Left to right`) rather than the start edge.

---

## v2.2.2 — 2026-05-05

### Fixes
- **Wipe / Scanline / Static Dissolve** — transitions were showing the edge glow but removing the whole image at once rather than revealing it progressively. Root cause: `drawEdge` and noise code left `ctx.fillStyle` set to a low-alpha gradient at the end of each frame; `ctx.save()` on the next frame captured that as the active fill, so `destination-out` was painting with near-transparent paint and punching no holes. Fixed by setting `ctx.fillStyle = '#000'` inside every `destination-out` block (`destination-out` ignores colour and uses alpha only).

---

## v2.2.1 — 2026-05-05

### New Features
- **Map transitions** — animated transitions play on the player screen when the GM switches maps. Select the transition (and configure its parameters) from the Current Map panel in the GM view. The transition holds the current view, plays the animation, and reveals the new map — filter, fog, and view all swap atomically so nothing flickers in early.
  - **None** — instant cut (default behaviour, unchanged).
  - **Fade** — fades the current map to black, swaps to the new map, fades back in. Duration configurable.
  - **CRT Collapse** — the screen collapses to a horizontal line, then to a phosphor dot (with green/amber glow), then expands back out with the new map. Colour and timing configurable.
  - **Wipe** — directional wipe in 6 directions (left, right, up, down, diagonal TL, diagonal TR) with a bright edge glow. Duration configurable.
  - **Scanline** — top-to-bottom or bottom-to-top reveal with a green scan-line glow. Duration configurable.
  - **Static Dissolve** — randomised block-by-block dissolve with subtle static noise. Block size and duration configurable.
  - Architecture mirrors the filters system: each transition lives in `src/transitions/definitions/<id>/index.ts` with its own param schema. Adding a new transition is a single new file — no registry edits needed. See `ADDING_TRANSITIONS.md` in the definitions folder.
- **Version badge** — current version shown in small text at the bottom of the GM sidebar.
- **LAN IP in QR code and player links** — when running the dev server locally, the QR code, "Open Player Window" button, and "Copy Player URL" now use the machine's LAN IP address instead of `localhost`. Allows phones and tablets on the same network to connect during local testing. (Production builds are unaffected.)

### Fixes & Improvements
- **Mobile viewport fix** — switched `Renderer` from `window.addEventListener('resize')` to `ResizeObserver`. On Android/Pixel the window resize event never fired on initial layout, causing the player to show the full map instead of the GM-defined viewport rectangle.
- **Atomic map change** — filter, view, and fog state now travel inside the `map_change` message rather than as separate follow-up messages. Eliminates a race where the new filter or view could briefly flash on the old map before the transition ran.
- **Transition reveal correctness** — transitions now snapshot the old frame, load the new map underneath while the snapshot covers the canvas, then animate the snapshot away. This ensures wipe/dissolve/scanline transitions reveal actual new content rather than the old map.

---

## v2.1.0 — 2026-04-18

### New Features
- **Interactive viewport editor** — the pan/zoom sliders are replaced by a direct on-map editor. A faint orange marching-ants rectangle is permanently overlaid on the GM's map showing exactly what players currently see. Click **Edit Player View** to activate drag handles: move the rectangle by dragging inside it, or resize it freely by dragging any corner. Hit **OK** to commit or **Cancel** to revert.
- **Reset to Full Map** — one-click button to snap the player view back to showing the complete map.
- **Strict viewport clipping** — the player's screen is hard-clipped to the GM's rectangle. No map content outside that rectangle is ever visible regardless of the player's screen size or aspect ratio. Background colour fills any letterbox or pillarbox bars.

---

## v2.0.0 — 2026-04-01

Initial public release of the v2 rewrite.

- Peer-to-peer via WebRTC (PeerJS) — no server required beyond static hosting.
- Eight visual filters including four artistically-styled effects (Ballpoint Pen, Hand Drawing, Watercolour, Oil Painting).
- Bundle import/export — save and restore the full map library as a single `.json` file.
- Default map bundle support (`public/default-bundle.json`).
- QR code for instant player connection on mobile.
- Auto-save of all per-map settings to IndexedDB.
- PWA support — installable on desktop and mobile.
- GPU-efficient rendering — static filters render on change only; animated filters run at full frame rate only when active.
