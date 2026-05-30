import { Guest } from '../p2p/Guest.ts';
import { generateId } from '../utils/id.ts';
import { PlayerIdentifyModal, type PlayerIdentity } from './PlayerIdentifyModal.ts';
import { PlayerActionMenu, type ActionMenuItem } from './PlayerActionMenu.ts';
import { PlayerMessageComposer } from './PlayerMessageComposer.ts';
import { PlayerMessageToasts } from './PlayerMessageToasts.ts';
import { PingLayer } from '../rendering/PingLayer.ts';
import { PlayerMarkerLayer } from '../rendering/PlayerMarkerLayer.ts';
import { PlayerInitiativeRail } from './PlayerInitiativeRail.ts';
import { PlayerInitiativeRollModal } from './PlayerInitiativeRollModal.ts';
import { showFullPlayerUiInPreview } from '../storage/localSettings.ts';
import { Viewer } from '../viewers/Viewer.ts';
import { PROFILE_PLAYER } from '../viewers/profiles.ts';
import { drawGrid } from '../viewers/strategies/drawGrid.ts';
import { attachGestures } from '../utils/Gestures.ts';
import { decodeImageBitmap } from '../utils/decodeImageBitmap.ts';
import { Renderer } from '../rendering/Renderer.ts';
import { MarkerTexture } from '../rendering/MarkerTexture.ts';
import { MarkerSprites } from '../rendering/MarkerSprites.ts';
import { MarkerOverlay, type OverlayItem } from '../rendering/MarkerOverlay.ts';
import { getMarkerAspect } from '../rendering/MarkerLayer.ts';
import { filterRegistry } from '../filters/FilterRegistry.ts';
import { TransitionEngine } from '../transitions/TransitionEngine.ts';
import { transitionRegistry } from '../transitions/TransitionRegistry.ts';
import type { GMMessage, TransitionConfig, Marker, MarkerIconData, SoundboardAudioData, SoundboardSlot, FogState, FilterState, ViewState, CompositeWirePayload } from '../types.ts';
import type { MotionOverlay, MotionOverlayScan, MotionOverlayBlob } from '../rendering/MarkerLayer.ts';

/**
 * PlayerApp — top-level orchestrator for the player view.
 *
 * Reads the room code from the URL fragment (#roomcode).
 * If the fragment is absent or empty, waits for a room code input.
 * Connects via P2P Guest (BroadcastChannel for local window, PeerJS for network).
 * Applies all incoming state updates to the Renderer.
 *
 * Markers are rendered as a CanvasTexture inside the Three.js scene (Plane 2)
 * so they pass through the active GLSL filter pipeline.
 */
export class PlayerApp {
  private renderer!: Renderer;
  private markerTexture!: MarkerTexture;
  private markerSprites!: MarkerSprites;
  private markerOverlay!: MarkerOverlay;
  private transitionEngine!: TransitionEngine;
  private guest!: Guest;
  private statusEl!: HTMLElement;
  private connectPanel!: HTMLElement;
  private roomInput!: HTMLInputElement;
  /** Tracks which map ID the player is currently showing (or loading). */
  private currentMapId: string | null = null;
  private currentMarkers: Marker[]    = [];
  private playerIconCache = new Map<string, ImageBitmap>();
  /** slotId → <audio> element for active soundboard slots */
  private sbAudioEls  = new Map<string, HTMLAudioElement>();
  /** assetId → data URL so re-plays don't need the URL resent */
  private sbAssetUrls = new Map<string, string>();
  /** Current slot configurations (for restoring on reconnect) */
  private sbSlots: SoundboardSlot[] = [];
  /** Master mute flag — starts true so first click both satisfies autoplay policy and unmutes */
  private sbMuted = true;
  /** slotIds paused by a mute transition — used to resume them on unmute. */
  private _sbPausedByMute = new Set<string>();
  /** markerIds paused by a positional mute-all — resumed on unmute. */
  private _posPausedByMute = new Set<string>();
  /** Live state of the Markers-panel master mute (broadcast by the GM).
   *  Silences both positional sources and the tracker ping. */
  private _posMutedAll = false;
  private _audioResumeScheduled = false;
  /** markerId → <audio> element for active positional sources */
  private _posAudioEls  = new Map<string, HTMLAudioElement>();
  /** assetId → URL so re-plays (late join / random fires) don't need the data resent */
  private _posAssetUrls = new Map<string, string>();
  /** v2.15 — shared viewer chrome (lifecycle close, fullscreen button,
   *  faff hold-screen with QR, mute indicator). The PlayerApp keeps
   *  rendering / P2P / message dispatch for now; later phases will
   *  fold more of the surface into Viewer too. */
  private viewer!: Viewer;
  /** v2.14.17 — map calibration + dimensions threaded through from the
   *  GM via full_state / map_change. Needed by the map-relative grid
   *  drawing strategy when the GM has Show Grid turned on for the
   *  Player View. */
  private mapPixelsPerSquare: number | null = null;
  private mapImageWidth:      number        = 0;
  private mapImageHeight:     number        = 0;
  /** v2.14.18 — grid offset for the active map (border-nudge alignment). */
  private gridOffsetX:        number        = 0;
  private gridOffsetY:        number        = 0;
  /** v2.14.31 — shared per-map grid colour (replaces the prior
   *  view-scoped ViewState.playerGridColor). Updated from full_state
   *  / map_change / map_meta_update broadcasts. */
  private gridColor:          string | null = null;
  /** v2.14.17 — Player-side grid overlay canvas. Drawn into whenever
   *  the GM's view broadcast carries playerGridEnabled=true and the
   *  active map is calibrated. */
  private playerGridCanvas: HTMLCanvasElement | null = null;
  /** v2.14.18 — Player-side zoom + pan within the GM-defined crop.
   *  `_broadcastView` is the GM's most recent view (the outer bounds);
   *  `_localOverride` is the player's chosen sub-rect (or null if
   *  they're matching the GM exactly). The rendered view is the
   *  override clamped to fit inside the broadcast. */
  private _broadcastView: ViewState | null = null;
  private _localOverride: { centerX: number; centerY: number; viewNW: number; viewNH: number } | null = null;
  /** Snapshot of the override at gesture start — gesture deltas are
   *  cumulative, so we re-derive the override from the snapshot each
   *  pointermove rather than integrating per-frame deltas. */
  private _gestureSnap: {
    override: { centerX: number; centerY: number; viewNW: number; viewNH: number };
    midX: number;
    midY: number;
  } | null = null;
  private _resetViewBtn: HTMLButtonElement | null = null;
  /** Minimum override width/height in map-norm units (caps zoom-in). */
  private static readonly MIN_OVERRIDE_VIEW = 0.05;
  // ── Motion-tracker overlay (rings + return blobs broadcast by the GM) ──────
  private _trackerScans: MotionOverlayScan[] = [];
  private _trackerBlobs: MotionOverlayBlob[] = [];
  private _trackerRafId: number | null       = null;
  /** Cached tracker ping audio data URLs, keyed by assetId. Populated by the
   *  first tracker_scan/tracker_blob carrying that asset's dataUrl. */
  private _trackerAudioUrls = new Map<string, string>();
  // ── WebGL context-loss recovery ──────────────────────────────────────────
  /** Room code retained so we can reconnect if cached state is unavailable. */
  private roomCode = '';
  /** Cached renderer inputs — replayed on WebGL context restore. */
  private lastMapBlob:  ArrayBuffer | null = null;
  private lastFog:      FogState           = { polygons: [] };
  private lastFilter:   FilterState | null = null;
  private lastView:     ViewState  | null  = null;
  /** v2.14 — promise that resolves when the in-flight map_change /
   *  handout_reveal / video_bundle texture load finishes. Each
   *  message that loads a new map texture awaits this before
   *  starting its own load, so handout_reveal can't race against a
   *  same-map reload's still-decoding starting-frame texture.
   *  Caught while debugging the "reveal snaps to end" report. */
  private _pendingMapLoad: Promise<void> = Promise.resolve();
  private _contextLost = false;
  /**
   * Sequence numbers of messages already processed.
   * Local player windows receive every broadcast TWICE — once via BroadcastChannel
   * (fast, sub-ms) and once via PeerJS (slower, ~50-200ms).  Without dedup, the
   * second delivery re-runs loadMap with a new loadGen, which then discards the
   * first (BC) texture decode and waits for a second, slower decode.  More
   * critically, re-processing map_change resets currentMapId mid-flight, which
   * can make valid fog_update messages appear to belong to a different map and
   * get discarded.  Tracking seqs lets us drop the PeerJS duplicate entirely.
   */
  private seenSeqs = new Set<number>();

  /**
   * Stable id for this player tab so the GM's heartbeat tracker can
   * deduplicate pings from this client (vs. counting each ping as a
   * distinct player). Regenerated per page load — a reload looks like a
   * fresh player and the prior id naturally expires from the GM's map.
   */
  private clientId = generateId();
  /** Interval id for the BC liveness ping. Cleared on disconnect. */
  private _heartbeatInterval: number | null = null;

