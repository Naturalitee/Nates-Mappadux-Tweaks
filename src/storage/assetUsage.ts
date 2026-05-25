import { getAllConfigs, getAllMaps, getAllMapAssets } from './db.ts';

/**
 * Compute the set of audio asset IDs currently referenced anywhere in the
 * saved library (soundboard slots, marker audio sources, motion-tracker pings
 * across every map). Used by My Library to flag unused assets so the GM
 * knows which can be safely deleted.
 */
export async function getUsedAudioAssetIds(): Promise<Set<string>> {
  const used = new Set<string>();
  const configs = await getAllConfigs();
  for (const cfg of configs) {
    for (const slot of cfg.audio?.slots ?? []) {
      if (slot.assetId) used.add(slot.assetId);
    }
    for (const m of cfg.markers ?? []) {
      if (m.audioTrackId) used.add(m.audioTrackId);
    }
    if (cfg.motionTracker?.outgoingPingAssetId) used.add(cfg.motionTracker.outgoingPingAssetId);
    if (cfg.motionTracker?.returnPingAssetId)   used.add(cfg.motionTracker.returnPingAssetId);
  }
  return used;
}

/**
 * Compute the set of custom-icon keys ('asset:<uuid>') referenced by any
 * marker on any saved map. Used by the IconPicker delete-mode UI.
 */
export async function getUsedIconKeys(): Promise<Set<string>> {
  const used = new Set<string>();
  const configs = await getAllConfigs();
  for (const cfg of configs) {
    for (const m of cfg.markers ?? []) {
      if (m.icon?.startsWith('asset:')) used.add(m.icon);
    }
  }
  return used;
}

/**
 * Compute the set of MapAsset ids currently referenced by any named map
 * instance. Used by the Map Library to flag unused map assets.
 *
 * v2.14.111 — also walks composite-map assets. A map image used ONLY as
 * a tile in a composite (and never as a top-level named map) used to
 * show up as Unused, so the GM could delete it from the library and
 * break the composite. Tiles count as bona-fide usages now.
 */
export async function getUsedMapAssetIds(): Promise<Set<string>> {
  const used = new Set<string>();
  const maps = await getAllMaps();
  for (const m of maps) {
    if (m.mapAssetId) used.add(m.mapAssetId);
  }
  const assets = await getAllMapAssets();
  // Iterate to a fixpoint so nested composites (a composite-as-tile inside
  // another composite) propagate usage through every level. Each pass only
  // walks composites whose own asset id is already in `used`.
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of assets) {
      if (a.source !== 'composite-map') continue;
      if (!used.has(a.id)) continue;
      for (const t of a.compositeTiles ?? []) {
        if (t.mapAssetId && !used.has(t.mapAssetId)) {
          used.add(t.mapAssetId);
          grew = true;
        }
      }
    }
  }
  return used;
}
