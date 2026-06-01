import type { InitiativeCard, InitiativeState, InitiativeEdge, InitiativeSortMode, PersistentPlayer } from '../types.ts';
import {
  saveInitiativeState,
  sortActiveDeck,
  advanceTurn,
  patchCardValue,
  addCardToDeck,
  removeFromDeck,
  injectFromStaging,
  injectFromStagingWithValue,
  discardCard,
  endCombat,
  rerollInitiative,
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
  ingestRoll(playerId: string, name: string, color: string, value: string, markerUrl?: string): void {
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
        ...(markerUrl ? { markerUrl } : {}),
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
          ...(p.iconDataUrl ? { markerUrl: p.iconDataUrl } : {}),
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

  /** v2.16.58 — type-to-inject: drop the staged card into the active deck
   *  AND patch its value in one mutation so it lands at the correct sort
   *  position immediately. Used by the value input on bench / tray cards. */
  private _injectWithValue(cardId: string, value: string): void {
    this._mutate((s) => injectFromStagingWithValue(s, cardId, value));
  }

  /** v2.16.58 — drag-to-discard: move a card from ANY pile into the
   *  discard zone. Out of THIS combat; End Combat clears the discard. */
  private _discard(cardId: string): void { this._mutate((s) => discardCard(s, cardId)); }

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
    // v2.16.58 — four zones, all rendered with the SAME card visual idiom
    // for the "lean into cards" pass. Bench + Discard are stacks (cards
    // cascading behind the top one); Unallocated is a row of full cards;
    // Rail is the fanned active deck.
    const zones = document.createElement('div');
    zones.className = 'init-zones';
    zones.appendChild(this._renderBench());
    zones.appendChild(this._renderUnallocated());
    zones.appendChild(this._renderRail());
    zones.appendChild(this._renderDiscard());
    this.root.appendChild(zones);
  }

  private _renderControls(): HTMLElement {
    const ctl = document.createElement('div');
    ctl.className = 'init-controls';

    const call = mkBtn('Call for Initiative', 'init-btn init-btn--primary', () => this.cb.onCallForInitiative());
    // v2.16.59 — when the END ROUND card lands at the front of the deck
    // the GM gets two choices (rather than one auto-advance): keep the
    // initiative order for the next round, or reroll. Most systems do
    // the former; some (Daggerheart-style) reroll every round.
    const headIsRoundEnd = this.state.activeDeck[0]?.type === 'round-marker';
    const advance = headIsRoundEnd
      ? mkBtn('Start Next Round ▶', 'init-btn init-btn--primary', () => this._advance())
      : mkBtn('Advance ▶', 'init-btn', () => this._advance());
    const reroll = headIsRoundEnd
      ? mkBtn('Reroll Initiative', 'init-btn', () => this._rerollInitiative())
      : null;

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

    if (reroll) ctl.append(call, advance, reroll, sort, edge, end, close);
    else        ctl.append(call, advance,         sort, edge, end, close);
    return ctl;
  }

  /** v2.16.59 — reset everyone's roll value + re-prompt the players. */
  private _rerollInitiative(): void {
    this._mutate(rerollInitiative);
    // Reuse the existing Call for Initiative wiring — it broadcasts the
    // prompt to player views AND re-seeds any missing players into the
    // unallocated tray.
    this.cb.onCallForInitiative();
  }

  private _renderBench(): HTMLElement {
    const zone = document.createElement('div');
    zone.className = 'init-zone init-zone--bench';
    const label = document.createElement('span');
    label.className = 'init-zone-label';
    label.textContent = 'Threats';
    zone.appendChild(label);
    const stack = document.createElement('div');
    stack.className = 'init-stack init-stack--bench';
    if (this.state.threatBench.length === 0) {
      stack.appendChild(this._emptyHint('Bench empty.'));
    } else {
      // v2.16.59 — static deck. Only the TOP card (A by default) is
      // rendered; deeper letters are represented by 2–4 thin "card
      // edge" spines so the GM sees the deck has depth without any
      // splay or animation. When A is taken (drag-to-rail, type-to-
      // inject, or drag-to-discard) B becomes the new top.
      const total = this.state.threatBench.length;
      const top = this.state.threatBench[0]!;
      const depth = Math.min(4, total - 1);
      for (let i = depth; i >= 1; i--) {
        const spine = document.createElement('div');
        spine.className = 'init-stack-spine';
        spine.style.setProperty('--depth', String(i));
        stack.appendChild(spine);
      }
      stack.appendChild(this._renderStagingCard(top, 'bench', { isTop: true, stackPos: 0, stackSize: total }));
      if (total > 1) {
        const count = document.createElement('span');
        count.className = 'init-stack-count';
        count.textContent = `+${total - 1}`;
        count.title = `${total - 1} more letters waiting in the bench (next is ${this.state.threatBench[1]!.threatLetter ?? '?'}).`;
        stack.appendChild(count);
      }
    }
    zone.appendChild(stack);
    return zone;
  }

  private _renderUnallocated(): HTMLElement {
    const zone = document.createElement('div');
    zone.className = 'init-zone init-zone--unallocated';
    const label = document.createElement('span');
    label.className = 'init-zone-label';
    label.textContent = 'Unallocated';
    zone.appendChild(label);
    const row = document.createElement('div');
    row.className = 'init-row init-row--unallocated';
    if (this.state.unallocated.length === 0) {
      row.appendChild(this._emptyHint('Everyone is in the rail.'));
    } else {
      for (const card of this.state.unallocated) {
        row.appendChild(this._renderStagingCard(card, 'unallocated', { isTop: true, stackPos: 0, stackSize: 1 }));
      }
    }
    zone.appendChild(row);
    return zone;
  }

  /** v2.16.58 — Discard pile. Cards dragged here are out of THIS combat.
   *  Rendered as a dimmed stack so the GM can see what's been taken out
   *  but can't accidentally re-use it. End Combat clears it. */
  private _renderDiscard(): HTMLElement {
    const zone = document.createElement('div');
    zone.className = 'init-zone init-zone--discard';
    const label = document.createElement('span');
    label.className = 'init-zone-label';
    label.textContent = 'Discard';
    zone.appendChild(label);
    const stack = document.createElement('div');
    stack.className = 'init-stack init-stack--discard';
    // Make the whole zone a drop target so the GM can fling cards in from
    // anywhere — rail, bench, tray. The state engine handles all three.
    zone.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('application/x-init-card')) return;
      e.preventDefault();
      stack.classList.add('is-drop-target');
    });
    zone.addEventListener('dragleave', () => stack.classList.remove('is-drop-target'));
    zone.addEventListener('drop', (e) => {
      stack.classList.remove('is-drop-target');
      const id = e.dataTransfer?.getData('application/x-init-card');
      if (!id) return;
      e.preventDefault();
      this._discard(id);
    });
    if (this.state.discarded.length === 0) {
      stack.appendChild(this._emptyHint('Drag here to remove from combat.'));
    } else {
      const total = this.state.discarded.length;
      for (let i = 0; i < total; i++) {
        const card = this.state.discarded[i]!;
        stack.appendChild(this._renderStagingCard(card, 'discard', { isTop: i === total - 1, stackPos: i, stackSize: total }));
      }
    }
    zone.appendChild(stack);
    return zone;
  }

  /** v2.16.58 — Render a staging card (bench / unallocated / discard).
   *  Re-uses the rail card visual idiom (tabs, body, portrait/letter)
   *  but swaps in value-input + drag handlers appropriate to the pile.
   *  - bench:       drag to rail OR discard; top has value-input
   *  - unallocated: drag to rail OR discard; every card has value-input
   *  - discard:     no drag, no input (out of combat); slightly dimmed
   */
  private _renderStagingCard(
    card: InitiativeCard,
    pile: 'bench' | 'unallocated' | 'discard',
    opts: { isTop: boolean; stackPos: number; stackSize: number },
  ): HTMLElement {
    const el = document.createElement('div');
    el.className = `init-card init-card--${card.type} init-card--staging init-card--${pile}`;
    if (pile === 'discard') el.classList.add('is-discarded');
    // v2.16.59 — only player cards inherit their identity colour inline;
    // enemy cards take the red CSS palette, round-marker the yellow.
    if (card.type === 'player') {
      el.style.setProperty('--init-color', card.color);
      el.style.setProperty('--init-color-fg', _isLightColor(card.color) ? '#0b0d12' : '#ffffff');
    }
    // Stack-position CSS variable lets the layout cascade staged cards.
    el.style.setProperty('--stack-pos', String(opts.stackPos));
    el.style.setProperty('--stack-size', String(opts.stackSize));
    el.dataset['cardId'] = card.id;
    el.dataset['pile'] = pile;

    // Drag source — every staging card is draggable except discard.
    if (pile !== 'discard') {
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', card.id);
        e.dataTransfer?.setData('application/x-init-card', card.id);
        e.dataTransfer?.setData('application/x-init-pile', pile);
        el.classList.add('is-dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('is-dragging'));
    }

    // Edge tabs (single-edge per orientation, per v2.16.57).
    const edgeText = card.type === 'enemy' ? (card.threatLetter ?? '?') : card.name;
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const tab = document.createElement('div');
      tab.className = `init-card-tab init-card-tab--${side}`;
      const t = document.createElement('span');
      t.className = 'init-card-tab-text';
      t.textContent = edgeText;
      tab.appendChild(t);
      el.appendChild(tab);
    }

    // Body — big VALUE for enemies AND players on the GM side (the
    // letter lives on the edge label, like the player's name lives on
    // theirs). Portrait/initial for players when no value yet.
    const body = document.createElement('div');
    body.className = 'init-card-body';
    if (card.type === 'enemy') {
      const big = document.createElement('div');
      big.className = 'init-card-big';
      big.textContent = card.value || '—';
      body.appendChild(big);
    } else if (card.markerUrl) {
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

    // Value input — only on the TOP card of the bench (so the GM types
    // into the "next available threat") and on every unallocated card
    // (each player rolls independently). Discard cards have no input.
    if ((pile === 'bench' && opts.isTop) || pile === 'unallocated') {
      const valInput = document.createElement('input');
      valInput.type = 'text';
      valInput.className = 'init-card-stage-value';
      valInput.placeholder = '#';
      valInput.title = 'Type the roll value + Enter to slot this card into the rail at the right position.';
      valInput.autocomplete = 'off';
      const commit = () => {
        const v = valInput.value.trim();
        if (!v) return;
        this._injectWithValue(card.id, v);
      };
      valInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { valInput.value = ''; valInput.blur(); }
      });
      // Don't let typing in the input start a drag of the card.
      valInput.addEventListener('mousedown', (e) => e.stopPropagation());
      valInput.addEventListener('dragstart', (e) => e.preventDefault());
      el.appendChild(valInput);
    }

    return el;
  }

  private _emptyHint(text: string): HTMLElement {
    const empty = document.createElement('span');
    empty.className = 'init-zone-empty';
    empty.textContent = text;
    return empty;
  }

  private _renderRail(): HTMLElement {
    const zone = document.createElement('div');
    zone.className = 'init-zone init-zone--rail init-rail-zone';
    const label = document.createElement('span');
    label.className = 'init-zone-label';
    label.textContent = 'Rail';
    zone.appendChild(label);
    const rail = document.createElement('div');
    rail.className = `init-rail ${isHorizontal(this.state.edge) ? 'is-horizontal' : 'is-vertical'}`;
    // v2.16.58 — rail accepts drops from bench / unallocated (inject) AND
    // from itself (reorder). Per-card drop targets handle the precise
    // position; the rail container catches "drop anywhere in here" for
    // staging piles when the GM doesn't aim at a specific slot.
    rail.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('application/x-init-card')) return;
      e.preventDefault();
    });
    rail.addEventListener('drop', (e) => {
      const id = e.dataTransfer?.getData('application/x-init-card');
      const pile = e.dataTransfer?.getData('application/x-init-pile');
      if (!id) return;
      // Only handle "stray" drops not consumed by a card-level handler.
      if ((e.target as HTMLElement).closest('.init-card')) return;
      e.preventDefault();
      if (pile === 'bench' || pile === 'unallocated') this._inject(id);
    });
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
    // v2.16.59 — for enemy and round-marker the palette is owned by CSS
    // (red for threats, yellow on black for END ROUND) so inline
    // --init-color would override the global rule.
    if (card.type === 'player') {
      el.style.setProperty('--init-color', card.color);
      el.style.setProperty('--init-color-fg', _isLightColor(card.color) ? '#0b0d12' : '#ffffff');
    }
    el.style.zIndex = String(100 - index);
    el.draggable = card.type !== 'round-marker';
    el.dataset['cardId'] = card.id;

    // Drag handlers — drag-to-reorder switches to manual sort mode; drops
    // from bench/unallocated inject the card at this position.
    el.addEventListener('dragstart', (e) => {
      if (card.type === 'round-marker') { e.preventDefault(); return; }
      e.dataTransfer?.setData('text/plain', card.id);
      e.dataTransfer?.setData('application/x-init-card', card.id);
      e.dataTransfer?.setData('application/x-init-pile', 'rail');
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
      const pile = e.dataTransfer?.getData('application/x-init-pile');
      if (!draggedId || draggedId === card.id) return;
      e.preventDefault();
      // v2.16.58 — drops from bench/unallocated inject (and the state
      // engine sorts); drops from rail reorder.
      if (pile === 'bench' || pile === 'unallocated') {
        this._inject(draggedId);
      } else {
        this._reorder(draggedId, index);
      }
    });

    // Right-click → Jump to Front (sudden reaction / boss phase trigger).
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (card.type !== 'round-marker' && index > 0) this._jumpToFront(card.id);
    });

    if (card.type === 'round-marker') {
      // v2.16.59 — "END ROUND" runs along the always-visible BOTTOM
      // edge so the GM reads it upright at a glance. Card body stays
      // black with the yellow accent driven by CSS.
      const tab = document.createElement('div');
      tab.className = 'init-card-tab init-card-tab--bottom init-card-tab--round-end';
      const t = document.createElement('span');
      t.className = 'init-card-tab-text';
      t.textContent = 'END ROUND';
      tab.appendChild(t);
      el.appendChild(tab);
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

/** YIQ brightness check — returns true for "light" hex colours so callers
 *  can pick a dark foreground against them. Accepts #rgb / #rrggbb. */
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
