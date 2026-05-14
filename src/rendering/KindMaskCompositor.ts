import * as THREE from 'three';
import type { FogPolygon, OverlayKind } from '../types.ts';
import { overlayKind } from '../mapfx/overlayKindRegistry.ts';

/**
 * KindMaskCompositor (v2.12) — for shader-driven overlay kinds.
 *
 * Maintains one OffscreenCanvas per kind that has a `shader` set in the
 * registry. Each canvas holds an RGBA mask: the alpha channel encodes
 * polygon coverage (1 where any polygon of that kind is, 0 elsewhere);
 * the RGB channels carry the polygon's own colour. The custom shader
 * plane for that kind samples this mask + time to produce the actual
 * effect (animated flames, electric crackle, etc.) — including using
 * mask.rgb as the per-polygon tint when allowColor is honoured.
 *
 * Two fire polygons with different colours produce different tints in
 * their respective regions naturally because of how the canvas paints
 * them; if they overlap, the later-drawn polygon's colour wins (which
 * matches FogCompositor's z + createdAt sort).
 *
 * Mask resolution mirrors the fog compositor (1024×1024 with normalised
 * UVs); the kind's z-stacked Three plane stretches it onto the map.
 */
export class KindMaskCompositor {
  private size: number;
  /** Per-kind mask canvas + texture. Created lazily on first sighting of
   *  a polygon for that kind; lives for the renderer's lifetime once
   *  created (dispose() tears them all down on map switch). */
  private entries = new Map<OverlayKind, { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D; texture: THREE.CanvasTexture }>();
  /** Last polygon snapshot — used so tickAnimation can re-mask if needed
   *  (animation is handled by the per-kind shader's time uniform; we
   *  don't re-redraw the masks per frame). */
  private lastPolygons: FogPolygon[] = [];

  constructor(size: number = 1024) {
    this.size = size;
  }

  /** Returns the mask texture for a kind, creating the canvas lazily.
   *  Returns null if the kind has no shader (caller shouldn't ask). */
  textureFor(kind: OverlayKind): THREE.CanvasTexture | null {
    const k = overlayKind(kind);
    if (!k.shader) return null;
    return this._ensure(kind).texture;
  }

  /** Rebuild all kind masks from the polygon list. Cheap — one canvas
   *  redraw per shader-driven kind, only when state changes. The shader
   *  itself animates via its time uniform between redraws. */
  redraw(polygons: FogPolygon[]): void {
    this.lastPolygons = polygons;
    // Bucket polygons by kind, only for kinds that need a mask.
    const byKind = new Map<OverlayKind, FogPolygon[]>();
    for (const poly of polygons) {
      const k = overlayKind(poly.kind);
      if (!k.shader) continue;
      const list = byKind.get(poly.kind) ?? [];
      list.push(poly);
      byKind.set(poly.kind, list);
    }

    // For each existing mask, redraw with its bucket (empty if no polygons
    // of that kind remain → mask goes blank).
    for (const [kind, entry] of this.entries) {
      const polys = byKind.get(kind) ?? [];
      this._rasterise(entry, polys);
    }

    // For kinds that have polygons but no mask canvas yet, create one.
    for (const [kind, polys] of byKind) {
      if (this.entries.has(kind)) continue;
      const entry = this._ensure(kind);
      this._rasterise(entry, polys);
    }
  }

  /** Returns the set of shader-driven kinds that currently have any
   *  polygons painted. The Renderer uses this to decide which shader
   *  planes need to be visible. */
  activeKinds(): OverlayKind[] {
    const set = new Set<OverlayKind>();
    for (const p of this.lastPolygons) {
      const k = overlayKind(p.kind);
      if (k.shader) set.add(p.kind);
    }
    return Array.from(set);
  }

  dispose(): void {
    for (const e of this.entries.values()) e.texture.dispose();
    this.entries.clear();
  }

  private _ensure(kind: OverlayKind) {
    let entry = this.entries.get(kind);
    if (entry) return entry;
    const canvas = new OffscreenCanvas(this.size, this.size);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(`KindMaskCompositor: 2D context unavailable for ${kind}`);
    const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    entry = { canvas, ctx, texture };
    this.entries.set(kind, entry);
    return entry;
  }

  private _rasterise(entry: { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D; texture: THREE.CanvasTexture }, polys: FogPolygon[]): void {
    const { ctx, canvas } = entry;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    if (polys.length === 0) {
      entry.texture.needsUpdate = true;
      return;
    }
    // Sort by createdAt so overlapping polygons of the same kind paint in
    // the same order the FogCompositor uses — newest wins on top. (Z is
    // the same for all polys of a kind, so createdAt is the tiebreaker.)
    const sorted = polys.slice().sort((a, b) => a.createdAt - b.createdAt);
    for (const poly of sorted) {
      if (poly.vertices.length < 3) continue;
      const kind = overlayKind(poly.kind);
      // Tint the mask with the polygon's own colour when the kind allows
      // per-poly colour; otherwise use the kind default. The shader reads
      // mask.rgb as the polygon tint at composite time.
      const tint = (kind.allowColor && poly.color) ? poly.color : kind.defaultColor;
      ctx.fillStyle = tint;
      ctx.beginPath();
      const v0 = poly.vertices[0]!;
      ctx.moveTo(v0.x * width, v0.y * height);
      for (let i = 1; i < poly.vertices.length; i++) {
        const v = poly.vertices[i]!;
        ctx.lineTo(v.x * width, v.y * height);
      }
      ctx.closePath();
      if (poly.holes) {
        for (const hole of poly.holes) {
          if (hole.length < 3) continue;
          const h0 = hole[0]!;
          ctx.moveTo(h0.x * width, h0.y * height);
          for (let i = 1; i < hole.length; i++) {
            const h = hole[i]!;
            ctx.lineTo(h.x * width, h.y * height);
          }
          ctx.closePath();
        }
      }
      ctx.fill('evenodd');
    }
    entry.texture.needsUpdate = true;
  }
}