  // ── v2.17 Player Voice — identity ──────────────────────────────────────────
  /** Stable device-persisted player id; survives reloads so the GM keeps the
   *  same persistent player record bound to this device across reconnects. */
  private playerId: string = this._loadPlayerId();
  /** Chosen identity (name/character/colour), persisted on this device. */
  private identity: PlayerIdentity | null = this._loadIdentity();
  /** True once we've shown the first-connect identify prompt (so a cancel
   *  doesn't re-pop it on every reconnect). */
  private _identityPromptShown = false;
  private _identityModal = new PlayerIdentifyModal();
  private _actionMenu = new PlayerActionMenu();
  /** True iff this page was launched from the GM's "Open Player Window" button.
   *  Detected via the ?gmPreview=1 URL flag — explicit, foolproof, and never
   *  triggered by real player tabs (the QR URL doesn't carry it). */
  private _gmPreviewFlag = (() => {
    try { return new URLSearchParams(location.search).has('gmPreview'); }
    catch { return false; }
  })();
  private _composer = new PlayerMessageComposer();
  private _msgToasts: PlayerMessageToasts | null = null;
  private pingLayer: PingLayer | null = null;
  private playerMarkerLayer: PlayerMarkerLayer | null = null;
  private initiativeRail: PlayerInitiativeRail | null = null;
  private _initiativeRollModal = new PlayerInitiativeRollModal();
  /** Roster broadcast by the GM — used to list other players as message targets. */
  private roster: Array<{ id: string; playerName: string; characterName: string; color: string; connected: boolean }> = [];
  /** Player-Voice features the GM currently allows. Default-on until the GM
   *  says otherwise (mirrors the default-enabled settings). */
  private features = { pings: true, messaging: true, movableMarkers: true };
  /** Long-press detection state for touch ping/menu. */
  private _pressTimer: number | null = null;
  private _pressStart: { x: number; y: number } | null = null;

