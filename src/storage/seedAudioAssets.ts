import mtPingUrl   from '../assets/MT-ping.mp3?url';
import mtReturnUrl from '../assets/MT-return.mp3?url';
import { AudioAssetStore } from '../audio/AudioAssetStore.ts';
import { saveAudioAsset, getAsset } from './db.ts';
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

/**
 * Backfill the `locallyStored` flag on existing audio assets that pre-date
 * the C1 schema change. Reads each asset, checks whether its blob is in the
 * `assets` store, and saves the row back with the correct flag. Runs once on
 * app start; subsequent runs are no-ops because the flag is already set.
 */
async function backfillLocallyStored(): Promise<void> {
  const all = await AudioAssetStore.getAll();
  for (const asset of all) {
    if (typeof (asset as Partial<AudioAsset>).locallyStored === 'boolean') continue;
    const stored = await getAsset(asset.id);
    await saveAudioAsset({ ...asset, locallyStored: !!stored });
  }
}

/** Build the canonical attribution string for a built-in sound. */
function _builtinAttribution(spec: BuiltinSpec): string {
  return `Sound: "${spec.name}" edited from "${spec.sourceTitle}" by ${spec.sourceAuthor} via Freesound — CC0`;
}

/**
 * Refresh the attribution + name on already-seeded built-in rows so format
 * changes propagate without forcing the user to delete and re-seed. The
 * built-in IDs are stable, so this is a safe overwrite for those rows only.
 */
async function refreshBuiltinMetadata(): Promise<void> {
  for (const spec of BUILTINS) {
    const existing = await AudioAssetStore.get(spec.id);
    if (!existing) continue;
    const wantedAttribution = _builtinAttribution(spec);
    if (existing.attribution === wantedAttribution && existing.name === spec.name) continue;
    await saveAudioAsset({ ...existing, name: spec.name, attribution: wantedAttribution });
  }
}

export async function seedAudioAssets(): Promise<void> {
  await backfillLocallyStored();
  await refreshBuiltinMetadata();

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
        locallyStored:    true, // bundled with the app, blob saved alongside the metadata row
        username:         spec.sourceAuthor,
        license:          'CC0 (Public Domain)',
        attribution:      _builtinAttribution(spec),
        freesoundPageUrl: spec.sourceUrl,
        addedAt:          Date.now(),
      };
      await AudioAssetStore.save(asset, blob);
    } catch {
      // Non-fatal — user can still import their own
    }
  }
}
