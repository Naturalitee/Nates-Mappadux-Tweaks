# Mappadux UI Design Language

The conventions every overlay / editor / control in Mappadux follows. Read
this **before** building any on-map object, panel control, or editor chrome —
the goal is to get it right the first time instead of iterating to it.

Last updated: 2026-06-02 (v2.16.85).

---

## 1. Editor chrome (selectable on-map objects)

Any object the GM can select + manipulate on the map (markers, viewport
rects, MapFX, initiative-free annotation objects — clocks, timers, notes)
uses ONE shared chrome convention. Do not invent new handle layouts.

**Handle placement (relative to the object box):**
| Handle | Position | Notes |
|--------|----------|-------|
| **Move / select** | top-left corner | Always visible when selectable. Click selects; drag moves. |
| **Delete** | bottom-left corner | Red trashcan. Only when selected. |
| **Resize** | bottom-right corner | Rounded-square (border-radius 6px, 2px border) — the *only* squared handle, so it reads as "the drag-to-scale grip". Only when selected. |
| **Rotate** | above top-centre, on a stem | Drag in a circle; snaps ±2° to cardinals (0/90/180/270). Only when selected. |
| **Type controls** | bottom EDGE bar, centred, below the box | Play/pause, reset, edit, etc. **Never inside the box.** Only when selected. |

**Handle visual style** — reuse the `.marker-handle` class:
- **Fixed 26px** circle, dark bg `rgba(20,24,36,0.85)`, 1.5px white border,
  drop shadow, `transform: translate(-50%,-50%)` (centres on its corner
  point).
- **Fixed screen size — handles NEVER scale with map zoom.** The GM can
  zoom in to work dense layouts; the chrome stays grabbable.
- Icons are inline **stroked 24×24 SVGs** (Lucide-style, monochrome,
  `stroke-width:2`, round caps). The established set lives in
  `src/annotate/AnchoredLayer.ts` (`svgIcon`, `mkHandle`, `ICON_MOVE`,
  `ICON_RESIZE`, `ICON_TRASH`, `ICON_ROTATE`) and
  `src/rendering/MarkerOverlay.ts`. Reuse them; don't redraw.
- Resize grip is the rounded-square; all other handles are circles.

**Deselect** on a tap (≤5px move) on empty canvas.

See also memory: `feedback_editor_chrome_convention`,
`feedback_delete_handle_convention`, `feedback_flat_icons`.

---

## 2. Colour roles

- **Object colour drives that object's chrome accents** — selection
  outline, resize-grip border, rotate stem, card border all key off the
  object's own chosen colour (CSS var `--obj-color`).
- **Green / orange are RESERVED for view identity only** — the
  player-view and projector-view viewport rects. Never use green/orange as
  a generic "active/handle" colour on other objects.
- **Black** is the GM-reserved identity (enemy/threat cards in initiative).
- **Red** = danger / delete / destructive. **Yellow** = caution / end-of-
  round.
- Per-object colour is chosen **up front** before the object is created
  (clocks, timers): name + segments/duration + colour, then Add.
- Pick a contrasting foreground for light vs dark object colours (YIQ
  brightness test) so text stays legible — see `_isLightColor` in the
  initiative layers.

---

## 3. Map-anchored on-map objects

Objects that belong to a map location (markers, annotation clocks/timers/
notes, whiteboard) are **map-anchored**, not screen-anchored:
- Position **and** size stored in **normalised map coordinates (0..1)**.
- Projected to screen every frame (RAF loop) via
  `Renderer.mapNormToCanvasCss(x,y)` / `canvasCssToMapNorm(cx,cy)`.
  Project two corners (top-left + bottom-right) to get both position and
  size — this scales the object with zoom automatically.
- **1:1 between GM and player/projector** — the same map-norm position
  shows the object at the same map location everywhere. Placed off-map →
  off the player's view until the GM pans there (same as markers).
- The OBJECT scales with zoom; the editor CHROME does not (§1).
- They render as **DOM overlays above the GL canvas**, so they are NOT
  subject to the shader visual filters. (On-top is the accepted default;
  a "subject to filters" mode would need GL-pipeline rendering and isn't
  built.)
- Base class: `src/annotate/AnchoredLayer.ts` — extend it for any new
  map-anchored, selectable object type. It provides projection, the chrome,
  move/resize/rotate, and the `edgeControls()` + `renderContent()` hooks.

Content that must scale with the box uses **CSS container-query units**
(`container-type: size` on the box, `cqh`/`cqmin` inside). Free-flowing
text uses JS auto-fit (binary-search font-size to fill the box), re-run on
every box resize via a `ResizeObserver` so it tracks zoom.

---

## 4. Panels (GM left sidebar)

- A `.panel` has a `.panel-header` with a `.panel-title` (collapsible via
  `aria-expanded`, wired generically) and, on the right, an optional
  **vision/ear-style toggle icon + bypass switch** (the slot where Visual
  Filter / Soundboard / Map Transition put their on/off).
- A count / status **badge** goes in that same right-margin slot (e.g.
  Players "# connected/total").
- Keep panels calm: the **common control stays always-visible**; rarer
  controls go in **collapsible `<details>` sub-sections that start closed**
  (e.g. Annotate: Whiteboard always shown; Notes/Clocks/Timers collapsed).
- **Compact modals/popovers** over sprawling inline panels for complex
  config (`feedback_popup_ui_style`).
- Colour swatch rows: small round swatches; selected = white ring.
- Bypass toggles: `checked` = feature shown/enabled. Decide the default per
  feature (most default ON; Annotate defaults ON).

---

## 5. Controls & affordances

- **Controls live on the chrome edge, not inside the content box** — when a
  manipulable object is selected, its actions appear as edge handles (§1
  "Type controls"), keeping the object face clean.
- Drag handles must **stopPropagation** on pointerdown so the GM canvas
  doesn't pan underneath; on-map interactive objects are also added to the
  `attachGestures` `shouldStart` exclusion list in `GMApp`.
- Drag should be **pointer-event based** (works for mouse + touch), not
  HTML5 drag-and-drop (touch-hostile). See the initiative card drag.
- Double-click to edit text in place (notes) — plus an explicit edit
  control on the edge.

---

## 6. Persistence

- Per-map content (fog, markers, **annotations**) lives in the per-map
  `SessionState` (the `configs` IDB store, keyed by mapId). Adding a field
  to `SessionState` makes it **auto-save (debounced) to IndexedDB AND travel
  in the `.mappadux` pack** export/import for free.
- Mutate via a `StateManager.setX()` that updates state + `_notify([...])`
  (which schedules the autosave). Don't write a parallel localStorage key
  for per-map content.
- **P2P frame limit:** a regular broadcast message is ONE un-chunked JSON
  frame (~16KB DataChannel limit). Never put base64 data URLs or unbounded
  data in a non-chunked message — chunk it or strip it for the wire and
  resolve viewer-side by id. See memory `dmr-datachannel-frame-limit`.

---

## 7. Docs / process conventions

- No emoji in docs (UI affordance glyphs are fine).
- Don't write a person's name in CHANGELOG / source comments.
- During iterative design, keep CHANGELOG entries to one line per beta
  patch; full write-ups on production cuts.
- Commit per logical change so any one can be reverted; bump patch each
  push; never push without explicit approval.
