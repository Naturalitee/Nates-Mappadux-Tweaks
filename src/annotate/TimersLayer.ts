import type { AnnotateTimer } from '../types.ts';

export interface TimersLayerCallbacks {
  /** Start / pause toggle. */
  onToggle?: (id: string) => void;
  /** Reset to full (countdown) / zero (count-up), paused. */
  onReset?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onRemove?: (id: string) => void;
}

/** Elapsed ms for a timer right now. */
export function timerElapsed(t: AnnotateTimer): number {
  return t.baseElapsedMs + (t.running ? Math.max(0, Date.now() - t.startedAt) : 0);
}

/** The number a timer should display (ms): count-up shows elapsed,
 *  countdown shows remaining (floored at 0). */
export function timerDisplayMs(t: AnnotateTimer): number {
  const e = timerElapsed(t);
  return t.mode === 'countdown' ? Math.max(0, t.durationMs - e) : e;
}

function fmt(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * TimersLayer (v2.16.78) — draggable real-time timer / countdown overlays.
 * Running state lives in absolute epoch anchors, so this layer just ticks
 * locally (250ms) and recomputes the display — no per-second broadcast.
 * Interactive on the GM (start/pause, reset, ×, drag); read-only mirror on
 * player / projector.
 */
export class TimersLayer {
  private timers: AnnotateTimer[] = [];
  private timeEls = new Map<string, HTMLElement>();
  private tick: ReturnType<typeof setInterval>;

  constructor(
    private root: HTMLElement,
    private interactive: boolean,
    private cb: TimersLayerCallbacks = {},
  ) {
    this._render();
    this.tick = setInterval(() => this._tick(), 250);
  }

  setTimers(timers: AnnotateTimer[]): void {
    this.timers = timers;
    this._render();
  }

  destroy(): void { clearInterval(this.tick); }

  private _tick(): void {
    for (const t of this.timers) {
      const el = this.timeEls.get(t.id);
      if (!el) continue;
      const ms = timerDisplayMs(t);
      el.textContent = fmt(ms);
      el.parentElement?.classList.toggle('is-done', t.mode === 'countdown' && ms === 0);
    }
  }

  private _render(): void {
    this.root.replaceChildren();
    this.timeEls.clear();
    this.root.classList.toggle('is-interactive', this.interactive);
    for (const t of this.timers) this.root.appendChild(this._renderTimer(t));
  }

  private _renderTimer(t: AnnotateTimer): HTMLElement {
    const el = document.createElement('div');
    el.className = 'a-timer' + (t.mode === 'countdown' ? ' is-countdown' : '');
    el.style.left = `${t.x * 100}%`;
    el.style.top  = `${t.y * 100}%`;
    el.style.setProperty('--timer-color', t.color);

    const head = document.createElement('div');
    head.className = 'a-timer-head';
    const name = document.createElement('span');
    name.className = 'a-timer-name';
    name.textContent = t.name;
    head.appendChild(name);
    if (this.interactive) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'a-timer-del';
      del.textContent = '×';
      del.title = 'Remove timer';
      del.addEventListener('pointerdown', (e) => e.stopPropagation());
      del.addEventListener('click', (e) => { e.stopPropagation(); this.cb.onRemove?.(t.id); });
      head.appendChild(del);
    }
    el.appendChild(head);

    const time = document.createElement('div');
    time.className = 'a-timer-time';
    time.textContent = fmt(timerDisplayMs(t));
    el.appendChild(time);
    this.timeEls.set(t.id, time);
    if (t.mode === 'countdown' && timerDisplayMs(t) === 0) el.classList.add('is-done');

    if (this.interactive) {
      const ctrls = document.createElement('div');
      ctrls.className = 'a-timer-ctrls';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'a-timer-btn';
      toggle.textContent = t.running ? '❚❚' : '▶';
      toggle.title = t.running ? 'Pause' : 'Start';
      toggle.addEventListener('pointerdown', (e) => e.stopPropagation());
      toggle.addEventListener('click', (e) => { e.stopPropagation(); this.cb.onToggle?.(t.id); });
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'a-timer-btn';
      reset.textContent = '↺';
      reset.title = 'Reset';
      reset.addEventListener('pointerdown', (e) => e.stopPropagation());
      reset.addEventListener('click', (e) => { e.stopPropagation(); this.cb.onReset?.(t.id); });
      ctrls.append(toggle, reset);
      el.appendChild(ctrls);
      this._makeDraggable(el, head, t);
    }
    return el;
  }

  private _makeDraggable(el: HTMLElement, handle: HTMLElement, t: AnnotateTimer): void {
    handle.style.cursor = 'grab';
    handle.style.touchAction = 'none';
    let start: { px: number; py: number; left: number; top: number } | null = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const rect = this.root.getBoundingClientRect();
      start = { px: e.clientX, py: e.clientY, left: t.x * rect.width, top: t.y * rect.height };
      handle.setPointerCapture?.(e.pointerId);
      handle.style.cursor = 'grabbing';
    });
    handle.addEventListener('pointermove', (e) => {
      if (!start) return;
      const rect = this.root.getBoundingClientRect();
      el.style.left = `${Math.max(0, Math.min(1, (start.left + (e.clientX - start.px)) / rect.width)) * 100}%`;
      el.style.top  = `${Math.max(0, Math.min(1, (start.top  + (e.clientY - start.py)) / rect.height)) * 100}%`;
    });
    handle.addEventListener('pointerup', (e) => {
      if (!start) return;
      const rect = this.root.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (start.left + (e.clientX - start.px)) / rect.width));
      const ny = Math.max(0, Math.min(1, (start.top  + (e.clientY - start.py)) / rect.height));
      start = null;
      handle.style.cursor = 'grab';
      this.cb.onMove?.(t.id, nx, ny);
    });
    handle.addEventListener('pointercancel', () => { start = null; handle.style.cursor = 'grab'; });
  }
}
