import type { AnnotateState, ProgressClock } from '../types.ts';
import { generateId } from '../utils/id.ts';

/**
 * Per-map annotation state (v2.16.76) — Blades-style progress clocks + a
 * freehand whiteboard. Stored per mapId so each map carries its own
 * annotations and they survive a map switch + page refresh. Shared live to
 * players + projector by GMApp.
 */

const KEY_PREFIX = 'mappadux:annotate:';

export function emptyAnnotateState(): AnnotateState {
  return { clocks: [], strokes: [] };
}

export function loadAnnotateState(mapId: string): AnnotateState {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + mapId);
    if (!raw) return emptyAnnotateState();
    const p = JSON.parse(raw) as Partial<AnnotateState>;
    return {
      clocks:  Array.isArray(p.clocks)  ? p.clocks  : [],
      strokes: Array.isArray(p.strokes) ? p.strokes : [],
    };
  } catch { return emptyAnnotateState(); }
}

export function saveAnnotateState(mapId: string, state: AnnotateState): void {
  try { localStorage.setItem(KEY_PREFIX + mapId, JSON.stringify(state)); }
  catch { /* private mode / quota — best-effort */ }
}

/** Build a fresh clock. Segments clamped to a sensible 2..24. Default
 *  position is upper-centre; the GM drags it where they want. */
export function makeClock(name: string, segments: number, color: string): ProgressClock {
  return {
    id: generateId(),
    name: name.trim() || 'Clock',
    segments: Math.max(2, Math.min(24, Math.round(segments) || 4)),
    filled: 0,
    color,
    x: 0.5,
    y: 0.18,
  };
}
