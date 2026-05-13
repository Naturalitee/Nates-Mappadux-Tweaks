/**
 * BrushController — pointer-event → stroke pipeline. Doesn't own the canvas;
 * subscribers wire it up against whichever surface they want. Emits live
 * stroke-in-progress events (for the GM to paint into the renderer in real
 * time) and a final stroke-complete event with the full smoothed point list
 * (for broadcast + persistence).
 *
 * Used by FogEditor (FoW brush mode) and MapFXEditor (paint mode).
 */

import type { FogVertex } from '../types.ts';
import { smoothPoints } from './strokeEngine.ts';

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
