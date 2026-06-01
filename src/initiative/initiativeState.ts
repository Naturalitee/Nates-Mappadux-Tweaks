import type {
  InitiativeCard,
  InitiativeState,
  InitiativeSortMode,
  InitiativeEdge,
} from '../types.ts';
import { generateId } from '../utils/id.ts';

const STORAGE_KEY = 'mappadux:initiative_state';

/** Stable id for the ROUND END separator. */
export const ROUND_MARKER_ID = 'round-end-marker';

/** v2.16.59 — GM threat cards now read as evil-red so the GM clocks them
 *  instantly against the cooler player tints. (Player view enemies still
 *  paint charcoal via PlayerInitiativeRail's own hardcode — only the GM
 *  side gets the red.) */
export const THREAT_COLOR = '#b91c1c';

/** v2.16.59 — Yellow for the ROUND END card so its edge matches the
 *  yellow body text. Background gets a black override in CSS. */
export const ROUND_MARKER_COLOR = '#fbbf24';

/** Make a fresh ROUND END separator card. */
export function makeRoundMarker(): InitiativeCard {
  return {
    id: ROUND_MARKER_ID,
    name: 'ROUND END',
    type: 'round-marker',
    color: ROUND_MARKER_COLOR,
    value: '',
    isSpent: false,
  };
}

/** Make a fresh threat bench card with the next available letter. */
export function makeThreatCard(letter: string): InitiativeCard {
  return {
    id: generateId(),
    name: `Threat ${letter}`,
    type: 'enemy',
    color: THREAT_COLOR,
    threatLetter: letter,
    value: '',
    isSpent: false,
  };
}

/** Default initial state — empty rail, ROUND END parked at the back of the
 *  active deck the moment combat starts, A–F threat bench pre-seeded. */
export function defaultInitiativeState(): InitiativeState {
  return {
    activeDeck:  [],
    unallocated: [],
    // v2.16.59 — full A-Z reserve (was A-F). The GM works through the
     // top of the stack; deeper letters wait their turn. After Z the
     // bench is empty.
    threatBench: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(makeThreatCard),
    discarded:   [],
    sortMode: 'high-to-low',
    // v2.16.56 — default to TOP since the top of the player & GM views are
    // the least-cluttered surfaces today. Easy to repin via the edge select.
    edge:     'top',
    visible:  false,
  };
}

/** Persist current state to localStorage so a refresh mid-combat survives. */
export function saveInitiativeState(state: InitiativeState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

/** Load persisted state, or the default if absent / corrupt. */
export function loadInitiativeState(): InitiativeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultInitiativeState();
    const parsed = JSON.parse(raw) as Partial<InitiativeState>;
    return {
      activeDeck:  Array.isArray(parsed.activeDeck)  ? parsed.activeDeck  : [],
      unallocated: Array.isArray(parsed.unallocated) ? parsed.unallocated : [],
      threatBench: Array.isArray(parsed.threatBench) ? parsed.threatBench : defaultInitiativeState().threatBench,
      discarded:   Array.isArray(parsed.discarded)   ? parsed.discarded   : [],
      sortMode:    (parsed.sortMode as InitiativeSortMode | undefined) ?? 'high-to-low',
      edge:        (parsed.edge as InitiativeEdge | undefined) ?? 'top',
      visible:     !!parsed.visible,
    };
  } catch { return defaultInitiativeState(); }
}

/** Sort the active deck per sort mode, keeping the ROUND END marker last.
 *  v2.16.59 — TIE-BREAK BY ARRIVAL ORDER. When two cards have equal
 *  values the comparator returns 0 and the ES2019+ stable-sort guarantee
 *  preserves their input order. addCardToDeck appends new cards to the
 *  END of [...activeDeck, newCard] so a later submitter lands BEHIND an
 *  earlier one on a tie — "if the player is slow, their problem" (Alex
 *  2026-06-01). DO NOT add a fallback tie-break here. */
