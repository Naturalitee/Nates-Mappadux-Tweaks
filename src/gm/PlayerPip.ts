/**
 * PlayerPip — inline Picture-in-Picture preview of the player view, overlaid
 * on the GM canvas.
 *
 * Lifecycle states:
 *   • Hidden ("Show Player View" pill button at bottom-left of the canvas).
 *   • Visible (iframe + chrome at last-remembered position, 33% wide, 16:9).
 *
 * Header chrome:
 *   • Drag area — anywhere on the header. Position persists across reloads
 *     (`dmr_pip_position`).
 *   • Minimise → hides the frame, brings back the pill button.
 *   • Pop-out → opens the same URL as a standalone popup window AND closes
 *     the inline frame. The pill button comes back, so the GM can open a
 *     second inline preview if they want to compare what's on screen vs
 *     what a real popped-out window shows. The Open Player Window button
 *     in the Player Views panel is retired in favour of this flow.
 *
 * Iframe content: standard player URL with `?gmPreview=1` so the
 * player-only chrome (mute toggle, identity pill, ping mode, etc.) is
 * suppressed — this is a preview, not a participating player.
 *
 * Connection: same-machine via BroadcastChannel (instant). The iframe is
 * same-origin so BC works out of the box; no PeerJS broker hop needed
 * unless the iframe is later moved cross-origin.
 */

const STORAGE_POSITION = 'dmr_pip_position';
const STORAGE_VISIBLE  = 'dmr_pip_visible';
const STORAGE_WIDTH    = 'dmr_pip_width';

interface PersistedPosition { x: number; y: number }

export interface PlayerPipOptions {
  /** Container the PiP overlays — typically `#canvas-wrapper`. */
  canvasWrapper: HTMLElement;
  /** Resolver for the player URL to load in the iframe / popup. Called on
   *  every show / pop-out, so the result tracks live state (room code,
   *  instance, etc.). */
  getPlayerUrl: () => string;
}

export class PlayerPip {
  private wrapper: HTMLElement;
  private getPlayerUrl: () => string;

