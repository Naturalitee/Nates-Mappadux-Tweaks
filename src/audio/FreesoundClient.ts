import type { AudioAsset } from '../types.ts';

const FREESOUND_API = 'https://freesound.org/apiv2';
const API_KEY_STORAGE_KEY = 'dmr_freesound_api_key';

const FIELDS = 'id,name,username,license,previews,url,duration';

export interface FreesoundResult {
  id:           number;
  name:         string;
  username:     string;
  license:      string;        // human-readable derived from license URL
  licenseUrl:   string;        // original CC URL
  attribution:  string;
  previewUrl:   string;        // preview-hq-mp3
  pageUrl:      string;
  durationSecs: number;
}

function parseLicenseLabel(licenseUrl: string): string {
  const u = licenseUrl.toLowerCase();
  if (u.includes('publicdomain/zero') || u.includes('publicdomain/mark'))
    return 'CC0 (Public Domain)';
  if (u.includes('/by-nc-sa/')) return 'CC-BY-NC-SA';
  if (u.includes('/by-nc/'))    return 'CC-BY-NC';
  if (u.includes('/by-sa/'))    return 'CC-BY-SA';
  if (u.includes('/by/'))       return 'CC-BY';
  return 'See license';
}

function toResult(raw: RawResult): FreesoundResult {
  const licenseUrl  = raw.license ?? '';
  const previewUrl  = raw.previews?.['preview-hq-mp3'] ?? '';
  const license     = parseLicenseLabel(licenseUrl);
  const attribution = `Sound: "${raw.name}" by ${raw.username} via Freesound`;
  return {
    id:           raw.id,
    name:         raw.name,
    username:     raw.username,
    license,
    licenseUrl,
    attribution,
    previewUrl,
    pageUrl:      raw.url ?? '',
    durationSecs: Math.round(raw.duration ?? 0),
  };
}

interface RawResult {
  id:       number;
  name:     string;
  username: string;
  license:  string;
  previews: Record<string, string>;
  url:      string;
  duration: number;
}

export interface FreesoundPage {
  results: FreesoundResult[];
  count:   number;
  nextUrl: string | null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class FreesoundClient {
  static getApiKey(): string | null {
    return localStorage.getItem(API_KEY_STORAGE_KEY);
  }

  static setApiKey(key: string): void {
    localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
  }

  static async search(
    query: string,
    maxDurationSecs: number | null,
  ): Promise<FreesoundPage> {
    const apiKey = FreesoundClient.getApiKey();
    if (!apiKey) throw new Error('No Freesound API key set');

    const params = new URLSearchParams({
      query,
      token:     apiKey,
      fields:    FIELDS,
      page_size: '20',
    });
    if (maxDurationSecs !== null) {
      params.set('filter', `duration:[0 TO ${maxDurationSecs}]`);
    }

    const res = await fetch(`${FREESOUND_API}/search/text/?${params.toString()}`);
    if (!res.ok) {
      if (res.status === 401) throw new Error('Invalid Freesound API key');
      throw new Error(`Freesound search failed: ${res.status}`);
    }

    const data = await res.json() as { results: RawResult[]; count: number; next: string | null };
    return {
      results: (data.results ?? []).map(toResult),
      count:   data.count ?? 0,
      nextUrl: data.next ?? null,
    };
  }

  /** Fetch a subsequent page using the `next` URL returned by a previous search. */
  static async fetchPage(nextUrl: string): Promise<FreesoundPage> {
    const apiKey = FreesoundClient.getApiKey();
    if (!apiKey) throw new Error('No Freesound API key set');

    // Ensure the token param is present (Freesound includes it but re-add for safety)
    const url = new URL(nextUrl);
    if (!url.searchParams.has('token')) url.searchParams.set('token', apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      if (res.status === 401) throw new Error('Invalid Freesound API key');
      throw new Error(`Freesound fetch failed: ${res.status}`);
    }

    const data = await res.json() as { results: RawResult[]; count: number; next: string | null };
    return {
      results: (data.results ?? []).map(toResult),
      count:   data.count ?? 0,
      nextUrl: data.next ?? null,
    };
  }

  /** Download a preview MP3 and return as a Blob. */
  static async downloadPreview(previewUrl: string): Promise<Blob> {
    const apiKey = FreesoundClient.getApiKey();
    if (!apiKey) throw new Error('No Freesound API key set');

    // Preview URLs already contain auth in the path; token param needed on some
    const url = previewUrl.includes('?')
      ? `${previewUrl}&token=${apiKey}`
      : `${previewUrl}?token=${apiKey}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    return res.blob();
  }

  /** Build an AudioAsset from a Freesound search result (before downloading blob). */
  static resultToAsset(result: FreesoundResult, id: string): AudioAsset {
    return {
      id,
      name:                result.name,
      source:              'freesound',
      freesoundId:         result.id,
      freesoundPreviewUrl: result.previewUrl,
      freesoundPageUrl:    result.pageUrl,
      username:            result.username,
      license:             result.license,
      attribution:         result.attribution,
      durationSecs:        result.durationSecs,
      addedAt:             Date.now(),
    };
  }
}
