/**
 * WLED API client — browser-side fetch helpers for WLED-firmware
 * devices. Mappadux talks to the user's existing WLED setup; we
 * don't build a parallel LED-arrangement UI. Users author presets
 * in WLED's own web interface, Mappadux only references them by
 * id and fires them on map switch.
 *
 * WLED CORS: the firmware sets `Access-Control-Allow-Origin: *`
 * by default, so cross-origin fetches from www.mappadux.com to
 * 192.168.x.x or http://wled-table.local/ work without proxying.
 *
 * Endpoints used:
 *   GET  /json/info          — device identity + firmware version
 *   GET  /presets.json       — preset library, keyed by id
 *   POST /json/state         — apply state; we send { "ps": <id> }
 *                              to recall a preset by id
 *
 * Everything soft-fails. A timeout, network error, or non-OK
 * status returns the failure shape rather than throwing — the
 * Stagecraft layer logs + continues so map switches never block
 * on a flaky LED strip.
 */

const DEFAULT_TIMEOUT_MS = 4000;

export interface WledInfo {
  /** Device name as set in WLED settings. */
  name: string;
  /** Firmware version string (e.g. "0.15.0-b3"). */
  version: string;
  /** Number of LEDs on the strip. */
  ledCount: number;
}

export interface WledPreset {
  /** Preset id — the integer key used to recall it via {ps:N}. */
  id: number;
  /** User-set preset name. */
  name: string;
  /** Quick-load label (the "QLC" / quick-pick chip in WLED's UI). Optional. */
  qll?: string;
}

export interface WledFailure {
  ok: false;
  reason: 'timeout' | 'network' | 'http' | 'parse';
  status?: number;
  message: string;
}

export interface WledSuccess<T> {
  ok: true;
  data: T;
}

export type WledResult<T> = WledSuccess<T> | WledFailure;

/** Normalise a user-supplied endpoint to a base URL with no
 *  trailing slash. Accepts "192.168.1.42", "wled-table.local",
 *  "http://...", "https://..." — defaults to http:// if no scheme. */
export function normaliseEndpoint(input: string): string {
  let s = input.trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s;
}

async function _fetchJson<T>(url: string, init?: RequestInit): Promise<WledResult<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...(init ?? {}), signal: ctrl.signal });
    if (!res.ok) {
      return { ok: false, reason: 'http', status: res.status, message: `HTTP ${res.status} from ${url}` };
    }
    try {
      const data = (await res.json()) as T;
      return { ok: true, data };
    } catch (e) {
      return { ok: false, reason: 'parse', message: `Could not parse JSON from ${url}: ${(e as Error).message}` };
    }
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') {
      return { ok: false, reason: 'timeout', message: `Request to ${url} timed out after ${DEFAULT_TIMEOUT_MS} ms` };
    }
    return { ok: false, reason: 'network', message: `Network error contacting ${url}: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Ping the device for /json/info — identity + firmware. */
export async function fetchInfo(endpoint: string): Promise<WledResult<WledInfo>> {
  const base = normaliseEndpoint(endpoint);
  if (!base) return { ok: false, reason: 'parse', message: 'Empty endpoint' };
  const raw = await _fetchJson<{ name?: string; ver?: string; leds?: { count?: number } }>(`${base}/json/info`);
  if (!raw.ok) return raw;
  return {
    ok: true,
    data: {
      name:     raw.data.name ?? '(unnamed)',
      version:  raw.data.ver ?? 'unknown',
      ledCount: raw.data.leds?.count ?? 0,
    },
  };
}

/** Pull /presets.json and shape it into a sorted WledPreset[].
 *
 *  WLED's preset file is keyed by integer id where "0" is a
 *  reserved slot ("not a preset") and ids 1..N are user-created.
 *  Empty slots may appear as `{}` — we skip those. */
export async function fetchPresets(endpoint: string): Promise<WledResult<WledPreset[]>> {
  const base = normaliseEndpoint(endpoint);
  if (!base) return { ok: false, reason: 'parse', message: 'Empty endpoint' };
  const raw = await _fetchJson<Record<string, { n?: string; ql?: string }>>(`${base}/presets.json`);
  if (!raw.ok) return raw;
  const presets: WledPreset[] = [];
  for (const [key, val] of Object.entries(raw.data ?? {})) {
    const id = Number(key);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (!val || typeof val !== 'object') continue;
    const name = val.n?.trim();
    if (!name) continue;
    presets.push({
      id,
      name,
      ...(val.ql ? { qll: val.ql } : {}),
    });
  }
  presets.sort((a, b) => a.id - b.id);
  return { ok: true, data: presets };
}

/** Apply a preset by id. Sends POST /json/state with { ps: id }. */
export async function applyPreset(endpoint: string, presetId: number): Promise<WledResult<void>> {
  const base = normaliseEndpoint(endpoint);
  if (!base) return { ok: false, reason: 'parse', message: 'Empty endpoint' };
  const result = await _fetchJson<unknown>(`${base}/json/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ps: presetId }),
  });
  if (!result.ok) return result;
  return { ok: true, data: undefined };
}
