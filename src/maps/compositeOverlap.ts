/**
 * compositeOverlap — shared bounding-box overlap detection for
 * composite maps. Used by both the library "Layered" pill
 * (MapAssetModal) and the reveal-layer backing rasteriser
 * (GMApp save path) so they agree on whether a composite has
 * overlapping tiles.
 *
 * Ignores rotation deliberately — over-detects spinning tiles a
 * little, which is fine because a rotated tile that overlaps any
 * other is layered either way. The result drives whether the
 * Reveal Map Layer brush has anything meaningful to expose, and
 * whether the Library shows the Layered pill.
 *
 * v2.15.1 — extracted from MapAssetModal so rasterizeRevealBacking
 * stops generating a backing blob for composites that aren't
 * actually layered. Without this gate, the user could remove every
 * overlap from a composite and the layered status would persist
 * indefinitely because the backing blob lived on after the
 * geometry changed.
 */

import type { CompositeTile, MapAsset } from '../types.ts';

export function tileBoundsNorm(
  tile: CompositeTile,
  asset: MapAsset | undefined,
  canvasAspect: number,
): { x0: number; x1: number; y0: number; y1: number } {
  const widthNormX = tile.scale ?? 1;
  let heightNormY: number;
  if (tile.scaleY != null) {
    heightNormY = tile.scaleY;
  } else {
    const aspect = (asset?.imageWidth && asset?.imageHeight)
      ? asset.imageWidth / asset.imageHeight
      : 1;
    heightNormY = widthNormX * canvasAspect / aspect;
  }
  return {
    x0: tile.x - widthNormX / 2,
    x1: tile.x + widthNormX / 2,
    y0: tile.y - heightNormY / 2,
    y1: tile.y + heightNormY / 2,
  };
}

export function compositeHasOverlap(
  asset: MapAsset,
  assetById: Map<string, MapAsset>,
): boolean {
  const tiles = asset.compositeTiles ?? [];
  if (tiles.length < 2) return false;
  const canvasAspect = asset.compositeAspect ?? (4 / 3);
  const bounds = tiles.map((t) => tileBoundsNorm(t, assetById.get(t.mapAssetId), canvasAspect));
  for (let i = 0; i < bounds.length; i++) {
    for (let j = i + 1; j < bounds.length; j++) {
      const a = bounds[i]!, b = bounds[j]!;
      if (a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0) return true;
    }
  }
  return false;
}
