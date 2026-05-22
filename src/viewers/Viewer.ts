/**
 * Viewer — unified remote-viewer surface.
 *
 * Owns the chrome + rendering pipeline shared between PlayerApp and
 * ProjectorApp. Profile-driven: what gets wired up is decided by the
 * ViewerProfile constant passed in at construction. Apps remain
 * responsible for P2P + message dispatch + their template-specific
 * extras (calibration UI, grid overlay, mute state, etc.).
 *
 * Phases covered here:
 *   • Phase 2 — Chrome surface: lifecycle BroadcastChannel close,
 *     fullscreen button, faff hold-screen overlay (with QR), mute
 *     indicator toast.
 *   • Phase 3a — Rendering pipeline: Renderer, MarkerOverlay,
 *     MarkerSprites, MarkerTexture, TransitionEngine (latter
 *     conditional on profile.transitions.mode === 'full').
 *
 * See [[project_dmr_viewer_refactor_design]] in project memory for
 * the full phase plan and what comes next (computeView / drawGrid
 * strategies, message dispatch).
 */

import QRCode from 'qrcode';
import { bindFullscreenButton } from '../utils/fullscreen.ts';
import { Renderer } from '../rendering/Renderer.ts';
import { MarkerTexture } from '../rendering/MarkerTexture.ts';
import { MarkerSprites } from '../rendering/MarkerSprites.ts';
import { MarkerOverlay } from '../rendering/MarkerOverlay.ts';
import { TransitionEngine } from '../transitions/TransitionEngine.ts';
import type { ViewerProfile } from './ViewerProfile.ts';

export interface ViewerOpts {
  // ── Chrome ─────────────────────────────────────────────────────────
  /** Element ID-or-element of the fullscreen toggle button this viewer
   *  manages. Different per-page in the existing HTML
   *  (`player-fullscreen-btn` vs `fullscreen-btn`); profile flag
   *  decides whether to bind it at all. Pass null / undefined to
   *  skip the binding entirely (ProjectorApp does this so it can
   *  manage its own monitor-mode rebind). */
  fullscreenBtn?: HTMLElement | null;
  /** Override the URL the hold-screen QR encodes. If not provided, the
   *  Viewer derives a URL from `profile.chrome.qrTarget`:
   *    - 'self'   → `window.location.href`
   *    - 'player' → `${origin}/player#${roomCode-from-hash}` */
  qrUrl?: string;

  // ── Rendering pipeline (Phase 3a) ──────────────────────────────────
  /** The Three.js renderer's canvas. Required — the Viewer constructs
   *  the Renderer against this element in init(). */
  rendererCanvas: HTMLCanvasElement;
  /** The screen-space DOM overlay container for marker labels +
   *  handles. Falls back to document.body if not provided. */
  markerOverlayEl?: HTMLElement | null;
  /** Canvas for the TransitionEngine. Only constructed if the profile
   *  asks for full transitions AND a canvas is provided. Profiles
   *  with mode: 'cut-to-frame' (projector / monitor) pass null. */
  transitionCanvas?: HTMLCanvasElement | null;

  /** Forwarded to the Three.js WebGLRenderer constructor — Player sets
   *  this true (lets the canvas be screenshot-captured). */
  preserveDrawingBuffer?: boolean;
  /** Initial state of the filter pipeline. Projector starts with the
   *  filter pass disabled (gated by the per-projector Disable-Filter
   *  toggle); Player leaves it enabled. Default true. */
  initialFilterEnabled?: boolean;
  /** Whether the renderer's video-stall watchdog escalates to the
   *  "tap fullscreen to resume" overlay. Projector disables this — at
   *  the table, a stuttering animation beats a blocking banner.
   *  Default true (the player behaviour). */
  videoStallEscalation?: boolean;
}

/** Callback that fires whenever a new map texture finishes loading.
 *  The Viewer invokes registered callbacks AFTER it has propagated
 *  the new aspect ratio to MarkerTexture + MarkerSprites, so app
 *  callbacks see a fully-aligned pipeline. */
export type OnMapLoadedFn = (aspect: number) => void;

export class Viewer {
  readonly profile: ViewerProfile;
  private opts: ViewerOpts;

  // ── Rendering pipeline (constructed in init()) ─────────────────────
  /** Three.js renderer. Apps continue to drive loadMap / setView /
   *  setFilter etc. directly during the refactor; later phases may
   *  move those calls behind viewer methods. */
  renderer!: Renderer;
  markerTexture!: MarkerTexture;
  markerSprites!: MarkerSprites;
  markerOverlay!: MarkerOverlay;
  /** Null when the profile's transition mode is 'cut-to-frame' OR no
   *  transition canvas was provided. */
  transitionEngine: TransitionEngine | null = null;

