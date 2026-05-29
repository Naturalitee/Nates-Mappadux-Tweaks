import { describe, it, expect } from 'vitest';
import {
  isReservedColor,
  normaliseHex,
  pickDefaultPlayerColor,
  PLAYER_COLOR_PALETTE,
} from '../../src/players/playerColors.ts';

describe('Player identity colours', () => {
  it('reserves black and near-black', () => {
    expect(isReservedColor('#000000')).toBe(true);
    expect(isReservedColor('#000')).toBe(true);
    expect(isReservedColor('#0a0a0a')).toBe(true);
    expect(isReservedColor('#101010')).toBe(true);
  });

  it('allows bright palette colours', () => {
    for (const c of PLAYER_COLOR_PALETTE) {
      expect(isReservedColor(c)).toBe(false);
    }
  });

  it('allows dark-but-saturated colours (deep navy stays usable)', () => {
    // Pure blue channel has low luminance weight, but a mid blue is fine.
    expect(isReservedColor('#3b82f6')).toBe(false);
  });

  it('treats unparseable input as reserved (so the picker rejects it)', () => {
    expect(isReservedColor('not-a-colour')).toBe(true);
    expect(isReservedColor('')).toBe(true);
  });

  it('normalises shorthand and case to #rrggbb', () => {
    expect(normaliseHex('#FFF')).toBe('#ffffff');
    expect(normaliseHex('#E03E3E')).toBe('#e03e3e');
  });

  it('picks the first unused palette colour', () => {
    const first = PLAYER_COLOR_PALETTE[0]!;
    const second = PLAYER_COLOR_PALETTE[1]!;
    expect(pickDefaultPlayerColor([])).toBe(first);
    expect(pickDefaultPlayerColor([first])).toBe(second);
    // Case/shorthand-insensitive: an upper-case duplicate still counts as used.
    expect(pickDefaultPlayerColor([first.toUpperCase()])).toBe(second);
  });

  it('falls back to the first palette colour when all are taken', () => {
    expect(pickDefaultPlayerColor([...PLAYER_COLOR_PALETTE])).toBe(PLAYER_COLOR_PALETTE[0]);
  });
});
