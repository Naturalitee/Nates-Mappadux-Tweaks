/**
 * StagecraftPanel — left-sidebar panel for assigning WLED presets and
 * Home Assistant scenes/scripts to the active map. Only renders when
 * at least one Stagecraft connection is configured in Settings.
 *
 * v2.16 — first cut. Per-map assignment lives on
 * MapAsset.stagecraft[connectionId] (see types.ts). Map switch fires
 * each assignment via the relevant client.
 *
 * The panel polls device APIs lazily — first refresh on open, cached
 * for the session. Re-poll on user click of "Refresh devices".
 *
 * The DOM scaffolding lives in index.html under #stagecraft-panel,
 * normally hidden. This module flips hidden=false once a connection
 * is configured, populates the body, and re-renders on every map
 * change.
 */

import type { MapAsset, StagecraftAssignment } from '../types.ts';
import {
  getWledEndpoints,
  getHaConfig,
  getQlcConfig,
  hasAnyStagecraftConnection,
} from '../stagecraft/stagecraftStorage.ts';
import { fetchPresets, type WledPreset } from '../stagecraft/wledClient.ts';
import { fetchEntities, type HaEntity } from '../stagecraft/haClient.ts';
import { fetchFunctions, type QlcFunction } from '../stagecraft/qlcClient.ts';
import { wledConfigUrl, haConfigUrl, qlcConfigUrl } from '../stagecraft/configUrls.ts';

export interface StagecraftPanelHost {
  /** Returns the live MapAsset for the active map, or null when no
   *  map is loaded. The panel writes assignments directly via
   *  saveAssignment + relies on the host to broadcast / persist. */
  getActiveMapAsset(): Promise<MapAsset | null>;
  /** Persist a changed assignment + trigger any GM-side side-effects
   *  (re-broadcast, autosave). Called whenever the user picks a new
   *  preset / scene from a dropdown. */
  saveAssignment(connectionId: string, assignment: StagecraftAssignment | null): Promise<void>;
  /** Fire the assignments for the active map (test button). */
  fireForActiveMap(): Promise<void>;
}

export class StagecraftPanel {
  private host: StagecraftPanelHost;
  private panelEl:        HTMLElement;
  private assignmentsEl:  HTMLElement;
  private statusEl:       HTMLElement;
  private refreshBtn:     HTMLButtonElement;
  private testBtn:        HTMLButtonElement;
  /** Cache of WLED presets keyed by endpoint id — populated lazily. */
  private wledPresetCache = new Map<string, WledPreset[]>();
  /** Cache of HA entities, populated lazily. */
  private haEntityCache: HaEntity[] | null = null;
  /** Cache of QLC+ Functions, populated lazily. */
  private qlcFunctionCache: QlcFunction[] | null = null;

  constructor(host: StagecraftPanelHost) {
    this.host          = host;
    this.panelEl       = document.getElementById('stagecraft-panel')!;
    this.assignmentsEl = document.getElementById('stagecraft-assignments')!;
    this.statusEl      = document.getElementById('stagecraft-status')!;
    this.refreshBtn    = document.getElementById('stagecraft-refresh-btn') as HTMLButtonElement;
    this.testBtn       = document.getElementById('stagecraft-test-btn') as HTMLButtonElement;
    // Panel collapse/expand is handled by GMApp's global panel-title
    // listener (binds every .panel-title[aria-expanded] button).
    this.refreshBtn.addEventListener('click', () => void this.refresh({ force: true }));
    this.testBtn.addEventListener('click', () => void this._fireTest());
  }