  // ── Chrome state ───────────────────────────────────────────────────
  /** Lifecycle BroadcastChannel — holds the reference so we don't get
   *  GC'd mid-session. Closed in destroy(). */
  private _lifecycleChannel: BroadcastChannel | null = null;
  /** Unsubscribe handle from bindFullscreenButton. Null when no button
   *  was bound (either the profile said no, or no element passed). */
  private _fullscreenUnbind: (() => void) | null = null;
  /** Lazily-created faff overlay DOM. Lives on document.body so it
   *  covers the whole viewport regardless of canvas layout. */
  private _faffOverlayEl: HTMLElement | null = null;
  /** Lazily-created mute-indicator toast. Player profile only. */
  private _muteIndicatorEl: HTMLElement | null = null;
  /** Pending fade timer for the mute indicator; cleared on rapid
   *  toggles so the toast doesn't ghost-disappear. */
  private _muteFadeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Subscribers to onMapLoaded. Fan-out happens in the renderer's
   *  own onMapLoaded callback that Viewer installs during init(). */
  private _onMapLoadedHooks: OnMapLoadedFn[] = [];

  constructor(profile: ViewerProfile, opts: ViewerOpts) {
    this.profile = profile;
    this.opts = opts;
  }

  /** Wire up the pipeline and any profile-gated chrome. Idempotent on
   *  re-call — duplicate bindings are skipped, the pipeline is built
   *  exactly once. */
  init(): void {
    // Pipeline construction is a one-shot — early-return if init has
    // already run. The chrome bindings below have their own dedupe.
    if (!this._isPipelineBuilt()) this._buildPipeline();

    this._attachLifecycleClose();
    if (this.profile.chrome.fullscreenBtn && this.opts.fullscreenBtn) {
      if (!this._fullscreenUnbind) {
        this._fullscreenUnbind = bindFullscreenButton(this.opts.fullscreenBtn);
      }
    }
  }

  /** Subscribe to map-loaded events. The Viewer fans out to all
   *  subscribers AFTER updating MarkerTexture + MarkerSprites with
   *  the new aspect ratio, so subscribers see an aligned pipeline.
   *
   *  Returns an unsubscribe function in case the caller wants to
   *  detach (e.g. teardown in a hot-reload scenario). */
  onMapLoaded(fn: OnMapLoadedFn): () => void {
    this._onMapLoadedHooks.push(fn);
    return () => {
      const i = this._onMapLoadedHooks.indexOf(fn);
      if (i >= 0) this._onMapLoadedHooks.splice(i, 1);
    };
  }

  /** Release resources held by the Viewer. Safe to call multiple times. */
  destroy(): void {
    try { this._lifecycleChannel?.close(); } catch { /* already closed */ }
    this._lifecycleChannel = null;
    this._fullscreenUnbind?.();
    this._fullscreenUnbind = null;
    if (this._muteFadeTimer !== null) {
      clearTimeout(this._muteFadeTimer);
      this._muteFadeTimer = null;
    }
    this._faffOverlayEl?.remove();
    this._faffOverlayEl = null;
    this._muteIndicatorEl?.remove();
    this._muteIndicatorEl = null;
    this._onMapLoadedHooks.length = 0;
  }

  /** Show or hide the hold-screen faff overlay. `show=false` removes
   *  it; the next show call rebuilds + re-renders the QR (URLs don't
   *  change mid-session so we don't re-render the QR unnecessarily). */
  showFaffOverlay(show: boolean, message: string): void {
    if (!show) {
      this._faffOverlayEl?.remove();
      this._faffOverlayEl = null;
      return;
    }
    if (!this._faffOverlayEl) {
      const el = document.createElement('div');
      el.className = 'faff-overlay';
      const qrBlock = this.profile.chrome.holdScreenQr
        ? '<div class="faff-overlay__connect">' +
            '<div class="faff-overlay__connect-label">Not connected, yet?</div>' +
            '<canvas class="faff-overlay__qr" width="160" height="160"></canvas>' +
            '<div class="faff-overlay__url"></div>' +
          '</div>'
        : '';
      el.innerHTML =
        '<img class="faff-overlay__logo" src="/icons/icon-192.png" alt="Mappadux" />' +
        '<div class="faff-overlay__message"></div>' +
        qrBlock;
      document.body.appendChild(el);
      this._faffOverlayEl = el;
      if (this.profile.chrome.holdScreenQr) {
        this._renderHoldScreenQr(el);
      }
    }
    const msgEl = this._faffOverlayEl.querySelector<HTMLElement>('.faff-overlay__message');
    if (msgEl) msgEl.textContent = message;
  }

