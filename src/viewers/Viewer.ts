/**
 * Viewer — unified remote-viewer surface.
 *
 * Phase 2 of the Player/Scaled refactor (see
 * [[project_dmr_viewer_refactor_design]] in project memory). This class
 * owns the cross-cutting chrome that's identical (or near-identical)
 * between PlayerApp and ProjectorApp:
 *
 *   • Lifecycle BroadcastChannel close — listens for the GM window's
 *     'gm-closing' signal and self-closes.
 *   • Fullscreen button binding (conditional on profile flag).
 *   • Faff hold-screen overlay with "Not connected, yet?" QR + URL
 *     panel (QR target driven by profile.chrome.qrTarget).
 *   • Mute indicator toast (player-only via profile flag).
 *
 * Rendering pipeline (Renderer, MarkerOverlay, MarkerSprites,
 * MarkerTexture, TransitionEngine, message dispatch, view computation,
 * grid drawing) is NOT yet in Viewer — those land in Phase 3 once the
 * chrome lift is bedded in.
 *
 * The class is data-driven from a ViewerProfile so adding new viewer
 * kinds (or future capabilities like role-switching mid-session) is a
 * profile change rather than a class edit.
 */

import QRCode from 'qrcode';
import { bindFullscreenButton } from '../utils/fullscreen.ts';
import type { ViewerProfile } from './ViewerProfile.ts';

export interface ViewerOpts {
  /** Element ID (or already-resolved Element) of the fullscreen toggle
   *  button this viewer manages. Different per-page in the existing
   *  HTML (`player-fullscreen-btn` vs `fullscreen-btn`); profile flag
   *  decides whether to bind it at all. Pass null / undefined to skip. */
  fullscreenBtn?: HTMLElement | null;
  /** Override the URL the hold-screen QR encodes. If not provided, the
   *  Viewer derives a URL from `profile.chrome.qrTarget`:
   *    - 'self'   → `window.location.href`
   *    - 'player' → `${origin}/player#${roomCode-from-hash}`
   *  Callers can pass an explicit URL when the derivation isn't right
   *  for their case (e.g. cross-origin embeds, future test harnesses). */
  qrUrl?: string;
}

export class Viewer {
  readonly profile: ViewerProfile;
  private opts: ViewerOpts;

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

  constructor(profile: ViewerProfile, opts: ViewerOpts = {}) {
    this.profile = profile;
    this.opts = opts;
  }

  /** Wire up profile-gated chrome. Call once during the host app's
   *  init(), after the DOM is ready. Idempotent on re-call — duplicate
   *  bindings are skipped. */
  init(): void {
    this._attachLifecycleClose();
    if (this.profile.chrome.fullscreenBtn && this.opts.fullscreenBtn) {
      // bindFullscreenButton is null-safe internally but assert here so
      // we don't silently double-bind on init() reruns.
      if (!this._fullscreenUnbind) {
        this._fullscreenUnbind = bindFullscreenButton(this.opts.fullscreenBtn);
      }
    }
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
  }

  /** Show or hide the hold-screen faff overlay. `show=false` removes
   *  it; the next show call rebuilds + re-renders the QR (URLs don't
   *  change mid-session so we don't re-render the QR unnecessarily).
   *
   *  Gated by `profile.chrome.holdScreenQr` only for the QR portion —
   *  the message + logo always render when called. Profiles that
   *  don't want the QR (none today; reserved for future minimalist
   *  variants) can set holdScreenQr: false. */
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

  /** Render the mute-indicator toast (player-only). The Player app
   *  calls this on mute-state changes; profiles where the flag is
   *  false get a no-op so the call site can stay branchless. */
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
    // Auto-fade the "Audio on" state — muted stays visible so the user
    // knows the page is silent. Cancel any pending fade so rapid
    // toggles don't end up with a half-faded indicator.
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
      // Light foreground on dark background to match the GM panel's QR
      // palette. Most phone scanners handle inverted QRs fine.
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
    // 'player' target — derive the PLAYER URL from this window's room
    // code. Works whether we're a scaled-primary or scaled-monitor;
    // the URL points at where late-joiners land as players, not back
    // at this projector window.
    if (typeof window === 'undefined') return null;
    const room = window.location.hash.replace(/^#/, '');
    return `${window.location.origin}/player${room ? '#' + room : ''}`;
  }
}
