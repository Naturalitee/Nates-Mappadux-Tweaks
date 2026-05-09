import type { AudioAsset } from '../types.ts';
import {
  saveAudioAsset, getAudioAsset, getAllAudioAssets, deleteAudioAsset,
  saveAsset, getAsset,
} from '../storage/db.ts';
import { FreesoundClient } from './FreesoundClient.ts';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export class AudioAssetStore {
  /** Runtime-only cache of fetched blobs for assets that aren't locally stored
   *  (web-link sources). Lives until page reload — does NOT touch IDB. */
  private static runtimeBlobs = new Map<string, Blob>();

  static async getAll(): Promise<AudioAsset[]> {
    const all = await getAllAudioAssets();
    return all.sort((a, b) => b.addedAt - a.addedAt);
  }

  static async save(asset: AudioAsset, blob: Blob): Promise<void> {
    await saveAudioAsset(asset);
    await saveAsset({ id: asset.id, name: asset.name, type: 'audio', blob, addedAt: asset.addedAt });
  }

  /** Save metadata only (no blob) — for web-link assets that stream at runtime. */
  static async saveMetadataOnly(asset: AudioAsset): Promise<void> {
    await saveAudioAsset(asset);
  }

  static async delete(id: string): Promise<void> {
    await deleteAudioAsset(id); // removes both audioAssets record and assets blob
    AudioAssetStore.runtimeBlobs.delete(id);
  }

  /**
   * Retrieve the raw Blob for an asset, in priority order:
   *   1. The local IDB blob (`locallyStored` assets always have this).
   *   2. A runtime-cached blob fetched earlier this session.
   *   3. Re-fetched from the asset's remote source:
   *        • web-link  → fetched from `sourceUrl` and held in runtime cache.
   *        • freesound → re-downloaded via FreesoundClient and persisted to IDB
   *                      (flips `locallyStored` to true so we don't re-fetch later).
   * Returns null if nothing works.
   */
  static async getBlob(asset: AudioAsset): Promise<Blob | null> {
    const stored = await getAsset(asset.id);
    if (stored) return stored.blob;

    const cached = AudioAssetStore.runtimeBlobs.get(asset.id);
    if (cached) return cached;

    if (asset.source === 'web-link' && asset.sourceUrl) {
      try {
        const res = await fetch(asset.sourceUrl);
        if (!res.ok) return null;
        const blob = await res.blob();
        AudioAssetStore.runtimeBlobs.set(asset.id, blob);
        return blob;
      } catch {
        return null;
      }
    }

    if (asset.source === 'freesound' && asset.freesoundPreviewUrl) {
      const apiKey = FreesoundClient.getApiKey();
      if (apiKey) {
        try {
          const blob = await FreesoundClient.downloadPreview(asset.freesoundPreviewUrl);
          await saveAsset({ id: asset.id, name: asset.name, type: 'audio', blob, addedAt: asset.addedAt });
          // Persist locallyStored=true so subsequent calls skip the re-download
          await saveAudioAsset({ ...asset, locallyStored: true });
          return blob;
        } catch {
          // Fall through to return null
        }
      }
    }
    return null;
  }

  /** Return a data URL for an asset blob (for P2P delivery). Null if unavailable. */
  static async getDataUrl(asset: AudioAsset): Promise<string | null> {
    const blob = await AudioAssetStore.getBlob(asset);
    if (!blob) return null;
    return blobToDataUrl(blob);
  }

  /** Get metadata for one asset. */
  static async get(id: string): Promise<AudioAsset | undefined> {
    return getAudioAsset(id);
  }

  /** Attribution strings for all library assets — for the attributions list. */
  static async getAttributions(): Promise<Array<{ name: string; attribution: string; license: string; pageUrl: string }>> {
    const all = await AudioAssetStore.getAll();
    const results: Array<{ name: string; attribution: string; license: string; pageUrl: string }> = [];
    for (const a of all) {
      if (a.source === 'freesound' && a.attribution) {
        results.push({ name: a.name, attribution: a.attribution, license: a.license ?? '', pageUrl: a.freesoundPageUrl ?? '' });
      } else if (a.source === 'upload') {
        results.push({ name: a.name, attribution: `Sound: "${a.name}" — Uploaded manually — unknown licence — BEWARE!`, license: 'Unknown', pageUrl: '' });
      }
    }
    return results;
  }
}