  /** Show / hide the panel + rebuild contents based on the current
   *  set of configured connections and the active map's existing
   *  assignments. `force=true` clears the device caches so the next
   *  fetch re-pulls preset / scene lists from the devices. */
  async refresh(opts?: { force?: boolean }): Promise<void> {
    if (opts?.force) {
      this.wledPresetCache.clear();
      this.haEntityCache = null;
      this.qlcFunctionCache = null;
    }
    if (!hasAnyStagecraftConnection()) {
      this.panelEl.hidden = true;
      return;
    }
    this.panelEl.hidden = false;
    const asset = await this.host.getActiveMapAsset();
    this.assignmentsEl.innerHTML = '';
    this.statusEl.textContent = '';
    if (!asset) {
      const note = document.createElement('div');
      note.className = 'settings-stat-sub';
      note.textContent = 'No active map. Switch to a map to assign presets.';
      this.assignmentsEl.appendChild(note);
      return;
    }
    const existing = asset.stagecraft ?? {};

    // ── WLED rows ────────────────────────────────────────────────
    for (const endpoint of getWledEndpoints()) {
      const row = document.createElement('div');
      row.className = 'stagecraft-row';
      const labelEl = document.createElement('label');
      labelEl.textContent = `WLED: ${endpoint.label}`;
      const select = document.createElement('select');
      select.className = 'stagecraft-select';
      const loadingOpt = document.createElement('option');
      loadingOpt.textContent = 'Loading presets…';
      loadingOpt.disabled = true;
      select.appendChild(loadingOpt);
      const openLink = this._configLink(wledConfigUrl(endpoint.url), 'Open WLED to author / edit presets');
      row.append(labelEl, select, openLink);
      this.assignmentsEl.appendChild(row);

      const cached = this.wledPresetCache.get(endpoint.id);
      const presets = cached ?? await this._loadWledPresets(endpoint.id, endpoint.url);
      this._populateWledSelect(select, presets, existing[endpoint.id]);
      select.addEventListener('change', () => {
        const v = select.value;
        if (v === '') void this.host.saveAssignment(endpoint.id, null);
        else void this.host.saveAssignment(endpoint.id, { kind: 'wled', presetId: parseInt(v, 10) });
      });
    }

    // ── QLC+ row ────────────────────────────────────────────────
    const qlc = getQlcConfig();
    if (qlc) {
      const row = document.createElement('div');
      row.className = 'stagecraft-row';
      const labelEl = document.createElement('label');
      labelEl.textContent = 'QLC+:';
      const select = document.createElement('select');
      select.className = 'stagecraft-select';
      const loadingOpt = document.createElement('option');
      loadingOpt.textContent = 'Loading Functions…';
      loadingOpt.disabled = true;
      select.appendChild(loadingOpt);
      const openLink = this._configLink(qlcConfigUrl(qlc.url), 'Open QLC+ Web Interface to author Functions');
      row.append(labelEl, select, openLink);
      this.assignmentsEl.appendChild(row);

      const fns = this.qlcFunctionCache ?? await this._loadQlcFunctions(qlc.url);
      this._populateQlcSelect(select, fns, existing['qlc']);
      select.addEventListener('change', () => {
        const v = select.value;
        if (v === '') void this.host.saveAssignment('qlc', null);
        else          void this.host.saveAssignment('qlc', { kind: 'qlc', functionId: parseInt(v, 10) });
      });
    }

    // ── HA row ──────────────────────────────────────────────────
    const ha = getHaConfig();
    if (ha) {
      const row = document.createElement('div');
      row.className = 'stagecraft-row';
      const labelEl = document.createElement('label');
      labelEl.textContent = 'Home Assistant:';
      const select = document.createElement('select');
      select.className = 'stagecraft-select';
      const loadingOpt = document.createElement('option');
      loadingOpt.textContent = 'Loading entities…';
      loadingOpt.disabled = true;
      select.appendChild(loadingOpt);
      const openLink = this._configLink(haConfigUrl(ha.url), 'Open Home Assistant to author scenes / scripts');
      row.append(labelEl, select, openLink);
      this.assignmentsEl.appendChild(row);

      const entities = this.haEntityCache ?? await this._loadHaEntities(ha.url, ha.token);
      this._populateHaSelect(select, entities, existing['ha']);
      select.addEventListener('change', () => {
        const v = select.value;
        if (v === '') {
          void this.host.saveAssignment('ha', null);
        } else {
          const ent = entities.find((e) => e.entity_id === v);
          if (!ent) return;
          void this.host.saveAssignment('ha', {
            kind: 'ha',
            service: ent.domain === 'automation' ? 'script' : (ent.domain as 'scene' | 'script'),
            entity: ent.entity_id,
          });
        }
      });
    }
  }

