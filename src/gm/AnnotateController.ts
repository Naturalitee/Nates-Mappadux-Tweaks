import type { AnnotateState, AnnotateStroke, ProgressClock, AnnotateTimer } from '../types.ts';
import { ClocksLayer } from '../annotate/ClocksLayer.ts';
import { WhiteboardLayer } from '../annotate/WhiteboardLayer.ts';
import { TimersLayer } from '../annotate/TimersLayer.ts';
import { emptyAnnotateState, loadAnnotateState, saveAnnotateState, makeClock, makeTimer } from '../annotate/annotateState.ts';
import { generateId } from '../utils/id.ts';

export interface AnnotateControllerCallbacks {
  /** Push the current clocks to viewers (empty list when muted). */
  broadcastClocks: (clocks: ProgressClock[]) => void;
  /** Push the current timers to viewers (empty list when muted). */
  broadcastTimers: (timers: AnnotateTimer[]) => void;
  /** Append one whiteboard stroke to viewers. */
  broadcastStroke: (stroke: AnnotateStroke) => void;
  /** Clear the whiteboard on viewers (also the first step of a resync). */
  broadcastClear: () => void;
}

export interface AnnotateControllerOpts {
  clocksRoot: HTMLElement;
  timersRoot: HTMLElement;
  whiteboardCanvas: HTMLCanvasElement;
  project: (x: number, y: number) => { x: number; y: number } | null;
  unproject: (clientX: number, clientY: number) => { x: number; y: number } | null;
}

/** Preset clock colours — red danger, amber, green racing, cyan, violet, white. */
const CLOCK_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#a855f7', '#e5e7eb'];
/** Whiteboard pen palette. */
const PEN_COLORS = ['#fde047', '#ef4444', '#22c55e', '#06b6d4', '#ffffff', '#111827'];
const PEN_WIDTH = 3;
/** Min screen-px travel before a new point is recorded (downsample). */
const SAMPLE_DIST = 2.5;

/**
 * AnnotateController (v2.16.77) — GM-side owner of the per-map annotation
 * layer: Blades-style progress clocks + a freehand whiteboard. Holds the
 * active map's state, renders the interactive layers, drives the panel,
 * persists per map, and broadcasts to players + projector. A global mute
 * hides everything on every surface (GM included) without deleting it.
 */
export class AnnotateController {
  private mapId: string | null = null;
  private state: AnnotateState = emptyAnnotateState();
  private muted = false;
  private clocksLayer: ClocksLayer;
  private timersLayer: TimersLayer;
  private board: WhiteboardLayer;
  private _clockColor = CLOCK_COLORS[0]!;
  private _timerColor = CLOCK_COLORS[1]!;
  private _penColor = PEN_COLORS[0]!;
  private _drawing = false;
  private canvas: HTMLCanvasElement;

  constructor(private opts: AnnotateControllerOpts, private cb: AnnotateControllerCallbacks) {
    this.canvas = opts.whiteboardCanvas;
    this.clocksLayer = new ClocksLayer(opts.clocksRoot, true, {
      onSetFilled: (id, filled) => this._mutate((s) => ({
        ...s,
        clocks: s.clocks.map((c) => c.id === id ? { ...c, filled: Math.max(0, Math.min(c.segments, filled)) } : c),
      })),
      onMove: (id, x, y) => this._mutate((s) => ({ ...s, clocks: s.clocks.map((c) => c.id === id ? { ...c, x, y } : c) })),
      onRemove: (id) => this._mutate((s) => ({ ...s, clocks: s.clocks.filter((c) => c.id !== id) })),
    });
    this.timersLayer = new TimersLayer(opts.timersRoot, true, {
      onToggle: (id) => this._mutate((s) => ({ ...s, timers: s.timers.map((t) => t.id === id ? this._toggleTimer(t) : t) })),
      onReset:  (id) => this._mutate((s) => ({ ...s, timers: s.timers.map((t) => t.id === id ? { ...t, running: false, startedAt: 0, baseElapsedMs: 0 } : t) })),
      onMove:   (id, x, y) => this._mutate((s) => ({ ...s, timers: s.timers.map((t) => t.id === id ? { ...t, x, y } : t) })),
      onRemove: (id) => this._mutate((s) => ({ ...s, timers: s.timers.filter((t) => t.id !== id) })),
    });
    this.board = new WhiteboardLayer(this.canvas, opts.project);
    this._bindPanel();
    this._bindDrawing();
  }

