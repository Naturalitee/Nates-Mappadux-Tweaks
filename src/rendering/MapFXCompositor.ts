import * as THREE from 'three';
import type { MapFXEntity, FogVertex } from '../types.ts';
import { mapfxKind } from '../mapfx/mapfxKindRegistry.ts';
import { applyStroke } from '../mapfx/strokeEngine.ts';

/**
 * MapFXCompositor (v2.12/M4) — sibling to FogCompositor. Maintains an
 * OffscreenCanvas representing the painted MapFX layer for the active map.
 * Each entity is drawn:
 *
 *   • Polygon mode → filled with the kind's colour
 *   • Paint mode   → its base64 PNG patch is decoded and drawn at the
 *                    entity's recorded bounds, then tinted with the kind
 *                    colour via globalCompositeOperation
 *
 * Unselected entities render at low opacity (~30%) so they sit calmly under
 * the map; selecting one pops it back to full opacity. The pulse / flicker
 * effects for animated kinds (fire, smoke, electric, fear) get layered as
 * additional shader passes in a follow-up — first cut is static raster.
 */
export class MapFXCompositor {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;

  /** Decoded paint PNGs cached by entity.id so we don't re-decode each
   *  frame. Cleared on full state push or entity removal. */
  private patchCache = new Map<string, ImageBitmap>();

  /** Last entities + selection from the most recent `redraw` — used so
   *  `tickAnimation` can re-composite with modulated opacities for
   *  animated kinds without the caller re-passing the lists. */
  private lastEntities: MapFXEntity[] = [];
  private lastSelected: string | null = null;

  constructor(width = 1024, height = 1024) {
    this.canvas = new OffscreenCanvas(width, height);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('MapFXCompositor: 2D context unavailable');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas as unknown as HTMLCanvasElement);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;
  }

  /** Discard cached patches for entities no longer in state, and schedule
   *  decode for any entities whose patches we haven't loaded yet. */
  async syncPatches(entities: MapFXEntity[]): Promise<void> {
    const seen = new Set<string>();
    for (const e of entities) {
      seen.add(e.id);
      if (e.paint && !this.patchCache.has(e.id)) {
        try {
          const bmp = await decodePng(e.paint.png);
          this.patchCache.set(e.id, bmp);
        } catch { /* malformed — skip */ }
      }
    }
    for (const cached of this.patchCache.keys()) {
      if (!seen.has(cached)) this.patchCache.delete(cached);
    }
  }

  /** Composite all entities to the canvas + flag the texture for upload.
   *  Pass `time` (seconds) to drive the per-frame animation for animated
   *  kinds. Stationary calls (state change) pass 0 / omitted — animated
   *  entities still render at their kind's default brightness. */
  redraw(entities: MapFXEntity[], selectedId: string | null, time: number = 0): void {
    const { ctx, canvas } = this;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    // Cache for tickAnimation.
    this.lastEntities = entities;
    this.lastSelected = selectedId;

    // Sort by createdAt so newer entities render on top (matches the GM's
    // intuition that "the thing I just painted is on top").
    const sorted = entities.slice().sort((a, b) => a.createdAt - b.createdAt);

    for (const e of sorted) {
      const kind = mapfxKind(e.kind);
      const selected = e.id === selectedId;
      let opacity = selected ? 1.0 : 0.3;

      // v2.12/M4 — animated kinds get a brightness wobble. Per-entity phase
      // from the id hash so siblings don't pulse in sync. Subtle by default
      // (±15% around base) so it reads as "alive" rather than distracting.
      if (kind.animated && time > 0) {
        const phase = _hashIdToPhase(e.id);
        const wobble = kind.id === 'electric'
          ? (Math.sin(time * 14.0 + phase) * 0.35 + Math.sin(time * 23.0 + phase * 1.3) * 0.20) // sharper crackle
          : kind.id === 'fire'
          ? (Math.sin(time *  8.0 + phase) * 0.30 + Math.sin(time * 17.0 + phase * 1.7) * 0.15) // flicker
          : kind.id === 'water'
          ? (Math.sin(time *  2.5 + phase) * 0.20)                                              // slow shimmer
          : (Math.sin(time *  3.5 + phase) * 0.18);                                             // smoke / fear default
        opacity = Math.max(0.05, Math.min(1.0, opacity * (1.0 + wobble * 0.25)));
      }

      ctx.save();
      ctx.globalAlpha = opacity;
      // Each kind picks its own blend mode so the layer composites naturally
      // (screen for light/fire, multiply for shadow, normal otherwise).
      switch (kind.blend) {
        case 'screen':   ctx.globalCompositeOperation = 'screen';   break;
        case 'multiply': ctx.globalCompositeOperation = 'multiply'; break;
        default:         ctx.globalCompositeOperation = 'source-over';
      }

      if (e.vertices && e.vertices.length >= 3) {
        ctx.fillStyle = kind.defaultColor;
        ctx.beginPath();
        const v0 = e.vertices[0]!;
        ctx.moveTo(v0.x * width, v0.y * height);
        for (let i = 1; i < e.vertices.length; i++) {
          const v = e.vertices[i]!;
          ctx.lineTo(v.x * width, v.y * height);
        }
        ctx.closePath();
        ctx.fill();
      } else if (e.paint) {
        const bmp = this.patchCache.get(e.id);
        if (bmp) {
          const b = e.paint.bounds;
          // Draw the cached patch at its recorded bounds. The patch already
          // carries the kind colour in its pixels (the GM painted with the
          // kind's colour); the kind's blend mode handles compositing.
          ctx.drawImage(bmp, b.x * width, b.y * height, b.w * width, b.h * height);
        }
      }
      ctx.restore();
    }

    this.texture.needsUpdate = true;
  }

  /** Wipe the compositor — used on map_change before the new state lands. */
  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.patchCache.clear();
    this.texture.needsUpdate = true;
  }

  /** Paint a live in-progress stroke directly onto the compositor canvas
   *  for instant feedback while the GM is dragging. The next `redraw` call
   *  will replace this with the committed entity's cached patch — strokes
   *  are short enough that the swap is invisible. */
  applyLiveStroke(stroke: { points: FogVertex[]; radius: number; mode: 'paint' | 'erase'; color: string }): void {
    applyStroke({ canvas: this.canvas, ctx: this.ctx }, stroke);
    this.texture.needsUpdate = true;
  }

  /** Returns true if any cached entity has an animated kind — caller uses
   *  this to decide whether to schedule per-frame redraws. */
  hasAnimatedEntities(): boolean {
    for (const e of this.lastEntities) {
      if (mapfxKind(e.kind).animated) return true;
    }
    return false;
  }

  /** Re-composite with a fresh time value. Cheap because paint patches are
   *  already in the cache. Called from the Renderer animation loop when
   *  hasAnimatedEntities() is true. */
  tickAnimation(time: number): void {
    if (this.lastEntities.length === 0) return;
    this.redraw(this.lastEntities, this.lastSelected, time);
  }

  dispose(): void {
    this.texture.dispose();
    this.patchCache.clear();
  }
}

function decodePng(base64Png: string): Promise<ImageBitmap> {
  const url = base64Png.startsWith('data:') ? base64Png : `data:image/png;base64,${base64Png}`;
  return fetch(url).then((r) => r.blob()).then(createImageBitmap);
}

/** Stable id → phase in 0..2π so animated entities don't pulse in sync. */
function _hashIdToPhase(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 0xffffffff) * Math.PI * 2;
}
