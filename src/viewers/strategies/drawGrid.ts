/**
 * drawGrid — paint the 1″ / 25 mm grid overlay onto a dedicated canvas.
 *
 * v2.14.32 — one simple algorithm. Walks gridline positions in MAP-pixel
 * space and asks the renderer where each one lands on the canvas via
 * mapNormToCanvasCss. Same projection the texture rides on, so the grid
 * is by construction glued to the map.
 *
 * Gridlines are at map.x = n*K + offsetX, map.y = n*K + offsetY for
 * every integer n, where K = mapPixelsPerSquare. The absolute origin
 * is map(0, 0); offsetX/Y comes from the calibration nudge.
 *
 * No more strategy dispatch, no parallel maths, no anchor helpers —
 * the renderer's transform is authoritative.
 */

export interface GridRenderer {
  mapNormToCanvasCss(mx: number, my: number): { x: number; y: number } | null;
}

export interface DrawGridContext {
  effectiveW: number;
  effectiveH: number;
  enabled: boolean;
  color:   string;
  mapPixelsPerSquare: number | null;
  mapImageWidth:  number;
  mapImageHeight: number;
  /** Calibration nudge in MAP pixels. Defaults to 0/0 (gridlines at
   *  map.x = nK, map.y = nK). */
  gridOffsetX?: number;
  gridOffsetY?: number;
  /** The renderer whose projection drives this grid — Player or
   *  Projector. Drawing rides its camera so the grid stays glued to
   *  the map texture under pan / zoom. */
  renderer: GridRenderer;
}

function prepCanvas(
  cv: HTMLCanvasElement,
  w: number,
  h: number,
): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  cv.width  = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.width  = `${w}px`;
  cv.style.height = `${h}px`;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

export function drawGrid(cv: HTMLCanvasElement, ctx: DrawGridContext): void {
  const ctx2d = prepCanvas(cv, ctx.effectiveW, ctx.effectiveH);
  if (!ctx2d) return;
  if (!ctx.enabled) return;
  const K = ctx.mapPixelsPerSquare;
  if (!K || K <= 0) return;
  const mapW = ctx.mapImageWidth;
  const mapH = ctx.mapImageHeight;
  if (mapW <= 0 || mapH <= 0) return;

  const offsetX = ctx.gridOffsetX ?? 0;
  const offsetY = ctx.gridOffsetY ?? 0;

  ctx2d.strokeStyle = ctx.color;
  ctx2d.lineWidth = 1;
  ctx2d.beginPath();

  // Vertical lines: map x = nK + offsetX for every n keeping x in [0, mapW].
  const nMinX = Math.ceil((0    - offsetX) / K);
  const nMaxX = Math.floor((mapW - offsetX) / K);
  for (let n = nMinX; n <= nMaxX; n++) {
    const mapX = n * K + offsetX;
    const top    = ctx.renderer.mapNormToCanvasCss(mapX / mapW, 0);
    const bottom = ctx.renderer.mapNormToCanvasCss(mapX / mapW, 1);
    if (!top || !bottom) continue;
    const x = Math.round(top.x) + 0.5;
    ctx2d.moveTo(x, top.y);
    ctx2d.lineTo(x, bottom.y);
  }

  // Horizontal lines: map y = nK + offsetY for every n keeping y in [0, mapH].
  const nMinY = Math.ceil((0    - offsetY) / K);
  const nMaxY = Math.floor((mapH - offsetY) / K);
  for (let n = nMinY; n <= nMaxY; n++) {
    const mapY = n * K + offsetY;
    const left  = ctx.renderer.mapNormToCanvasCss(0, mapY / mapH);
    const right = ctx.renderer.mapNormToCanvasCss(1, mapY / mapH);
    if (!left || !right) continue;
    const y = Math.round(left.y) + 0.5;
    ctx2d.moveTo(left.x,  y);
    ctx2d.lineTo(right.x, y);
  }

  ctx2d.stroke();
}
