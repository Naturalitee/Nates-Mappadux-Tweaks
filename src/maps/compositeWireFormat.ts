/**
 * compositeWireFormat — pack / unpack composite maps for the wire.
 *
 * GM-side: packCompositeForBroadcast bundles each unique tile's
 * bytes into a single ArrayBuffer with a manifest of byte offsets.
 * Reuses the existing map_change.mapBlob chunked-binary transport —
 * no new message type, no protocol change in PeerJS.
 *
 * Viewer-side: unpackCompositeBundle slices the received ArrayBuffer
 * back into per-tile Blobs ready for rasterizeFromTiles.
 *
 * Tile assets are deduplicated by id — a composite that reuses the
 * same tile asset multiple times only ships its bytes once.
 *
 * v2.14.54.
 */

import type { MapAsset, CompositeWirePayload, CompositeTile } from '../types.ts';
import type { TileInput } from './rasterizeComposite.ts';
import { MapAssetStore } from './MapAssetStore.ts';

export interface PackResult {
  /** Packed ArrayBuffer to ship as MsgMapChange.mapBlob. */
  binary: ArrayBuffer;
  /** Metadata to ship as MsgMapChange.composite. */
  wire:   CompositeWirePayload;
}

/** GM-side: pack a composite MapAsset for the wire. */
export async function packCompositeForBroadcast(asset: MapAsset): Promise<PackResult | null> {
  if (asset.source !== 'composite-map') return null;
  const tiles = asset.compositeTiles ?? [];
  if (tiles.length === 0) return null;

  // Collect blobs in tile-encounter order, deduplicated by mapAssetId.
  // Order matters only for offset assignment; the receiver uses
  // tile.mapAssetId to look the right entry up.
  type Pending = {
    id:               string;
    imageWidth:       number;
    imageHeight:      number;
    pixelsPerSquare?: number;
    mimeType:         string;
    bytes:            ArrayBuffer;
  };
  const seen = new Map<string, Pending>();
  for (const tile of tiles) {
    if (seen.has(tile.mapAssetId)) continue;
    const tileAsset = await MapAssetStore.get(tile.mapAssetId);
    if (!tileAsset) continue;
    const blob = await MapAssetStore.getBlob(tileAsset);
    if (!blob) continue;
    const bytes = await blob.arrayBuffer();
    seen.set(tile.mapAssetId, {
      id:           tileAsset.id,
      imageWidth:   tileAsset.imageWidth ?? 0,
      imageHeight:  tileAsset.imageHeight ?? 0,
      ...(tileAsset.pixelsPerSquare ? { pixelsPerSquare: tileAsset.pixelsPerSquare } : {}),
      mimeType:     blob.type || 'image/png',
      bytes,
    });
  }
  if (seen.size === 0) return null;

  // Compute offsets + total size + concatenate.
  const tileAssetsList: CompositeWirePayload['tileAssets'] = [];
  let totalSize = 0;
  for (const p of seen.values()) {
    tileAssetsList.push({
      id:          p.id,
      imageWidth:  p.imageWidth,
      imageHeight: p.imageHeight,
      ...(p.pixelsPerSquare ? { pixelsPerSquare: p.pixelsPerSquare } : {}),
      mimeType:    p.mimeType,
      blobOffset:  totalSize,
      blobSize:    p.bytes.byteLength,
    });
    totalSize += p.bytes.byteLength;
  }
  const binary = new Uint8Array(totalSize);
  let cursor = 0;
  for (const p of seen.values()) {
    binary.set(new Uint8Array(p.bytes), cursor);
    cursor += p.bytes.byteLength;
  }

  return {
    binary: binary.buffer,
    wire: {
      tiles,
      tileAssets: tileAssetsList,
      aspect:     asset.compositeAspect ?? (4 / 3),
    },
  };
}

/** Viewer-side: turn the received bundle into the TileInput[] form
 *  rasterizeFromTiles wants. Tiles whose mapAssetId isn't in the
 *  bundle (corrupted message, future GM, etc.) are silently skipped
 *  rather than aborting the whole render. */
export function unpackCompositeBundle(
  bundleBuffer: ArrayBuffer,
  payload:      CompositeWirePayload,
): TileInput[] {
  // Build per-asset Blob lookup once.
  const byId = new Map<string, { blob: Blob; meta: CompositeWirePayload['tileAssets'][number] }>();
  for (const meta of payload.tileAssets) {
    const slice = bundleBuffer.slice(meta.blobOffset, meta.blobOffset + meta.blobSize);
    const blob  = new Blob([slice], { type: meta.mimeType });
    byId.set(meta.id, { blob, meta });
  }

  const inputs: TileInput[] = [];
  for (const tile of payload.tiles) {
    const found = byId.get(tile.mapAssetId);
    if (!found) continue;
    const asset = {
      id:          found.meta.id,
      imageWidth:  found.meta.imageWidth,
      imageHeight: found.meta.imageHeight,
      ...(found.meta.pixelsPerSquare !== undefined
        ? { pixelsPerSquare: found.meta.pixelsPerSquare }
        : {}),
    };
    inputs.push({ tile, asset, blob: found.blob });
  }
  return inputs;
}

/** Returns true iff the asset is a composite. Convenience for
 *  GMApp's broadcast path. */
export function isCompositeAsset(asset: MapAsset | null | undefined): boolean {
  return !!asset && asset.source === 'composite-map';
}

// Re-export so callers (PlayerApp / ProjectorApp) can import the
// types directly without a separate types.ts dance.
export type { CompositeTile };
