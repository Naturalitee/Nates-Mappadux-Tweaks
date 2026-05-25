/**
 * Home Assistant REST API client. Mappadux scope: list the scenes /
 * scripts the user has already authored in HA, and fire one of them
 * when a map is loaded. Mappadux never authors HA entities — the user
 * builds those in HA's own UI, then picks from a dropdown here.
 *
 * Endpoints used:
 *   GET  /api/states                  — list every entity; we filter
 *                                       to domain=scene / script /
 *                                       automation client-side.
 *   POST /api/services/{domain}/{service}
 *                                     — fire a scene / script. Body
 *                                       is { "entity_id": "scene.x" }.
 *
 * Auth: Bearer token (long-lived access token from
 * HA → Profile → Long-Lived Access Tokens).
 *
 * Soft-fails on timeout / network / auth like the WLED client.
 */

const DEFAULT_TIMEOUT_MS = 4000;

export type HaServiceDomain = 'scene' | 'script' | 'automation';

export interface HaEntity {
  /** Full entity id, e.g. "scene.tavern_warm". */
  entity_id: string;
  /** Friendly name (from attributes.friendly_name), falls back to entity_id. */
  friendly_name: string;
  /** Discriminated domain — scene / script / automation. */
  domain: HaServiceDomain;
}

export interface HaFailure {
  ok: false;
  reason: 'timeout' | 'network' | 'http' | 'parse' | 'auth';
  status?: number;
  message: string;
}

export interface HaSuccess<T> {
  ok: true;
  data: T;
}

export type HaResult<T> = HaSuccess<T> | HaFailure;

async function _haFetch<T>(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<HaResult<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...(init ?? {}),
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'auth', status: res.status, message: 'Home Assistant rejected the access token. Check it under Profile → Long-Lived Access Tokens.' };
    }
    if (!res.ok) {
      return { ok: false, reason: 'http', status: res.status, message: `Home Assistant returned HTTP ${res.status}` };
    }
    try {
      // Some service calls return empty bodies on success — tolerate that.
      const text = await res.text();
      if (!text) return { ok: true, data: undefined as T };
      return { ok: true, data: JSON.parse(text) as T };
    } catch (e) {
      return { ok: false, reason: 'parse', message: `Could not parse HA response: ${(e as Error).message}` };
    }
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') {
      return { ok: false, reason: 'timeout', message: `HA request to ${url} timed out after ${DEFAULT_TIMEOUT_MS} ms` };
    }
    return { ok: false, reason: 'network', message: `Network error contacting HA: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Pull every entity from /api/states, keep only scene / script /
 *  automation domains, shape into HaEntity[]. */
export async function fetchEntities(baseUrl: string, token: string): Promise<HaResult<HaEntity[]>> {
  const url = baseUrl.replace(/\/+$/, '') + '/api/states';
  const raw = await _haFetch<Array<{
    entity_id: string;
    attributes?: { friendly_name?: string };
  }>>(url, token);
  if (!raw.ok) return raw;
  const entities: HaEntity[] = [];
  for (const ent of raw.data) {
    const [domain] = ent.entity_id.split('.', 1);
    if (domain !== 'scene' && domain !== 'script' && domain !== 'automation') continue;
    entities.push({
      entity_id:    ent.entity_id,
      friendly_name: ent.attributes?.friendly_name ?? ent.entity_id,
      domain:       domain as HaServiceDomain,
    });
  }
  entities.sort((a, b) => a.friendly_name.localeCompare(b.friendly_name));
  return { ok: true, data: entities };
}

/** Fire a scene / script / automation by entity id. The HA service
 *  endpoint shape is /api/services/{domain}/{service}. For:
 *    - scene:      service is `turn_on`
 *    - script:     service is `turn_on` (HA accepts this generic
 *                  form across all script entities)
 *    - automation: service is `trigger`
 */
export async function fireEntity(
  baseUrl: string,
  token: string,
  entity: HaEntity,
): Promise<HaResult<void>> {
  const service =
    entity.domain === 'automation' ? 'trigger' : 'turn_on';
  const url = baseUrl.replace(/\/+$/, '') + `/api/services/${entity.domain}/${service}`;
  const result = await _haFetch<unknown>(url, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entity_id: entity.entity_id }),
  });
  if (!result.ok) return result;
  return { ok: true, data: undefined };
}

/** Quick connectivity check — calls /api/ (the discovery endpoint).
 *  Returns the running HA version on success. */
export async function fetchInfo(baseUrl: string, token: string): Promise<HaResult<{ version: string }>> {
  const url = baseUrl.replace(/\/+$/, '') + '/api/';
  const raw = await _haFetch<{ message?: string; version?: string }>(url, token);
  if (!raw.ok) return raw;
  return { ok: true, data: { version: raw.data?.version ?? 'unknown' } };
}
