import type { InitiativeCard, InitiativeState, InitiativeEdge, InitiativeSortMode, PersistentPlayer } from '../types.ts';
import {
  saveInitiativeState,
  sortActiveDeck,
  advanceTurn,
  patchCardValue,
  addCardToDeck,
  removeFromDeck,
  injectFromStaging,
  endCombat,
  reorderCard,
  jumpToFront,
  makeRoundMarker,
  ensureRoundMarker,
} from '../initiative/initiativeState.ts';
import { generateId } from '../utils/id.ts';

export interface InitiativeTrackerCallbacks {
  /** Broadcast the canonical state to player views every time it changes. */
  onChange: (state: InitiativeState) => void;
  /** Fire the call-for-initiative broadcast so player views pop a roll prompt. */
  onCallForInitiative: () => void;
  /** Provide the current persistent players for the unallocated tray. */
  getPlayers: () => PersistentPlayer[];
}

/**
 * GM-side initiative tracker (v2.17 Player Voice).
 *
 * Renders the fanned-deck rail along whichever edge of the GM view it's
 * pinned to (horizontal on top/bottom, vertical on left/right), plus the
 * GM-private staging zones — the threat bench (reserve enemies as letters
 * A–F) and the unallocated tray (player cards that haven't rolled yet).
 *
 * The state is the single source of truth; this class mutates it through
 * pure helpers and re-renders + persists + broadcasts on every change.
 */
export class InitiativeTracker {
  private state: InitiativeState;
  private root: HTMLElement;
  private cb: InitiativeTrackerCallbacks;

  constructor(root: HTMLElement, initial: InitiativeState, cb: InitiativeTrackerCallbacks) {
    this.root = root;
    this.state = ensureMarkerIfActive(initial);
    this.cb = cb;
    this._render();
  }

  /** Replace state wholesale (e.g. after a localStorage reload). */
  setState(state: InitiativeState): void { this.state = ensureMarkerIfActive(state); this._render(); }

  getState(): InitiativeState { return this.state; }

  /** Open the tracker overlay. Seeds ROUND END if the deck was empty. */
  open(): void {
    this._mutate((s) => ({ ...s, visible: true, activeDeck: s.activeDeck.length === 0 ? [makeRoundMarker()] : s.activeDeck }));
  }

  close(): void { this._mutate((s) => ({ ...s, visible: false })); }

  toggle(): void { this.state.visible ? this.close() : this.open(); }

  /** Ingest a player's typed roll value. Called by GMApp on MsgInitiativeRoll. */
  ingestRoll(playerId: string, name: string, color: string, value: string): void {
    this._mutate((s) => {
      // Drop any existing card / tray entry for this player.
      const deck = s.activeDeck.filter((c) => c.playerId !== playerId);
      const tray = s.unallocated.filter((c) => c.playerId !== playerId);
      const card: InitiativeCard = {
        id: generateId(),
        name,
        type: 'player',
        color,
        playerId,
        value,
        isSpent: false,
      };
      return addCardToDeck({ ...s, activeDeck: deck, unallocated: tray }, card);
    });
  }

  /** Make sure every persistent player has either an active card OR an
   *  unallocated ghost when the GM opens the tracker. Called by GMApp. */
  seedUnallocatedFromPlayers(): void {
    this._mutate((s) => {
      const players = this.cb.getPlayers();
      const known = new Set<string>();
      for (const c of s.activeDeck)  if (c.playerId) known.add(c.playerId);
      for (const c of s.unallocated) if (c.playerId) known.add(c.playerId);
      const additions: InitiativeCard[] = [];
      for (const p of players) {
        if (known.has(p.id)) continue;
        additions.push({
          id: generateId(),
          name: p.characterName || p.playerName || 'Player',
          type: 'player',
          color: p.color,
          playerId: p.id,
          value: '',
          isSpent: false,
        });
      }
      return { ...s, unallocated: [...s.unallocated, ...additions] };
    });
  }

  // ── Mutations driven by UI events ──────────────────────────────────────────

  private _advance(): void { this._mutate(advanceTurn); }

  private _setSortMode(mode: InitiativeSortMode): void {
    this._mutate((s) => ({ ...s, sortMode: mode, activeDeck: sortActiveDeck(s.activeDeck, mode) }));
  }

  private _setEdge(edge: InitiativeEdge): void { this._mutate((s) => ({ ...s, edge })); }

  private _endCombat(): void {
    if (!confirm('Wipe the tracker (active rail + unallocated + threat bench) and start fresh?')) return;
    this._mutate(endCombat);
  }

  private _editValue(cardId: string, value: string): void {
    this._mutate((s) => patchCardValue(s, cardId, value));
  }

