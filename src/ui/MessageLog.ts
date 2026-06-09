import { copyText } from '../utils/copyText.ts';

export type MessageLevel = 'ok' | 'warn' | 'error';

interface LogEntry {
  text: string;
  level: MessageLevel;
  ts: number;
}

/**
 * v2.17.20 — Quiet activity log.
 *
 * Connection / status chatter ("Connecting…", "Ready", "Reconnecting…",
 * "P2P error: …") used to be slammed onto a visible bar that floated over the
 * GM sidebar and the player canvas — great for debugging, rubbish for play,
 * since it parked itself on top of panels mid-session.
 *
 * This replaces that with a small unobtrusive (i) button that lives in a
 * corner. Messages are kept in a short ring buffer; the icon twinkles (and a
 * coloured dot appears) when a new one lands, so it's noticeable without ever
 * covering anything. Clicking it shows the last handful of messages with
 * timestamps and a one-tap copy-to-clipboard — so a player or GM can grab the
 * log for a Discord bug report without it ever interrupting the game.
 *
 * Self-contained: builds its own button + popover DOM. The button is appended
 * into a host element (e.g. the GM footer row); the popover is parented to
 * <body> and positioned on open so it is never clipped by an overflow:auto
 * sidebar.
 */
export class MessageLog {
  private readonly root: HTMLElement;
  private readonly btn: HTMLButtonElement;
  private readonly dot: HTMLElement;
  private readonly pop: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly entries: LogEntry[] = [];
  private readonly max: number;
  private open = false;
  private blinkTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly showButton: boolean;