export function sortActiveDeck(deck: InitiativeCard[], mode: InitiativeSortMode): InitiativeCard[] {
  if (mode === 'manual') return deck;
  const roundMarker = deck.find((c) => c.type === 'round-marker');
  const rest = deck.filter((c) => c.type !== 'round-marker');
  rest.sort((a, b) => {
    const an = parseFloat(a.value);
    const bn = parseFloat(b.value);
    const aIsNum = !isNaN(an) && a.value.trim() !== '';
    const bIsNum = !isNaN(bn) && b.value.trim() !== '';
    if (aIsNum && bIsNum) return mode === 'high-to-low' ? bn - an : an - bn;
    // Numeric values sort ahead of un-rolled string values so cards with rolls
    // line up where the GM expects.
    if (aIsNum) return -1;
    if (bIsNum) return 1;
    // v2.16.59 — non-numeric values (FAST / SLOW / ACE / etc) sort
    // ALPHABETICALLY A→Z regardless of numeric sort direction. Same-string
    // ties resolve by arrival order via stable sort (Alex 2026-06-01).
    return a.value.localeCompare(b.value, undefined, { sensitivity: 'base' });
  });
  return roundMarker ? [...rest, roundMarker] : rest;
}

/** Advance the active turn: the current actor goes to spent at the back; the
 *  next card slides into focus. Cycling past ROUND END resets all spent flags
 *  and parks the marker at the rear for the new round. */
export function advanceTurn(state: InitiativeState): InitiativeState {
  if (state.activeDeck.length === 0) return state;
  const [head, ...rest] = state.activeDeck;
  if (head!.type === 'round-marker') {
    return {
      ...state,
      activeDeck: [...rest.map((c) => ({ ...c, isSpent: false })), head!],
    };
  }
  const spent: InitiativeCard = { ...head!, isSpent: true };
  const roundIdx = rest.findIndex((c) => c.type === 'round-marker');
  const newDeck = roundIdx === -1
    ? [...rest, spent]
    : [...rest.slice(0, roundIdx), spent, ...rest.slice(roundIdx)];
  return { ...state, activeDeck: newDeck };
}

/** Ensure the ROUND END marker sits at the back of the active deck. Idempotent. */
export function ensureRoundMarker(deck: InitiativeCard[]): InitiativeCard[] {
  if (deck.length === 0) return [];
  const hasMarker = deck.some((c) => c.type === 'round-marker');
  if (hasMarker) {
    const marker = deck.find((c) => c.type === 'round-marker')!;
    const rest = deck.filter((c) => c.type !== 'round-marker');
    return [...rest, marker];
  }
  return [...deck, makeRoundMarker()];
}

/** GM types a value into a card — re-sort the deck per current mode. */
export function patchCardValue(state: InitiativeState, cardId: string, value: string): InitiativeState {
  const updated = state.activeDeck.map((c) => c.id === cardId ? { ...c, value } : c);
  return { ...state, activeDeck: sortActiveDeck(updated, state.sortMode) };
}

/** Add a fresh card to the active deck in the right place for sort mode. */
export function addCardToDeck(state: InitiativeState, card: InitiativeCard): InitiativeState {
  const deck = state.sortMode === 'manual'
    ? // Manual mode: drop at the back, just before ROUND END if present.
      (() => {
        const roundIdx = state.activeDeck.findIndex((c) => c.type === 'round-marker');
        return roundIdx === -1
          ? [...state.activeDeck, card]
          : [...state.activeDeck.slice(0, roundIdx), card, ...state.activeDeck.slice(roundIdx)];
      })()
    : sortActiveDeck([...state.activeDeck, card], state.sortMode);
  return { ...state, activeDeck: ensureRoundMarker(deck) };
}

/** Pop a card out of the active deck. Enemies return to the threat bench;
 *  player cards drop into the unallocated tray. */
export function removeFromDeck(state: InitiativeState, cardId: string): InitiativeState {
  const card = state.activeDeck.find((c) => c.id === cardId);
  if (!card || card.type === 'round-marker') return state;
  const newDeck = state.activeDeck.filter((c) => c.id !== cardId);
  if (card.type === 'enemy') {
    const wiped: InitiativeCard = { ...card, value: '', isSpent: false };
    return { ...state, activeDeck: newDeck, threatBench: [...state.threatBench, wiped] };
  }
  // player card → unallocated (cleared)
  const wiped: InitiativeCard = { ...card, value: '', isSpent: false };
  return { ...state, activeDeck: newDeck, unallocated: [...state.unallocated, wiped] };
}

