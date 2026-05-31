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
    // whichever slice is exposed by the fan; portrait (when set) or
    // initial disc on the face for the centred identity cue.
    el.style.setProperty('--init-color', card.color);
    // v2.16.56 — auto-pick a contrasting foreground for the tab text +
    // disc so light identity colours (yellow, light blue) don't lose
    // white text on a bright tab. Dark colours get white; light colours
    // get near-black.
    el.style.setProperty('--init-color-fg', _isLightColor(card.color) ? '#0b0d12' : '#ffffff');
    _appendEdgeTabs(el, card.name);

    const body = document.createElement('div');
    body.className = 'init-card-body';
    if (card.markerUrl) {
      // Player has chosen a token icon — render it as the centred portrait.
      const img = document.createElement('img');
      img.className = 'init-card-portrait';
      img.src = card.markerUrl;
      img.alt = '';
      img.draggable = false;
      body.appendChild(img);
    } else {
      const disc = document.createElement('div');
      disc.className = 'init-card-disc';
      disc.textContent = (card.name.trim()[0] ?? '?').toUpperCase();
      body.appendChild(disc);
    }
    el.appendChild(body);

    return el;
  }
}

/** v2.16.56 — YIQ brightness check. Returns true for hex colours that read
 *  as "light" against a white background (e.g. yellow, light blue, mint);
 *  the caller uses this to pick dark text against bright identity colours
 *  so the edge labels stay legible. Accepts #rgb / #rrggbb. */
function _isLightColor(hex: string): boolean {
  const m = hex.replace('#', '');
  let r = 0, g = 0, b = 0;
  if (m.length === 3) {
    r = parseInt(m[0]! + m[0]!, 16);
    g = parseInt(m[1]! + m[1]!, 16);
    b = parseInt(m[2]! + m[2]!, 16);
  } else if (m.length === 6) {
    r = parseInt(m.slice(0, 2), 16);
    g = parseInt(m.slice(2, 4), 16);
    b = parseInt(m.slice(4, 6), 16);
  } else {
    return false;
  }
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
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