  /**
   * @param host    element the (i) button is appended into.
   * @param opts.max number of messages to retain (default 8 — "half a dozen"+).
   * @param opts.title heading shown above the list.
   * @param opts.showButton v2.17.21 — when false, no visible (i) is rendered
   *   and nothing twinkles; the log is opened on demand via open() (the player
   *   view wires this to a right-click "Show activity" entry, so the corner
   *   indicator never distracts during play).
   */
  constructor(host: HTMLElement, opts?: { max?: number; title?: string; showButton?: boolean }) {
    this.max = opts?.max ?? 8;
    this.showButton = opts?.showButton ?? true;

    this.root = document.createElement('div');
    this.root.className = 'msglog';

    this.btn = document.createElement('button');
    this.btn.type = 'button';
    this.btn.className = 'msglog__btn';
    this.btn.title = 'Activity log — connection messages';
    this.btn.setAttribute('aria-expanded', 'false');
    this.btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

    this.dot = document.createElement('span');
    this.dot.className = 'msglog__dot';
    this.dot.hidden = true;
    this.btn.appendChild(this.dot);

    this.root.appendChild(this.btn);
    if (this.showButton) host.appendChild(this.root);

    // Popover lives on <body> so an overflow:auto sidebar can't clip it.
    this.pop = document.createElement('div');
    this.pop.className = 'msglog__pop';
    this.pop.hidden = true;
    this.pop.innerHTML =
      '<div class="msglog__head">' +
      `<span class="msglog__title">${opts?.title ?? 'Activity'}</span>` +
      '<button type="button" class="msglog__copy" title="Copy log to clipboard">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="9" y="9" width="11" height="11" rx="2"/>' +
      '<path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg></button>' +
      '</div><ul class="msglog__list"></ul>';
    document.body.appendChild(this.pop);
    this.listEl = this.pop.querySelector('.msglog__list')!;

    this.btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    this.pop.querySelector('.msglog__copy')!.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.copyAll(e.currentTarget as HTMLElement);
    });
    // Click-away + Escape close.
    document.addEventListener('pointerdown', (e) => {
      if (!this.open) return;
      const t = e.target as Node;
      if (!this.pop.contains(t) && !this.root.contains(t)) this.close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.open) this.close(); });
  }

  /** Record a message. Empty / whitespace strings are ignored (used as "clear"). */
  push(text: string, level: MessageLevel = 'ok'): void {
    const msg = (text ?? '').trim();
    if (!msg) return;
    // Collapse immediate duplicates (e.g. repeated "Reconnecting…" ticks) so the
    // log stays readable — bump the timestamp instead of stacking copies.
    const last = this.entries[this.entries.length - 1];
    if (last && last.text === msg && last.level === level) {
      last.ts = Date.now();
    } else {
      this.entries.push({ text: msg, level, ts: Date.now() });
      while (this.entries.length > this.max) this.entries.shift();
    }
    this.blink(level);
    if (this.open) this.render();
  }

  private blink(level: MessageLevel): void {
    if (!this.showButton) return; // no visible indicator — opened on demand
    this.dot.hidden = false;
    this.dot.dataset['level'] = level;
    this.btn.classList.remove('msglog__btn--blink');
    // Force reflow so re-adding the class re-triggers the animation.
    void this.btn.offsetWidth;
    this.btn.classList.add('msglog__btn--blink');
    if (this.blinkTimer) clearTimeout(this.blinkTimer);
    this.blinkTimer = setTimeout(() => this.btn.classList.remove('msglog__btn--blink'), 1400);
  }

  private toggle(): void { this.open ? this.close() : this.openPop(); }

  /** Open the log on demand. `anchor` (viewport coords) positions the popover
   *  near a click point — used by the player's right-click "Show activity"
   *  entry; omit it to anchor above the (i) button (GM footer). */
  openPop(anchor?: { x: number; y: number }): void {
    this.render();
    this.pop.hidden = false;
    this.open = true;
    this.btn.setAttribute('aria-expanded', 'true');
    this.dot.hidden = true; // mark read
    this.position(anchor);
  }

  /** Public alias — open from an external trigger (e.g. a context-menu item). */
  show(anchor?: { x: number; y: number }): void { this.openPop(anchor); }

  close(): void {
    this.pop.hidden = true;
    this.open = false;
    this.btn.setAttribute('aria-expanded', 'false');
  }

  /** Position the popover: near `anchor` if given, else just above the button. */
  private position(anchor?: { x: number; y: number }): void {
    const pr = this.pop.getBoundingClientRect();
    const margin = 8;
    if (anchor) {
      const left = Math.min(anchor.x, window.innerWidth - pr.width - margin);
      const top = Math.min(anchor.y, window.innerHeight - pr.height - margin);
      this.pop.style.left = `${Math.max(margin, Math.round(left))}px`;
      this.pop.style.top = `${Math.max(margin, Math.round(top))}px`;
      this.pop.style.bottom = 'auto';
      return;
    }
    const r = this.btn.getBoundingClientRect();
    let left = r.left;
    if (left + pr.width > window.innerWidth - margin) left = window.innerWidth - pr.width - margin;
    if (left < margin) left = margin;
    this.pop.style.left = `${Math.round(left)}px`;
    this.pop.style.top = 'auto';
    // Open upward off the button's top edge.
    this.pop.style.bottom = `${Math.round(window.innerHeight - r.top + margin)}px`;
  }

  private render(): void {
    if (!this.entries.length) {
      this.listEl.innerHTML = '<li class="msglog__empty">No messages yet.</li>';
      return;
    }
    const rows = this.entries
      .slice()
      .reverse()
      .map((e) => {
        const li = document.createElement('li');
        li.className = 'msglog__item';
        li.dataset['level'] = e.level;
        const time = document.createElement('span');
        time.className = 'msglog__time';
        time.textContent = this.fmtTime(e.ts);
        const txt = document.createElement('span');
        txt.className = 'msglog__text';
        txt.textContent = e.text;
        li.appendChild(time);
        li.appendChild(txt);
        return li;
      });
    this.listEl.replaceChildren(...rows);
  }

  private fmtTime(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  private async copyAll(btn: HTMLElement): Promise<void> {
    const text = this.entries
      .map((e) => `[${this.fmtTime(e.ts)}] ${e.text}`)
      .join('\n');
    const ok = await copyText(text || '(no messages)');
    btn.classList.toggle('msglog__copy--done', ok);
    setTimeout(() => btn.classList.remove('msglog__copy--done'), 1200);
  }
}