/** Drop a card from the threat bench or unallocated tray into the active deck. */
export function injectFromStaging(state: InitiativeState, cardId: string): InitiativeState {
  const benchIdx = state.threatBench.findIndex((c) => c.id === cardId);
  if (benchIdx !== -1) {
    const card = state.threatBench[benchIdx]!;
    return addCardToDeck(
      { ...state, threatBench: state.threatBench.filter((_, i) => i !== benchIdx) },
      card,
    );
  }
  const trayIdx = state.unallocated.findIndex((c) => c.id === cardId);
  if (trayIdx !== -1) {
    const card = state.unallocated[trayIdx]!;
    return addCardToDeck(
      { ...state, unallocated: state.unallocated.filter((_, i) => i !== trayIdx) },
      card,
    );
  }
  return state;
}

/** Wipe everything but keep settings (sort mode + edge + visible). */
export function endCombat(state: InitiativeState): InitiativeState {
  return {
    ...state,
    activeDeck: [],
    unallocated: [],
    threatBench: defaultInitiativeState().threatBench,
    discarded:   [],
  };
}

/** v2.16.59 — When END ROUND reaches the front of the deck the GM gets
 *  two choices: Start Next Round (keep initiative order, reset spent
 *  flags — same as advanceTurn would do on a round-marker head) and
 *  Reroll Initiative (some systems re-roll every round). This is the
 *  reroll path: every active player card goes back to the tray with
 *  value cleared, every active enemy is returned to the bench, deck
 *  starts fresh, discarded is preserved. Round marker re-seeded by the
 *  next addCardToDeck. Caller is responsible for broadcasting the
 *  initiative_call to player views. */
export function rerollInitiative(state: InitiativeState): InitiativeState {
  // Active players → tray (value cleared, spent cleared).
  const playerCards = state.activeDeck
    .filter((c) => c.type === 'player')
    .map((c) => ({ ...c, value: '', isSpent: false }));
  // Active enemies → bench (value cleared). Letters stay so the GM
  // recognises which monsters are returning.
  const enemyCards = state.activeDeck
    .filter((c) => c.type === 'enemy')
    .map((c) => ({ ...c, value: '', isSpent: false }));
  return {
    ...state,
    activeDeck:  [],
    unallocated: [...state.unallocated.map((c) => ({ ...c, value: '', isSpent: false })), ...playerCards],
    // Returned enemies go to the FRONT of the bench so they're the next
    // letters available (the deeper unused letters wait their turn).
    threatBench: [...enemyCards, ...state.threatBench],
  };
}

/** v2.16.58 — Drop a card from ANY pile (active deck, bench, tray) into the
 *  discard pile. Cards in the discard pile are out of THIS combat; they
 *  won't return to bench / tray automatically. End Combat clears the
 *  discard along with everything else. Returns state unchanged if cardId
 *  is unknown or the card is the ROUND END marker. */
export function discardCard(state: InitiativeState, cardId: string): InitiativeState {
  const fromDeck  = state.activeDeck.find((c) => c.id === cardId);
  const fromBench = state.threatBench.find((c) => c.id === cardId);
  const fromTray  = state.unallocated.find((c) => c.id === cardId);
  const card = fromDeck ?? fromBench ?? fromTray;
  if (!card || card.type === 'round-marker') return state;
  const wiped: InitiativeCard = { ...card, value: '', isSpent: false };
  return {
    ...state,
    activeDeck:  state.activeDeck.filter((c) => c.id !== cardId),
    threatBench: state.threatBench.filter((c) => c.id !== cardId),
    unallocated: state.unallocated.filter((c) => c.id !== cardId),
    discarded:   [...state.discarded, wiped],
  };
}

/** v2.16.58 — Inject a card from the bench/tray into the active deck AND
 *  immediately patch its value in one mutation so the card lands at the
 *  correct sort position. Used by the type-to-inject flow on bench/tray
 *  cards. If value is empty it's a plain inject (current behaviour).
 *
 *  v2.16.59 — In MANUAL sort mode the previous compose-then-patch
 *  approach left the new card at the back (manual sort doesn't auto-
 *  resort). Now we insert the staged card directly at its value-sorted
 *  position regardless of mode — descending by default in manual; the
 *  rest of the manually-positioned cards stay where the GM put them. */
