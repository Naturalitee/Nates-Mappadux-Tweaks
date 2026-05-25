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

/** Minimum overlap (in composite-norm units) for two tiles to count
 *  as actually overlapping. ~0.1% of canvas in either axis — small
 *  enough to catch any genuine overlap, large enough to absorb the
 *  floating-point residue left by snap math + the grid-snap rounding
 *  that "perfectly butted" tiles always sit a few ULPs off-edge from.
 *
 *  v2.15.4 — chosen after Alex spotted that two grid-snapped 6×6
 *  tiles butted edge-to-edge (x = 0.25, x = 0.5, both scale 0.25)
 *  were registering as overlapping. Their bounds shared the edge
 *  at x = 0.375 nominally, but the actual stored x carried a tiny
 *  positive bias from `Math.round((nx - 0.5) / cell) * cell + 0.5`
 *  in the snap path, pushing one bound past the other by ~1e-7. */
const OVERLAP_EPS = 0.001;

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
      if (a.x0 < b.x1 - OVERLAP_EPS && a.x1 > b.x0 + OVERLAP_EPS
       && a.y0 < b.y1 - OVERLAP_EPS && a.y1 > b.y0 + OVERLAP_EPS) {
        return true;
      }
    }
  }
  return false;
}
