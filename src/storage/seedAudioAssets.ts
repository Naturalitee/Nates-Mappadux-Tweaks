import mtPingUrl   from '../assets/MT-ping.mp3?url';
import mtReturnUrl from '../assets/MT-return.mp3?url';
import { AudioAssetStore } from '../audio/AudioAssetStore.ts';
import type { AudioAsset } from '../types.ts';

/**
 * Built-in audio assets shipped with the app. Seeded on first run (per asset)
 * so they show up in every user's library by default and can be referenced as
 * default tracker pings without the user needing to import anything.
 *
 * IDs are deterministic so re-seeding doesn't create duplicates. If a user
 * deletes one, it stays deleted — we only seed if missing on app start.
 */
export const BUILTIN_TRACKER_PING_OUT_ID = 'builtin-mt-ping';
export const BUILTIN_TRACKER_PING_IN_ID  = 'builtin-mt-return';

interface BuiltinSpec {
  id:           string;
  name:         string;
  url:          string;
  /** Source attribution — credits the original Freesound author. Files in
   *  src/assets/ are edited derivatives of these CC0 samples. */
  sourceTitle:  string;
  sourceAuthor: string;
  sourceUrl:    string;
}

const BUILTINS: BuiltinSpec[] = [
  {
    id:           BUILTIN_TRACKER_PING_OUT_ID,
    name:         'Tracker Ping (Outgoing)',
    url:          mtPingUrl,
    sourceTitle:  'motion tracker blip.wav',
    sourceAuthor: 'Balcoran',
    sourceUrl:    'https://freesound.org/s/478187/',
  },
  {
    id:           BUILTIN_TRACKER_PING_IN_ID,
    name:         'Tracker Ping (Return)',
    url:          mtReturnUrl,
    sourceTitle:  'motion tracker beep.wav',
    sourceAuthor: 'Balcoran',
    sourceUrl:    'https://freesound.org/s/478186/',
  },
];

export async function seedAudioAssets(): Promise<void> {
  for (const spec of BUILTINS) {
    const existing = await AudioAssetStore.get(spec.id);
    if (existing) continue;
    try {
      const res  = await fetch(spec.url);
      if (!res.ok) continue;
      const blob = await res.blob();
      const asset: AudioAsset = {
        id:               spec.id,
        name:             spec.name,
        source:           'freesound',
        username:         spec.sourceAuthor,
        license:          'CC0 (Public Domain)',
        attribution:      `Edited from "${spec.sourceTitle}" by ${spec.sourceAuthor} via Freesound — CC0`,
        freesoundPageUrl: spec.sourceUrl,
        addedAt:          Date.now(),
      };
      await AudioAssetStore.save(asset, blob);
    } catch {
      // Non-fatal — user can still import their own
    }
  }
}
