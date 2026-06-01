import type { AnnotateState, ProgressClock } from '../types.ts';
import { ClocksLayer } from '../annotate/ClocksLayer.ts';
import { emptyAnnotateState, loadAnnotateState, saveAnnotateState, makeClock } from '../annotate/annotateState.ts';

export interface AnnotateControllerCallbacks {
  /** Push the current clocks to viewers (empty list when muted). */
  broadcastClocks: (clocks: ProgressClock[]) => void;
}

/** Preset clock colours — red danger, amber, green racing, cyan, violet,
 *  white. The GM picks one before adding a clock. */
const CLOCK_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#a855f7', '#e5e7eb'];

/**
 * AnnotateController (v2.16.76) — GM-side owner of the per-map annotation
 * layer. Slice 1: Blades-style progress clocks. Holds the active map's
 * AnnotateState, renders the interactive clocks HUD, drives the add-clock
 * form, persists per map, and broadcasts to players + projector. A global
 * "mute" switch hides the layer from players/projector (the GM still sees
 * + edits it).
 */
export class AnnotateController {
  private mapId: string | null = null;
  private state: AnnotateState = emptyAnnotateState();
  private muted = false;
  private clocksLayer: ClocksLayer;
  private _pickColor = CLOCK_COLORS[0]!;

  constructor(clocksRoot: HTMLElement, private cb: AnnotateControllerCallbacks) {
    this.clocksLayer = new ClocksLayer(clocksRoot, true, {
      onSetFilled: (id, filled) => this._mutate((s) => ({
        ...s,
        clocks: s.clocks.map((c) => c.id === id ? { ...c, filled: Math.max(0, Math.min(c.segments, filled)) } : c),
      })),
      onMove: (id, x, y) => this._mutate((s) => ({
        ...s,
        clocks: s.clocks.map((c) => c.id === id ? { ...c, x, y } : c),
      })),
      onRemove: (id) => this._mutate((s) => ({ ...s, clocks: s.clocks.filter((c) => c.id !== id) })),
    });
    this._bindPanel();
  }

  /** Switch to a map: load its saved annotations, render, re-broadcast. */
  setMap(mapId: string | null): void {
    this.mapId = mapId;
    this.state = mapId ? loadAnnotateState(mapId) : emptyAnnotateState();
    this._renderClocks();
    this._broadcast();
  }

  /** Re-broadcast the current state (e.g. a player just connected). */
  rebroadcast(): void { this._broadcast(); }

  /** Mute = hide everywhere, GM view included (Alex 2026-06-01). The
   *  per-map data is untouched; unmute brings them straight back. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this._renderClocks();
    this._broadcast();
  }

  // ── Panel wiring ───────────────────────────────────────────────────────────

  private _bindPanel(): void {
    // Colour swatches.
    const colors = document.getElementById('annotate-clock-colors');
    if (colors) {
      colors.replaceChildren();
      for (const hex of CLOCK_COLORS) {
        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'annotate-swatch' + (hex === this._pickColor ? ' is-selected' : '');
        sw.style.background = hex;
        sw.title = hex;
        sw.addEventListener('click', () => {
          this._pickColor = hex;
          colors.querySelectorAll('.annotate-swatch').forEach((el) => el.classList.remove('is-selected'));
          sw.classList.add('is-selected');
        });
        colors.appendChild(sw);
      }
    }

    const nameEl = document.getElementById('annotate-clock-name') as HTMLInputElement | null;
    const segEl  = document.getElementById('annotate-clock-segments') as HTMLInputElement | null;
    const addBtn = document.getElementById('annotate-add-clock');
    const add = () => {
      const name = nameEl?.value.trim() || '';
      const segs = parseInt(segEl?.value || '4', 10);
      if (!name) { nameEl?.focus(); return; }
      this._mutate((s) => ({ ...s, clocks: [...s.clocks, makeClock(name, segs, this._pickColor)] }));
      if (nameEl) nameEl.value = '';
    };
    addBtn?.addEventListener('click', add);
    nameEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  }

  // ── Core ───────────────────────────────────────────────────────────────────

  private _mutate(fn: (s: AnnotateState) => AnnotateState): void {
    this.state = fn(this.state);
    if (this.mapId) saveAnnotateState(this.mapId, this.state);
    this._renderClocks();
    this._broadcast();
  }

  /** Muted hides them on the GM view too. */
  private _renderClocks(): void { this.clocksLayer.setClocks(this.muted ? [] : this.state.clocks); }

  private _broadcast(): void { this.cb.broadcastClocks(this.muted ? [] : this.state.clocks); }
}
