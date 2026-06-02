# Getting Started — onboarding content (working doc)

Source of truth for the **Getting Started** default pack copy + the two
onboarding videos. The pack ships as `public/default-bundle.json` (a gzipped
`.mappadux` bundle); edit the slide text *in-app* (open the handout, edit the
Text Map, re-export the pack) — this doc is the script you paste from.

Guiding rules (from real new-GM feedback, 2026-05-26):
- **Name the button and the screen.** "Open the **Map** dropdown → **+ Add New
  Map…**", never "just add a map" or "just play".
- **Don't assume per-player screens.** Single shared screen / projector is a
  first-class table — say so.
- **Restraint over completeness.** Get them to *one map on a screen*; let the
  rest self-discover. The pack's example maps + HELP.md carry the depth.
- Keep Alex's voice (cheeky, plain-spoken). The fix is *concreteness*, not tone.

---

## Redrafted slide copy

Only the slides that went stale or said "just play" are below. The others
(2. No Logins, 7. Markers, the two example maps) are broadly fine — re-read for
panel-name drift before the cut.

### 1. Welcome — replace the "GETTING STARTED" closer

> **The best way to learn Mappadux is to use it — so this pack *is* a
> playground.** Work through these maps in order: open the **Map** dropdown
> (top-left) and pick the next one, or use the arrows. Each map shows a feature
> running on real artwork, and you can pull it apart to see how it's built.
>
> Right now you're looking at a **Text Map** — a handout. *You* (the GM) see the
> raw page; your players see it beautified. **Next:** open the **Map** dropdown
> and choose **2. No Logins. WTF?**

### 3. Player Connections → retitle **Player Views**, replace the body

> **Player Views** is one panel for everything your players see.
>
> **See what players see, right here.** Click **Show Player View** on the GM
> canvas — a live preview of the player screen docks onto your own screen. No
> second window, no "click to allow" pop-up nonsense. Drag it out of the way, or
> **pop it out** to a full window when you want it on a second monitor.
>
> **Put a map on a player's own device.** In the **Player connections** section,
> point a phone or tablet's camera at the **QR code** — that device is now a
> player screen. Any device on your network, no app to install.
>
> **One shared screen instead?** Totally fine — lots of tables run a single TV
> or projector and nothing else. The inline preview *is* your player view; mirror
> it to the room and you never touch a QR code. Use **Scaled view** (below) to
> project a battlemap at true 1″ table scale under the minis.

### 4. Map Selection — replace "Just play around!"

> **To add your own map:** open the **Map** dropdown and pick **+ Add New Map…**
> at the bottom. From there you can link a map from the web, upload a file from
> your disk, or stitch several images into a **Composite** map. (In a hurry?
> Drag a JPG straight onto the page — it lands in your library and opens.)
> Everything tracks its licence + attribution as it comes in.

### 5. Making Stuff Look Fancy — replace "Honestly - just play!"

> Keep **Show Player View** open so you can watch the player screen change, then
> try these on this map — change one thing, watch the preview:
> - **Backdrop** — the animated starfield behind this text (sparkle button by
>   the background colour in the **Map** panel).
> - **Visual Filters** — full-screen looks like this broken-CRT (the **Visual
>   Filter** panel); players see it, you don't.
> - **MapFX** — paint fog, fire, water, mist onto the map (the **Fog & MapFX**
>   panel).
> - **Transitions** — how a map arrives on the player screen (the **Map** panel).
>
> That's the whole loop: tweak on the GM side, watch the player preview. Nothing
> here is permanent — poke freely.

---

## Video scripts

Two short clips, embedded as **in-map YouTube handouts** in the pack (that's why
the in-app YT player exists). Film **after the 2.17 UI settles** so labels match;
re-recording is just swapping the video id in the handout, no rebuild.

### Video 1 — "Make a map in Mappadux in 2 minutes" *(the build-it beat)*

Goal: a new GM watches once and has loaded, dressed, and previewed a real map.

| # | Show on screen | Voiceover (≈) |
|---|---|---|
| 1 | Empty Mappadux, fresh tab | "No login, nothing to install — you're already in." |
| 2 | **Map** dropdown → **+ Add New Map… → Upload** (or drag a JPG onto the page) | "Drop in any image — a battlemap, a floorplan, even a photo. That's your map." |
| 3 | Map fills the canvas; click **Show Player View** | "This docked preview is exactly what your players see." |
| 4 | **Fog & MapFX**: paint a fog edge, then a fire patch | "Hide what they shouldn't see yet — and add a little atmosphere." |
| 5 | **Visual Filter** → pick one; watch the preview shift | "A filter sets the mood on the player screen — you keep the clean view." |
| 6 | Right-click the map → a marker drops | "Right-click to drop a token wherever you need one." |
| 7 | Sit back; preview shows the dressed map | "Two minutes: a real, good-looking, playable map. Now go poke at the rest." |

Target run-time: ~2:00. Hard rule: do **not** add panels beyond these — the
promise is "in 2 minutes", honour it.

### Video 2 — "Set up your game table" *(the share-it beat)*

Goal: the GM understands the three table shapes and how each View serves them.
This is where the real feedback got stuck, so it earns the longer clip.

| # | Show on screen | Voiceover (≈) |
|---|---|---|
| 1 | Three quick captions: shared screen / per-player tablets / hybrid | "Mappadux fits three kinds of table. Pick yours — they all work." |
| 2 | **Show Player View** docked, then popped out to a window on a 2nd display | "One shared screen? This *is* your player view — pop it onto a TV or projector and you're done." |
| 3 | **Player Views → Player connections**: phone scans the QR, becomes a player screen | "Per-player devices? Scan the QR — any phone or tablet on your network is a player screen. No app." |
| 4 | **Scaled view**: calibrate once, project on an under-table screen; a mini on a 1″ square | "For minis on the table, Scaled view projects at true one-inch scale — a one-inch creature really is one inch." |
| 5 | Place a **player token**; the player drags their own on a second device | "Give each player a token they can move themselves — you watch it live, and can send it back." |
| 6 | The broadcast toggle flips to the "GM is faffing" hold screen and back | "Need a second to set up? Flip broadcast off — players get a friendly hold screen, you reset in peace." |
| 7 | Recap of the three table shapes | "Shared screen, tablets, or both — set it up once and play." |

Target run-time: ~3:00–3:30.

---

## Pack structure (recommended ordering)

Bookend the example maps with the two video handouts so the pack reads as an arc:

1. **1. Welcome** *(default map on first load)* — orientation + redrafted closer.
2. **2. No Logins. WTF?**
3. **3. Player Views** *(retitled)* — connections + the shared-screen note.
4. **4. Map Selection & Handouts**
5. **5. Making Stuff Look Fancy**
6. **6. Griffinholm** *(example: MapFX / a dressed battlemap)*
7. **7. Markers, Sound & Motion**
8. **8. Rons-Moto Encounter** *(example)*
9. *(new)* **Composite / Layered demo** — your planned third example map.
10. *(new)* **"Make a map in 2 mins"** handout — embeds Video 1.
11. *(new)* **"Set up your table"** handout — embeds Video 2.

Cheap discovery win: drop a live **progress clock** (annotation) onto one example
map (e.g. the encounter) so a poking GM trips over annotations without being told.
