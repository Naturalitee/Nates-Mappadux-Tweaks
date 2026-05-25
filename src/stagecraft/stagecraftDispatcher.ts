/**
 * Stagecraft dispatcher — given a MapAsset, fires every Stagecraft
 * assignment configured on it. Soft-fails: a flaky LED strip or
 * a stale HA token must never block the map switch. Each integration
 * is awaited but errors are swallowed + logged.
 *
 * v2.16 — initial: WLED + Home Assistant. Soundtracks come later
 * (pack-level, not per-map, fired from a different hook).
 *
 * Called from GMApp.loadMap once the new map is in place. Also
 * exposed via the Lighting/Automation panel's "Fire now (test)"
 * button so the GM can sanity-check assignments without switching
 * maps.
 */

import type { MapAsset, StagecraftAssignment } from '../types.ts';
import {
  getWledEndpoints,
  getHaConfig,
  getQlcConfig,
} from './stagecraftStorage.ts';
import { applyPreset as wledApplyPreset } from './wledClient.ts';
import { fireEntity as haFireEntity, type HaEntity } from './haClient.ts';
import { fireFunction as qlcFireFunction } from './qlcClient.ts';

/** Run every Stagecraft assignment defined on `asset`. Resolves once
 *  all fire-and-forget calls have completed (success or soft-fail). */
export async function fireStagecraftForAsset(asset: MapAsset): Promise<void> {
  const assignments = asset.stagecraft ?? {};
  if (Object.keys(assignments).length === 0) return;

  const tasks: Promise<void>[] = [];

  // ── WLED ─────────────────────────────────────────────────────
  const endpoints = getWledEndpoints();
  for (const ep of endpoints) {
    const a = assignments[ep.id];
    if (!a || a.kind !== 'wled') continue;
    tasks.push(_runWled(ep.url, a, ep.label));
  }

  // ── HA ───────────────────────────────────────────────────────
  const ha = getHaConfig();
  const haAssign = assignments['ha'];
  if (ha && haAssign && haAssign.kind === 'ha') {
    tasks.push(_runHa(ha.url, ha.token, haAssign));
  }

  // ── QLC+ ─────────────────────────────────────────────────────
  const qlc = getQlcConfig();
  const qlcAssign = assignments['qlc'];
  if (qlc && qlcAssign && qlcAssign.kind === 'qlc') {
    tasks.push(_runQlc(qlc.url, qlcAssign));
  }

  await Promise.allSettled(tasks);
}

async function _runQlc(url: string, assignment: Extract<StagecraftAssignment, { kind: 'qlc' }>): Promise<void> {
  try {
    const result = await qlcFireFunction(url, assignment.functionId);
    if (!result.ok) {
      console.warn(`[stagecraft] QLC+ failed to fire function ${assignment.functionId}: ${result.message}`);
    }
  } catch (e) {
    console.warn(`[stagecraft] QLC+ threw: ${(e as Error).message}`);
  }
}

async function _runWled(url: string, assignment: Extract<StagecraftAssignment, { kind: 'wled' }>, label: string): Promise<void> {
  try {
    const result = await wledApplyPreset(url, assignment.presetId);
    if (!result.ok) {
      console.warn(`[stagecraft] WLED "${label}" failed to apply preset ${assignment.presetId}: ${result.message}`);
    }
  } catch (e) {
    console.warn(`[stagecraft] WLED "${label}" threw: ${(e as Error).message}`);
  }
}

async function _runHa(url: string, token: string, assignment: Extract<StagecraftAssignment, { kind: 'ha' }>): Promise<void> {
  try {
    const [domain] = assignment.entity.split('.', 1);
    if (domain !== 'scene' && domain !== 'script' && domain !== 'automation') {
      console.warn(`[stagecraft] HA assignment has unsupported domain: ${assignment.entity}`);
      return;
    }
    const ent: HaEntity = {
      entity_id:    assignment.entity,
      friendly_name: assignment.entity,
      domain,
    };
    const result = await haFireEntity(url, token, ent);
    if (!result.ok) {
      console.warn(`[stagecraft] HA failed to fire ${assignment.entity}: ${result.message}`);
    }
  } catch (e) {
    console.warn(`[stagecraft] HA threw: ${(e as Error).message}`);
  }
}
