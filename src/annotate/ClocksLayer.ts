import type { ProgressClock } from '../types.ts';

export interface ClocksLayerCallbacks {
  /** GM set the filled-wedge count for a clock (click on a wedge). */
  onSetFilled?: (id: string, filled: number) => void;
  /** GM dragged a clock to a new fractional position (0..1). */
  onMove?: (id: string, x: number, y: number) => void;
  /** GM removed a clock. */
  onRemove?: (id: string) => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * ClocksLayer (v2.16.76) — renders the Blades-in-the-Dark progress clocks
 * as draggable HUD elements. The SAME class drives the GM (interactive:
 * click a wedge to fill/unfill, drag to move, × to remove) and the player /
 * projector views (read-only mirror). Positions are fractional (0..1 of the
 * container) so a clock lands in the same relative spot on every surface.
 */
export class ClocksLayer {
  private clocks: ProgressClock[] = [];

  constructor(
    private root: HTMLElement,
    private interactive: boolean,
    private cb: ClocksLayerCallbacks = {},
  ) {
    this._render();
  }

  setClocks(clocks: ProgressClock[]): void {
    this.clocks = clocks;
    this._render();
  }

  private _render(): void {
    this.root.replaceChildren();
    this.root.classList.toggle('is-interactive', this.interactive);
    for (const c of this.clocks) this.root.appendChild(this._renderClock(c));
  }

  private _renderClock(c: ProgressClock): HTMLElement {
    const el = document.createElement('div');
    el.className = 'clock';
    el.style.left = `${c.x * 100}%`;
    el.style.top  = `${c.y * 100}%`;
    el.style.setProperty('--clock-color', c.color);

    // Header — name + (× remove on GM). Doubles as the drag handle.
    const head = document.createElement('div');
    head.className = 'clock-head';
    const name = document.createElement('span');
    name.className = 'clock-name';
    name.textContent = c.name;
    head.appendChild(name);
    if (this.interactive) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'clock-del';
      del.textContent = '×';
      del.title = 'Remove clock';
      del.addEventListener('pointerdown', (e) => e.stopPropagation());
      del.addEventListener('click', (e) => { e.stopPropagation(); this.cb.onRemove?.(c.id); });
      head.appendChild(del);
    }
    el.appendChild(head);

    // The segmented dial.
    el.appendChild(this._renderDial(c));

    // Count read-out.
    const count = document.createElement('div');
    count.className = 'clock-count';
    count.textContent = `${c.filled}/${c.segments}`;
    el.appendChild(count);

    if (this.interactive) this._makeDraggable(el, head, c);
    return el;
  }

  private _renderDial(c: ProgressClock): SVGSVGElement {
    const SIZE = 92, cx = SIZE / 2, cy = SIZE / 2, r = SIZE / 2 - 4;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'clock-dial');
    svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
    svg.setAttribute('width', String(SIZE));
    svg.setAttribute('height', String(SIZE));

    for (let i = 0; i < c.segments; i++) {
      const a0 = (-90 + (360 / c.segments) * i) * (Math.PI / 180);
      const a1 = (-90 + (360 / c.segments) * (i + 1)) * (Math.PI / 180);
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const large = (360 / c.segments) > 180 ? 1 : 0;
      const wedge = document.createElementNS(SVG_NS, 'path');
      wedge.setAttribute('d', `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`);
      wedge.setAttribute('class', 'clock-wedge' + (i < c.filled ? ' is-filled' : ''));
      if (this.interactive) {
        wedge.style.cursor = 'pointer';
        wedge.addEventListener('click', (e) => {
          e.stopPropagation();
          // Click a wedge to fill up to + including it; click the topmost
          // filled wedge again to unfill back to it.
          const next = (c.filled === i + 1) ? i : i + 1;
          this.cb.onSetFilled?.(c.id, next);
        });
      }
      svg.appendChild(wedge);
    }
    return svg;
  }

  /** Drag a clock by its header. Position is committed as a fraction of the
   *  container on release. */
  private _makeDraggable(el: HTMLElement, handle: HTMLElement, c: ProgressClock): void {
    handle.style.cursor = 'grab';
    handle.style.touchAction = 'none';
    let start: { px: number; py: number; left: number; top: number } | null = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.stopPropagation(); // don't let the GM canvas pan underneath
      const rect = this.root.getBoundingClientRect();
      start = { px: e.clientX, py: e.clientY, left: c.x * rect.width, top: c.y * rect.height };
      handle.setPointerCapture?.(e.pointerId);
      handle.style.cursor = 'grabbing';
    });
    handle.addEventListener('pointermove', (e) => {
      if (!start) return;
      const rect = this.root.getBoundingClientRect();
      const nx = (start.left + (e.clientX - start.px)) / rect.width;
      const ny = (start.top  + (e.clientY - start.py)) / rect.height;
      el.style.left = `${Math.max(0, Math.min(1, nx)) * 100}%`;
      el.style.top  = `${Math.max(0, Math.min(1, ny)) * 100}%`;
    });
    const end = (e: PointerEvent) => {
      if (!start) return;
      const rect = this.root.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (start.left + (e.clientX - start.px)) / rect.width));
      const ny = Math.max(0, Math.min(1, (start.top  + (e.clientY - start.py)) / rect.height));
      start = null;
      handle.style.cursor = 'grab';
      this.cb.onMove?.(c.id, nx, ny);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', () => { start = null; handle.style.cursor = 'grab'; });
  }
}