  private pipFrame: HTMLElement | null = null;
  private showButton: HTMLElement | null = null;
  /** Tracks the user-resized width so we can persist on debounced
   *  changes from the CSS-native bottom-right resize handle. */
  private _resizeObserver: ResizeObserver | null = null;
  private _resizeSaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: PlayerPipOptions) {
    this.wrapper = opts.canvasWrapper;
    this.getPlayerUrl = opts.getPlayerUrl;

    // Initial state from persisted visibility. Default ON — the
    // onboarding intent is "GM sees what players see right away".
    const persisted = localStorage.getItem(STORAGE_VISIBLE);
    const startOpen = persisted === null ? true : persisted === '1';
    if (startOpen) this.show();
    else this._buildShowButton();
  }

  /** Open the inline PiP. No-op if already open. */
  show(): void {
    if (this.pipFrame) return;
    this._removeShowButton();
    this._buildPipFrame();
    localStorage.setItem(STORAGE_VISIBLE, '1');
  }

  /** Close the inline PiP. The pill button reappears at bottom-left. */
  hide(): void {
    this._removePipFrame();
    this._buildShowButton();
    localStorage.setItem(STORAGE_VISIBLE, '0');
  }

  /** Pop the inline PiP out into a standalone window. The inline frame
   *  closes; the pill button comes back so the GM can spawn another
   *  inline preview alongside the popped-out one. */
  popOut(): void {
    const raw = this.getPlayerUrl();
    if (!raw) return;
    // v2.16.104 — a popped-out window is a REAL player view: you hand it to a
    // participant or put it on their screen. Strip the gmPreview flag (which
    // marks the INLINE PiP as a non-registering GM preview) so the pop-out
    // self-registers like any player. Without this it only registered when
    // "Show full player UI in the GM preview window" was on — and that setting
    // is meant to gate the inline preview ONLY, not pop-outs / remote windows.
    let url = raw;
    try { const u = new URL(raw); u.searchParams.delete('gmPreview'); url = u.toString(); }
    catch { /* malformed URL — fall back to the raw string */ }
    window.open(url, '_blank', 'noopener,popup,width=1280,height=720');
    // Match the existing Hide behaviour: persist intent + show pill.
    this.hide();
  }

  /** Re-resolve the player URL and re-load the iframe. Used when the
   *  room code becomes available after the PiP has already mounted
   *  (host.onReady fires asynchronously after init). No-op when the
   *  inline frame is hidden — pop-out / show always reads fresh. */
  refresh(): void {
    if (!this.pipFrame) return;
    const iframe = this.pipFrame.querySelector<HTMLIFrameElement>('iframe.player-pip-iframe');
    const url = this.getPlayerUrl();
    if (iframe && url) {
      const u = new URL(url);
      u.searchParams.set('pip', '1');
      iframe.src = u.toString();
    }
  }

  // ─── Build / teardown ────────────────────────────────────────────────────

  private _buildShowButton(): void {
    if (this.showButton) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'player-pip-show-btn';
    btn.title = 'Show inline preview of what players see. Drag to move; use the pop-out button on the preview to send it to a standalone window.';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="2" y="4" width="20" height="14" rx="2"/>' +
        '<line x1="8" y1="20" x2="16" y2="20"/>' +
        '<line x1="12" y1="18" x2="12" y2="20"/>' +
      '</svg>' +
      '<span>Show Player View</span>';
    btn.addEventListener('click', () => this.show());
    // Same propagation-stop as the frame so clicking the pill doesn't
    // also trigger a workspace pan-start on the canvas underneath.
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('pointerup',   (e) => e.stopPropagation());
    this.wrapper.appendChild(btn);
    this.showButton = btn;
  }

  private _removeShowButton(): void {
    this.showButton?.remove();
    this.showButton = null;
  }

  private _buildPipFrame(): void {
    const frame = document.createElement('div');
    frame.className = 'player-pip-frame';

    // Header — drag handle + min / pop-out buttons.
    const header = document.createElement('div');
    header.className = 'player-pip-header';
    const title = document.createElement('span');
    title.className = 'player-pip-title';
    title.textContent = 'Player View';
    const minBtn = document.createElement('button');
    minBtn.type = 'button';
    minBtn.className = 'player-pip-chrome-btn';
    minBtn.title = 'Minimise to the Show Player View button';
    minBtn.setAttribute('aria-label', 'Minimise');
    minBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<line x1="5" y1="19" x2="19" y2="19"/>' +
      '</svg>';
    minBtn.addEventListener('click', () => this.hide());
    const popBtn = document.createElement('button');
    popBtn.type = 'button';
    popBtn.className = 'player-pip-chrome-btn';
    popBtn.title = 'Pop out to a standalone window. The Show Player View button will reappear so you can spawn another inline preview.';
    popBtn.setAttribute('aria-label', 'Pop out');
    popBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' +
      '</svg>';
    popBtn.addEventListener('click', () => this.popOut());
    header.appendChild(title);
    header.appendChild(minBtn);
    header.appendChild(popBtn);
    frame.appendChild(header);

    // Iframe body. v2.16.42 — append `pip=1` to the URL so the inner
    // PlayerApp skips the mute indicator and stays silently muted (no
    // audio needed for an inline preview; the giant "tap to start
    // audio" prompt would dwarf the small frame anyway). Pop-out
    // windows use the raw URL (no pip flag) so they get sound.
    const iframe = document.createElement('iframe');
    iframe.className = 'player-pip-iframe';
    const rawUrl = this.getPlayerUrl();
    if (rawUrl) {
      const u = new URL(rawUrl);
      u.searchParams.set('pip', '1');
      iframe.src = u.toString();
    }
    iframe.title = 'Player view preview';
    iframe.setAttribute('allow', 'autoplay; fullscreen');
    frame.appendChild(iframe);

    // Position from persisted store, falling back to bottom-left.
    const pos = this._loadPosition();
    if (pos) {
      frame.style.left = `${pos.x}px`;
      frame.style.top  = `${pos.y}px`;
    } else {
      frame.style.left   = '12px';
      frame.style.bottom = '12px';
    }
    // Restore user-resized width if present. Height auto-computes from
    // the CSS aspect-ratio so we only need to track width.
    const w = this._loadWidth();
    if (w !== null) frame.style.width = `${w}px`;

    this.wrapper.appendChild(frame);
    this.pipFrame = frame;

    // Watch for CSS-native resize from the bottom-right handle; persist
    // the new width on a short debounce so we don't hammer localStorage
    // during the drag.
    this._resizeObserver = new ResizeObserver(() => {
      if (this._resizeSaveTimer !== null) clearTimeout(this._resizeSaveTimer);
      this._resizeSaveTimer = setTimeout(() => {
        if (this.pipFrame) this._saveWidth(this.pipFrame.offsetWidth);
        this._resizeSaveTimer = null;
      }, 250);
    });
    this._resizeObserver.observe(frame);

    // v2.16.43 — stop pointer/wheel/click events on the PiP frame from
    // bubbling up to the canvas-wrapper's pan/zoom + workspace gesture
    // handlers. Otherwise clicking the header to drag the PiP also
    // pans the GM camera underneath, and scrolling on the iframe area
    // zooms the GM. The iframe itself is its own document so events
    // inside it never bubble here — only chrome interactions matter.
    const stop = (e: Event) => e.stopPropagation();
    frame.addEventListener('pointerdown', stop);
    frame.addEventListener('pointerup', stop);
    frame.addEventListener('wheel', stop, { passive: true });
    frame.addEventListener('click', stop);
    frame.addEventListener('dblclick', stop);
    frame.addEventListener('contextmenu', stop);

    this._bindDrag(header, frame);
  }

  private _removePipFrame(): void {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    if (this._resizeSaveTimer !== null) {
      clearTimeout(this._resizeSaveTimer);
      this._resizeSaveTimer = null;
    }
    this.pipFrame?.remove();
    this.pipFrame = null;
  }

  // ─── Drag ────────────────────────────────────────────────────────────────

  private _bindDrag(handle: HTMLElement, frame: HTMLElement): void {
    let dragging = false;
    let startMouseX = 0;
    let startMouseY = 0;
    let startLeft   = 0;
    let startTop    = 0;

    handle.addEventListener('pointerdown', (e) => {
      // Skip clicks on the chrome buttons.
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      dragging = true;
      handle.setPointerCapture(e.pointerId);
      startMouseX = e.clientX;
      startMouseY = e.clientY;
      const wrapRect = this.wrapper.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      startLeft = frameRect.left - wrapRect.left;
      startTop  = frameRect.top  - wrapRect.top;
      // Switch to top/left positioning so dragging works regardless of
      // whether we started with a bottom/right anchor.
      frame.style.left   = `${startLeft}px`;
      frame.style.top    = `${startTop}px`;
      frame.style.bottom = '';
      frame.style.right  = '';
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startMouseX;
      const dy = e.clientY - startMouseY;
      // Clamp within wrapper so the user can't lose it off-screen.
      const wrapRect = this.wrapper.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      const maxLeft = wrapRect.width  - frameRect.width;
      const maxTop  = wrapRect.height - frameRect.height;
      const nextLeft = Math.max(0, Math.min(maxLeft, startLeft + dx));
      const nextTop  = Math.max(0, Math.min(maxTop,  startTop  + dy));
      frame.style.left = `${nextLeft}px`;
      frame.style.top  = `${nextTop}px`;
    });
    handle.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      const left = parseFloat(frame.style.left || '0');
      const top  = parseFloat(frame.style.top  || '0');
      this._savePosition({ x: left, y: top });
    });
    handle.addEventListener('pointercancel', () => { dragging = false; });
  }

  // ─── Storage ─────────────────────────────────────────────────────────────

  private _loadPosition(): PersistedPosition | null {
    try {
      const raw = localStorage.getItem(STORAGE_POSITION);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedPosition;
      if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
      return parsed;
    } catch { return null; }
  }

  private _savePosition(pos: PersistedPosition): void {
    try { localStorage.setItem(STORAGE_POSITION, JSON.stringify(pos)); }
    catch { /* quota / disabled — ignore */ }
  }

  private _loadWidth(): number | null {
    try {
      const raw = localStorage.getItem(STORAGE_WIDTH);
      if (!raw) return null;
      const n = parseFloat(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch { return null; }
  }

  private _saveWidth(w: number): void {
    if (!Number.isFinite(w) || w <= 0) return;
    try { localStorage.setItem(STORAGE_WIDTH, String(w)); }
    catch { /* quota / disabled — ignore */ }
  }
}
