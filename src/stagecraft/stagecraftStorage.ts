/**
 * Stagecraft storage — pack-level connection details (WLED endpoints,
 * Home Assistant URL+token, future Spotify/YouTube credentials) live
 * here. Per-machine, never traverses .mappadux exports — same pattern
 * as projector calibrations ([[project_dmr_storage_map]]).
 *
 * Per-map preset assignments DO travel — they live on the MapAsset
 * itself under `MapAsset.stagecraft` so they bundle alongside the
 * map they're attached to. That's a separate file (in types.ts).
 *
 * This module is the localStorage facade only.
 */

const WLED_ENDPOINTS_KEY = 'mappadux:stagecraft_wled_endpoints';
const HA_CONFIG_KEY      = 'mappadux:stagecraft_ha';
const SOUNDTRACKS_ENABLED_KEY = 'mappadux:stagecraft_soundtracks_enabled';

export interface WledEndpoint {
  /** Stable id (generated when the endpoint is first added). Used to
   *  cross-reference per-map preset assignments. */
  id: string;
  /** Friendly label set by the user (e.g. "Table strip", "Ceiling"). */
  label: string;
  /** Base URL — http://192.168.1.42, http://wled-table.local, etc.
   *  Normalised via wledClient.normaliseEndpoint on save. */
  url: string;
}

export interface HaConfig {
  url: string;
  /** Long-lived access token. Never travels in bundles. */
  token: string;
}

// ─── WLED endpoints ────────────────────────────────────────────────────

export function getWledEndpoints(): WledEndpoint[] {
  try {
    const raw = localStorage.getItem(WLED_ENDPOINTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(_isWledEndpoint);
  } catch { return []; }
}

export function setWledEndpoints(endpoints: WledEndpoint[]): void {
  try {
    localStorage.setItem(WLED_ENDPOINTS_KEY, JSON.stringify(endpoints));
  } catch { /* private mode etc. — no-op */ }
}

export function addWledEndpoint(endpoint: WledEndpoint): void {
  const list = getWledEndpoints();
  const i = list.findIndex((e) => e.id === endpoint.id);
  if (i >= 0) list[i] = endpoint; else list.push(endpoint);
  setWledEndpoints(list);
}

export function removeWledEndpoint(id: string): void {
  setWledEndpoints(getWledEndpoints().filter((e) => e.id !== id));
}

function _isWledEndpoint(v: unknown): v is WledEndpoint {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r['id'] === 'string'
      && typeof r['label'] === 'string'
      && typeof r['url'] === 'string';
}

// ─── Home Assistant ────────────────────────────────────────────────────

export function getHaConfig(): HaConfig | null {
  try {
    const raw = localStorage.getItem(HA_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const r = parsed as Record<string, unknown>;
    if (typeof r['url'] !== 'string' || typeof r['token'] !== 'string') return null;
    return { url: r['url'], token: r['token'] };
  } catch { return null; }
}

export function setHaConfig(cfg: HaConfig | null): void {
  try {
    if (cfg) localStorage.setItem(HA_CONFIG_KEY, JSON.stringify(cfg));
    else     localStorage.removeItem(HA_CONFIG_KEY);
  } catch { /* private mode etc. — no-op */ }
}

// ─── Soundtracks (YouTube) — pack-level enable ─────────────────────────

/** YouTube doesn't need OAuth so the "enable" is really just a user
 *  opt-in that says "I want the Soundtracks panel to appear". The
 *  track URLs themselves travel in the bundle on SessionState. */
export function isSoundtracksEnabled(): boolean {
  try { return localStorage.getItem(SOUNDTRACKS_ENABLED_KEY) === '1'; }
  catch { return false; }
}

export function setSoundtracksEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(SOUNDTRACKS_ENABLED_KEY, '1');
    else         localStorage.removeItem(SOUNDTRACKS_ENABLED_KEY);
  } catch { /* private mode etc. — no-op */ }
}

// ─── Convenience: are any Stagecraft connections configured? ──────────

/** True if at least one WLED endpoint, HA config, or Soundtracks opt-
 *  in exists. Drives the Lighting/Automation panel's visibility —
 *  the Soundtracks panel is independently gated by isSoundtracksEnabled. */
export function hasAnyStagecraftConnection(): boolean {
  return getWledEndpoints().length > 0 || getHaConfig() !== null;
}
