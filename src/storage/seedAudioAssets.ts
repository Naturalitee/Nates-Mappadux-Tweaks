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

/**
 * One-shot semantics fix: the original C1 default for Freesound items was
 * `locallyStored: true` because they had blobs in IDB. The model has since
 * been clarified — Freesound items are URL-style by default, and Stored is
 * the user's explicit choice via the Store button. Flip existing
 * non-builtin Freesound rows to false so they pick up Store buttons.
 * Guarded by a localStorage flag so it runs exactly once.
 */
const FREESOUND_RESET_FLAG = 'dmr_freesound_locallystored_reset_v1';
const BUILTIN_IDS = new Set([BUILTIN_TRACKER_PING_OUT_ID, BUILTIN_TRACKER_PING_IN_ID]);
async function resetFreesoundStoredFlag(): Promise<void> {
  if (localStorage.getItem(FREESOUND_RESET_FLAG)) return;
  const all = await AudioAssetStore.getAll();
  for (const asset of all) {
    if (asset.source !== 'freesound') continue;
    if (BUILTIN_IDS.has(asset.id))    continue;
    if (asset.locallyStored !== true) continue;
    await saveAudioAsset({ ...asset, locallyStored: false });
  }
  localStorage.setItem(FREESOUND_RESET_FLAG, '1');
}

/** Build the canonical attribution string for a built-in sound. */
function _builtinAttribution(spec: BuiltinSpec): string {
  return `Sound: "${spec.name}" edited from "${spec.sourceTitle}" by ${spec.sourceAuthor} via Freesound — CC0`;
}

/**
 * Refresh the canonical metadata on already-seeded built-in rows so format
 * changes (and any drift introduced by old bundle import paths) propagate
 * without forcing the user to delete and re-seed. The built-in IDs are
 * stable, so this is a safe full overwrite of the source/license/etc fields.
 * `addedAt` is preserved so library sort order doesn't jump around.
 */
async function refreshBuiltinMetadata(): Promise<void> {
  for (const spec of BUILTINS) {
    const existing = await AudioAssetStore.get(spec.id);
    if (!existing) continue;
    const wanted: AudioAsset = {
      id:               spec.id,
      name:             spec.name,
      source:           'freesound',
      locallyStored:    existing.locallyStored ?? true, // assume stored unless we know otherwise
      username:         spec.sourceAuthor,
      license:          'CC0 (Public Domain)',
      attribution:      _builtinAttribution(spec),
      freesoundPageUrl: spec.sourceUrl,
      addedAt:          existing.addedAt,
    };
    // Skip the write if the row is already canonical
    if (
      existing.source           === wanted.source &&
      existing.name             === wanted.name &&
      existing.license          === wanted.license &&
      existing.attribution      === wanted.attribution &&
      existing.freesoundPageUrl === wanted.freesoundPageUrl &&
      existing.username         === wanted.username
    ) continue;
    await saveAudioAsset(wanted);
  }
}

export async function seedAudioAssets(): Promise<void> {
  await backfillLocallyStored();
  await resetFreesoundStoredFlag();
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
