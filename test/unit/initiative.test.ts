import { describe, it, expect } from 'vitest';
import type { InitiativeCard, InitiativeState } from '../../src/types.ts';
import {
  sortActiveDeck,
  advanceTurn,
  addCardToDeck,
  removeFromDeck,
  injectFromStaging,
  makeRoundMarker,
  defaultInitiativeState,
  ensureRoundMarker,
  jumpToFront,
} from '../../src/initiative/initiativeState.ts';

function card(opts: Partial<InitiativeCard> & { id: string }): InitiativeCard {
  return {
    name: opts.name ?? `card-${opts.id}`,
    type: opts.type ?? 'player',
    color: opts.color ?? '#fff',
    value: opts.value ?? '',
    isSpent: opts.isSpent ?? false,
    ...opts,
  };
}

describe('Initiative — sort modes', () => {
  it('high-to-low places larger numeric rolls first; ROUND END stays last', () => {
    const deck = [
      card({ id: 'a', value: '12' }),
      card({ id: 'b', value: '20' }),
      card({ id: 'c', value: '8' }),
      makeRoundMarker(),
    ];
    const sorted = sortActiveDeck(deck, 'high-to-low');
    expect(sorted.map((c) => c.id)).toEqual(['b', 'a', 'c', 'round-end-marker']);
  });

  it('low-to-high reverses numeric order', () => {
    const deck = [card({ id: 'a', value: '12' }), card({ id: 'b', value: '4' }), card({ id: 'c', value: '8' })];
    const sorted = sortActiveDeck(deck, 'low-to-high');
    expect(sorted.map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('manual mode preserves order', () => {
    const deck = [card({ id: 'a', value: '5' }), card({ id: 'b', value: '20' })];
    expect(sortActiveDeck(deck, 'manual').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('numeric values sort ahead of empty / string values so rolled cards line up first', () => {
    const deck = [
      card({ id: 'pending', value: '' }),
      card({ id: 'rolled', value: '15' }),
      card({ id: 'name', value: 'Fast' }),
    ];
    const sorted = sortActiveDeck(deck, 'high-to-low');
    expect(sorted[0]!.id).toBe('rolled');
  });
});

describe('Initiative — advance turn', () => {
  it('moves the current actor to the very back (after ROUND END = acts next round) and marks spent', () => {
    const state: InitiativeState = {
      ...defaultInitiativeState(),
      activeDeck: [
        card({ id: 'a', value: '20' }),
        card({ id: 'b', value: '15' }),
        card({ id: 'c', value: '10' }),
        makeRoundMarker(),
      ],
    };
    const next = advanceTurn(state);
    // The spent actor parks behind the ROUND END marker so it acts NEXT round,
    // not twice this round. Verified in manual play.
    expect(next.activeDeck.map((c) => c.id)).toEqual(['b', 'c', 'round-end-marker', 'a']);
    expect(next.activeDeck.find((c) => c.id === 'a')!.isSpent).toBe(true);
    expect(next.activeDeck[0]!.isSpent).toBe(false); // next actor (b) is fresh
  });

  it('cycling past ROUND END resets every spent flag and parks marker at the back', () => {
    const state: InitiativeState = {
      ...defaultInitiativeState(),
      activeDeck: [
        makeRoundMarker(),
        card({ id: 'a', value: '20', isSpent: true }),
        card({ id: 'b', value: '15', isSpent: true }),
      ],
    };
    const next = advanceTurn(state);
    expect(next.activeDeck.map((c) => c.id)).toEqual(['a', 'b', 'round-end-marker']);
    expect(next.activeDeck.every((c) => !c.isSpent)).toBe(true);
  });
});

describe('Initiative — staging zones', () => {
  it('removing an enemy returns its card (cleared) to the threat bench', () => {
    const enemy = card({ id: 'e', type: 'enemy', threatLetter: 'A', value: '14', isSpent: true });
    const state: InitiativeState = {
      ...defaultInitiativeState(),
      threatBench: [],
      activeDeck: [enemy, makeRoundMarker()],
    };
    const next = removeFromDeck(state, 'e');
    expect(next.activeDeck.find((c) => c.id === 'e')).toBeUndefined();
    expect(next.threatBench).toHaveLength(1);
    expect(next.threatBench[0]).toMatchObject({ id: 'e', value: '', isSpent: false });
  });

  it('removing a player drops their card into the unallocated tray (cleared)', () => {
    const p = card({ id: 'p', type: 'player', playerId: 'pid', value: '12', isSpent: true });
    const state: InitiativeState = {
      ...defaultInitiativeState(),
      unallocated: [],
      activeDeck: [p, makeRoundMarker()],
    };
    const next = removeFromDeck(state, 'p');
    expect(next.unallocated).toHaveLength(1);
    expect(next.unallocated[0]).toMatchObject({ playerId: 'pid', value: '', isSpent: false });
  });

  it('injecting a bench chip moves it into the active deck', () => {
    const benchCard = card({ id: 'a', type: 'enemy', threatLetter: 'A' });
    const state: InitiativeState = { ...defaultInitiativeState(), threatBench: [benchCard], activeDeck: [makeRoundMarker()] };
    const next = injectFromStaging(state, 'a');
    expect(next.activeDeck.find((c) => c.id === 'a')).toBeDefined();
    expect(next.threatBench).toHaveLength(0);
  });
});

describe('Initiative — manual overrides', () => {
  it('jumpToFront pops a card to the active slot', () => {
    const state: InitiativeState = {
      ...defaultInitiativeState(),
      activeDeck: [card({ id: 'a' }), card({ id: 'b' }), card({ id: 'c' }), makeRoundMarker()],
    };
    const next = jumpToFront(state, 'c');
    expect(next.activeDeck[0]!.id).toBe('c');
  });
});

describe('Initiative — addCardToDeck + ensureRoundMarker', () => {
  it('addCardToDeck slots a card in by sort mode and keeps ROUND END at the back', () => {
    const state: InitiativeState = {
      ...defaultInitiativeState(),
      activeDeck: [card({ id: 'a', value: '12' }), makeRoundMarker()],
    };
    const next = addCardToDeck(state, card({ id: 'b', value: '18' }));
    expect(next.activeDeck.map((c) => c.id)).toEqual(['b', 'a', 'round-end-marker']);
  });

  it('ensureRoundMarker is idempotent', () => {
    const deck = [card({ id: 'a' }), makeRoundMarker()];
    expect(ensureRoundMarker(deck).filter((c) => c.type === 'round-marker').length).toBe(1);
  });
});
