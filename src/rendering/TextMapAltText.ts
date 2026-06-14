/** One handout element reduced to its accessible text plus the top-left
 *  position used only to order the list the way the page reads. */
export interface AltTextItem {
  /** Top-left as PERCENTAGES of the page (0..100) — for reading-order sort. */
  x:    number;
  y:    number;
  /** The accessible text: a text block's words, or an image's alt / name. */
  text: string;
}

/**
 * TextMapAltText (v2.17.26) — screen-reader alternative for text-map handouts.
 *
 * A handout's text and images are rasterised into the single page image painted
 * on the WebGL canvas, so their words are invisible to assistive tech and there
 * are no per-element DOM nodes to label. This exposes a visually-hidden region
 * that lists every element's accessible text in reading order (top-to-bottom,
 * then left-to-right). It has NO visual presence — sighted users see exactly the
 * same screen; only screen readers gain the content.
 */
export class TextMapAltText {
  private readonly region: HTMLElement;

  constructor(root: HTMLElement) {
    this.region = document.createElement('div');
    this.region.className = 'textmap-alt-text sr-only';
    this.region.setAttribute('role', 'region');
    this.region.setAttribute('aria-label', 'Handout written content');
    root.appendChild(this.region);
  }

  /** Replace the announced content. Pass the current map's text + image items
   *  (empty for non-text-maps). Ordered here so reading follows the layout. */
  setItems(items: AltTextItem[]): void {
    const ordered = [...items]
      .filter((it) => it.text.length > 0)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    this.region.replaceChildren();
    for (const it of ordered) {
      const p = document.createElement('p');
      p.textContent = it.text;
      this.region.appendChild(p);
    }
  }

  clear(): void { this.setItems([]); }

  destroy(): void { this.region.remove(); }
}

/** Extract reading-order plain text from a sanitised rich-text body without
 *  executing or fetching anything (DOMParser builds an inert document). */
export function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}
