import type { ProgressClock } from '../types.ts';
import { AnchoredLayer, type AnchoredOpts } from './AnchoredLayer.ts';

export interface ClocksLayerCallbacks {
  onSetFilled?: (id: string, filled: number) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onResize?: (id: string, w: number, h: number) => void;
  onRotate?: (id: string, rot: number) => void;
  onRemove?: (id: string) => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * ClocksLayer (v2.16.82) — map-anchored Blades progress clocks. Extends
 * AnchoredLayer for projection + the move/resize/delete chrome; renders the
 * segmented dial as the type-specific face. Click a wedge to fill / unfill.
 */
export class ClocksLayer extends AnchoredLayer<ProgressClock> {
  private _onSetFilled: ((id: string, filled: number) => void) | undefined;

  constructor(root: HTMLElement, interactive: boolean, opts: AnchoredOpts, cb: ClocksLayerCallbacks = {}) {
    super(root, interactive, { ...opts, aspectLock: true }, { onMove: cb.onMove, onResize: cb.onResize, onRotate: cb.onRotate, onRemove: cb.onRemove });
    this._onSetFilled = cb.onSetFilled;
  }

  setClocks(clocks: ProgressClock[]): void { this.setObjects(clocks); }

  protected objClass(): string { return 'a-clock'; }
  protected objColor(c: ProgressClock): string { return c.color; }

  protected renderContent(c: ProgressClock, content: HTMLElement): void {
    content.style.setProperty('--clock-color', c.color);

    const name = document.createElement('div');
    name.className = 'clock-name';
    name.textContent = c.name;
    content.appendChild(name);

    content.appendChild(this._renderDial(c));

    const count = document.createElement('div');
    count.className = 'clock-count';
    count.textContent = `${c.filled}/${c.segments}`;
    content.appendChild(count);
  }

  private _renderDial(c: ProgressClock): SVGSVGElement {
    const SIZE = 100, cx = SIZE / 2, cy = SIZE / 2, r = SIZE / 2 - 4;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'clock-dial');
    svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
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
        wedge.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = (c.filled === i + 1) ? i : i + 1;
          this._onSetFilled?.(c.id, next);
        });
      }
      svg.appendChild(wedge);
    }
    return svg;
  }
}