  /** Arm / disarm whiteboard draw mode (canvas takes pointer events). */
  private _setDrawing(on: boolean): void {
    this._drawing = on;
    document.getElementById('annotate-draw-toggle')?.classList.toggle('is-active', on);
    this.canvas.style.pointerEvents = on ? 'auto' : 'none';
    this.canvas.style.cursor = on ? 'crosshair' : '';
  }

  /** Start ↔ pause a timer, re-anchoring the absolute epoch + elapsed base. */
  private _toggleTimer(t: AnnotateTimer): AnnotateTimer {
    if (t.running) {
      return { ...t, running: false, baseElapsedMs: t.baseElapsedMs + Math.max(0, Date.now() - t.startedAt), startedAt: 0 };
    }
    return { ...t, running: true, startedAt: Date.now() };
  }

  /** Switch to a map: load its saved annotations, render, re-broadcast. */
  setMap(mapId: string | null): void {
    this.mapId = mapId;
    this.state = mapId ? loadAnnotateState(mapId) : emptyAnnotateState();
    this._renderLocal();
    this._broadcastAll();
  }

  /** Re-broadcast everything (e.g. a viewer just connected). */
  rebroadcast(): void { this._broadcastAll(); }

  /** Mute hides clocks + whiteboard everywhere, GM included. Data is kept. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this._renderLocal();
    this._broadcastAll();
  }

  // ── Panel wiring ───────────────────────────────────────────────────────────

  private _bindPanel(): void {
    this._buildSwatches('annotate-clock-colors', CLOCK_COLORS, this._clockColor, (hex) => { this._clockColor = hex; });
    this._buildSwatches('annotate-timer-colors', CLOCK_COLORS, this._timerColor, (hex) => { this._timerColor = hex; });
    // v2.16.79 — picking a pen colour auto-arms Draw mode (it's the most
    // common next action after choosing a colour).
    this._buildSwatches('annotate-pen-colors', PEN_COLORS, this._penColor, (hex) => { this._penColor = hex; this._setDrawing(true); });

    const nameEl = document.getElementById('annotate-clock-name') as HTMLInputElement | null;
    const segEl  = document.getElementById('annotate-clock-segments') as HTMLInputElement | null;
    const add = () => {
      const name = nameEl?.value.trim() || '';
      const segs = parseInt(segEl?.value || '4', 10);
      if (!name) { nameEl?.focus(); return; }
      this._mutate((s) => ({ ...s, clocks: [...s.clocks, makeClock(name, segs, this._clockColor)] }));
      if (nameEl) nameEl.value = '';
    };
    document.getElementById('annotate-add-clock')?.addEventListener('click', add);
    nameEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

    // Timer / countdown.
    const tNameEl = document.getElementById('annotate-timer-name') as HTMLInputElement | null;
    const tModeEl = document.getElementById('annotate-timer-mode') as HTMLSelectElement | null;
    const tDurEl  = document.getElementById('annotate-timer-duration') as HTMLInputElement | null;
    const addTimer = () => {
      const name = tNameEl?.value.trim() || '';
      const mode = (tModeEl?.value === 'countup' ? 'countup' : 'countdown') as 'countup' | 'countdown';
      const durMs = parseDuration(tDurEl?.value || '5:00');
      if (!name) { tNameEl?.focus(); return; }
      this._mutate((s) => ({ ...s, timers: [...s.timers, makeTimer(name, mode, durMs, this._timerColor)] }));
      if (tNameEl) tNameEl.value = '';
    };
    document.getElementById('annotate-add-timer')?.addEventListener('click', addTimer);
    tNameEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTimer(); } });
    // Duration input only matters for countdown — dim it on count-up.
    const syncDur = () => { if (tDurEl) tDurEl.disabled = tModeEl?.value === 'countup'; };
    tModeEl?.addEventListener('change', syncDur);
    syncDur();

    document.getElementById('annotate-draw-toggle')?.addEventListener('click', () => this._setDrawing(!this._drawing));

    document.getElementById('annotate-wb-clear')?.addEventListener('click', () => {
      this._mutate((s) => ({ ...s, strokes: [] }));
      this.cb.broadcastClear();
    });
  }

  private _buildSwatches(containerId: string, colors: string[], selected: string, onPick: (hex: string) => void): void {
    const host = document.getElementById(containerId);
    if (!host) return;
    host.replaceChildren();
    for (const hex of colors) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'annotate-swatch' + (hex === selected ? ' is-selected' : '');
      sw.style.background = hex;
      sw.title = hex;
      sw.addEventListener('click', () => {
        onPick(hex);
        host.querySelectorAll('.annotate-swatch').forEach((el) => el.classList.remove('is-selected'));
        sw.classList.add('is-selected');
      });
      host.appendChild(sw);
    }
  }

  // ── Whiteboard draw capture ──────────────────────────────────────────────

  private _bindDrawing(): void {
    let live: AnnotateStroke | null = null;
    let lastX = 0, lastY = 0;
    let pointerId = -1;

    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this._drawing || this.muted) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.stopPropagation();
      e.preventDefault();
      this.canvas.setPointerCapture?.(e.pointerId);
      pointerId = e.pointerId;
      const n = this.opts.unproject(e.clientX, e.clientY);
      live = { id: generateId(), color: this._penColor, width: PEN_WIDTH, points: n ? [n] : [] };
      lastX = e.clientX; lastY = e.clientY;
      this.board.setLive(live);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!live || e.pointerId !== pointerId) return;
      e.stopPropagation();
      if (Math.hypot(e.clientX - lastX, e.clientY - lastY) < SAMPLE_DIST) return;
      const n = this.opts.unproject(e.clientX, e.clientY);
      if (n) { live.points.push(n); lastX = e.clientX; lastY = e.clientY; this.board.setLive(live); }
    });
    const finish = (e: PointerEvent) => {
      if (!live || e.pointerId !== pointerId) return;
      e.stopPropagation();
      const stroke = live;
      live = null; pointerId = -1;
      this.board.setLive(null);
      if (stroke.points.length === 0) return;
      this._mutate((s) => ({ ...s, strokes: [...s.strokes, stroke] }));
      if (!this.muted) this.cb.broadcastStroke(stroke);
    };
    this.canvas.addEventListener('pointerup', finish);
    this.canvas.addEventListener('pointercancel', (e) => { if (e.pointerId === pointerId) { live = null; pointerId = -1; this.board.setLive(null); } });
  }

  // ── Core ───────────────────────────────────────────────────────────────────

  private _mutate(fn: (s: AnnotateState) => AnnotateState): void {
    this.state = fn(this.state);
    if (this.mapId) saveAnnotateState(this.mapId, this.state);
    this._renderLocal();
    // Re-broadcast the small HUD lists (clocks + timers). Strokes broadcast
    // individually at their own call sites.
    this.cb.broadcastClocks(this.muted ? [] : this.state.clocks);
    this.cb.broadcastTimers(this.muted ? [] : this.state.timers);
  }

  /** Render all layers on the GM (respecting mute). */
  private _renderLocal(): void {
    this.clocksLayer.setClocks(this.muted ? [] : this.state.clocks);
    this.timersLayer.setTimers(this.muted ? [] : this.state.timers);
    this.board.setStrokes(this.state.strokes);
    this.board.setHidden(this.muted);
  }

  /** Full resync to viewers: clocks + timers + clear-then-resend every stroke. */
  private _broadcastAll(): void {
    this.cb.broadcastClocks(this.muted ? [] : this.state.clocks);
    this.cb.broadcastTimers(this.muted ? [] : this.state.timers);
    this.cb.broadcastClear();
    if (!this.muted) for (const st of this.state.strokes) this.cb.broadcastStroke(st);
  }
}

/** Parse "mm:ss" / "h:mm:ss" / plain seconds → milliseconds. */
function parseDuration(raw: string): number {
  const s = raw.trim();
  if (!s) return 0;
  if (s.includes(':')) {
    const parts = s.split(':').map((p) => parseInt(p, 10) || 0);
    let sec = 0;
    for (const p of parts) sec = sec * 60 + p;
    return sec * 1000;
  }
  return (parseInt(s, 10) || 0) * 1000;
}
