/**
 * BrushController — pointer-event → stroke pipeline. Doesn't own the canvas;
 * subscribers wire it up against whichever surface they want. Emits live
 * stroke-in-progress events (for the GM to paint into the renderer in real
 * time) and a final stroke-complete event with the full smoothed point list
 * (for broadcast + persistence).
 *
 * Used by FogEditor (FoW + MapFX brush — the unified v2.12 overlay system).
 */

import type { FogVertex } from '../types.ts';

/** Chaikin smoothing pass — softens pointer-event jitter without changing
 *  the stroke's overall shape. Inlined here so the brush controller
 *  doesn't depend on the (now-defunct) strokeEngine module. */
function smoothPoints(points: FogVertex[], iterations: number = 1): FogVertex[] {
  let pts = points.slice();
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) return pts;
    const next: FogVertex[] = [];
    next.push(pts[0]!);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i]!;
      const p1 = pts[i + 1]!;
      next.push({ x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y });
      next.push({ x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y });
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
  }
  return pts;
}

export interface BrushSettings {
  /** Brush radius in normalised map units (1 = map width). */
  radius: number;
  /** 'paint' adds opacity; 'erase' subtracts. */
  mode:   'paint' | 'erase';
  /** '#rrggbb' — fill colour for the stroke. */
  color:  string;
}

export interface BrushStrokeStartHandler {
  (point: FogVertex, settings: BrushSettings): void;
}

export interface BrushStrokeContinueHandler {
  /** Called with the latest point appended. The controller has already
   *  smoothed prior points, but the latest is passed raw so the renderer
   *  can extend the live stroke without artefacts. */
  (point: FogVertex, settings: BrushSettings): void;
}

export interface BrushStrokeEndHandler {
  /** Final smoothed point list — what to broadcast / persist. */
  (points: FogVertex[], settings: BrushSettings): void;
}

export interface BrushHandlers {
  onStart?:    BrushStrokeStartHandler;
  onContinue?: BrushStrokeContinueHandler;
  onEnd?:      BrushStrokeEndHandler;
}

/** Minimum normalised-distance between sampled points so we don't record
 *  every pixel under the cursor — keeps the stroke point count bounded. */
const MIN_POINT_DIST = 0.002;

export class BrushController {
  private settings: BrushSettings = { radius: 0.05, mode: 'paint', color: '#000000' };
  private handlers: BrushHandlers = {};
  private active = false;
  private points: FogVertex[] = [];
  private lastClient: { x: number; y: number } | null = null;

  /** Map a raw pointer event into normalised 0..1 map-space coords.
   *  Caller-supplied so the controller is agnostic to whether the canvas
   *  is screen-space or wired through a camera. Receives clientX/Y. */
  private clientToMapNorm: (clientX: number, clientY: number) => FogVertex | null;

  constructor(clientToMapNorm: (clientX: number, clientY: number) => FogVertex | null) {
    this.clientToMapNorm = clientToMapNorm;
  }

  setHandlers(h: BrushHandlers): void { this.handlers = h; }
  setSettings(patch: Partial<BrushSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }
  getSettings(): BrushSettings { return { ...this.settings }; }

  /** Begin a stroke at the given client coords. Call from pointerdown. */
  begin(clientX: number, clientY: number): void {
    const p = this.clientToMapNorm(clientX, clientY);
    if (!p) return;
    this.active = true;
    this.points = [p];
    this.lastClient = { x: clientX, y: clientY };
    this.handlers.onStart?.(p, this.settings);
  }

  /** Append a point at the given client coords. Call from pointermove
   *  while a stroke is active. */
  continue(clientX: number, clientY: number): void {
    if (!this.active) return;
    if (this.lastClient) {
      const dx = clientX - this.lastClient.x;
      const dy = clientY - this.lastClient.y;
      if (Math.hypot(dx, dy) < 1) return; // <1 px move — ignore jitter
    }
    const p = this.clientToMapNorm(clientX, clientY);
    if (!p) return;
    const lastP = this.points[this.points.length - 1];
    if (lastP) {
      const dx = p.x - lastP.x;
      const dy = p.y - lastP.y;
      if (Math.hypot(dx, dy) < MIN_POINT_DIST) return;
    }
    this.points.push(p);
    this.lastClient = { x: clientX, y: clientY };
    this.handlers.onContinue?.(p, this.settings);
  }

  /** Finalise the stroke. Call from pointerup / pointercancel / pointerout. */
  end(): void {
    if (!this.active) return;
    this.active = false;
    this.lastClient = null;
    if (this.points.length > 0) {
      const smoothed = smoothPoints(this.points, 1);
      this.handlers.onEnd?.(smoothed, this.settings);
    }
    this.points = [];
  }

  /** Discard an in-progress stroke without firing onEnd. */
  cancel(): void {
    this.active = false;
    this.lastClient = null;
    this.points = [];
  }

  isActive(): boolean { return this.active; }
}
