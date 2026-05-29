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

/** Default colour palette for the GM Threat Bench letters (charcoal so it stays
 *  in the reserved range; players see "???" / "Opposition" anyway). */
export const THREAT_COLOR = '#1f2937';

/** Neutral tone for the ROUND END card. */
export const ROUND_MARKER_COLOR = '#475569';

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
    threatBench: ['A', 'B', 'C', 'D', 'E', 'F'].map(makeThreatCard),
    sortMode: 'high-to-low',
    edge:     'bottom',
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
      sortMode:    (parsed.sortMode as InitiativeSortMode | undefined) ?? 'high-to-low',
      edge:        (parsed.edge as InitiativeEdge | undefined) ?? 'bottom',
      visible:     !!parsed.visible,
    };
  } catch { return defaultInitiativeState(); }
}

/** Sort the active deck per sort mode, keeping the ROUND END marker last. */
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
    return mode === 'high-to-low' ? b.value.localeCompare(a.value) : a.value.localeCompare(b.value);
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
  };
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
