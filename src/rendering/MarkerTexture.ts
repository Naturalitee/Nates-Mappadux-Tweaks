import type { Marker } from '../types.ts';
import { drawMarkerShape } from './MarkerLayer.ts';

/**
 * MarkerTexture — manages an OffscreenCanvas used as Plane 2 in the Three.js
 * scene so player markers pass through the active GLSL filter.
 *
 * The canvas is passed to Renderer.setMarkerCanvas() which creates its own
 * THREE.CanvasTexture from it. After each render() call the caller should
 * invoke renderer.markMarkersDirty() to upload the new pixels to the GPU.
 */
export class MarkerTexture {
  readonly canvas: OffscreenCanvas;

  constructor() {
    this.canvas = new OffscreenCanvas(1024, 1024);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setAspectRatio(_ar: number): void { /* reserved for future aspect-ratio scaling */ }

  render(markers: Marker[], iconCache?: Map<string, ImageBitmap>): void {
    const { width: W, height: H } = this.canvas;
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    for (const m of markers) {
      if (m.hidden) continue; // players never see hidden markers
      const cx = m.position.x * W;
      const cy = m.position.y * H;
      const r  = H * 0.025 * m.size;
      drawMarkerShape(ctx as unknown as CanvasRenderingContext2D, m, cx, cy, r, false, false, iconCache);
    }
  }
}
