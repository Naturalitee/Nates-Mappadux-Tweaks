import type { TextMapAltItem } from '../types.ts';

type Project = (x: number, y: number) => { x: number; y: number } | null;

/**
 * TextMapAltText (v2.17.31) — screen-reader access to text-map handouts.
 *
 * A handout's text + images are rasterised into the single page image on the
 * WebGL canvas, so their words are invisible to assistive tech and there are no
 * per-element DOM nodes. This builds, over the map, one **focusable but
 * invisible** element per handout element — `tabindex=0`, named by the box's
 * text, `pointer-events:none` (so map panning is untouched). A screen-reader
 * user Tabs through the handout and hears each box read where it sits; a sighted
 * keyboard user sees a focus outline land on each box. With a `project` fn the
 * boxes track the map through pan/zoom (same projection the video layer uses).
 *
 * The boxes live inside a labelled region ("Handout written content") so the
 * set is also reachable as one landmark / in browse mode. No visual change
 * except the on-focus outline. The map canvas is additionally marked
 * `role="img"` while a handout is active so object-navigation lands on it too.
 */
export class TextMapAltText {
  private readonly region: HTMLElement;
  private items: TextMapAltItem[] = [];
  private boxes: HTMLElement[] = [];
  private raf = 0;

  constructor(
    root: HTMLElement,
    private project: Project | null = null,
    private canvas: HTMLCanvasElement | null = null,
  ) {
    this.region = document.createElement('div');
    this.region.className = 'textmap-alt-text';
    this.region.setAttribute('role', 'region');
    this.region.setAttribute('aria-label', 'Handout written content');
    root.appendChild(this.region);
    if (this.project) {
      const loop = (): void => { this._position(); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    }
  }

  /** Replace the announced content. Pass the current map's text + image items
   *  (empty for non-text-maps). Sorted to page order (top-to-bottom, then
   *  left-to-right) so Tab + browse read the way the handout reads. */
  setItems(items: TextMapAltItem[]): void {
    this.items = [...items]
      .filter((it) => it.text.length > 0)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    this.region.replaceChildren();
    this.boxes = this.items.map((it) => {
      const box = document.createElement('div');
      box.className = 'textmap-alt-box';
      box.tabIndex = 0;
      box.setAttribute('role', 'img');           // a baked picture of text → image w/ alt
      box.setAttribute('aria-label', it.text);
      this.region.appendChild(box);
      return box;
    });
    this._position();
    this._syncCanvas();
  }

  clear(): void { this.setItems([]); }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this._syncCanvas();
    this.region.remove();
  }

  /** Place each focusable box over its handout element. No-op without a
   *  projection (the box still exists + reads; it just isn't positioned). */
  private _position(): void {
    if (!this.project) return;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]!;
      const box = this.boxes[i];
      if (!box) continue;
      const tl = this.project(it.x / 100, it.y / 100);
      const br = this.project((it.x + it.w) / 100, (it.y + it.h) / 100);
      if (!tl || !br) { box.style.visibility = 'hidden'; continue; }
      box.style.visibility = '';
      box.style.left   = `${Math.min(tl.x, br.x)}px`;
      box.style.top    = `${Math.min(tl.y, br.y)}px`;
      box.style.width  = `${Math.max(1, Math.abs(br.x - tl.x))}px`;
      box.style.height = `${Math.max(1, Math.abs(br.y - tl.y))}px`;
    }
  }

  /** Mark the map canvas as an image while a handout is active so object
   *  navigation lands on it; strip it on non-handout maps. */
  private _syncCanvas(): void {
    const cv = this.canvas;
    if (!cv) return;
    if (this.items.length === 0) {
      cv.removeAttribute('role');
      cv.removeAttribute('aria-label');
      return;
    }
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', `Handout: ${this.items[0]!.text.slice(0, 80)}`);
  }
}

/** Extract reading-order plain text from a sanitised rich-text body without
 *  executing or fetching anything (DOMParser builds an inert document). */
export function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}