  private _delete(cardId: string): void { this._mutate((s) => removeFromDeck(s, cardId)); }

  private _inject(cardId: string): void { this._mutate((s) => injectFromStaging(s, cardId)); }

  private _reorder(cardId: string, toIndex: number): void { this._mutate((s) => reorderCard(s, cardId, toIndex)); }

  private _jumpToFront(cardId: string): void { this._mutate((s) => jumpToFront(s, cardId)); }

  // ── Core mutate + render loop ──────────────────────────────────────────────

  private _mutate(fn: (s: InitiativeState) => InitiativeState): void {
    this.state = fn(this.state);
    saveInitiativeState(this.state);
    this.cb.onChange(this.state);
    this._render();
  }

  private _render(): void {
    this.root.replaceChildren();
    this.root.className = `init-tracker is-edge-${this.state.edge} ${isHorizontal(this.state.edge) ? 'is-horizontal' : 'is-vertical'}`;
    this.root.hidden = !this.state.visible;
    if (!this.state.visible) return;

    this.root.appendChild(this._renderControls());
    const zones = document.createElement('div');
    zones.className = 'init-zones';
    zones.appendChild(this._renderBench());
    zones.appendChild(this._renderRail());
    zones.appendChild(this._renderUnallocated());
    this.root.appendChild(zones);
  }

  private _renderControls(): HTMLElement {
    const ctl = document.createElement('div');
    ctl.className = 'init-controls';

    const call = mkBtn('Call for Initiative', 'init-btn init-btn--primary', () => this.cb.onCallForInitiative());
    const advance = mkBtn('Advance ▶', 'init-btn', () => this._advance());

    const sort = document.createElement('select');
    sort.className = 'init-sort';
    sort.title = 'Sort mode';
    for (const [mode, label] of [
      ['high-to-low', 'High → Low'],
      ['low-to-high', 'Low → High'],
      ['manual',      'Manual / Freeform'],
    ] as Array<[InitiativeSortMode, string]>) {
      const opt = document.createElement('option');
      opt.value = mode;
      opt.textContent = label;
      if (this.state.sortMode === mode) opt.selected = true;
      sort.appendChild(opt);
    }
    sort.addEventListener('change', () => this._setSortMode(sort.value as InitiativeSortMode));

    const edge = document.createElement('select');
    edge.className = 'init-edge';
    edge.title = 'Pin the tracker to an edge of the view';
    for (const [val, label] of [
      ['bottom', '⤓ Bottom'],
      ['top',    '⤒ Top'],
      ['left',   '◀ Left'],
      ['right',  '▶ Right'],
    ] as Array<[InitiativeEdge, string]>) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (this.state.edge === val) opt.selected = true;
      edge.appendChild(opt);
    }
    edge.addEventListener('change', () => this._setEdge(edge.value as InitiativeEdge));

    const end = mkBtn('End Combat', 'init-btn init-btn--danger', () => this._endCombat());
    const close = mkBtn('×', 'init-close', () => this.close());
    close.title = 'Hide tracker (state is kept)';

