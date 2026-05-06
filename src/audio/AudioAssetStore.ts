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
  static async getAll(): Promise<AudioAsset[]> {
    const all = await getAllAudioAssets();
    return all.sort((a, b) => b.addedAt - a.addedAt);
  }

  static async save(asset: AudioAsset, blob: Blob): Promise<void> {
    await saveAudioAsset(asset);
    await saveAsset({ id: asset.id, name: asset.name, type: 'audio', blob, addedAt: asset.addedAt });
  }

  static async delete(id: string): Promise<void> {
    await deleteAudioAsset(id); // removes both audioAssets record and assets blob
  }

  /**
   * Retrieve the raw Blob for an asset.
   * If the blob is missing from local storage (e.g. cleared cache, different machine),
   * attempts to re-download the Freesound preview and caches it.
   * Returns null if unavailable and re-download fails or is not possible.
   */
  static async getBlob(asset: AudioAsset): Promise<Blob | null> {
    const stored = await getAsset(asset.id);
    if (stored) return stored.blob;

    if (asset.source === 'freesound' && asset.freesoundPreviewUrl) {
      const apiKey = FreesoundClient.getApiKey();
      if (apiKey) {
        try {
          const blob = await FreesoundClient.downloadPreview(asset.freesoundPreviewUrl);
          await saveAsset({ id: asset.id, name: asset.name, type: 'audio', blob, addedAt: asset.addedAt });
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