  /** Small "↗" link next to each connection row that opens the
   *  device's own web UI in a new tab. Lets the GM author a new
   *  preset / scene / Function and come back to assign it without
   *  hunting for the URL. */
  private _configLink(href: string, title: string): HTMLAnchorElement {
    const a = document.createElement('a');
    a.className = 'stagecraft-config-link';
    a.href      = href;
    a.target    = '_blank';
    a.rel       = 'noopener';
    a.title     = title;
    a.textContent = '↗';
    return a;
  }

  private async _loadWledPresets(id: string, url: string): Promise<WledPreset[]> {
    const result = await fetchPresets(url);
    if (!result.ok) {
      this.statusEl.textContent = `WLED ${id}: ${result.message}`;
      return [];
    }
    this.wledPresetCache.set(id, result.data);
    return result.data;
  }

  private async _loadHaEntities(url: string, token: string): Promise<HaEntity[]> {
    const result = await fetchEntities(url, token);
    if (!result.ok) {
      this.statusEl.textContent = `Home Assistant: ${result.message}`;
      return [];
    }
    this.haEntityCache = result.data;
    return result.data;
  }

  private async _loadQlcFunctions(url: string): Promise<QlcFunction[]> {
    const result = await fetchFunctions(url);
    if (!result.ok) {
      this.statusEl.textContent = `QLC+: ${result.message}`;
      return [];
    }
    this.qlcFunctionCache = result.data;
    return result.data;
  }

  private _populateQlcSelect(
    select: HTMLSelectElement,
    fns: QlcFunction[],
    existing: StagecraftAssignment | undefined,
  ): void {
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '(none — do nothing on this map)';
    select.appendChild(none);
    // Group by Function type so chasers / scenes / sequences are
    // easy to scan. Mirrors how QLC+'s own dropdown organises them.
    const groups: Record<string, QlcFunction[]> = {};
    for (const f of fns) (groups[f.type] ??= []).push(f);
    for (const type of Object.keys(groups).sort()) {
      const og = document.createElement('optgroup');
      og.label = type;
      for (const f of groups[type]!) {
        const opt = document.createElement('option');
        opt.value = String(f.id);
        opt.textContent = f.name;
        og.appendChild(opt);
      }
      select.appendChild(og);
    }
    if (existing && existing.kind === 'qlc') {
      select.value = String(existing.functionId);
    } else {
      select.value = '';
    }
  }

  private _populateWledSelect(
    select: HTMLSelectElement,
    presets: WledPreset[],
    existing: StagecraftAssignment | undefined,
  ): void {
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '(none — do nothing on this map)';
    select.appendChild(none);
    for (const p of presets) {
      const opt = document.createElement('option');
      opt.value = String(p.id);
      opt.textContent = `${p.id}. ${p.name}`;
      select.appendChild(opt);
    }
    if (existing && existing.kind === 'wled') {
      select.value = String(existing.presetId);
    } else {
      select.value = '';
    }
  }

  private _populateHaSelect(
    select: HTMLSelectElement,
    entities: HaEntity[],
    existing: StagecraftAssignment | undefined,
  ): void {
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '(none — do nothing on this map)';
    select.appendChild(none);
    // Group by domain for readability.
    const groups: Record<string, HaEntity[]> = { scene: [], script: [], automation: [] };
    for (const e of entities) groups[e.domain]!.push(e);
    for (const domain of ['scene', 'script', 'automation'] as const) {
      const list = groups[domain];
      if (!list || list.length === 0) continue;
      const og = document.createElement('optgroup');
      og.label = `${domain.charAt(0).toUpperCase()}${domain.slice(1)}s`;
      for (const e of list) {
        const opt = document.createElement('option');
        opt.value = e.entity_id;
        opt.textContent = e.friendly_name;
        og.appendChild(opt);
      }
      select.appendChild(og);
    }
    if (existing && existing.kind === 'ha') {
      select.value = existing.entity;
    } else {
      select.value = '';
    }
  }

  private async _fireTest(): Promise<void> {
    this.statusEl.textContent = 'Firing assignments…';
    try {
      await this.host.fireForActiveMap();
      this.statusEl.textContent = 'Fired. (Check devices for visible response.)';
    } catch (e) {
      this.statusEl.textContent = `Fire failed: ${(e as Error).message}`;
    }
  }

}