  async init(): Promise<void> {
    // v2.15 — Viewer owns the chrome (lifecycle, fullscreen, faff
    // overlay, mute indicator) AND the rendering pipeline (Renderer,
    // marker layer, transition engine). PlayerApp drives the P2P side
    // and the post-map-load callback chain; the rest comes out of
    // Viewer via readonly fields. Profile-driven so future viewer
    // kinds slot in without forking these init paths.
    this.viewer = new Viewer(PROFILE_PLAYER, {
      fullscreenBtn:        document.getElementById('player-fullscreen-btn'),
      rendererCanvas:       document.querySelector<HTMLCanvasElement>('#renderer-canvas')!,
      markerOverlayEl:      document.getElementById('marker-overlay'),
      transitionCanvas:     document.querySelector<HTMLCanvasElement>('#transition-canvas'),
      preserveDrawingBuffer: true,
      // v2.14.20 — once the player has had their first interaction
      // (canvas tap to unmute), the icon-only mute button takes over
      // as the toggle source. This callback hands control back to
      // PlayerApp's mute pipeline.
      onMuteToggle: () => this._toggleMute(),
    });
    this.viewer.init();

    // Alias the pipeline pieces locally so the existing `this.renderer`
    // / `this.markerTexture` / etc. call sites elsewhere in this file
    // don't need touching. Future cleanup can switch them all to
    // `this.viewer.renderer` direct access.
    this.renderer        = this.viewer.renderer;
    this.markerTexture   = this.viewer.markerTexture;
    this.markerSprites   = this.viewer.markerSprites;
    this.markerOverlay   = this.viewer.markerOverlay;
    this.transitionEngine = this.viewer.transitionEngine!;

    // v2.17 Player Voice — ping pulses anchored to map coords, auto-fading.
    const pingLayerEl = document.getElementById('ping-layer');
    if (pingLayerEl) {
      this.pingLayer = new PingLayer(
        pingLayerEl,
        (x, y) => this.renderer.mapNormToCanvasCss(x, y),
        { showLabel: false, persistent: false, ttlMs: 10000 },
      );
    }
    // v2.17 Player Voice — incoming-message toasts (GM replies, other players).
    const toastsEl = document.getElementById('player-msg-toasts');
    if (toastsEl) this._msgToasts = new PlayerMessageToasts(toastsEl);

    // v2.17 Player Voice — initiative rail (atmospheric face).
    const initEl = document.getElementById('player-initiative');
    if (initEl) this.initiativeRail = new PlayerInitiativeRail(initEl);

    // v2.17 Player Voice — player tokens. Players can drag only their own, and
    // only while the GM allows movable markers.
    const pmEl = document.getElementById('player-marker-layer');
    if (pmEl) {
      this.playerMarkerLayer = new PlayerMarkerLayer(pmEl, {
        project:   (x, y) => this.renderer.mapNormToCanvasCss(x, y),
        unproject: (cx, cy) => {
          const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas');
          if (!canvas) return null;
          const r = canvas.getBoundingClientRect();
          return this.renderer.canvasCssToMapNorm(cx - r.left, cy - r.top);
        },
        canDrag: (playerId) => this.features.movableMarkers && playerId === this.playerId,
        onDragMove: (_pid, x, y) => this.guest.send({ type: 'player_marker_move', playerId: this.playerId, clientId: this.clientId, x, y, done: false }),
        onDragEnd:  (_pid, x, y) => this.guest.send({ type: 'player_marker_move', playerId: this.playerId, clientId: this.clientId, x, y, done: true }),
      });
    }

    // Post-map-load: marker re-render + overlay refresh. Viewer has
    // already pushed the new aspect ratio into MarkerTexture +
    // MarkerSprites before invoking this hook.
    this.viewer.onMapLoaded(() => {
      this.markerTexture.render(this.currentMarkers, this.playerIconCache);
      this.markerSprites.render(this.currentMarkers, this.playerIconCache);
      this._updateMarkerOverlay();
      this.renderer.markMarkersDirty();
      // v2.14.17 — redraw the player-side grid on map load too. The
      // new map may bring a different mapPixelsPerSquare /
      // mapImageWidth, which the map-relative strategy needs.
      this._refreshPlayerGrid();
    });

    // v2.14.17 — bind the player-side grid canvas + redraw on canvas
    // resize.
    // v2.14.33 — observe the RENDERER canvas (not window.resize). The
    // Renderer's own ResizeObserver fires before mine on the same
    // element (registered earlier in init), so by the time my callback
    // runs the camera has already been updated for the new dimensions
    // and mapNormToCanvasCss returns coords against the new frustum.
    // window.resize was firing too early — my grid was projecting
    // gridlines against the OLD camera onto the NEW canvas size,
    // which drifted on every window resize.
    this.playerGridCanvas = document.querySelector<HTMLCanvasElement>('#player-grid');
    const rendererCanvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas');
    if (rendererCanvas) {
      new ResizeObserver(() => this._refreshPlayerGrid()).observe(rendererCanvas);
    }

    // v2.14.18 — bind the Reset View button + wire pan/zoom gestures
    // on the renderer canvas. The button stays hidden until the
    // player has actually deviated from the GM's broadcast view.
    this._resetViewBtn = document.getElementById('player-reset-view-btn') as HTMLButtonElement | null;
    this._resetViewBtn?.addEventListener('click', (e) => {
      // Don't let this click bubble to the document-level mute toggle.
      e.stopPropagation();
      this._localOverride = null;
      this._applyEffectiveView();
    });
    this._attachPlayerGestures();

    this.renderer.onContextLost = () => {
      this._contextLost = true;
      this.setStatus('Renderer lost — recovering…');
    };
    this.renderer.onContextRestored = () => {
      this._contextLost = false;
      this._recoverRenderer();
    };

    // visibilitychange fires when the user returns to the tab/app on mobile.
    // If the context was lost while the page was hidden and the browser didn't
    // fire webglcontextrestored yet, this is a fallback trigger.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this._contextLost) {
        this._recoverRenderer();
      }
    });

    this.statusEl     = document.querySelector('#status')!;
    this.connectPanel = document.querySelector('#connect-panel')!;
    this.roomInput    = document.querySelector<HTMLInputElement>('#room-input')!;

    const roomCode = location.hash.slice(1).trim();

    if (roomCode) {
      this.connect(roomCode);
    } else {
      this.showConnectPanel();
    }

    document.querySelector('#connect-btn')?.addEventListener('click', () => {
      const code = this.roomInput.value.trim();
      if (code) {
        this.connectPanel.hidden = true;
        this.connect(code);
      }
    });

    // v2.14.20 — The document-wide click handler only services the
    // VERY FIRST interaction: it unmutes (satisfying the browser's
    // autoplay policy) and hands the toggle role over to the
    // mute-indicator button. After that, clicks on the canvas no
    // longer toggle mute — the icon-only button top-right is the
    // single source of truth. Without this gate, every pan/zoom
    // tap-and-release was muting/unmuting the player.
    const firstClick = () => {
      if (!this.connectPanel.hidden) return; // not connected yet — wait
      // Don't gate on preview mode — click-to-unmute is the only way the audio
      // pipeline ever starts (browser autoplay policy), and the GM previewing
      // needs audio working so they can hear what players hear.
      this._toggleMute();
      this.viewer.markMuteInteractive();
      document.removeEventListener('click', firstClick);
    };
    document.addEventListener('click', firstClick);

    // Prevent the browser context menu on right-click (keep canvas clean)
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // v2.17 Player Voice — right-click / long-press the map → action menu (ping, …).
    const mapCanvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas');
    mapCanvas?.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this._isPreviewMode()) return;
      this._openPlayerMenu(e.clientX, e.clientY);
    });
    mapCanvas?.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      if (this._isPreviewMode()) return;
      this._pressStart = { x: e.clientX, y: e.clientY };
      this._clearPressTimer();
      this._pressTimer = window.setTimeout(() => {
        this._pressTimer = null;
        if (this._pressStart) this._openPlayerMenu(this._pressStart.x, this._pressStart.y);
      }, 500);
    });
    mapCanvas?.addEventListener('pointermove', (e) => {
      if (!this._pressStart) return;
      if (Math.abs(e.clientX - this._pressStart.x) > 10 || Math.abs(e.clientY - this._pressStart.y) > 10) {
        this._clearPressTimer(); // became a pan — not a long-press
      }
    });
    mapCanvas?.addEventListener('pointerup',     () => this._clearPressTimer());
    mapCanvas?.addEventListener('pointercancel', () => this._clearPressTimer());

    // v2.17 Player Voice — identity button (set / change who you are).
    document.querySelector('#player-identity-btn')?.addEventListener('click', () => {
      void this.openIdentityModal();
    });
    this._refreshIdentityButton();
    // Apply GM-preview gating at page load so it takes effect before the first
    // network message arrives, rather than briefly flashing player chrome.
    this._refreshPreviewModeUi();

    // Clean disconnect so the GM drops our binding immediately — BroadcastChannel
    // never signals close, so this mirrors the projector_bye pattern.
    window.addEventListener('pagehide', () => {
      try { this.guest?.send({ type: 'player_bye', clientId: this.clientId }); } catch { /* unloading */ }
    });

    // Show "Muted" indicator immediately — player starts muted
    this.viewer.showMuteIndicator(this.sbMuted);
  }

  /** v2.14.17 — Refresh the player-side 1″ grid overlay. Drawn via
   *  the shared map-relative strategy so spacing tracks the current
   *  view fraction. No-op when the GM has the grid off, when the
   *  active map isn't calibrated, or when the canvas isn't bound. */
  private _refreshPlayerGrid(): void {
    if (!this.playerGridCanvas) return;
    drawGrid(this.playerGridCanvas, {
      effectiveW:         window.innerWidth,
      effectiveH:         window.innerHeight,
      enabled:            !!this.lastView?.playerGridEnabled,
      color:              this.gridColor ?? '#ffffff',
      mapPixelsPerSquare: this.mapPixelsPerSquare,
      mapImageWidth:      this.mapImageWidth,
      mapImageHeight:     this.mapImageHeight,
      gridOffsetX:        this.gridOffsetX,
      gridOffsetY:        this.gridOffsetY,
      renderer:           this.renderer,
    });
  }

  /** v2.14.18 — Apply the broadcast view + any local zoom override
   *  to the renderer. Called on view_update / full_state / map_change,
   *  and on every override mutation (wheel, drag, pinch, reset). */
  private _applyEffectiveView(): void {
    const bv = this._broadcastView;
    if (!bv) return;

    // Clamp the override to fit inside the broadcast bounds. If there's
    // no override the broadcast view IS the effective view.
    let effective: ViewState;
    if (this._localOverride) {
      this._clampOverride(bv);
      const ov = this._localOverride;
      effective = {
        ...bv,
        centerX: ov.centerX,
        centerY: ov.centerY,
        viewNW:  ov.viewNW,
        viewNH:  ov.viewNH,
      };
    } else {
      effective = bv;
    }

    this.lastView = effective;
    this.renderer.setView(effective);
    this.renderer.setBackdrop(effective.backdrop ?? null);
    this.markerSprites.render(this.currentMarkers, this.playerIconCache);
    this._updateMarkerOverlay();
    this.renderer.markMarkersDirty();
    this._refreshPlayerGrid();

    // Reset-view button visibility follows the override state. A small
    // tolerance avoids flashing the button if the override just
    // happens to coincide with the broadcast (e.g. after clamping).
    if (this._resetViewBtn) {
      const showReset = !!this._localOverride;
      this._resetViewBtn.hidden = !showReset;
    }
  }

  /** Mutate `_localOverride` so its rect fits inside the broadcast
   *  view rect. viewNW/viewNH get clamped to [MIN, broadcast.viewN*];
   *  center is clamped so the override rect stays within bounds. */
  private _clampOverride(bv: ViewState): void {
    const ov = this._localOverride;
    if (!ov) return;
    const minSize = PlayerApp.MIN_OVERRIDE_VIEW;
    ov.viewNW = Math.min(bv.viewNW, Math.max(minSize, ov.viewNW));
    ov.viewNH = Math.min(bv.viewNH, Math.max(minSize, ov.viewNH));
    const dx = (bv.viewNW - ov.viewNW) / 2;
    const dy = (bv.viewNH - ov.viewNH) / 2;
    ov.centerX = Math.min(bv.centerX + dx, Math.max(bv.centerX - dx, ov.centerX));
    ov.centerY = Math.min(bv.centerY + dy, Math.max(bv.centerY - dy, ov.centerY));
  }

  /** Wire pointer / wheel / pinch handlers. Bound to document.body so
   *  no overlay layer (transition canvas, grid canvas, marker overlay,
   *  faff dimmer) can intercept the gesture — the canvas itself sits
   *  beneath all of them. Coordinate math still uses the renderer
   *  canvas's rect, which is identical to the body rect on the player
   *  page (the canvas fills the viewport). */
  private _attachPlayerGestures(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas');
    if (!canvas) return;
    attachGestures(document.body, {
      // Pointerdown gate — let the connect panel's input + buttons
      // and the two floating chrome buttons keep their native event
      // handling. Without this, e.g. tapping the Connect button on
      // mobile would be captured as a gesture-start and the click
      // would never fire.
      shouldStart: (e) => {
        const t = e.target as HTMLElement | null;
        if (!t) return true;
        if (t.closest('.connect-panel')) return false;
        if (t.closest('#player-fullscreen-btn')) return false;
        if (t.closest('#player-reset-view-btn')) return false;
        return true;
      },
      onWheel: (e) => this._zoomAtClient(e.clientX, e.clientY, e.factor),
      onDrag:  (e) => {
        // Only treat mouse / pen / touch single-finger drags as pans.
        // (attachGestures also exposes pointerType — currently we accept
        // all of them; tap-to-mute still survives because attachGestures
        // doesn't fire onDrag until the pointer actually moves.)
        if (e.phase === 'start') {
          this._gestureSnap = {
            override: this._currentOverrideSnapshot(),
            midX: e.clientX, midY: e.clientY,
          };
          return;
        }
        if (!this._gestureSnap || !this._broadcastView) return;
        const canvasRect = canvas.getBoundingClientRect();
        const bv = this._broadcastView;
        const snap = this._gestureSnap.override;
        // dx/dy is cumulative from start. Convert client-px → view-norm,
        // negate (dragging the map right shifts the view-center LEFT).
        const dnx = -e.dx / canvasRect.width  * snap.viewNW;
        const dny = -e.dy / canvasRect.height * snap.viewNH;
        this._localOverride = {
          centerX: snap.centerX + dnx,
          centerY: snap.centerY + dny,
          viewNW:  snap.viewNW,
          viewNH:  snap.viewNH,
        };
        // Skip applying for tiny pre-threshold drags (< 1px) so a
        // genuine tap-to-mute click doesn't get clobbered by a stray
        // sub-pixel pointermove between down and up.
        if (e.phase === 'move' && Math.hypot(e.dx, e.dy) < 1) return;
        this._clampOverride(bv);
        this._applyEffectiveView();
        if (e.phase === 'end') this._gestureSnap = null;
      },
      onTwoFinger: (e) => {
        if (e.phase === 'start') {
          this._gestureSnap = {
            override: this._currentOverrideSnapshot(),
            midX: e.midX, midY: e.midY,
          };
          return;
        }
        if (!this._gestureSnap || !this._broadcastView) return;
        const canvasRect = canvas.getBoundingClientRect();
        const snap = this._gestureSnap.override;
        // Scale around the original centroid (in client px). e.scale is
        // cumulative — fingers spread → >1 → zoom IN → smaller view.
        const u0 = (this._gestureSnap.midX - canvasRect.left) / canvasRect.width;
        const v0 = (this._gestureSnap.midY - canvasRect.top)  / canvasRect.height;
        const wx0 = snap.centerX - snap.viewNW / 2 + u0 * snap.viewNW;
        const wy0 = snap.centerY - snap.viewNH / 2 + v0 * snap.viewNH;
        const newW = snap.viewNW / e.scale;
        const newH = snap.viewNH / e.scale;
        // Also account for centroid drift since gesture start (panDx/Dy).
        const dnx = -e.panDx / canvasRect.width  * snap.viewNW;
        const dny = -e.panDy / canvasRect.height * snap.viewNH;
        this._localOverride = {
          viewNW:  newW,
          viewNH:  newH,
          centerX: wx0 - (u0 - 0.5) * newW + dnx,
          centerY: wy0 - (v0 - 0.5) * newH + dny,
        };
        this._clampOverride(this._broadcastView);
        this._applyEffectiveView();
        if (e.phase === 'end') this._gestureSnap = null;
      },
    });
  }

  /** Snapshot the current effective view as an override seed — used
   *  when the player starts a gesture from the GM-matching state. */
  private _currentOverrideSnapshot(): { centerX: number; centerY: number; viewNW: number; viewNH: number } {
    if (this._localOverride) {
      const ov = this._localOverride;
      return { centerX: ov.centerX, centerY: ov.centerY, viewNW: ov.viewNW, viewNH: ov.viewNH };
    }
    const bv = this._broadcastView!;
    return { centerX: bv.centerX, centerY: bv.centerY, viewNW: bv.viewNW, viewNH: bv.viewNH };
  }

  /** Zoom around a client-px point. factor < 1 = zoom IN, >1 = zoom OUT. */
  private _zoomAtClient(clientX: number, clientY: number, factor: number): void {
    if (!this._broadcastView) return;
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const u = (clientX - rect.left) / rect.width;
    const v = (clientY - rect.top)  / rect.height;
    const cur = this._currentOverrideSnapshot();
    const wx0 = cur.centerX - cur.viewNW / 2 + u * cur.viewNW;
    const wy0 = cur.centerY - cur.viewNH / 2 + v * cur.viewNH;
    const newW = cur.viewNW * factor;
    const newH = cur.viewNH * factor;
    this._localOverride = {
      viewNW:  newW,
      viewNH:  newH,
      centerX: wx0 - (u - 0.5) * newW,
      centerY: wy0 - (v - 0.5) * newH,
    };
    this._clampOverride(this._broadcastView);
    // If the wheel-out has restored the override to match the broadcast
    // exactly, drop it back to null so the Reset button hides itself.
    const bv = this._broadcastView;
    const ov = this._localOverride;
    const eps = 1e-4;
    if (
      Math.abs(ov.viewNW - bv.viewNW) < eps &&
      Math.abs(ov.viewNH - bv.viewNH) < eps &&
      Math.abs(ov.centerX - bv.centerX) < eps &&
      Math.abs(ov.centerY - bv.centerY) < eps
    ) {
      this._localOverride = null;
    }
    this._applyEffectiveView();
  }

  /** v2.14.54 — composite payload handling. When map_change /
   *  full_state carries a composite payload, the mapBlob is a packed
   *  concatenation of tile bytes (not a final PNG). Unpack + rasterise
   *  locally so the renderer's loadMap gets a normal image buffer.
   *  Returns the input blob unchanged for non-composite maps. */
  private async _maybeRasterizeComposite(
    blob:      ArrayBuffer,
    composite: CompositeWirePayload | undefined,
  ): Promise<{ renderable: ArrayBuffer; backing?: ArrayBuffer }> {
    if (!composite) return { renderable: blob };
    const { unpackCompositeBundle } = await import('../maps/compositeWireFormat.ts');
    const { rasterizeFromTiles }    = await import('../maps/rasterizeComposite.ts');
    const inputs = unpackCompositeBundle(blob, composite);
    const result = await rasterizeFromTiles(inputs, composite.aspect);
    if (!result) return { renderable: blob };
    const renderable = await result.blob.arrayBuffer();
    // v2.14.70 — when the composite has 2+ tiles, also rasterise a
    // "minus topmost tile" backing so the Reveal Map Layer brush
    // exposes the layer underneath through alpha holes in the main
    // map. Single-tile composites skip the backing (nothing to
    // reveal). The viewer computes the backing locally from the
    // same wire-shipped tile bytes — no extra bandwidth.
    if (inputs.length < 2) return { renderable };
    // v2.15.16 — Backing membership = "tiles with something drawn
    // OVER them" (matches the GM-side rasterizeRevealBacking rule
    // shared via compositeOverlap.backingTileIndices). Earlier this
    // used inputs.slice(0, -1) — only the single LAST tile got
    // excluded, which broke composites with multiple top tiles
    // covering the same bottom (only one became transparent under
    // the upper-layer slider on the GM, both broke on the player).
    const { backingTileIndices } = await import('../maps/compositeOverlap.ts');
    const covered = backingTileIndices(
      inputs.map((i) => i.tile),
      (id) => inputs.find((i) => i.asset.id === id)?.asset,
      composite.aspect,
    );
    if (covered.size === 0) return { renderable };
    const drawnInputs = inputs.filter((_, idx) => covered.has(idx));
    // Pass full inputs as extentInputs so the backing PNG shares the
    // main composite's dimensions exactly.
    const backingResult = await rasterizeFromTiles(drawnInputs, composite.aspect, inputs);
    if (!backingResult) return { renderable };
    const backing = await backingResult.blob.arrayBuffer();
    return { renderable, backing };
  }

  private _recoverRenderer(): void {
    if (this.lastMapBlob) {
      // Re-feed the cached state — recreates all GPU resources from scratch.
      void this.renderer.loadMap(this.lastMapBlob, this.lastFog).then(() => {
        if (this.lastFilter) this.renderer.setFilter(this.lastFilter);
        // Re-apply through the effective-view path so any active zoom
        // override survives context loss.
        if (this._broadcastView || this.lastView) {
          if (!this._broadcastView && this.lastView) this._broadcastView = this.lastView;
          this._applyEffectiveView();
        }
        this.setStatus('');
      });
    } else if (this.roomCode) {
      // No cached blob yet (first load) — reconnect to get a fresh full_state.
      this.connect(this.roomCode);
    }
  }

  // ─── P2P ──────────────────────────────────────────────────────────────────

  private connect(roomCode: string): void {
    this.roomCode = roomCode;
    this.setStatus('Connecting…');

    // Destroy any existing guest (e.g. WebGL context-recovery reconnect) before
    // creating a new one, so there are never two active P2P connections at once.
    this.guest?.destroy();

    this.guest = new Guest({
      onConnected:    () => { this.setStatus(''); void this._onConnectedIdentity(); },
      onDisconnected: () => this.setStatus('Disconnected — waiting for GM…'),
      onReconnecting: (attempt, delayMs) => {
        const secs = Math.round(delayMs / 1000);
        this.setStatus(`Reconnecting… (${secs}s, attempt ${attempt})`);
      },
      onError: (err)  => this.setStatus(`Error: ${err.message}`),
      onMessage: (msg, blob) => this.handleMessage(msg, blob),
    });

    this.guest.connect(roomCode);

    // Liveness pings so the GM can detect this same-machine player even
    // though BroadcastChannel offers no presence signal. PeerJS-connected
    // players ping too — Host swallows those (the conn lifecycle already
    // tracks them) so the bandwidth cost is a few bytes per 4s.
    if (this._heartbeatInterval !== null) clearInterval(this._heartbeatInterval);
    const beat = () => {
      // Don't announce a same-browser preview popup as a real player.
      if (this._isPreviewMode()) return;
      this.guest.send({ type: 'player_heartbeat', clientId: this.clientId });
    };
    beat();
    this._heartbeatInterval = window.setInterval(beat, 4000);
  }

  /** True when this view was launched from the GM's "Open Player Window" button
   *  AND the override setting hasn't been flipped on. Detection is the
   *  ?gmPreview=1 URL flag — phones / laptops connecting via QR never have it,
   *  so they're never preview mode regardless of any local state. */
  private _isPreviewMode(): boolean {
    return this._gmPreviewFlag && !showFullPlayerUiInPreview();
  }

  /** Apply preview-mode visibility to the player chrome (identity pill, toasts
   *  container). Cheap to call on every incoming message — flips state idempotently. */
  private _refreshPreviewModeUi(): void {
    const preview = this._isPreviewMode();
    const pillEl = document.querySelector<HTMLElement>('#player-identity-btn');
    if (pillEl) pillEl.hidden = preview;
    const toastsEl = document.querySelector<HTMLElement>('#player-msg-toasts');
    if (toastsEl) toastsEl.hidden = preview;
    document.body.classList.toggle('is-gm-preview', preview);
  }

  // ── v2.17 Player Voice — identity ──────────────────────────────────────────

  private _loadPlayerId(): string {
    try {
      const existing = localStorage.getItem('mappadux:player_id');
      if (existing) return existing;
      const fresh = generateId();
      localStorage.setItem('mappadux:player_id', fresh);
      return fresh;
    } catch { return generateId(); }
  }

  private _loadIdentity(): PlayerIdentity | null {
    try {
      const raw = localStorage.getItem('mappadux:player_identity');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PlayerIdentity>;
      if (typeof parsed.color !== 'string') return null;
      return {
        playerName:    typeof parsed.playerName === 'string' ? parsed.playerName : '',
        characterName: typeof parsed.characterName === 'string' ? parsed.characterName : '',
        color:         parsed.color,
      };
    } catch { return null; }
  }

  private _saveIdentity(id: PlayerIdentity): void {
    this.identity = id;
    try { localStorage.setItem('mappadux:player_identity', JSON.stringify(id)); } catch { /* private mode */ }
    this._refreshIdentityButton();
  }

  /** Push our identity to the GM. No-op if we have none yet, or in preview mode. */
  private _sendIdentify(): void {
    if (!this.identity) return;
    if (this._isPreviewMode()) return;
    this.guest.send({
      type: 'player_identify',
      playerId:      this.playerId,
      clientId:      this.clientId,
      playerName:    this.identity.playerName,
      characterName: this.identity.characterName,
      color:         this.identity.color,
    });
  }

  /** On (re)connect: announce existing identity, or prompt once on first join.
   *  Suppressed entirely in GM preview mode — the popup isn't a real player. */
  private async _onConnectedIdentity(): Promise<void> {
    this._refreshPreviewModeUi();
    if (this._isPreviewMode()) return;
    if (this.identity) { this._sendIdentify(); return; }
    if (this._identityPromptShown) return;
    this._identityPromptShown = true;
    const chosen = await this._identityModal.open();
    if (chosen) { this._saveIdentity(chosen); this._sendIdentify(); }
  }

  /** Re-open the identify modal so the player can change their details. The
   *  modal also exposes a Forget-me button that wipes local state + asks the
   *  GM to remove the persistent record so testing can restart cleanly. */
  async openIdentityModal(): Promise<void> {
    const chosen = await this._identityModal.open(this.identity ?? undefined, {
      onForget: () => this._forgetMe(),
    });
    if (chosen) { this._saveIdentity(chosen); this._sendIdentify(); }
  }

  /** Wipe local identity, ask the GM to drop the registry record, and reload
   *  with a fresh playerId so the next connect starts from zero. */
  private _forgetMe(): void {
    try { this.guest?.send({ type: 'player_forget_me', playerId: this.playerId, clientId: this.clientId }); } catch { /* connection might be flaky — try anyway */ }
    try {
      localStorage.removeItem('mappadux:player_id');
      localStorage.removeItem('mappadux:player_identity');
    } catch { /* private mode */ }
    // Brief delay so the message has a chance to flush before the reload.
    setTimeout(() => location.reload(), 200);
  }

  // ── v2.17 Player Voice — pings ─────────────────────────────────────────────

  private _clearPressTimer(): void {
    if (this._pressTimer !== null) { clearTimeout(this._pressTimer); this._pressTimer = null; }
    this._pressStart = null;
  }

  /** Open the player action menu at a viewport point, if it maps onto the map. */
  private _openPlayerMenu(clientX: number, clientY: number): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const norm = this.renderer.canvasCssToMapNorm(clientX - rect.left, clientY - rect.top);
    if (!norm || norm.x < 0 || norm.x > 1 || norm.y < 0 || norm.y > 1) return; // off-map / letterbox

    const items: ActionMenuItem[] = [];
    if (this.features.pings) {
      items.push({ label: 'Ping here', onSelect: () => this._sendPing(norm.x, norm.y) });
    }
    if (this.features.messaging) {
      items.push({ label: 'Message the GM', onSelect: () => void this._composeAndSend(undefined, 'the GM') });
      for (const p of this.roster) {
        if (p.id === this.playerId) continue; // not yourself
        const label = p.characterName || p.playerName || 'player';
        items.push({ label: `Message ${label}`, onSelect: () => void this._composeAndSend(p.id, label) });
      }
    }
    // Utility entries — same actions as the floating corner buttons, surfaced
    // here too so the menu and the buttons are the two routes to the same thing.
    items.push({
      label: this.identity ? 'Change your name / colour' : 'Introduce yourself',
      onSelect: () => void this.openIdentityModal(),
    });
    items.push({
      label: document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen',
      onSelect: () => document.querySelector<HTMLButtonElement>('#player-fullscreen-btn')?.click(),
    });
    const resetBtn = document.querySelector<HTMLButtonElement>('#player-reset-view-btn');
    if (resetBtn && !resetBtn.hidden) {
      items.push({ label: 'Reset view to GM\'s', onSelect: () => resetBtn.click() });
    }
    this._actionMenu.open(clientX, clientY, items);
  }

  /** Prompt for message text, then send to the GM (toPlayerId undefined) or
   *  another player. Ensures we have an identity first. */
  private async _composeAndSend(toPlayerId: string | undefined, label: string): Promise<void> {
    if (!this.features.messaging) return;
    if (!this.identity) {
      await this.openIdentityModal();
      if (!this.identity) return;
    }
    const text = await this._composer.open(label);
    if (!text) return;
    this.guest.send({
      type: 'player_message',
      messageId:    generateId(),
      fromPlayerId: this.playerId,
      clientId:     this.clientId,
      ...(toPlayerId ? { toPlayerId } : {}),
      text,
    });
  }

  private _sendPing(x: number, y: number): void {
    if (!this.features.pings) return;
    // A ping carries the player's colour + name, so make sure we have one first.
    if (!this.identity) {
      void this.openIdentityModal().then(() => { if (this.identity) this._emitPing(x, y); });
      return;
    }
    this._emitPing(x, y);
  }

  private _emitPing(x: number, y: number): void {
    this.guest.send({ type: 'player_ping', pingId: generateId(), playerId: this.playerId, clientId: this.clientId, x, y });
  }

  /** Pop the roll-for-initiative prompt; send the value back to the GM if the
   *  player types one. Identity is required so the GM can colour + name the card.
   *  Suppressed in GM preview mode. */
  private async _handleInitiativeCall(message?: string): Promise<void> {
    if (this._isPreviewMode()) return;
    if (!this.identity) {
      await this.openIdentityModal();
      if (!this.identity) return;
    }
    const value = await this._initiativeRollModal.open(message);
    if (!value) return;
    this.guest.send({ type: 'initiative_roll', playerId: this.playerId, clientId: this.clientId, value });
  }

  private _refreshIdentityButton(): void {
    const btn = document.querySelector<HTMLButtonElement>('#player-identity-btn');
    if (!btn) return;
    const dot = btn.querySelector<HTMLElement>('.player-identity-dot');
    const label = btn.querySelector<HTMLElement>('.player-identity-label');
    if (this.identity) {
      if (dot) dot.style.background = this.identity.color;
      // Character name first — the in-fiction handle. Fall back to the player's
      // own name only when the character is blank. The GM Players panel shows
      // both, which is the canonical place to look up either one.
      if (label) label.textContent = this.identity.characterName || this.identity.playerName || 'You';
      btn.classList.remove('player-identity-btn--prompting');
    } else {
      if (dot) dot.style.background = 'transparent';
      if (label) label.textContent = 'Who are you?';
      btn.classList.add('player-identity-btn--prompting');
    }
  }

  // ─── Message handling ─────────────────────────────────────────────────────

  private handleMessage(msg: GMMessage, mapBlob?: ArrayBuffer): void {
    // First message via BroadcastChannel proves we're a same-browser session;
    // refresh preview-mode UI gating idempotently every time.
    this._refreshPreviewModeUi();

    // ── Sequence-number deduplication ────────────────────────────────────────
    // Local player windows receive every broadcast twice: once via the fast
    // BroadcastChannel (sub-ms) and once via PeerJS (~50-200ms later).
    // The first delivery (BC) is canonical.  When the PeerJS copy arrives we
    // recognise the seq and drop it before any state is touched.
    const seq = (msg as unknown as Record<string, unknown>)['_seq'];
    if (typeof seq === 'number') {
      if (this.seenSeqs.has(seq)) return; // duplicate — already handled via BC
      this.seenSeqs.add(seq);
      // Trim the set so it doesn't grow without bound over a long session.
      if (this.seenSeqs.size > 200) {
        const sorted = [...this.seenSeqs].sort((a, b) => a - b);
        this.seenSeqs = new Set(sorted.slice(-100));
      }
    }

    switch (msg.type) {
      case 'full_state': {
        this.currentMapId   = msg.payload.map?.id ?? null;
        this.currentMarkers = msg.payload.markers ?? [];
        this.sbSlots        = msg.payload.audio?.slots ?? [];
        // v2.14.17 — pick up calibration + dimensions for the
        // player-side grid renderer.
        // v2.14.18 — gridOffsetX/Y travel in the same payload.
        if (msg.mapPixelsPerSquare !== undefined) this.mapPixelsPerSquare = msg.mapPixelsPerSquare;
        if (msg.mapImageWidth      !== undefined) this.mapImageWidth      = msg.mapImageWidth;
        if (msg.mapImageHeight     !== undefined) this.mapImageHeight     = msg.mapImageHeight;
        if (msg.gridOffsetX        !== undefined) this.gridOffsetX        = msg.gridOffsetX;
        if (msg.gridOffsetY        !== undefined) this.gridOffsetY        = msg.gridOffsetY;
        if (msg.gridColor          !== undefined) this.gridColor          = msg.gridColor;
        if (mapBlob) {
          this.lastFog     = msg.payload.fog ?? { polygons: [] };
          // v2.14.54 — composite payload requires local rasterise.
          // Wrap in IIFE since handleMessage itself is sync.
          const compositeForFs = msg.composite;
          const fogForFs       = msg.payload.fog;
          void (async () => {
            const { renderable, backing } = await this._maybeRasterizeComposite(mapBlob, compositeForFs);
            this.lastMapBlob = renderable;
            await this.renderer.loadMap(renderable, fogForFs, backing);
          })();
        } else {
          this.renderer.updateFog(msg.payload.fog);
          this.lastFog = msg.payload.fog ?? { polygons: [] };
        }
        if (msg.payload.filter) this.lastFilter = msg.payload.filter;
        if (msg.payload.view) {
          this._broadcastView = msg.payload.view;
          this.lastView = msg.payload.view;
        }
        this.renderer.setFilter(msg.payload.filter);
        this._applyEffectiveView();
        void (async () => {
          if (msg.iconData?.length)         await this._decodeIconData(msg.iconData);
          if (msg.soundboardAssets?.length) this._cacheSoundboardAssets(msg.soundboardAssets);
          if (msg.soundboardActive?.length) this._applySoundboardActive(msg.soundboardActive);
          this.markerSprites.render(this.currentMarkers, this.playerIconCache);
          this._updateMarkerOverlay();
          this.renderer.markMarkersDirty();
        })();
        this.setStatus('');
        break;
      }

      case 'map_change': {
        this.currentMapId = msg.payload.id;
        if (msg.markers !== undefined) this.currentMarkers = msg.markers;
        if (msg.audio?.slots)          this.sbSlots = msg.audio.slots;
        // v2.14.17 — refresh calibration + dimensions for the new map.
        // v2.14.18 — and the grid offset.
        if (msg.mapPixelsPerSquare !== undefined) this.mapPixelsPerSquare = msg.mapPixelsPerSquare;
        if (msg.mapImageWidth      !== undefined) this.mapImageWidth      = msg.mapImageWidth;
        if (msg.mapImageHeight     !== undefined) this.mapImageHeight     = msg.mapImageHeight;
        if (msg.gridOffsetX        !== undefined) this.gridOffsetX        = msg.gridOffsetX;
        if (msg.gridOffsetY        !== undefined) this.gridOffsetY        = msg.gridOffsetY;
        if (msg.gridColor          !== undefined) this.gridColor          = msg.gridColor;
        // Stop any playing audio from the previous map
        this._stopAllSoundboard();
        this._stopAllPositional();
        // Drop any in-flight tracker visuals from the previous map
        this._trackerScans = [];
        this._trackerBlobs = [];
        // v2.12.x — animated map two-phase delivery: nothing UI-side
        // to do during the wait. The snapshot is on screen from this
        // map_change handler below; the video_bundle that follows
        // just swaps the texture invisibly when ready. Faff overlay
        // would only obscure the static map the GM sees behind it.
        if (mapBlob) {
          const fog    = msg.fog    ?? { polygons: [] };
          const filter = msg.filter;
          const view   = msg.view;
          const blob   = mapBlob;
          this.lastMapBlob = blob;
          this.lastFog     = fog;
          if (filter) this.lastFilter = filter;
          if (view)   this.lastView   = view;
          // Track this map load on _pendingMapLoad so a follow-up
          // handout_reveal awaits it before swapping the texture
          // again. Without this serialisation the reveal can race
          // against the still-decoding starting-frame load and the
          // animation visibly "snaps to end".
          const prior = this._pendingMapLoad;
          const composite = msg.composite;
          this._pendingMapLoad = (async () => {
            await prior;
            if (msg.iconData?.length)       await this._decodeIconData(msg.iconData);
            if (msg.soundboardActive?.length) this._applySoundboardActive(msg.soundboardActive);
            // v2.14.54 — rasterise composite payload locally if
            // present. Cache the rendered blob (not the packed
            // bundle) so context-recovery can re-feed instantly.
            const { renderable, backing } = await this._maybeRasterizeComposite(blob, composite);
            this.lastMapBlob = renderable;
            await this.runTransition(msg.transition, async () => {
              await this.renderer.loadMap(renderable, fog, backing);
              if (filter) this.renderer.setFilter(filter);
              if (view) {
                // v2.14.18 — fresh map = fresh broadcast bounds.
                // Drop any zoom override so the player starts on the
                // GM-prescribed view of the new map.
                this._broadcastView = view;
                this._localOverride = null;
                this._applyEffectiveView();
              }
            });
          })();
        }
        break;
      }

      case 'handout_reveal': {
        // Reveal animation for a handout. Routes through the
        // renderer's IN-SCENE reveal overlay so the EffectComposer
        // post-effect filter runs over BOTH halves of the reveal
        // (snapshot of unsullied starting frame + underlying final
        // frame). Map→map transitions stay on the existing DOM-overlay
        // path — different filter semantics by design.
        if (!mapBlob) break;
        if (msg.mapId !== this.currentMapId) break; // stale message
        const finalBlob = mapBlob;
        const startBlob = this.lastMapBlob; // cached starting frame
        const fog    = this.lastFog;
        const filter = this.lastFilter;
        const view   = this.lastView;
        this.lastMapBlob = finalBlob;
        // Serialise behind any in-flight map_change load so the
        // reveal's applyChange doesn't race against the still-
        // decoding starting-frame texture. Without this the
        // underlying canvas state is undefined during def.play and
        // the animation visibly snaps to end. _pendingMapLoad chains
        // the new load AFTER the previous one resolves.
        const prior = this._pendingMapLoad;
        this._pendingMapLoad = (async () => {
          await prior;
          let preSnap: ImageBitmap | undefined;
          if (startBlob) {
            try {
              preSnap = await createImageBitmap(new Blob([startBlob], { type: 'image/png' }));
            } catch { preSnap = undefined; }
          }
          // Open an in-scene reveal overlay sized to the WebGL
          // canvas's CSS pixels. The TransitionEngine paints onto
          // this offscreen canvas; the renderer pulls those pixels
          // into a CanvasTexture on a plane inside the EffectComposer
          // pipeline. Filter applies. The overlay is torn down when
          // the transition finishes.
          const rendererCanvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas')!;
          const revealCanvas = this.renderer.beginRevealOverlay(
            rendererCanvas.clientWidth  || window.innerWidth,
            rendererCanvas.clientHeight || window.innerHeight,
          );
          try {
            await this.runTransition(msg.transition, async () => {
              await this.renderer.loadMap(finalBlob, fog);
              if (filter) this.renderer.setFilter(filter);
              if (view) {
                // Handout reveal stays on the same map_id — preserve
                // any in-flight player override; just refresh bounds
                // in case the GM updated the broadcast crop alongside.
                this._broadcastView = view;
                this._applyEffectiveView();
              }
            }, preSnap, revealCanvas);
          } finally {
            this.renderer.endRevealOverlay();
          }
        })();
        break;
      }

      case 'video_bundle': {
        // v2.12.x animated-map phase 2 — we already have a static
        // snapshot from the preceding map_change; this message
        // carries the full video bytes. Swap the renderer texture
        // from still image to VideoTexture by re-loading via
        // renderer.loadMap with the video buffer. Skip if the GM
        // has already moved on to a different map.
        //
        // Note: same-browser peers (player popups, same-machine
        // projector) never reach this branch because Host
        // suppresses video_bundle over LocalChannel — those peers
        // stay on the static snapshot from the preceding map_change.
        // Only remote PeerJS peers receive the bundle and animate.
        if (!mapBlob) break;
        if (msg.mapId !== this.currentMapId) break;
        const videoBuf = mapBlob;
        this.lastMapBlob = videoBuf;
        void this.renderer.loadMap(videoBuf, this.lastFog).then(() => {
          if (this.lastFilter) this.renderer.setFilter(this.lastFilter);
          // video_bundle is a static→video swap on the SAME map, so
          // keep any active override and re-apply it via the effective
          // view path.
          this._applyEffectiveView();
        });
        break;
      }

      case 'filter_update': {
        this.lastFilter = msg.payload;
        this.renderer.setFilter(msg.payload);
        break;
      }

      case 'fog_update': {
        // Safety net: discard fog updates for a different map.
        // With seq deduplication the BC+PeerJS race is already prevented, but
        // this guard catches any edge case where mapId doesn't match.
        if (msg.mapId && msg.mapId !== this.currentMapId) break;
        this.lastFog = msg.payload;
        this.renderer.updateFog(msg.payload);
        break;
      }


      case 'view_update': {
        // v2.14.18 — GM's view becomes the new broadcast bounds.
        // Any active player-side zoom override is preserved and
        // re-clamped to fit the new bounds inside _applyEffectiveView
        // (so panning/cropping by the GM doesn't snap the player out
        // of their local zoom). Backdrop, marker re-render, and grid
        // refresh all happen inside _applyEffectiveView.
        this._broadcastView = msg.payload;
        this._applyEffectiveView();
        break;
      }

      case 'map_meta_update': {
        // v2.14.28 — GM rebroadcasts map metadata after recalibration.
        // Without this handler, the player kept using the old pps so
        // its map-relative grid drew at the OLD spacing even though
        // the asset's calibration had changed. (The map image still
        // looked right because the texture was unchanged.) Update the
        // cached metadata and redraw the grid.
        if (msg.mapPixelsPerSquare !== undefined) this.mapPixelsPerSquare = msg.mapPixelsPerSquare;
        if (msg.mapImageWidth      !== undefined) this.mapImageWidth      = msg.mapImageWidth;
        if (msg.mapImageHeight     !== undefined) this.mapImageHeight     = msg.mapImageHeight;
        if (msg.gridOffsetX        !== undefined) this.gridOffsetX        = msg.gridOffsetX;
        if (msg.gridOffsetY        !== undefined) this.gridOffsetY        = msg.gridOffsetY;
        if (msg.gridColor          !== undefined) this.gridColor          = msg.gridColor;
        this._refreshPlayerGrid();
        break;
      }

      case 'marker_update': {
        this.currentMarkers = msg.payload;
        void (async () => {
          if (msg.iconData?.length) await this._decodeIconData(msg.iconData);
          this.markerSprites.render(this.currentMarkers, this.playerIconCache);
          this._updateMarkerOverlay();
          this.renderer.markMarkersDirty();
        })();
        break;
      }

      case 'positional_play': {
        // Reuse the same binary-or-dataUrl pattern as soundboard_play
        if (mapBlob) {
          const url = URL.createObjectURL(new Blob([mapBlob], { type: 'audio/mpeg' }));
          this._posAssetUrls.set(msg.assetId, url);
          this._posPlay(msg.markerId, url, msg.loop, msg.volume);
        } else {
          if (msg.dataUrl) this._posAssetUrls.set(msg.assetId, msg.dataUrl);
          const url = this._posAssetUrls.get(msg.assetId);
          if (url) this._posPlay(msg.markerId, url, msg.loop, msg.volume);
        }
        break;
      }

      case 'positional_volume': {
        const el = this._posAudioEls.get(msg.markerId);
        if (el) el.volume = Math.max(0, Math.min(1, msg.volume));
        break;
      }

      case 'positional_stop': {
        const el = this._posAudioEls.get(msg.markerId);
        if (el) { el.pause(); el.currentTime = 0; }
        this._posAudioEls.delete(msg.markerId);
        break;
      }

      case 'positional_mute_all': {
        // Pause / resume every positional source so loops survive the
        // round-trip cleanly. Soundboard slots are unaffected — they
        // ride the separate soundboard_mute_all channel. The flag also
        // gates the tracker ping so an active scan keeps animating
        // silently when marker audio is muted.
        this._posMutedAll = msg.muted;
        if (msg.muted) {
          this._posPausedByMute.clear();
          for (const [id, el] of this._posAudioEls.entries()) {
            if (!el.paused) {
              this._posPausedByMute.add(id);
              el.pause();
            }
          }
        } else {
          for (const id of this._posPausedByMute) {
            const el = this._posAudioEls.get(id);
            if (el) void el.play().catch(() => { /* autoplay blocked */ });
          }
          this._posPausedByMute.clear();
        }
        break;
      }

      case 'audio_update': {
        // Slot configuration updated (assign/unassign, loop, volume)
        this.sbSlots = msg.payload.slots ?? [];
        // Stop any slots that are no longer assigned
        for (const [slotId, el] of this.sbAudioEls.entries()) {
          const slot = this.sbSlots.find((s) => s.id === slotId);
          if (!slot?.assetId) { el.pause(); this.sbAudioEls.delete(slotId); }
        }
        break;
      }

      case 'soundboard_play': {
        if (mapBlob) {
          // Audio delivered as binary chunks — create an object URL for it.
          const objUrl = URL.createObjectURL(new Blob([mapBlob], { type: 'audio/mpeg' }));
          this.sbAssetUrls.set(msg.assetId, objUrl);
          this._sbPlay(msg.slotId, objUrl, msg.loop, msg.volume);
        } else {
          // Inline dataUrl (local BroadcastChannel) or cached replay.
          if (msg.dataUrl) this.sbAssetUrls.set(msg.assetId, msg.dataUrl);
          const url = this.sbAssetUrls.get(msg.assetId);
          if (url) this._sbPlay(msg.slotId, url, msg.loop, msg.volume);
        }
        break;
      }

      case 'soundboard_stop': {
        const el = this.sbAudioEls.get(msg.slotId);
        if (el) { el.pause(); el.currentTime = 0; }
        break;
      }

      case 'soundboard_asset': {
        if (mapBlob) {
          const objUrl = URL.createObjectURL(new Blob([mapBlob], { type: 'audio/mpeg' }));
          this.sbAssetUrls.set(msg.assetId, objUrl);
        } else if (msg.dataUrl) {
          this.sbAssetUrls.set(msg.assetId, msg.dataUrl);
        }
        break;
      }

      case 'soundboard_volume': {
        const el = this.sbAudioEls.get(msg.slotId);
        if (el) el.volume = Math.max(0, Math.min(1, msg.volume));
        break;
      }

      case 'soundboard_mute_all': {
        this._applyMute(msg.muted);
        break;
      }

      case 'view_placeholder': {
        if (msg.target !== 'player') break;
        this.viewer.showFaffOverlay(msg.show, msg.message);
        break;
      }

      case 'tracker_scan': {
        this._trackerScans.push({
          startTime: performance.now(),
          centre:    msg.centre,
          range:     msg.range,
          speedSecs: msg.speedSecs,
          colour:    msg.colour,
        });
        this._playTrackerPing(msg.audioAssetId, msg.audioDataUrl, msg.audioVolume);
        this._kickTrackerRaf();
        break;
      }

      case 'tracker_blob': {
        // fadeMs=0 is the GM's "audio-only return" sentinel — skip the visual blob.
        if (msg.fadeMs > 0) {
          this._trackerBlobs.push({
            startTime: performance.now(),
            sourceId:  msg.sourceId,
            position:  msg.position,
            fadeMs:    msg.fadeMs,
            mode:      msg.mode,
            colour:    msg.colour,
          });
          this._kickTrackerRaf();
        }
        this._playTrackerPing(msg.audioAssetId, msg.audioDataUrl, msg.audioVolume);
        break;
      }

      case 'ping_show': {
        // v2.17 Player Voice — a ping relayed by the GM; pulse it on our map.
        this.pingLayer?.add({ id: msg.pingId, x: msg.x, y: msg.y, color: msg.color, name: msg.name });
        break;
      }

      case 'player_features': {
        // v2.17 Player Voice — GM toggled which interactions are allowed.
        if (typeof msg.pings === 'boolean')          this.features.pings          = msg.pings;
        if (typeof msg.messaging === 'boolean')      this.features.messaging      = msg.messaging;
        if (typeof msg.movableMarkers === 'boolean') this.features.movableMarkers = msg.movableMarkers;
        break;
      }

      case 'player_roster': {
        // v2.17 Player Voice — who else is in the session (message targets).
        this.roster = msg.players;
        break;
      }

      case 'player_markers': {
        // v2.17 Player Voice — player tokens placed on the active map.
        this.playerMarkerLayer?.setMarkers(msg.markers);
        break;
      }

      case 'initiative_update': {
        // v2.17 Player Voice — atmospheric initiative rail update.
        this.initiativeRail?.setState(msg.state);
        break;
      }

      case 'initiative_call': {
        // v2.17 Player Voice — GM asked everyone to roll.
        void this._handleInitiativeCall(msg.message);
        break;
      }

      case 'message_deliver': {
        // v2.17 Player Voice — a message addressed to us (GM reply or another
        // player). Broadcast reaches everyone; only show ours, and never in
        // preview mode (the GM popup isn't a real player so messages aren't
        // for it).
        if (msg.toPlayerId === this.playerId && !this._isPreviewMode()) {
          this._msgToasts?.show({ messageId: msg.messageId, fromName: msg.fromName, fromColor: msg.fromColor, text: msg.text });
        }
        break;
      }
    }
  }

  /** Cache the tracker ping audio if a fresh dataUrl arrived, and fire a one-shot. */
  private _playTrackerPing(assetId: string | undefined, dataUrl: string | undefined, volume: number | undefined): void {
    if (!assetId) return;
    if (dataUrl) this._trackerAudioUrls.set(assetId, dataUrl);
    const url = this._trackerAudioUrls.get(assetId);
    if (!url) return;
    if (this.sbMuted || this._posMutedAll) return; // respect player mute + GM marker-mute
    const a = new Audio(url);
    a.volume = Math.max(0, Math.min(1, volume ?? 0.8));
    void a.play().catch(() => { /* autoplay-policy ignore */ });
  }

  // ─── Motion-tracker overlay ───────────────────────────────────────────────

  /** Drive the tracker overlay redraw loop. Idempotent; self-terminates when
   *  there are no rings expanding and no blobs still fading. */
  private _kickTrackerRaf(): void {
    if (this._trackerRafId !== null) return;
    const tick = (now: number) => {
      // Prune expired
      this._trackerScans = this._trackerScans.filter((s) => now - s.startTime < s.speedSecs * 1000);
      this._trackerBlobs = this._trackerBlobs.filter((b) => now - b.startTime < b.fadeMs);

      const overlay: MotionOverlay = {
        now,
        scans: this._trackerScans,
        blobs: this._trackerBlobs,
      };
      this.markerTexture.render(this.currentMarkers, this.playerIconCache, overlay);
      this.markerSprites.render(this.currentMarkers, this.playerIconCache);
      this._updateMarkerOverlay();
      this.renderer.markMarkersDirty();

      if (this._trackerScans.length > 0 || this._trackerBlobs.length > 0) {
        this._trackerRafId = requestAnimationFrame(tick);
      } else {
        this._trackerRafId = null;
        // Final draw with no overlay so the motion texture is clean.
        this.markerTexture.render(this.currentMarkers, this.playerIconCache);
        this.renderer.markMarkersDirty();
      }
    };
    this._trackerRafId = requestAnimationFrame(tick);
  }

  // ─── Soundboard ───────────────────────────────────────────────────────────

  private _sbPlay(slotId: string, dataUrl: string, loop: boolean, volume: number): void {
    let el = this.sbAudioEls.get(slotId);
    if (!el) {
      el = new Audio();
      this.sbAudioEls.set(slotId, el);
    }
    if (el.src !== dataUrl) {
      el.pause();
      el.src = dataUrl;
    }
    el.currentTime = 0;
    el.loop   = loop;
    el.volume = Math.max(0, Math.min(1, volume));
    el.muted  = this.sbMuted;
    void el.play().catch(() => {
      this._scheduleAudioResume();
    });
  }

  private _stopAllSoundboard(): void {
    // v2.12.1 bug fix — must fully tear down, not just pause. Pausing
    // alone leaves the elements in `sbAudioEls`, and the unmute path
    // (and `_scheduleAudioResume`) iterate every entry and resume any
    // that are paused — which would replay every slot ever heard on
    // every prior map in one go after a few map swaps while muted.
    // Clearing the maps matches the symmetric behaviour of
    // `_stopAllPositional` and ensures `_applySoundboardActive` for
    // the new map starts from a clean slate.
    for (const el of this.sbAudioEls.values()) {
      el.pause();
      el.currentTime = 0;
      el.removeAttribute('src');
      try { el.load(); } catch { /* harmless on browsers without media reset */ }
    }
    this.sbAudioEls.clear();
    this._sbPausedByMute.clear();
  }

  private _cacheSoundboardAssets(assets: { assetId: string; dataUrl?: string }[]): void {
    for (const { assetId, dataUrl } of assets) {
      if (dataUrl && !this.sbAssetUrls.has(assetId)) {
        this.sbAssetUrls.set(assetId, dataUrl);
      }
      // Assets without a dataUrl here arrive via binary soundboard_asset messages below.
    }
  }

  private _applySoundboardActive(active: SoundboardAudioData[]): void {
    for (const item of active) {
      // dataUrl may be absent (stripped for chunked binary delivery).
      // Play from cache if available; individual soundboard_play messages follow.
      if (item.dataUrl) this.sbAssetUrls.set(item.assetId, item.dataUrl);
      const url = this.sbAssetUrls.get(item.assetId);
      if (url) this._sbPlay(item.slotId, url, item.loop, item.volume);
    }
  }

  private _scheduleAudioResume(): void {
    if (this._audioResumeScheduled) return;
    this._audioResumeScheduled = true;
    const resume = () => {
      this._audioResumeScheduled = false;
      for (const el of this.sbAudioEls.values()) {
        if (el.paused && el.src) void el.play().catch(() => {});
      }
      for (const el of this._posAudioEls.values()) {
        if (el.paused && el.src) void el.play().catch(() => {});
      }
    };
    document.addEventListener('click',   resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
  }

  private _toggleMute(): void {
    this._applyMute(!this.sbMuted);
    this.viewer.showMuteIndicator(this.sbMuted);
  }

  /**
   * Apply a mute/unmute transition by pausing/resuming the currently
   * playing audio elements rather than just setting `el.muted`. Looping
   * background tracks survive mute → unmute cycles because pause
   * preserves the playback position; setting `el.muted = false` after
   * the element has been silent is unreliable in some browsers, so we
   * pause on mute and explicitly resume on unmute.
   */
  private _applyMute(muted: boolean): void {
    const wasMuted = this.sbMuted;
    this.sbMuted = muted;
    if (muted && !wasMuted) {
      this._sbPausedByMute.clear();
      for (const [slotId, el] of this.sbAudioEls.entries()) {
        if (!el.paused) {
          this._sbPausedByMute.add(slotId);
          el.pause();
        }
      }
      for (const el of this._posAudioEls.values()) el.muted = true;
    } else if (!muted && wasMuted) {
      for (const el of this.sbAudioEls.values())   el.muted = false;
      for (const el of this._posAudioEls.values()) el.muted = false;
      for (const slotId of this._sbPausedByMute) {
        const el = this.sbAudioEls.get(slotId);
        if (el) void el.play().catch(() => { /* autoplay blocked */ });
      }
      this._sbPausedByMute.clear();
    }
  }

  // v2.15 — _showFaffOverlay, _showMuteIndicator, _faffOverlayEl,
  // _muteIndicatorEl all lifted into Viewer. Callers use
  // this.viewer.showFaffOverlay / this.viewer.showMuteIndicator.

  // ─── Positional audio ─────────────────────────────────────────────────────

  private _posPlay(markerId: string, url: string, loop: boolean, volume: number): void {
    let el = this._posAudioEls.get(markerId);
    if (!el) {
      el = new Audio();
      this._posAudioEls.set(markerId, el);
    }
    if (el.src !== url) { el.pause(); el.src = url; }
    el.currentTime = 0;
    el.loop   = loop;
    el.volume = Math.max(0, Math.min(1, volume));
    el.muted  = this.sbMuted;
    el.play().then(
      () => { /* ok */ },
      () => { this._scheduleAudioResume(); },
    );
  }

  private _stopAllPositional(): void {
    for (const el of this._posAudioEls.values()) { el.pause(); el.currentTime = 0; }
    this._posAudioEls.clear();
    this._posAssetUrls.clear();
  }

  // ─── Icon cache ───────────────────────────────────────────────────────────

  private async _decodeIconData(iconData: MarkerIconData[]): Promise<void> {
    await Promise.all(
      iconData
        .filter(({ key }) => !this.playerIconCache.has(key))
        .map(async ({ key, dataUrl }) => {
          try {
            const bmp = await decodeImageBitmap(dataUrl);
            this.playerIconCache.set(key, bmp);
          } catch {
            /* shrug — skip this icon, fallback circle will render */
          }
        }),
    );
  }

  /**
   * Sync the HTML overlay so each marker label sits below its icon in
   * screen px. World coords ↦ screen via the renderer's camera projection,
   * with a small vertical offset for breathing room below the icon body
   * (icon body half-height = 0.025 × m.size world units; PAD_FACTOR
   * margin in the per-marker sprite is on top of that).
   */
  private _updateMarkerOverlay(): void {
    const aspect = this.renderer.mapAspect;
    const scale  = this.renderer.worldToScreenScale();
    const items: OverlayItem[] = [];
    for (const m of this.currentMarkers) {
      if (m.hidden) continue;
      const wx = (m.position.x - 0.5) * aspect;
      const wy = -(m.position.y - 0.5);
      const s  = this.renderer.worldToScreen(wx, wy);
      if (!s) continue;
      const iconAspect = getMarkerAspect(m, this.playerIconCache);
      const halfHWorld = 0.025 * m.size;
      const halfWWorld = halfHWorld * iconAspect;
      items.push({
        id:               m.id,
        anchorX:          s.x,
        anchorY:          s.y,
        iconHalfWidthPx:  halfWWorld * scale.pxPerWorldX,
        iconHalfHeightPx: halfHWorld * scale.pxPerWorldY,
        label: { text: m.label ?? '', visible: !!m.showLabel && !!m.label },
        // No move handle on player — read-only view.
      });
    }
    this.markerOverlay.update(items);
  }

  // ─── Transitions ──────────────────────────────────────────────────────────

  private async runTransition(
    config: TransitionConfig | undefined,
    applyChange: () => Promise<void>,
    /** Optional pre-decoded snapshot for the transition's "before"
     *  state. Handout reveal pathway passes in the raw starting-frame
     *  bitmap so the filter doesn't get baked into the snapshot at
     *  capture time. Map→map transitions leave this undefined and the
     *  engine snapshots the live canvas. */
    preSnapshot?: ImageBitmap,
    /** Optional offscreen canvas the transition should paint onto
     *  instead of the DOM overlay. Handout reveal pathway supplies
     *  the renderer's in-scene reveal-overlay canvas so the filter
     *  applies to BOTH halves of the reveal. Map→map transitions
     *  leave this undefined and paint to the DOM overlay above the
     *  WebGL canvas — outside the filter pipeline. */
    overlayOverride?: HTMLCanvasElement,
  ): Promise<void> {
    const id  = config?.transitionId ?? 'none';
    const def = transitionRegistry.getOrFallback(id);
    const params = config?.params ?? transitionRegistry.defaultParams(id);
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas')!;
    await this.transitionEngine.run(def, params, canvas, applyChange, preSnapshot, overlayOverride);
  }

  // ─── UI ───────────────────────────────────────────────────────────────────

  private showConnectPanel(): void {
    this.connectPanel.hidden = false;
    this.setStatus('Enter room code to connect');
  }

  private setStatus(msg: string): void {
    this.statusEl.textContent = msg;
    this.statusEl.hidden = !msg;
  }
}

// Pre-warm filter registry so shaders are compiled on load
filterRegistry.getAll();