  /** Render the mute-indicator toast (player-only). Profiles where
   *  the flag is false get a no-op so call sites stay branchless. */
  showMuteIndicator(muted: boolean): void {
    if (!this.profile.chrome.muteIndicator) return;
    if (!this._muteIndicatorEl) {
      const el = document.createElement('div');
      el.className = 'mute-indicator';
      document.body.appendChild(el);
      this._muteIndicatorEl = el;
    }
    const el = this._muteIndicatorEl;
    el.textContent = muted ? '🔇 Muted' : '🔊 Audio on';
    el.classList.remove('mute-indicator--hiding');
    // Auto-fade the "Audio on" state — muted stays visible so the
    // user knows the page is silent. Cancel any pending fade so
    // rapid toggles don't end up with a half-faded indicator.
    if (this._muteFadeTimer !== null) {
      clearTimeout(this._muteFadeTimer);
      this._muteFadeTimer = null;
    }
    if (!muted) {
      this._muteFadeTimer = setTimeout(() => {
        this._muteIndicatorEl?.classList.add('mute-indicator--hiding');
        this._muteFadeTimer = null;
      }, 1500);
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private _isPipelineBuilt(): boolean {
    // `renderer` is declared with `!:` so it's truthy iff init has
    // already built the pipeline. Reading an unset definite-assign
    // field returns undefined at runtime regardless of the type.
    return !!(this as unknown as { renderer?: unknown }).renderer;
  }

  private _buildPipeline(): void {
    const rendererOpts = this.opts.preserveDrawingBuffer
      ? { preserveDrawingBuffer: true }
      : undefined;
    this.renderer = new Renderer(this.opts.rendererCanvas, rendererOpts);
    if (this.opts.initialFilterEnabled === false) {
      this.renderer.setFilterEnabled(false);
    }
    if (this.opts.videoStallEscalation === false) {
      this.renderer.setVideoStallEscalation(false);
    }

    this.markerTexture = new MarkerTexture();
    this.markerSprites = new MarkerSprites();
    this.renderer.setMarkerCanvas(this.markerTexture.canvas);
    this.renderer.setMarkerSpriteGroup(this.markerSprites.group);

    this.markerOverlay = new MarkerOverlay(this.opts.markerOverlayEl ?? document.body);

    // TransitionEngine only when the profile wants animations AND we
    // were handed a canvas to render them on. Projector + monitor
    // (cut-to-frame) and any future template that omits the
    // transitionCanvas get null here; their map_change / handout_reveal
    // handlers cut straight to the final frame.
    if (this.profile.transitions.mode === 'full' && this.opts.transitionCanvas) {
      this.transitionEngine = new TransitionEngine(this.opts.transitionCanvas);
    }

    // Single fan-out point for onMapLoaded. We update the marker
    // pipeline's aspect ratio first, then invoke registered hooks so
    // app callbacks see an aligned state. Apps subscribe via
    // viewer.onMapLoaded(fn).
    this.renderer.onMapLoaded = (aspect) => {
      this.markerTexture.setAspectRatio(aspect);
      this.markerSprites.setAspectRatio(aspect);
      for (const fn of this._onMapLoadedHooks) {
        try { fn(aspect); } catch { /* one subscriber's throw shouldn't kill the rest */ }
      }
    };

    this.renderer.start();
  }

  private _attachLifecycleClose(): void {
    if (this._lifecycleChannel) return;
    try {
      const ch = new BroadcastChannel('mappadux:lifecycle');
      ch.onmessage = (e) => {
        if (e?.data?.kind === 'gm-closing') {
          try { window.close(); } catch { /* not opened via window.open — leave alone */ }
        }
      };
      this._lifecycleChannel = ch;
    } catch {
      // BroadcastChannel unavailable (very old browsers, sandboxed
      // contexts). The window stays open on GM close — acceptable
      // graceful degradation.
    }
  }

  private _renderHoldScreenQr(rootEl: HTMLElement): void {
    const qrCanvas = rootEl.querySelector<HTMLCanvasElement>('.faff-overlay__qr');
    const urlEl    = rootEl.querySelector<HTMLElement>('.faff-overlay__url');
    const url = this._qrUrl();
    if (!url) return;
    if (urlEl) urlEl.textContent = url;
    if (qrCanvas) {
      // Light foreground on dark background to match the GM panel's
      // QR palette. Most phone scanners handle inverted QRs fine.
      void QRCode.toCanvas(qrCanvas, url, {
        width: 160,
        color: { dark: '#c8d8e8', light: '#0a0e1a' },
      }).catch(() => { /* QR is non-critical for any flow */ });
    }
  }

  private _qrUrl(): string | null {
    if (this.opts.qrUrl) return this.opts.qrUrl;
    if (this.profile.chrome.qrTarget === 'self') {
      return typeof window !== 'undefined' ? window.location.href : null;
    }
    // 'player' target — derive the PLAYER URL from this window's
    // room code. Works whether we're a scaled-primary or
    // scaled-monitor; the URL points at where late-joiners land as
    // players, not back at this projector window.
    if (typeof window === 'undefined') return null;
    const room = window.location.hash.replace(/^#/, '');
    return `${window.location.origin}/player${room ? '#' + room : ''}`;
  }
}
