/**
 * Convert legacy SoundtracksConfig (the v2.15.7–v2.15.11 fixed-slot
 * shape) to the v2.15.12+ N-slot shape. Idempotent — already-new
 * configs pass through unchanged. The migration is one-shot per
 * config object; results aren't persisted until the user saves.
 *
 * Legacy shape had four optional slots: { preSetup, theme, outro,
 * playlist } where each was { volume?, tracks: [] }. The new shape
 * is { slots: SoundtrackSlot[] } where slots[0] is the silent anchor
 * and the rest are user-authored.
 */

import type { SoundtracksConfig, SoundtrackSlot } from '../types.ts';
import { generateId } from '../utils/id.ts';

interface LegacySlot { tracks?: unknown[]; volume?: number }
interface LegacyConfig {
  preSetup?: LegacySlot;
  theme?:    LegacySlot;
  outro?:    LegacySlot;
  playlist?: LegacySlot;
  slots?:    unknown;
  crossfadeMs?: number;
}

const DEFAULT_CROSSFADE_MS = 1500;

/** Ensure the config has the new shape with a silent first slot. */
export function migrateSoundtracksConfig(input: SoundtracksConfig | LegacyConfig | undefined): SoundtracksConfig {
  if (!input) return _withSilent({ slots: [], crossfadeMs: DEFAULT_CROSSFADE_MS });

  // Already-new shape: ensure silent anchor + crossfade default.
  if (Array.isArray((input as SoundtracksConfig).slots)) {
    return _withSilent(input as SoundtracksConfig);
  }

  // Legacy shape — translate each populated key into a slot.
  const legacy = input as LegacyConfig;
  const slots: SoundtrackSlot[] = [];
  const carry = (label: string, mode: 'play-once' | 'playlist', s: LegacySlot | undefined): void => {
    if (!s) return;
    const tracks = Array.isArray(s.tracks) ? (s.tracks as unknown[]).filter(_isTrack) : [];
    if (tracks.length === 0) return;
    slots.push({
      id: generateId(),
      label,
      mode,
      tracks,
      ...(s.volume !== undefined ? { volume: s.volume } : {}),
    });
  };
  carry('Pre-setup', 'play-once', legacy.preSetup);
  carry('Theme',     'play-once', legacy.theme);
  carry('Outro',     'play-once', legacy.outro);
  carry('Playlist',  'playlist',  legacy.playlist);
  return _withSilent({
    slots,
    crossfadeMs: legacy.crossfadeMs ?? DEFAULT_CROSSFADE_MS,
  });
}

function _isTrack(v: unknown): v is import('../types.ts').SoundtrackTrack {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (r['kind'] === 'youtube' && typeof r['videoId'] === 'string') return true;
  if (r['kind'] === 'spotify' && typeof r['trackUri'] === 'string') return true;
  return false;
}

/** Guarantee a silent anchor slot at index 0. Stable id so the panel
 *  can persist "current slot = silent" across reloads. */
function _withSilent(cfg: SoundtracksConfig): SoundtracksConfig {
  const SILENT_ID = '_silent';
  const first = cfg.slots[0];
  if (first && first.id === SILENT_ID && first.mode === 'silent') return cfg;
  return {
    ...cfg,
    slots: [
      { id: SILENT_ID, label: 'Silent', mode: 'silent', tracks: [] },
      ...cfg.slots.filter((s) => s.id !== SILENT_ID),
    ],
  };
}

export function newUserSlot(label = 'New slot'): SoundtrackSlot {
  return {
    id:     generateId(),
    label,
    mode:   'play-once',
    tracks: [],
  };
}
