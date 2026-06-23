import type { TextMapAltItem } from '../types.ts';

let regionSeq = 0;

/**
 * TextMapAltText (v2.17.26, canvas-bound v2.17.28) — screen-reader alternative
 * for text-map handouts.
 *
 * A handout's text and images are rasterised into the single page image painted
 * on the WebGL canvas, so their words are invisible to assistive tech and there
 * are no per-element DOM nodes to label. This exposes a visually-hidden region
 * that lists every element's accessible text in reading order (top-to-bottom,
 * then left-to-right). It has NO visual presence — sighted users see exactly the
 * same screen; only screen readers gain the content.
 *
 * The visually-hidden region alone is reachable in a screen reader's browse/scan
 * mode, but a user who navigates to the on-screen map graphic lands on a bare
 * `<canvas>` with no accessible name and hears nothing. So when a `canvas` is
 * given, this also turns it into an `role="img"` while a handout is active —
 * named by the handout's first line and described by the hidden region — so
 * landing on the map itself announces the content. No extra on-screen elements.
 */
export class TextMapAltText {
  private readonly region: HTMLElement;

  constructor(root: HTMLElement, private canvas: HTMLCanvasElement | null = null) {
    this.region = document.createElement('div');
    this.region.id = `textmap-alt-content-${regionSeq++}`;
    this.region.className = 'textmap-alt-text sr-only';
    this.region.setAttribute('role', 'region');
    this.region.setAttribute('aria-label', 'Handout written content');
    root.appendChild(this.region);
  }

  /** Replace the announced content. Pass the current map's text + image items
   *  (empty for non-text-maps). Ordered here so reading follows the layout. */
  setItems(items: TextMapAltItem[]): void {
    const ordered = [...items]
      .filter((it) => it.text.length > 0)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    this.region.replaceChildren();
    for (const it of ordered) {
      const p = document.createElement('p');
      p.textContent = it.text;
      this.region.appendChild(p);
    }
    this._syncCanvas(ordered);
  }

  clear(): void { this.setItems([]); }

  destroy(): void {
    this._syncCanvas([]);
    this.region.remove();
  }

  /** Make the map canvas an image named + described by this content while a
   *  handout is active; strip the role on non-handout maps so the canvas reads
   *  as nothing rather than a stale handout. */
  private _syncCanvas(ordered: TextMapAltItem[]): void {
    const cv = this.canvas;
    if (!cv) return;
    if (ordered.length === 0) {
      cv.removeAttribute('role');
      cv.removeAttribute('aria-label');
      cv.removeAttribute('aria-describedby');
      return;
    }
    cv.setAttribute('role', 'img');
    // First line (usually the title) names the image; the region carries the rest.
    cv.setAttribute('aria-label', ordered[0]!.text.slice(0, 80) || 'Map handout');
    cv.setAttribute('aria-describedby', this.region.id);
  }
}

/** Extract reading-order plain text from a sanitised rich-text body without
 *  executing or fetching anything (DOMParser builds an inert document). */
export function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}
