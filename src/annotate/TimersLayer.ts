import type { AnnotateTimer } from '../types.ts';
import { AnchoredLayer, type AnchoredOpts } from './AnchoredLayer.ts';

export interface TimersLayerCallbacks {
  onToggle?: (id: string) => void;
  onReset?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onResize?: (id: string, w: number, h: number) => void;
  onRotate?: (id: string, rot: number) => void;
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
 * TimersLayer (v2.16.82) — map-anchored real-time timer / countdown overlays.
 * Extends AnchoredLayer for projection + chrome. Running state lives in
 * absolute epoch anchors, so a local 250ms tick recomputes the display with
 * no per-second broadcast. Interactive on the GM; read-only mirror elsewhere.
 */
export class TimersLayer extends AnchoredLayer<AnnotateTimer> {
  private _onToggle: ((id: string) => void) | undefined;
  private _onReset: ((id: string) => void) | undefined;
  private timeEls = new Map<string, HTMLElement>();
  private tick: ReturnType<typeof setInterval>;

  constructor(root: HTMLElement, interactive: boolean, opts: AnchoredOpts, cb: TimersLayerCallbacks = {}) {
    super(root, interactive, { ...opts, aspectLock: true }, { onMove: cb.onMove, onResize: cb.onResize, onRotate: cb.onRotate, onRemove: cb.onRemove });
    this._onToggle = cb.onToggle;
    this._onReset = cb.onReset;
    this.tick = setInterval(() => this._tick(), 250);
  }

  setTimers(timers: AnnotateTimer[]): void { this.setObjects(timers); }

  override destroy(): void { clearInterval(this.tick); super.destroy(); }

  protected objClass(t: AnnotateTimer): string { return 'a-timer' + (t.mode === 'countdown' ? ' is-countdown' : ''); }
  protected objColor(t: AnnotateTimer): string { return t.color; }

  private _tick(): void {
    for (const t of this.objects) {
      const el = this.timeEls.get(t.id);
      if (!el) continue;
      const ms = timerDisplayMs(t);
      el.textContent = fmt(ms);
      el.closest('.a-timer')?.classList.toggle('is-done', t.mode === 'countdown' && ms === 0);
    }
  }

  protected renderContent(t: AnnotateTimer, content: HTMLElement): void {
    content.style.setProperty('--timer-color', t.color);

    const head = document.createElement('div');
    head.className = 'a-timer-head';
    const name = document.createElement('span');
    name.className = 'a-timer-name';
    name.textContent = t.name;
    head.appendChild(name);
    content.appendChild(head);

    const time = document.createElement('div');
    time.className = 'a-timer-time';
    time.textContent = fmt(timerDisplayMs(t));
    content.appendChild(time);
    this.timeEls.set(t.id, time);

    if (this.interactive) {
      const ctrls = document.createElement('div');
      ctrls.className = 'a-timer-ctrls';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'a-timer-btn';
      toggle.textContent = t.running ? '❚❚' : '▶';
      toggle.title = t.running ? 'Pause' : 'Start';
      toggle.addEventListener('pointerdown', (e) => e.stopPropagation());
      toggle.addEventListener('click', (e) => { e.stopPropagation(); this._onToggle?.(t.id); });
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'a-timer-btn';
      reset.textContent = '↺';
      reset.title = 'Reset';
      reset.addEventListener('pointerdown', (e) => e.stopPropagation());
      reset.addEventListener('click', (e) => { e.stopPropagation(); this._onReset?.(t.id); });
      ctrls.append(toggle, reset);
      content.appendChild(ctrls);
    }
  }
}
