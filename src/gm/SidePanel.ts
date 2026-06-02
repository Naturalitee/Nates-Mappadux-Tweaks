/**
 * SidePanel — right-edge slide-out container for "configure this thing"
 * surfaces too rich for inline sidebar controls.
 *
 * Used as the home for complex param editors (Visual Filter params, MapFX
 * kind-specific params, eventually Player Voice message threads) so the
 * left sidebar stays a compact picker / launcher and the heavier work
 * happens in a focused panel that overlays the canvas without dismantling
 * the rest of the GM workspace.
 *
 * Behaviour:
 *   - Single panel at a time. Opening a new SidePanel closes any existing.
 *   - Slides in from the right; closes via the X button, outside click,
 *     or Escape.
 *   - Header (title + close), scrollable body, optional footer slot.
 *   - On narrow viewports the panel takes the full screen width and the
 *     `is-mobile` class can drive different styling (full-bleed look).
 *
 * Patterned on FxPopover.ts so the call shape is familiar:
 *   const handle = openSidePanel({ title, populate, onClose });
 *   handle.refresh();          // re-run populate on the same body
 *   handle.setTitle('New');    // update the header
 *   handle.close();            // tear down
 */

export interface SidePanelOptions {
  /** Header title shown at the top of the panel. */
  title:    string;
  /** Caller fills the body. Called once on open and again on every
   *  refresh() from the returned handle. */
  populate: (body: HTMLElement) => void;
  /** Optional close callback (fires after the DOM is removed). */
  onClose?: () => void;
  /** Optional extra CSS class on the panel root (per-call-site tweaks). */
  className?: string;
}

export interface SidePanelHandle {
  /** Close the panel + run cleanup + onClose. Idempotent. */
  close:    () => void;
  /** Re-run the populate callback against the same body. */
  refresh:  () => void;
  /** Update the header title without rebuilding the panel. */
  setTitle: (title: string) => void;
  /** True until close() has run. Useful for stale-handle guards. */
  readonly isOpen: boolean;
}

/** Single live panel — the framework guarantees at most one at a time so
 *  consumers don't end up with stacked overlapping panels fighting over
 *  focus / outside-click. Opening a new panel closes this one first. */
let activeHandle: SidePanelHandle | null = null;

export function openSidePanel(opts: SidePanelOptions): SidePanelHandle {
  // Close any existing panel before opening the new one. Keeps the
  // "one at a time" invariant simple — no stack, no z-index dance.
  activeHandle?.close();

  const root = document.createElement('aside');
  root.className = 'side-panel' + (opts.className ? ` ${opts.className}` : '');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');

  const header = document.createElement('header');
  header.className = 'side-panel__header';
  const titleEl = document.createElement('h2');
  titleEl.className = 'side-panel__title';
  titleEl.textContent = opts.title;
  header.appendChild(titleEl);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'side-panel__close';
  closeBtn.setAttribute('aria-label', 'Close panel');
  closeBtn.title = 'Close (Esc)';
  closeBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
    '</svg>';
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'side-panel__body';

  root.appendChild(header);
  root.appendChild(body);

  // Mobile breakpoint — full-bleed at narrow widths. Re-evaluated on
  // resize so a window drag across the breakpoint flips classes live.
  const MOBILE_BREAKPOINT_PX = 720;
  const applyResponsive = () => {
    root.classList.toggle('side-panel--mobile', window.innerWidth < MOBILE_BREAKPOINT_PX);
  };
  applyResponsive();
  window.addEventListener('resize', applyResponsive);

  document.body.appendChild(root);

  // Initial render. We populate AFTER the DOM is in place so callers
  // can measure their own elements during populate if they need to.
  opts.populate(body);

  // Slide in on the next frame — appending + animating in the same
  // tick skips the transition (the browser hasn't laid the element
  // out at the start state yet).
  requestAnimationFrame(() => { root.classList.add('is-open'); });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', onDocClick, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', applyResponsive);
    root.classList.remove('is-open');
    // Wait for the slide-out transition before tearing down the DOM.
    // 240 ms covers the 220 ms CSS transition + a frame of slack.
    setTimeout(() => { root.remove(); }, 240);
    if (activeHandle === handle) activeHandle = null;
    opts.onClose?.();
  };
  // Capture-phase pointerdown so we see EVERY click before any
  // descendant (the canvas-wrapper's attachGestures, marker editor,
  // fog editor, etc.) gets a chance to stopPropagation. Matches what
  // the rest of the GM's input pipeline uses — bubbling `mousedown`
  // missed clicks on the canvas occasionally because the gesture
  // handlers downstream sometimes consume the event flow.
  const onDocClick = (ev: PointerEvent) => {
    if (root.contains(ev.target as Node)) return;
    // Sidebar-content clicks shouldn't dismiss — the GM is steering
    // the panel from there (e.g. picked a different filter id). Keep
    // the panel alive; the caller can refresh it via the handle.
    const t = ev.target as HTMLElement | null;
    if (t?.closest('#sidebar')) return;
    close();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') close();
  };
  closeBtn.addEventListener('click', close);

  // Defer one tick so the pointerdown that opened the panel doesn't
  // immediately close it via the off-click handler.
  setTimeout(() => {
    if (closed) return;
    document.addEventListener('pointerdown', onDocClick, true);
    document.addEventListener('keydown', onKey);
  }, 0);

  const refresh = () => {
    if (closed) return;
    body.innerHTML = '';
    opts.populate(body);
  };
  const setTitle = (next: string) => {
    if (closed) return;
    titleEl.textContent = next;
  };

  const handle: SidePanelHandle = {
    close,
    refresh,
    setTitle,
    get isOpen() { return !closed; },
  };
  activeHandle = handle;
  return handle;
}

/** Close any currently-open SidePanel. Safe to call when none is open. */
export function closeAnySidePanel(): void {
  activeHandle?.close();
}