    ctl.append(call, advance, sort, edge, end, close);
    return ctl;
  }

  private _renderBench(): HTMLElement {
    const zone = document.createElement('div');
    zone.className = 'init-zone init-bench';
    const label = document.createElement('span');
    label.className = 'init-zone-label';
    label.textContent = 'Threats';
    zone.appendChild(label);
    const list = document.createElement('div');
    list.className = 'init-zone-list';
    for (const card of this.state.threatBench) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'init-chip init-chip--enemy';
      chip.style.setProperty('--init-color', card.color);
      chip.textContent = card.threatLetter ?? '?';
      chip.title = `Drop ${card.name} into the rail`;
      chip.addEventListener('click', () => this._inject(card.id));
      list.appendChild(chip);
    }
    zone.appendChild(list);
    return zone;
  }

  private _renderUnallocated(): HTMLElement {
    const zone = document.createElement('div');
    zone.className = 'init-zone init-unallocated';
    const label = document.createElement('span');
    label.className = 'init-zone-label';
    label.textContent = 'Unallocated';
    zone.appendChild(label);
    const list = document.createElement('div');
    list.className = 'init-zone-list';
    if (this.state.unallocated.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'init-zone-empty';
      empty.textContent = '— everyone is in the rail —';
      list.appendChild(empty);
    }
    for (const card of this.state.unallocated) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'init-chip init-chip--player init-chip--ghost';
      chip.style.setProperty('--init-color', card.color);
      chip.textContent = card.name;
      chip.title = 'Drop this player into the rail (enter their roll afterwards)';
      chip.addEventListener('click', () => this._inject(card.id));
      list.appendChild(chip);
    }
    zone.appendChild(list);
    return zone;
  }

  private _renderRail(): HTMLElement {
    const zone = document.createElement('div');
    zone.className = 'init-zone init-rail-zone';
    const label = document.createElement('span');
    label.className = 'init-zone-label';
    label.textContent = 'Rail';
    zone.appendChild(label);
    const rail = document.createElement('div');
    rail.className = `init-rail ${isHorizontal(this.state.edge) ? 'is-horizontal' : 'is-vertical'}`;
    for (let i = 0; i < this.state.activeDeck.length; i++) {
      rail.appendChild(this._renderCard(this.state.activeDeck[i]!, i));
    }
    if (this.state.activeDeck.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'init-zone-empty';
      empty.textContent = 'Click "Call for Initiative" or drop a threat / player to start.';
      rail.appendChild(empty);
    }
    zone.appendChild(rail);
    return zone;
  }

  private _renderCard(card: InitiativeCard, index: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'init-card init-card--' + card.type
      + (index === 0 ? ' is-active' : '')
      + (card.isSpent ? ' is-spent' : '');
    el.style.setProperty('--init-color', card.color);
    el.style.zIndex = String(100 - index);
    el.draggable = card.type !== 'round-marker';
    el.dataset['cardId'] = card.id;

    // Drag handlers — drag-to-reorder switches to manual sort mode.
    el.addEventListener('dragstart', (e) => {
      if (card.type === 'round-marker') { e.preventDefault(); return; }
      e.dataTransfer?.setData('text/plain', card.id);
      e.dataTransfer?.setData('application/x-init-card', card.id);
      el.classList.add('is-dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('is-dragging'));
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('application/x-init-card')) return;
      e.preventDefault();
      el.classList.add('is-drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('is-drop-target'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('is-drop-target');
      const draggedId = e.dataTransfer?.getData('application/x-init-card');
      if (!draggedId || draggedId === card.id) return;
      e.preventDefault();
      this._reorder(draggedId, index);
    });

    // Right-click → Jump to Front (sudden reaction / boss phase trigger).
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (card.type !== 'round-marker' && index > 0) this._jumpToFront(card.id);
    });

    if (card.type === 'round-marker') {
      const body = document.createElement('div');
      body.className = 'init-card-body init-card-body--marker';
      body.textContent = 'ROUND END';
      el.appendChild(body);
      return el;
    }

    // v2.16.53 — paint the identity strip on every edge of the card. The
    // fanned deck only ever exposes ONE edge of a mid-deck card, so a
    // single-edge label was unreadable for stacked cards. CSS hides the
    // edges that don't apply to the current rail orientation.
    const edgeText = card.type === 'enemy' ? (card.threatLetter ?? '?') : card.name;
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const tab = document.createElement('div');
      tab.className = `init-card-tab init-card-tab--${side}`;
      const tabText = document.createElement('span');
      tabText.className = 'init-card-tab-text';
      tabText.textContent = edgeText;
      tab.appendChild(tabText);
      el.appendChild(tab);
    }

    // Main body — GM-facing mechanical face: giant value (player) or threat letter (enemy)
    const body = document.createElement('div');
    body.className = 'init-card-body';
    if (card.type === 'enemy') {
      const big = document.createElement('div');
      big.className = 'init-card-big';
      big.textContent = card.threatLetter ?? '?';
      body.appendChild(big);
    } else {
      const big = document.createElement('div');
      big.className = 'init-card-big';
      big.textContent = card.value || '—';
      body.appendChild(big);
    }
    el.appendChild(body);

    // v2.16.54 — delete moved from the bottom chrome strip to a small
    // upper-right corner cross, per spec §5. Reveals on hover/active.
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'init-card-delete';
    del.title = card.type === 'enemy' ? 'Return to threat bench' : 'Move to unallocated tray';
    del.textContent = '×';
    del.addEventListener('click', (e) => { e.stopPropagation(); this._delete(card.id); });
    el.appendChild(del);

    // Value editor chrome — bottom strip, reveals on hover/active.
    const chrome = document.createElement('div');
    chrome.className = 'init-card-chrome';

    const valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.className = 'init-card-value';
    valInput.value = card.value;
    valInput.title = 'Initiative value';
    valInput.placeholder = '–';
    valInput.addEventListener('change', () => this._editValue(card.id, valInput.value));
    chrome.appendChild(valInput);

    el.appendChild(chrome);
    return el;
  }
}

function ensureMarkerIfActive(state: InitiativeState): InitiativeState {
  if (state.activeDeck.length === 0) return state;
  return { ...state, activeDeck: ensureRoundMarker(state.activeDeck) };
}

function isHorizontal(edge: InitiativeEdge): boolean {
  return edge === 'top' || edge === 'bottom';
}

function mkBtn(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
