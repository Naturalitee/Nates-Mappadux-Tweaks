/**
 * MarkerOverlay — HTML screen-space layer that holds per-marker UI elements
 * positioned over the canvas.
 *
 * Each marker that wants to surface UI gets one `<div>` child in the
 * overlay container. The caller supplies positions in CSS pixels relative
 * to the overlay's top-left (which matches the canvas's top-left). Sizing
 * is left to CSS so labels stay screen-fixed regardless of map zoom.
 *
 * For v2.11/A3a this only renders labels. A3b will extend the item shape
 * to include the GM marker handles (move handle + badges) and selection
 * widgets (resize / rotate). The pointer-events policy is:
 *   - container: pointer-events: none (default in CSS)
 *   - per-child: opt back in by setting pointer-events: auto on the child
 * Labels stay none-pointer (read-only); handles/badges will flip to auto.
 *
 * The class is render-agnostic — it's a thin DOM manager. The callers
 * (MarkerLayer for GM, PlayerApp / ProjectorApp for the broadcast views)
 * own the world→screen position math.
 */
export interface OverlayItem {
  id:      string;
  text:    string;
  /** CSS px, relative to overlay container top-left. */
  x:       number;
  y:       number;
  visible: boolean;
}

export class MarkerOverlay {
  private container: HTMLElement;
  private elements = new Map<string, HTMLElement>();

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * Sync the overlay's DOM to the given item list. Adds new entries,
   * updates positions / text / visibility on existing entries, and
   * removes any whose id is no longer in the list.
   */
  update(items: OverlayItem[]): void {
    const seen = new Set<string>();
    for (const item of items) {
      seen.add(item.id);
      let el = this.elements.get(item.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'marker-label';
        this.container.appendChild(el);
        this.elements.set(item.id, el);
      }
      if (el.textContent !== item.text) el.textContent = item.text;
      // Position via `transform: translate(-50%, 0)` in CSS so the anchor
      // is the horizontal centre of the label; vertical anchor is the top.
      el.style.left = `${item.x}px`;
      el.style.top  = `${item.y}px`;
      el.hidden = !item.visible || !item.text;
    }
    for (const [id, el] of this.elements) {
      if (!seen.has(id)) {
        el.remove();
        this.elements.delete(id);
      }
    }
  }

  /** Drop every label — for map changes or hard resets. */
  clear(): void {
    for (const el of this.elements.values()) el.remove();
    this.elements.clear();
  }
}
