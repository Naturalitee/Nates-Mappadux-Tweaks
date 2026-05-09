import type { AudioAsset } from '../../types.ts';

/** A single page of search results from a connector. */
export interface AssetSearchPage<T = unknown> {
  results: T[];
  count:   number;
  nextUrl: string | null;
}

/** Display fields the modal renders for a single result row. */
export interface ResultRowData {
  name:              string;
  /** Secondary line — e.g. "username · 12s". */
  meta:              string;
  /** Human-readable license label. */
  license:           string;
  needsAttribution:  boolean;
  attribution?:      string;
  /** URL the modal can pass to an <audio> element for in-place preview. */
  previewUrl:        string;
}

export interface AssetSearchOptions {
  /** Filter by max duration in seconds. null/undefined = no filter. */
  maxDurationSecs?: number | null;
}

/**
 * Source-specific connector for searching and importing audio assets.
 * One connector wraps each external API or catalog (Freesound today, Web Links
 * and other APIs in v2.8). The modal UI iterates over registered connectors
 * and uses this contract uniformly so adding a new source is a single new file.
 */
export interface AssetSourceConnector<TResult = unknown> {
  /** Stable identifier (used in DOM data-attributes and dispatch). */
  readonly id: string;
  /** Tab label shown in the asset picker. */
  readonly label: string;
  /** Whether asset blobs can be downloaded and stored locally. */
  readonly canStore: boolean;
  /** True if the user must provide configuration (API key, etc.) before searching. */
  readonly requiresConfig: boolean;
  /** True if the connector accepts a max-duration filter on search. */
  readonly supportsDurationFilter: boolean;

  isConfigured(): boolean;

  /**
   * Optional config UI rendered into a container (e.g. an API key form).
   * `onChange` should be called whenever the user updates configuration so
   * the modal can re-evaluate `isConfigured()` and re-enable search.
   */
  renderConfig?(container: HTMLElement, onChange: () => void): void;

  search(query: string, opts?: AssetSearchOptions): Promise<AssetSearchPage<TResult>>;
  fetchPage(nextUrl: string): Promise<AssetSearchPage<TResult>>;

  resultRow(result: TResult): ResultRowData;
  download(result: TResult): Promise<Blob>;
  toAudioAsset(result: TResult, id: string): AudioAsset;
}
