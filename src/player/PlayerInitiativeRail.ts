import type { InitiativeCard, InitiativeState, InitiativeEdge } from '../types.ts';

/**
 * PlayerInitiativeRail (v2.17 Player Voice) — player-side atmospheric face of
 * the fanned-deck initiative tracker. The player sees WHEN each turn falls in
 * relation to theirs but zero tactical data about which enemy is which:
 *
 *  - Player cards show name + colour tab (and an initial in the disc).
 *  - Enemy cards show a uniform charcoal tab labelled "???" and an "Opposition"
 *    body — no threat letter, no roll value.
 *  - The ROUND END marker is a neutral separator.
 *
 * Rail orientation follows whatever edge the GM has pinned the tracker to;
 * horizontal on top/bottom, vertical on left/right.
 */
export class PlayerInitiativeRail {
  private state: InitiativeState | null = null;

  constructor(private root: HTMLElement) {
    this._render();
  }

  setState(state: InitiativeState | null): void { this.state = state; this._render(); }

  private _render(): void {
    this.root.replaceChildren();
    if (!this.state || !this.state.visible || this.state.activeDeck.length === 0) {
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;
    this.root.className = `player-init is-edge-${this.state.edge} ${isHorizontal(this.state.edge) ? 'is-horizontal' : 'is-vertical'}`;

    const rail = document.createElement('div');
    rail.className = `init-rail ${isHorizontal(this.state.edge) ? 'is-horizontal' : 'is-vertical'}`;
    for (let i = 0; i < this.state.activeDeck.length; i++) {
      rail.appendChild(this._renderCard(this.state.activeDeck[i]!, i));
    }
    this.root.appendChild(rail);
  }

  private _renderCard(card: InitiativeCard, index: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'init-card init-card--' + card.type
      + (index === 0 ? ' is-active' : '')
      + (card.isSpent ? ' is-spent' : '');
    el.style.zIndex = String(100 - index);

    if (card.type === 'round-marker') {
      el.style.setProperty('--init-color', card.color);
      const body = document.createElement('div');
      body.className = 'init-card-body init-card-body--marker';
      body.textContent = 'ROUND END';
      el.appendChild(body);
      return el;
    }

    if (card.type === 'enemy') {
      // Information blackout: uniform charcoal tabs on every edge with "!",
      // body shows a dark Mappadux duck silhouette — atmospheric, on-brand,
      // and dryly funny. Replaces the spec's "???" edge label and "abstract
      // backdrop" asset slot (we already have the gfx — 2026-05-31).
      el.style.setProperty('--init-color', '#1f2937');
      _appendEdgeTabs(el, '!');
      const body = document.createElement('div');
      body.className = 'init-card-body init-card-body--enemy';
      const duck = document.createElement('img');
      duck.className = 'init-card-duck';
      duck.src = '/icons/icon-512.png';
      duck.alt = '';
      duck.draggable = false;
      body.appendChild(duck);
      el.appendChild(body);
      return el;
    }

    // Player card — colour tabs on every edge so the name reads from
    // whichever slice is exposed by the fan; initial disc on the face for
    // the centred identity cue.
    el.style.setProperty('--init-color', card.color);
    _appendEdgeTabs(el, card.name);

    const body = document.createElement('div');
    body.className = 'init-card-body';
    const disc = document.createElement('div');
    disc.className = 'init-card-disc';
    disc.textContent = (card.name.trim()[0] ?? '?').toUpperCase();
    body.appendChild(disc);
    el.appendChild(body);

    return el;
  }
}

function isHorizontal(edge: InitiativeEdge): boolean {
  return edge === 'top' || edge === 'bottom';
}

/** v2.16.53 — paint the card's identity label on all four edges. CSS hides
 *  the two that don't apply to the current rail orientation (horizontal
 *  shows left+right; vertical shows top+bottom). The exposed slice when a
 *  card is mid-fan is always an edge; this guarantees the name is readable
 *  whichever way the deck is stacked. Long names truncate via overflow. */
function _appendEdgeTabs(host: HTMLElement, text: string): void {
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const tab = document.createElement('div');
    tab.className = `init-card-tab init-card-tab--${side}`;
    const t = document.createElement('span');
    t.className = 'init-card-tab-text';
    t.textContent = text;
    tab.appendChild(t);
    host.appendChild(tab);
  }
}
