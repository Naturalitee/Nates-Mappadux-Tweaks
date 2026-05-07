import { getAllMaps, getMap, saveMap, loadConfig, saveConfig, getAllAssets, saveAsset, getAllAudioAssets, saveAudioAsset, getAsset } from './db.ts';
import type { SessionState, StoredMap, AudioAsset } from '../types.ts';

const BUNDLE_VERSION = 1;

interface MapEntry {
  id:       string;
  name:     string;
  addedAt:  number;
  mimeType: string;
  imageB64: string;
  config:   SessionState | null;
}

interface IconEntry {
  id:       string;
  name:     string;
  mimeType: string;
  dataB64:  string;
}

interface AudioEntry {
  id:       string;
  name:     string;
  mimeType: string;
  dataB64:  string;
  addedAt:  number;
}

export interface DMRBundle {
  version:      typeof BUNDLE_VERSION;
  exportedAt:   number;
  maps:         MapEntry[];
  customIcons?: IconEntry[];
  /** Uploaded audio files — embedded because they have no remote source to re-download */
  uploadedAudio?: AudioEntry[];
  /**
   * Freesound asset metadata only — blobs are NOT embedded (too large; can be
   * re-downloaded from freesoundPreviewUrl on demand via AudioAssetStore.getBlob).
   */
  freesoundAudio?: AudioAsset[];
}

// ─── Encoding helpers ─────────────────────────────────────────────────────────

/** ArrayBuffer → base64 string, chunked to avoid call-stack limits on large files */
function ab2b64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (let i = 0; i < bytes.length; i += 65536) {
    str += String.fromCharCode(...bytes.subarray(i, Math.min(i + 65536, bytes.length)));
  }
  return btoa(str);
}

/** base64 string → Blob */
function b64ToBlob(b64: string, mimeType: string): Blob {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Export all maps + their saved configs as a downloadable .json bundle.
 */
export async function exportBundle(): Promise<void> {
  const maps = await getAllMaps();
  const entries: MapEntry[] = [];

  for (const map of maps) {
    const ab     = await map.blob.arrayBuffer();
    const config = await loadConfig(map.id);
    entries.push({
      id:       map.id,
      name:     map.name,
      addedAt:  map.addedAt,
      mimeType: map.blob.type || 'image/png',
      imageB64: ab2b64(ab),
      config:   config ?? null,
    });
  }

  // Export custom icon assets
  const iconAssets = await getAllAssets('icon');
  const iconEntries: IconEntry[] = [];
  for (const asset of iconAssets) {
    const ab = await asset.blob.arrayBuffer();
    iconEntries.push({
      id:       asset.id,
      name:     asset.name,
      mimeType: asset.blob.type || 'image/png',
      dataB64:  ab2b64(ab),
    });
  }

  // Export uploaded audio (source='upload') — these have no remote URL to re-fetch
  const allAudioMeta = await getAllAudioAssets();
  const uploadedAudio: AudioEntry[] = [];
  for (const meta of allAudioMeta.filter((a) => a.source === 'upload')) {
    const stored = await getAsset(meta.id);
    if (!stored) continue;
    const ab = await stored.blob.arrayBuffer();
    uploadedAudio.push({
      id:       meta.id,
      name:     meta.name,
      mimeType: stored.blob.type || 'audio/mpeg',
      dataB64:  ab2b64(ab),
      addedAt:  meta.addedAt,
    });
  }

  // Export Freesound metadata only — no blob (re-downloaded on demand via freesoundPreviewUrl)
  const freesoundAudio = allAudioMeta.filter((a) => a.source === 'freesound');

  const bundle: DMRBundle = {
    version:    BUNDLE_VERSION,
    exportedAt: Date.now(),
    maps:       entries,
    ...(iconEntries.length > 0      ? { customIcons:    iconEntries    } : {}),
    ...(uploadedAudio.length > 0    ? { uploadedAudio:  uploadedAudio  } : {}),
    ...(freesoundAudio.length > 0   ? { freesoundAudio: freesoundAudio } : {}),
  };

  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `dmr-maps-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Import a bundle file.  Maps are upserted (new ones added, existing IDs
 * overwritten with the bundle's version).
 * Returns counts of how many maps were added vs updated.
 */
export async function importBundle(
  file: File
): Promise<{ added: number; updated: number }> {
  const text = await file.text();

  let bundle: DMRBundle;
  try {
    bundle = JSON.parse(text) as DMRBundle;
  } catch {
    throw new Error('Invalid bundle — could not parse JSON');
  }

  if (bundle.version !== BUNDLE_VERSION) {
    throw new Error(`Unsupported bundle version: ${String(bundle.version)}`);
  }
  if (!Array.isArray(bundle.maps)) {
    throw new Error('Invalid bundle — missing maps array');
  }

  let added   = 0;
  let updated = 0;

  for (const entry of bundle.maps) {
    const existing = await getMap(entry.id);

    const map: StoredMap = {
      id:      entry.id,
      name:    entry.name,
      addedAt: entry.addedAt,
      blob:    b64ToBlob(entry.imageB64, entry.mimeType),
    };

    await saveMap(map);
    if (entry.config) await saveConfig(entry.id, entry.config);

    if (existing) updated++; else added++;
  }

  // Restore custom icons if present
  if (Array.isArray(bundle.customIcons)) {
    for (const icon of bundle.customIcons) {
      const blob = b64ToBlob(icon.dataB64, icon.mimeType);
      await saveAsset({ id: icon.id, name: icon.name, type: 'icon', blob, addedAt: Date.now() });
    }
  }

  // Restore uploaded audio assets (with embedded blob)
  if (Array.isArray(bundle.uploadedAudio)) {
    for (const entry of bundle.uploadedAudio) {
      const blob = b64ToBlob(entry.dataB64, entry.mimeType);
      const asset: AudioAsset = {
        id:      entry.id,
        name:    entry.name,
        source:  'upload',
        license: 'Unknown / Manual import',
        addedAt: entry.addedAt,
      };
      await saveAudioAsset(asset);
      await saveAsset({ id: entry.id, name: entry.name, type: 'audio', blob, addedAt: entry.addedAt });
    }
  }

  // Restore Freesound metadata — blob is not bundled; AudioAssetStore.getBlob()
  // will re-download from freesoundPreviewUrl on first access if API key is set.
  if (Array.isArray(bundle.freesoundAudio)) {
    for (const asset of bundle.freesoundAudio) {
      await saveAudioAsset(asset as AudioAsset);
      // Don't overwrite the blob if it was already cached locally
    }
  }

  return { added, updated };
}