export function injectFromStagingWithValue(state: InitiativeState, cardId: string, value: string): InitiativeState {
  // Find + extract the card from whichever staging pile holds it.
  const benchIdx = state.threatBench.findIndex((c) => c.id === cardId);
  const trayIdx  = state.unallocated.findIndex((c) => c.id === cardId);
  let card: InitiativeCard | undefined;
  let threatBench = state.threatBench;
  let unallocated = state.unallocated;
  if (benchIdx !== -1) {
    card = { ...state.threatBench[benchIdx]!, value: value.trim() };
    threatBench = state.threatBench.filter((_, i) => i !== benchIdx);
  } else if (trayIdx !== -1) {
    card = { ...state.unallocated[trayIdx]!, value: value.trim() };
    unallocated = state.unallocated.filter((_, i) => i !== trayIdx);
  } else {
    return state;
  }

  let activeDeck: InitiativeCard[];
  if (state.sortMode === 'manual') {
    // Manual mode: insert by value, preserve other cards' positions.
    activeDeck = _insertByValue(state.activeDeck, card, 'high-to-low');
  } else {
    // Numeric mode: full sort.
    activeDeck = sortActiveDeck([...state.activeDeck, card], state.sortMode);
  }
  activeDeck = ensureRoundMarker(activeDeck);
  return { ...state, threatBench, unallocated, activeDeck };
}

/** Insert a card into the active deck by VALUE without disturbing the
 *  order of the other cards. Used when type-to-injecting in manual mode
 *  so the new card slots into the right place but everyone else's
 *  GM-curated position stays put. */
function _insertByValue(deck: InitiativeCard[], card: InitiativeCard, dir: 'high-to-low' | 'low-to-high'): InitiativeCard[] {
  const cardN = parseFloat(card.value);
  const cardIsNum = !isNaN(cardN) && card.value.trim() !== '';
  if (!cardIsNum) {
    // Non-numeric: alphabetical A→Z slot, sitting AFTER all numeric
    // cards and AFTER any earlier-letter non-numeric cards. Same-string
    // ties land at the END of the equal-string run (arrival-order tie-
    // break per the sortActiveDeck contract).
    let i = 0;
    while (i < deck.length) {
      const d = deck[i]!;
      if (d.type === 'round-marker') break;
      const dN = parseFloat(d.value);
      const dIsNum = !isNaN(dN) && d.value.trim() !== '';
      if (dIsNum) { i++; continue; }   // numerics always ahead of strings
      if (d.value.localeCompare(card.value, undefined, { sensitivity: 'base' }) > 0) break;
      i++;
    }
    return [...deck.slice(0, i), card, ...deck.slice(i)];
  }
  let i = 0;
  while (i < deck.length) {
    const d = deck[i]!;
    if (d.type === 'round-marker') break;
    const dN = parseFloat(d.value);
    const dIsNum = !isNaN(dN) && d.value.trim() !== '';
    if (!dIsNum) break;            // non-numeric existing card: insert before it
    if (dir === 'high-to-low' ? dN < cardN : dN > cardN) break;
    i++;
  }
  return [...deck.slice(0, i), card, ...deck.slice(i)];
}

/** Manual drag-reorder of a card within the active deck (sort mode → manual). */
export function reorderCard(state: InitiativeState, cardId: string, toIndex: number): InitiativeState {
  const fromIdx = state.activeDeck.findIndex((c) => c.id === cardId);
  if (fromIdx === -1) return state;
  const next = state.activeDeck.slice();
  const [card] = next.splice(fromIdx, 1);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, card!);
  return { ...state, activeDeck: ensureRoundMarker(next), sortMode: 'manual' };
}

/** Send a card to the front (right-click Jump to Front). */
export function jumpToFront(state: InitiativeState, cardId: string): InitiativeState {
  const idx = state.activeDeck.findIndex((c) => c.id === cardId);
  if (idx <= 0) return state;
  const next = state.activeDeck.slice();
  const [card] = next.splice(idx, 1);
  next.unshift(card!);
  return { ...state, activeDeck: next };
}

/** Upsert a player card from an incoming initiative_roll. */
export function ingestPlayerRoll(
  state: InitiativeState,
  playerId: string,
  playerName: string,
  characterName: string,
  color: string,
  value: string,
): InitiativeState {
  // Remove any existing player card or unallocated entry for this player.
  const cleanedDeck  = state.activeDeck.filter((c) => c.playerId !== playerId);
  const cleanedUnall = state.unallocated.filter((c) => c.playerId !== playerId);
  const card: InitiativeCard = {
    id: generateId(),
    name: characterName || playerName || 'Player',
    type: 'player',
    color,
    playerId,
    value,
    isSpent: false,
  };
  const next = addCardToDeck({ ...state, activeDeck: cleanedDeck, unallocated: cleanedUnall }, card);
  return next;
}
