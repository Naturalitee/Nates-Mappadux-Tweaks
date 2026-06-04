import { describe, it, expect } from 'vitest';
import { perceptualVolume } from '../../src/audio/volumeCurve.ts';

describe('perceptualVolume — soundboard fader taper', () => {
  it('maps the endpoints to themselves (silence + full scale unchanged)', () => {
    expect(perceptualVolume(0)).toBe(0);
    expect(perceptualVolume(1)).toBe(1);
  });

  it('pulls the low end down hard so low fader positions are actually quiet', () => {
    // The whole point: a low slider position used to play near full volume.
    expect(perceptualVolume(0.05)).toBeCloseTo(0.0025, 6); // was 0.05 linear
    expect(perceptualVolume(0.1)).toBeCloseTo(0.01, 6);
  });

  it('is monotonic and below-or-equal linear across the range', () => {
    let prev = -1;
    for (let p = 0; p <= 1.0001; p += 0.1) {
      const g = perceptualVolume(p);
      expect(g).toBeGreaterThanOrEqual(prev); // monotonically increasing
      expect(g).toBeLessThanOrEqual(p + 1e-9); // never louder than linear
      prev = g;
    }
  });

  it('clamps out-of-range input', () => {
    expect(perceptualVolume(-0.5)).toBe(0);
    expect(perceptualVolume(2)).toBe(1);
  });
});
