/**
 * CanvasUndoManager — GM-canvas-scoped undo / redo.
 *
 * v2.14.108 — covers the two surfaces a GM most often regrets a click
 * on: fog / MapFX polygons and marker placements. One unified stack
 * timeline, each entry tags itself with the kind it captured so undo
 * reverts only the relevant slice of state.
 *
 * The Composite + Text Map editors maintain their own per-modal
 * stacks (cleared on close). This one runs alongside them on the
 * main GM canvas — orthogonal scope, no overlap.
 *
 * Scope kept tight for v1:
 *   - fog:     full FogState snapshot
 *   - markers: full Marker[] snapshot
 *   - Map / view / filter / transition changes NOT covered. Add later
 *     if the user finds the gap.
 *
 * Action coalescing — recordIfNewAction(kind) is called from the
 * StateManager's setFog / setMarkers BEFORE the mutation. The
 * manager debounces by kind: rapid-fire setFog calls within a single
 * brush stroke collapse to ONE undo entry capturing the state from
 * just before the stroke began. After IDLE_GAP_MS of quiet on that
 * kind, the next mutation starts a fresh undo entry.
 *
 * Stack capped at 200 entries.
 */

import type { FogState, Marker } from '../types.ts';

export type UndoSurface = 'fog' | 'markers';

interface UndoEntry {
  kind:    UndoSurface;
  fog?:    FogState;
  markers?: Marker[];
}

export interface UndoCallbacks {
  /** Read the CURRENT fog state (for snapshot). */
  getFog:     () => FogState;
  /** Apply a previous fog state on undo / redo. */
  applyFog:   (fog: FogState) => void;
  /** Read the CURRENT markers (for snapshot). */
  getMarkers: () => Marker[];
  /** Apply a previous marker list on undo / redo. */
  applyMarkers: (markers: Marker[]) => void;
  /** Called whenever the stack changes so the buttons can refresh
   *  their disabled state. */
  onChange?: () => void;
}

const IDLE_GAP_MS = 250;

export class CanvasUndoManager {
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private cb: UndoCallbacks;
  private lastTouchAt = new Map<UndoSurface, number>();
  /** Set during undo / redo apply so the StateManager hook (which
   *  fires inside applyFog / applyMarkers) doesn't record the
   *  re-application as a fresh user action. */
  private applying = false;

  constructor(callbacks: UndoCallbacks) {
    this.cb = callbacks;
  }

  /** Push the CURRENT state of `kind` to the undo stack. Clears redo
   *  (any new action invalidates the redo path). */
  push(kind: UndoSurface): void {
    const entry: UndoEntry = { kind };
    if (kind === 'fog')     entry.fog = this._deepClone(this.cb.getFog());
    else                    entry.markers = this._deepClone(this.cb.getMarkers());
    this.undoStack.push(entry);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.cb.onChange?.();
  }

  /** Hook entry point — called by StateManager BEFORE each setFog /
   *  setMarkers mutation. Coalesces rapid-fire actions on the same
   *  kind into a single undo entry by IDLE_GAP_MS. */
  recordIfNewAction(kind: UndoSurface): void {
    if (this.applying) return;
    const now = Date.now();
    const last = this.lastTouchAt.get(kind) ?? 0;
    this.lastTouchAt.set(kind, now);
    if (now - last < IDLE_GAP_MS) return;
    this.push(kind);
  }

  undo(): void {
    if (this.undoStack.length === 0) return;
    const entry = this.undoStack.pop()!;
    this.redoStack.push(this._captureCurrent(entry.kind));
    this.applying = true;
    try { this._applyEntry(entry); } finally { this.applying = false; }
    this.lastTouchAt.set(entry.kind, Date.now());
    this.cb.onChange?.();
  }

  redo(): void {
    if (this.redoStack.length === 0) return;
    const entry = this.redoStack.pop()!;
    this.undoStack.push(this._captureCurrent(entry.kind));
    this.applying = true;
    try { this._applyEntry(entry); } finally { this.applying = false; }
    this.lastTouchAt.set(entry.kind, Date.now());
    this.cb.onChange?.();
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  /** Tear down the stacks — called on map change so undo can't
   *  leak fog + markers across map switches (they'd land on the
   *  wrong map). */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastTouchAt.clear();
    this.cb.onChange?.();
  }

  private _captureCurrent(kind: UndoSurface): UndoEntry {
    const e: UndoEntry = { kind };
    if (kind === 'fog')     e.fog = this._deepClone(this.cb.getFog());
    else                    e.markers = this._deepClone(this.cb.getMarkers());
    return e;
  }

  private _applyEntry(entry: UndoEntry): void {
    if (entry.kind === 'fog' && entry.fog) this.cb.applyFog(entry.fog);
    if (entry.kind === 'markers' && entry.markers) this.cb.applyMarkers(entry.markers);
  }

  private _deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
