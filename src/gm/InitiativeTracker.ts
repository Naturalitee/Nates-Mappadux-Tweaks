import type { InitiativeCard, InitiativeState, InitiativeEdge, PersistentPlayer } from '../types.ts';
import {
  saveInitiativeState,
  sortActiveDeck,
  advanceTurn,
  patchCardValue,
  addCardToDeck,
  injectFromStagingAt,
  injectFromStagingWithValue,
  discardCard,
  endCombat,
  resetForNewCombat,
  restoreFromDiscard,
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
  /** v2.16.63 — discard pile expansion state (UI-only, not persisted).
   *  When true, the discard cards fan out so the GM can grab one back. */
  private _discardExpanded = false;
  /** v2.16.63 — index where a dragged card would land if dropped. null
   *  when no drag is over the rail. Drives the visual "gap" between
   *  rail cards as the GM hovers. */
  private _dragOverInsertIndex: number | null = null;
  /** Cached rail element so dragover updates can re-paint gap classes
   *  without a full re-render. */
  private _railEl: HTMLElement | null = null;

  constructor(root: HTMLElement, initial: InitiativeState, cb: InitiativeTrackerCallbacks) {
    this.root = root;
    this.state = ensureMarkerIfActive(initial);
    this.cb = cb;
    this._render();
    // v2.16.68 — REVERTED v2.16.67's root-level stopPropagation. It was
    // breaking HTML5 drag-and-drop on cards because the native drag
    // initiation path depends on mousedown propagating up. The pan-
    // suppression now lives in the GM canvas's pan handler (which
    // checks if the event target lives inside any UI overlay).
  }

  /** Replace state wholesale (e.g. after a localStorage reload). */
  setState(state: InitiativeState): void { this.state = ensureMarkerIfActive(state); this._render(); }

  /** v2.16.63 — Reset for a new combat: wipes deck + tray + bench, keeps
   *  the discard pile so dead characters / monsters stay dead across
   *  combats within the same campaign session. */
  resetForNewCombat(): void { this._mutate(resetForNewCombat); }

  /** v2.16.65 — Sync sort direction from the global Settings dialog.
   *  Updates lastNumericSortMode + (re-applies sort unless GM is in
   *  manual mode). Doesn't reset the deck — just rewrites direction. */
  setSortDirection(dir: 'high-to-low' | 'low-to-high'): void {
    this._mutate((s) => ({
      ...s,
      lastNumericSortMode: dir,
      sortMode: s.sortMode === 'manual' ? 'manual' : dir,
      activeDeck: s.sortMode === 'manual' ? s.activeDeck : sortActiveDeck(s.activeDeck, dir),
    }));
  }

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


  private _setEdge(edge: InitiativeEdge): void { this._mutate((s) => ({ ...s, edge })); }

  private _endCombat(): void {
    if (!confirm('End combat? Clears the rail + tray + bench + discard and closes the tracker.')) return;
    // v2.16.61 — End Combat is now also the "close tracker" affordance
    // (the hide × went away). Wipe + close in one mutation.
    this._mutate((s) => ({ ...endCombat(s), visible: false }));
  }

  private _editValue(cardId: string, value: string): void {
    this._mutate((s) => patchCardValue(s, cardId, value));
  }

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

    // v2.16.63 — far-left (or top in vertical mode) drag bar. Click to
    // cycle dock position top → right → bottom → left → top. Replaces
    // the edge dropdown with a tactile grip the GM can see + grab. The
    // chosen edge persists via state.edge.
    const dragBar = document.createElement('div');
    dragBar.className = 'init-drag-bar';
    dragBar.title = `Drag to a screen edge to dock the tracker (currently ${this.state.edge}). Quick click cycles through edges.`;
    dragBar.setAttribute('aria-label', 'Drag to dock the tracker');
    dragBar.setAttribute('role', 'button');
    // v2.16.65 — real drag with snap-to-edge on release. Pointer is
    // captured so the drag survives leaving the bar. Quick clicks
    // (no meaningful movement) cycle to the next edge as a fallback
    // so the bar still works on keyboard / touch with no drag motion.
    // v2.16.71 — VISIBLE drag. While dragging, the whole tracker follows
    // the cursor (translate + dimmed) so it reads as "I am moving this".
    // On release it snaps to the nearest viewport edge. A quick click with
    // no real movement still cycles edges as a keyboard/touch fallback.
    let dragStart: { x: number; y: number } | null = null;
    const clearDragVisual = () => {
      this.root.style.transform = '';
      this.root.style.opacity = '';
      this.root.classList.remove('is-dock-dragging');
    };
    dragBar.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      dragStart = { x: e.clientX, y: e.clientY };
      dragBar.setPointerCapture?.(e.pointerId);
      dragBar.classList.add('is-grabbing');
    });
    dragBar.addEventListener('pointermove', (e) => {
      if (!dragStart) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      // Only start the visible follow once past a small threshold so a
      // click doesn't jitter the tracker.
      if (Math.hypot(dx, dy) < 6 && !this.root.classList.contains('is-dock-dragging')) return;
      this.root.classList.add('is-dock-dragging');
      this.root.style.transform = `translate(${dx}px, ${dy}px)`;
      this.root.style.opacity = '0.85';
    });
    dragBar.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      dragBar.classList.remove('is-grabbing');
      if (!dragStart) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      const moved = Math.hypot(dx, dy) > 24;
      dragStart = null;
      clearDragVisual();
      if (moved) {
        // Snap to whichever viewport edge the cursor was closest to on release.
        const x = e.clientX, y = e.clientY;
        const w = window.innerWidth, h = window.innerHeight;
        const distances: Array<[InitiativeEdge, number]> = [
          ['top',    y],
          ['bottom', h - y],
          ['left',   x],
          ['right',  w - x],
        ];
        distances.sort((a, b) => a[1] - b[1]);
        this._setEdge(distances[0]![0]);
      } else {
        this._cycleEdge();
      }
    });
    dragBar.addEventListener('pointercancel', () => { dragStart = null; dragBar.classList.remove('is-grabbing'); clearDragVisual(); });
    dragBar.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });
    ctl.append(dragBar);

    // Primary column: Advance, Roll Initiative, End Combat — the three
    // main combat-loop actions. Reroll Initiative joins them only when
    // END ROUND is at the front of the deck (round transition).
    const primary = document.createElement('div');
    primary.className = 'init-controls-primary';

    const headIsRoundEnd = this.state.activeDeck[0]?.type === 'round-marker';
    const advance = headIsRoundEnd
      ? mkBtn('Start Next Round ▶', 'init-btn init-btn--advance', () => this._advance())
      : mkBtn('Advance ▶', 'init-btn init-btn--advance', () => this._advance());
    // v2.16.63 — "Reroll Initiative" (orange) is the consolidated primary
    // initiative action. Resets deck + tray + bench (preserving discard)
    // and re-prompts players. Both this button and the Players-panel
    // orange one route through cb.onCallForInitiative.
    const reroll = mkBtn('Reroll Initiative', 'init-btn init-btn--roll', () => this.cb.onCallForInitiative());
    const end = mkBtn('End Combat', 'init-btn init-btn--danger', () => this._endCombat());
    primary.append(advance, reroll, end);
    ctl.append(primary);
    // v2.16.64 — sort-direction dropdown removed. Direction is a
    // one-time settings choice (default High → Low). Manual mode is
    // reached implicitly by dragging a card.
    return ctl;
  }

  /** v2.16.63 — cycle through the four dock edges. The drag-bar click
   *  invokes this; the chosen edge persists via state.edge → localStorage. */
  private _cycleEdge(): void {
    const order: InitiativeEdge[] = ['top', 'right', 'bottom', 'left'];
    const idx = order.indexOf(this.state.edge);
    const next = order[(idx + 1) % order.length]!;
    this._setEdge(next);
  }

  /** v2.16.63 — figure out which slot the cursor would drop into based on
   *  rail-card midpoints. Skips the card currently being dragged so the
   *  source position doesn't influence the gap calc. */
  private _computeRailInsertIndex(rail: HTMLElement, clientX: number, clientY: number): number {
    const isH = isHorizontal(this.state.edge);
    const cards = Array.from(rail.querySelectorAll<HTMLElement>('.init-card'));
    let realIndex = 0;
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i]!;
      if (card.classList.contains('is-dragging')) continue;
      const rect = card.getBoundingClientRect();
      const cursor = isH ? clientX : clientY;
      const midpoint = isH ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
      if (cursor < midpoint) return realIndex;
      realIndex++;
    }
    return realIndex;
  }

  /** v2.16.63 — open / close the rail "gap" by toggling .is-gap-shift on
   *  cards at or after the insertion point. Direct DOM mutation, not a
   *  re-render — keeps the drag UX 60fps. */
  private _applyRailGap(insertIndex: number | null): void {
    if (!this._railEl) return;
    const cards = Array.from(this._railEl.querySelectorAll<HTMLElement>('.init-card'));
    let nonDraggedIndex = 0;
    for (const card of cards) {
      if (card.classList.contains('is-dragging')) continue;
      if (insertIndex !== null && nonDraggedIndex >= insertIndex) {
        card.classList.add('is-gap-shift');
      } else {
        card.classList.remove('is-gap-shift');
      }
      nonDraggedIndex++;
    }
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
    // v2.16.65 — discarded enemies dragged here jump back to the TOP
    // of the bench so the next-letter slot is the GM's revived monster.
    zone.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.getData('application/x-init-pile') !== 'discard') return;
      e.preventDefault();
      stack.classList.add('is-drop-target');
    });
    zone.addEventListener('dragleave', () => stack.classList.remove('is-drop-target'));
    zone.addEventListener('drop', (e) => {
      stack.classList.remove('is-drop-target');
      if (e.dataTransfer?.getData('application/x-init-pile') !== 'discard') return;
      const id = e.dataTransfer?.getData('application/x-init-card');
      if (!id) return;
      e.preventDefault();
      this._mutate((s) => restoreFromDiscard(s, id));
    });
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
    // v2.16.65 — discarded player cards dragged here land back in the
    // tray (cleared value) so the GM can re-add them to play.
    zone.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.getData('application/x-init-pile') !== 'discard') return;
      e.preventDefault();
      row.classList.add('is-drop-target');
    });
    zone.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
    zone.addEventListener('drop', (e) => {
      row.classList.remove('is-drop-target');
      if (e.dataTransfer?.getData('application/x-init-pile') !== 'discard') return;
      const id = e.dataTransfer?.getData('application/x-init-card');
      if (!id) return;
      e.preventDefault();
      this._mutate((s) => restoreFromDiscard(s, id));
    });
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
    stack.className = `init-stack init-stack--discard${this._discardExpanded ? ' is-expanded' : ''}`;
    // Drop target for incoming discards from any pile.
    zone.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('application/x-init-card')) return;
      // Only accept discard drops when not already a drag FROM discard
      // (we don't accept discarded cards back into the discard pile).
      if (e.dataTransfer.getData('application/x-init-pile') === 'discard') return;
      e.preventDefault();
      stack.classList.add('is-drop-target');
    });
    zone.addEventListener('dragleave', () => stack.classList.remove('is-drop-target'));
    zone.addEventListener('drop', (e) => {
      stack.classList.remove('is-drop-target');
      if (e.dataTransfer?.getData('application/x-init-pile') === 'discard') return;
      const id = e.dataTransfer?.getData('application/x-init-card');
      if (!id) return;
      e.preventDefault();
      this._discard(id);
    });
    if (this.state.discarded.length === 0) {
      stack.appendChild(this._emptyHint('Drag here to remove from combat.'));
    } else {
      // v2.16.63 — clicking the stack toggles "expanded" mode. While
      // expanded the cards fan out to the side AND become draggable,
      // letting the GM pull one back into the rail/bench/tray if they
      // discarded by mistake. No card EVER disappears.
      stack.style.cursor = 'pointer';
      stack.title = this._discardExpanded
        ? 'Click to close the discard fan'
        : 'Click to fan the discard — pull a card back to revive it';
      stack.addEventListener('click', (e) => {
        // Ignore clicks that bubbled up from a dragstart-related event.
        if ((e.target as HTMLElement).closest('.init-card-stage-value')) return;
        this._discardExpanded = !this._discardExpanded;
        this._render();
      });
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

    // Drag source — bench/unallocated cards are always draggable.
    // Discard cards are only draggable while the pile is expanded
    // (v2.16.63 click-to-fan affordance) so the GM can pull them back.
    const draggable = pile !== 'discard' || this._discardExpanded;
    if (draggable) {
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
    // v2.16.63 — rail gap-on-drag. As the GM drags any card over the
    // rail, the cards at and after the would-be insertion point shift
    // away to open a gap. Drop lands at that index precisely. Drops
    // from bench / unallocated / discard inject at the gap; rail→rail
    // drops reorder. Per-card drop handlers are gone (rail-level owns it).
    this._railEl = rail;
    rail.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('application/x-init-card')) return;
      e.preventDefault();
      const newIndex = this._computeRailInsertIndex(rail, e.clientX, e.clientY);
      if (newIndex !== this._dragOverInsertIndex) {
        this._dragOverInsertIndex = newIndex;
        this._applyRailGap(newIndex);
      }
    });
    rail.addEventListener('dragleave', (e) => {
      // Only clear the gap when leaving the rail entirely — moving
      // between sibling cards fires dragleave + dragenter pairs.
      if (rail.contains(e.relatedTarget as Node | null)) return;
      this._applyRailGap(null);
      this._dragOverInsertIndex = null;
    });
    rail.addEventListener('drop', (e) => {
      const id = e.dataTransfer?.getData('application/x-init-card');
      const pile = e.dataTransfer?.getData('application/x-init-pile');
      const insertIndex = this._dragOverInsertIndex ?? this.state.activeDeck.length;
      this._applyRailGap(null);
      this._dragOverInsertIndex = null;
      if (!id) return;
      e.preventDefault();
      if (pile === 'bench' || pile === 'unallocated' || pile === 'discard') {
        this._mutate((s) => injectFromStagingAt(s, id, insertIndex));
      } else if (pile === 'rail') {
        this._reorder(id, insertIndex);
      }
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

    // v2.16.63 — drag source only. The rail-level dragover/drop handler
    // computes the precise insertion index (via the gap visual) and
    // routes inject vs reorder. Per-card drop handlers are gone.
    el.addEventListener('dragstart', (e) => {
      if (card.type === 'round-marker') { e.preventDefault(); return; }
      e.dataTransfer?.setData('text/plain', card.id);
      e.dataTransfer?.setData('application/x-init-card', card.id);
      e.dataTransfer?.setData('application/x-init-pile', 'rail');
      el.classList.add('is-dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('is-dragging'));

    // Right-click → Jump to Front (sudden reaction / boss phase trigger).
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (card.type !== 'round-marker' && index > 0) this._jumpToFront(card.id);
    });

    if (card.type === 'round-marker') {
      // v2.16.62 — treat the round marker like any other card: same
      // 4-edge tab pattern with CSS hiding three of four based on rail
      // orientation. END ROUND text reads on whichever edge is visible
      // (right in horizontal rail, bottom in vertical). No special
      // positioning — just always at the back of the deck.
      for (const side of ['left', 'right', 'top', 'bottom'] as const) {
        const tab = document.createElement('div');
        tab.className = `init-card-tab init-card-tab--${side}`;
        const t = document.createElement('span');
        t.className = 'init-card-tab-text';
        t.textContent = 'END ROUND';
        tab.appendChild(t);
        el.appendChild(tab);
      }
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

    // Main body — GM-facing mechanical face: giant VALUE on both enemy
    // and player cards (the letter / name lives on the edge label).
    // v2.16.62 — was previously showing the threat letter in the body
    // too; that duplicated the edge label and hid the GM's typed roll.
    const body = document.createElement('div');
    body.className = 'init-card-body';
    if (card.type === 'enemy') {
      const big = document.createElement('div');
      big.className = 'init-card-big';
      big.textContent = card.value || '—';
      body.appendChild(big);
    } else {
      const big = document.createElement('div');
      big.className = 'init-card-big';
      big.textContent = card.value || '—';
      body.appendChild(big);
    }
    el.appendChild(body);

    // v2.16.60 — corner X removed. Discard pile is the only removal
    // affordance (drag-only). Cards never disappear — they can be
    // dragged back when the discard is fanned. The old delete path
    // (return enemy to bench / player to tray on click) is no longer
    // surfaced; if the GM wants to un-deck a card without discarding
    // they drag it to bench / unallocated zones.

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
