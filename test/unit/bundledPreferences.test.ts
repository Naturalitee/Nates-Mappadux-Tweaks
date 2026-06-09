import { describe, it, expect, beforeEach } from 'vitest';
import {
  collectBundledPreferences,
  applyBundledPreferences,
  getMeasureUnitValue,
  getMeasureUnitSuffix,
  getInitiativeSortDirection,
  isInitiativeAnonymised,
  arePingsEnabled,
  isMessagingEnabled,
  arePlayerMarkersMovable,
} from '../../src/storage/localSettings.ts';

describe('Bundled GM preferences — pack round-trip', () => {
  beforeEach(() => localStorage.clear());

  it('defaults are sensible when nothing is stored', () => {
    const p = collectBundledPreferences();
    expect(p.measureUnitValue).toBe(5);
    expect(p.measureUnitSuffix).toBe("'");
    expect(p.initiativeSortDirection).toBe('high-to-low');
    expect(p.initiativeAnonymise).toBe(true);
    expect(p.playerPingsEnabled).toBe(true);
    expect(p.playerMessagingEnabled).toBe(true);
    expect(p.playerMarkersMovable).toBe(true);
  });

  it('apply then collect round-trips every field', () => {
    applyBundledPreferences({
      measureUnitValue: 3,
      measureUnitSuffix: 'm',
      initiativeSortDirection: 'low-to-high',
      initiativeAnonymise: false,
      playerPingsEnabled: false,
      playerMessagingEnabled: false,
      playerMarkersMovable: false,
    });
    expect(getMeasureUnitValue()).toBe(3);
    expect(getMeasureUnitSuffix()).toBe('m');
    expect(getInitiativeSortDirection()).toBe('low-to-high');
    expect(isInitiativeAnonymised()).toBe(false);
    expect(arePingsEnabled()).toBe(false);
    expect(isMessagingEnabled()).toBe(false);
    expect(arePlayerMarkersMovable()).toBe(false);
    expect(collectBundledPreferences()).toEqual({
      measureUnitValue: 3,
      measureUnitSuffix: 'm',
      initiativeSortDirection: 'low-to-high',
      initiativeAnonymise: false,
      playerPingsEnabled: false,
      playerMessagingEnabled: false,
      playerMarkersMovable: false,
    });
  });

  it('absent fields (older bundle) leave current settings untouched', () => {
    applyBundledPreferences({ measureUnitValue: 10 });        // partial
    applyBundledPreferences(undefined);                       // no-op
    expect(getMeasureUnitValue()).toBe(10);
    expect(getMeasureUnitSuffix()).toBe("'");                 // default preserved
    expect(arePingsEnabled()).toBe(true);                     // default preserved
  });
});
