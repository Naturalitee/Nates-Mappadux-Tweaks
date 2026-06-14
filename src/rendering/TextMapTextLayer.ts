import type { TextMapTextElement } from '../types.ts';

type Project = (x: number, y: number) => { x: number; y: number } | null;

/** A text block reduced to what this layer needs: its page-% geometry plus
 *  the plain-text fallback extracted from the (already sanitised) rich body. */
interface TextItem {
  id:   string;
  x:    number;
  y:    number;
  w:    number;
  h:    number;
  text: string;
}

/**
 * TextMapTextLayer (v2.17.25) — accessibility layer for text-map handouts.
 *
 * A text-map's text blocks are rasterised into the single page image painted
 * on the WebGL canvas, so there are no per-block DOM nodes to carry a tooltip
 * or feed a screen reader. This layer reconstructs both from the stored
 * `TextMapTextElement.html`:
 *
 *  - **Screen reader** — a visually-hidden region lists every block's plain
 *    text in reading order, labelled as the handout's written content. Gives
 *    AT users the words that are otherwise locked inside the image.
 *  - **Sighted hover** — a single floating tooltip. We hit-test the pointer
 *    against each block's projected screen rect (same map-% → screen-px
 *    projection the video layer uses) and show that block's text. Everything
 *    here is `pointer-events: none`; the hit-test reads the pointer from a
 *    mousemove on the canvas wrapper, so map panning is never intercepted —
 *    the distinction that made this the "hybrid" approach over transparent
 *    hotspot divs.
 */
export class TextMapTextLayer {
  private items: TextItem[] = [];
  private readonly srRegion: HTMLElement;
  private readonly tooltip:  HTMLElement;
  private hoverId: string | null = null;

  constructor(
    /** Positioned container over the canvas (e.g. #canvas-wrapper). Holds the
     *  tooltip + SR region; tooltip coords are relative to its top-left. */
    private root: HTMLElement,
    /** Element the pointer actually moves over (the canvas wrapper). Listened
     *  to passively so panning/drag handlers are untouched. */
    hitTarget: HTMLElement,
    /** map-% (0..1) → screen-px, relative to `root`'s top-left. */
    private project: Project,
  ) {
    this.srRegion = document.createElement('div');
    this.srRegion.className = 'textmap-text-sr sr-only';
    this.srRegion.setAttribute('role', 'region');
    this.srRegion.setAttribute('aria-label', 'Handout written content');
    this.root.appendChild(this.srRegion);

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'textmap-text-tooltip';
    this.tooltip.hidden = true;
    this.root.appendChild(this.tooltip);

    hitTarget.addEventListener('mousemove', this._onMove, { passive: true });
    hitTarget.addEventListener('mouseleave', this._onLeave, { passive: true });
  }

  /** Feed the current map's text elements (empty array for non-text-maps). */
  setTexts(elements: TextMapTextElement[]): void {
    this.items = elements
      .map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.w, h: e.h, text: plainText(e.html) }))
      .filter((it) => it.text.length > 0);
    this._renderSR();
    if (this.hoverId && !this.items.some((it) => it.id === this.hoverId)) this._hideTooltip();
  }

  clear(): void { this.setTexts([]); }

  destroy(): void {
    this.srRegion.remove();
    this.tooltip.remove();
  }

  /** Rebuild the visually-hidden reading-order list of block text. */
  private _renderSR(): void {
    this.srRegion.replaceChildren();
    for (const it of this.items) {
      const p = document.createElement('p');
      p.textContent = it.text;
      this.srRegion.appendChild(p);
    }
  }

  private _onMove = (ev: MouseEvent): void => {
    if (this.items.length === 0) { if (!this.tooltip.hidden) this._hideTooltip(); return; }
    const rect = this.root.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    // Topmost block wins — later elements paint over earlier ones, so scan back.
    let hit: TextItem | null = null;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]!;
      const tl = this.project(it.x / 100, it.y / 100);
      const br = this.project((it.x + it.w) / 100, (it.y + it.h) / 100);
      if (!tl || !br) continue;
      const x0 = Math.min(tl.x, br.x), x1 = Math.max(tl.x, br.x);
      const y0 = Math.min(tl.y, br.y), y1 = Math.max(tl.y, br.y);
      if (px >= x0 && px <= x1 && py >= y0 && py <= y1) { hit = it; break; }
    }
    if (!hit) { if (!this.tooltip.hidden) this._hideTooltip(); return; }
    if (this.hoverId !== hit.id) {
      this.hoverId = hit.id;
      this.tooltip.textContent = hit.text;
      this.tooltip.hidden = false;
    }
    // Offset from the cursor; clamp to the root so it never spills off-canvas.
    const maxW = Math.min(360, rect.width - 16);
    this.tooltip.style.maxWidth = `${maxW}px`;
    const tw = this.tooltip.offsetWidth, th = this.tooltip.offsetHeight;
    let left = px + 14, top = py + 16;
    if (left + tw > rect.width - 4)  left = px - tw - 14;
    if (top + th > rect.height - 4)  top = py - th - 16;
    this.tooltip.style.left = `${Math.max(4, left)}px`;
    this.tooltip.style.top  = `${Math.max(4, top)}px`;
  };

  private _onLeave = (): void => { this._hideTooltip(); };

  private _hideTooltip(): void {
    this.hoverId = null;
    this.tooltip.hidden = true;
  }
}

/** Extract reading-order plain text from a sanitised rich-text body without
 *  executing or fetching anything (DOMParser builds an inert document). */
function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}
