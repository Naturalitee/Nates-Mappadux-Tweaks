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
      // Information blackout: uniform charcoal tab, "???" edge text, "Opposition" face.
      el.style.setProperty('--init-color', '#1f2937');
      const tab = document.createElement('div');
      tab.className = 'init-card-tab';
      const tabText = document.createElement('span');
      tabText.className = 'init-card-tab-text';
      tabText.textContent = '???';
      tab.appendChild(tabText);
      el.appendChild(tab);
      const body = document.createElement('div');
      body.className = 'init-card-body init-card-body--enemy';
      body.textContent = 'Opposition';
      el.appendChild(body);
      return el;
    }

    // Player card — colour tab + name on the edge + initial disc on the face.
    el.style.setProperty('--init-color', card.color);
    const tab = document.createElement('div');
    tab.className = 'init-card-tab';
    const tabText = document.createElement('span');
    tabText.className = 'init-card-tab-text';
    tabText.textContent = card.name;
    tab.appendChild(tabText);
    el.appendChild(tab);

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
