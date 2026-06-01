import type { AnnotateStroke } from '../types.ts';

type Project = (x: number, y: number) => { x: number; y: number } | null;

/**
 * WhiteboardLayer (v2.16.77) — renders freehand strokes onto a canvas that
 * overlays the map. Strokes are stored in normalised map coords (0..1); a
 * RAF loop reprojects them every frame so the drawing stays glued to the
 * map as it pans / zooms (same self-driving approach as PingLayer). The
 * SAME class is used read-only on player / projector and as the render
 * surface for the GM (the GM's draw capture lives in AnnotateController).
 */
export class WhiteboardLayer {
  private strokes: AnnotateStroke[] = [];
  private live: AnnotateStroke | null = null;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private _hidden = false;

  constructor(private canvas: HTMLCanvasElement, private project: Project) {
    this.ctx = canvas.getContext('2d')!;
    const loop = () => { this._draw(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  setStrokes(strokes: AnnotateStroke[]): void { this.strokes = strokes; }
  addStroke(stroke: AnnotateStroke): void { this.strokes = [...this.strokes, stroke]; }
  clear(): void { this.strokes = []; this.live = null; }
  /** The GM's in-progress stroke, shown live while drawing. */
  setLive(stroke: AnnotateStroke | null): void { this.live = stroke; }
  /** Hide/show without losing the strokes (drives the mute + the hidden attr). */
  setHidden(hidden: boolean): void { this._hidden = hidden; }

  destroy(): void { cancelAnimationFrame(this.raf); }

  private _draw(): void {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, c.width, c.height);
    if (this._hidden) return;
    const all = this.live ? [...this.strokes, this.live] : this.strokes;
    for (const st of all) this._drawStroke(st, dpr);
  }

  private _drawStroke(st: AnnotateStroke, dpr: number): void {
    if (st.points.length === 0) return;
    const ctx = this.ctx;
    ctx.strokeStyle = st.color;
    ctx.lineWidth = Math.max(1, st.width) * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    for (const p of st.points) {
      const s = this.project(p.x, p.y);
      if (!s) { started = false; continue; }  // point off-screen; break the line
      const px = s.x * dpr, py = s.y * dpr;
      if (!started) { ctx.moveTo(px, py); started = true; }
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // A single dot (tap) — draw a round cap so it's visible.
    if (st.points.length === 1) {
      const s = this.project(st.points[0]!.x, st.points[0]!.y);
      if (s) {
        ctx.fillStyle = st.color;
        ctx.beginPath();
        ctx.arc(s.x * dpr, s.y * dpr, (Math.max(1, st.width) * dpr) / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
