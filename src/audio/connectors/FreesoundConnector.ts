import type { AudioAsset } from '../../types.ts';
import { FreesoundClient, type FreesoundResult } from '../FreesoundClient.ts';
import type {
  AssetSourceConnector, AssetSearchPage, AssetSearchOptions, ResultRowData,
} from './AssetSourceConnector.ts';

/**
 * AssetSourceConnector implementation for Freesound.org.
 * Wraps the low-level FreesoundClient HTTP layer.
 */
export class FreesoundConnector implements AssetSourceConnector<FreesoundResult> {
  readonly id                     = 'freesound';
  readonly label                  = 'Freesound Search';
  readonly canStore               = true;
  readonly requiresConfig         = true;
  readonly supportsDurationFilter = true;

  isConfigured(): boolean {
    return !!FreesoundClient.getApiKey();
  }

  search(query: string, opts?: AssetSearchOptions): Promise<AssetSearchPage<FreesoundResult>> {
    return FreesoundClient.search(query, opts?.maxDurationSecs ?? null);
  }

  fetchPage(nextUrl: string): Promise<AssetSearchPage<FreesoundResult>> {
    return FreesoundClient.fetchPage(nextUrl);
  }

  resultRow(r: FreesoundResult): ResultRowData {
    return {
      name:             r.name,
      meta:             `${r.username} · ${r.durationSecs}s`,
      license:          r.license,
      needsAttribution: !r.license.startsWith('CC0'),
      attribution:      r.attribution,
      previewUrl:       r.previewUrl,
    };
  }

  download(r: FreesoundResult): Promise<Blob> {
    return FreesoundClient.downloadPreview(r.previewUrl);
  }

  toAudioAsset(r: FreesoundResult, id: string): AudioAsset {
    return FreesoundClient.resultToAsset(r, id);
  }
}

export const freesoundConnector = new FreesoundConnector();
