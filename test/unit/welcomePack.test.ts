import { describe, it, expect, beforeEach } from 'vitest';
import {
  getWelcomePackSeededVersion,
  setWelcomePackSeededVersion,
  getWelcomePackOfferDismissedVersion,
  setWelcomePackOfferDismissedVersion,
  consumeWelcomePackRefreshedFlag,
  setWelcomePackRefreshedFlag,
} from '../../src/storage/localSettings.ts';

describe('Welcome-pack version tracking', () => {
  beforeEach(() => localStorage.clear());

  it('seeded version is null when never recorded, round-trips once set', () => {
    expect(getWelcomePackSeededVersion()).toBeNull();
    setWelcomePackSeededVersion(2);
    expect(getWelcomePackSeededVersion()).toBe(2);
  });

  it('offer-dismissed version defaults to 0 and round-trips', () => {
    expect(getWelcomePackOfferDismissedVersion()).toBe(0);
    setWelcomePackOfferDismissedVersion(2);
    expect(getWelcomePackOfferDismissedVersion()).toBe(2);
  });

  it('refreshed flag is one-shot — true once, then consumed', () => {
    expect(consumeWelcomePackRefreshedFlag()).toBe(false);
    setWelcomePackRefreshedFlag();
    expect(consumeWelcomePackRefreshedFlag()).toBe(true);
    expect(consumeWelcomePackRefreshedFlag()).toBe(false);
  });
});
