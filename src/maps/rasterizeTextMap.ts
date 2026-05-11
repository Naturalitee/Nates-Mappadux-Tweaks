/**
 * Rasterise a TextMapConfig (handout) into a PNG blob so it can flow
 * through the same map → texture → mesh pipeline as a real map image.
 *
 * Approach: build an SVG that wraps the sanitised body HTML in a
 * foreignObject, load it into an <img>, paint to a canvas, export PNG.
 * The SVG-foreignObject path keeps the browser doing the HTML layout —
 * fonts, line-breaking, lists, inline SVG icons all just work — without
 * pulling in a heavyweight html2canvas dependency.
 *
 * Known limitation: custom @font-face fonts loaded via the Google Fonts
 * CSS API may not be accessible inside the SVG document context. The
 * fallback is the system serif/sans, which is acceptable for M3 — the
 * preview pane stays the source of design truth, and we can inline
 * base64-encoded font binaries in a follow-up if creators ask for it.
 */

import type { TextMapConfig } from '../types.ts';
import { sanitizeSplashHtml } from '../utils/sanitizeHtml.ts';
import { ensureFontsLoaded } from '../images/fontCatalog.ts';

/** Cache of @font-face rules with base64-embedded woff2 bytes, keyed by
 *  font family. The SVG document context can't reach fonts loaded by the
 *  host page, so we embed the font binary inside a <style> inside the
 *  SVG itself. Per-session cache — fonts don't change mid-run. */
const fontFaceCache = new Map<string, string | null>();

async function fetchFontFaceForSvg(family: string): Promise<string | null> {
  const cached = fontFaceCache.get(family);
  if (cached !== undefined) return cached;

  try {
    // Fetch the Google Fonts CSS as the browser sees it — that path
    // returns woff2 URLs (other agents see ttf).
    const cssUrl =
      `https://fonts.googleapis.com/css2?family=`
      + encodeURIComponent(family).replace(/%20/g, '+')
      + `&display=swap`;
    const cssRes = await fetch(cssUrl);
    if (!cssRes.ok) { fontFaceCache.set(family, null); return null; }
    const css = await cssRes.text();
    // Pull every woff2 URL out of the CSS — most families ship multiple
    // unicode-range variants, all of which we want available inside the
    // SVG document so glyph fallbacks work. Build a single <style> with
    // all the @font-face blocks, woff2 bodies inlined as data URIs.
    const blocks: string[] = [];
    const woff2Pattern = /url\((https:\/\/[^)]+\.woff2)\)/g;
    const ffPattern    = /@font-face\s*\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ffPattern.exec(css)) !== null) {
      const body = m[1] ?? '';
      const urlMatch = woff2Pattern.exec(body);
      if (!urlMatch) continue;
      const woffUrl = urlMatch[1];
      if (!woffUrl) continue;
      const fontRes = await fetch(woffUrl);
      if (!fontRes.ok) continue;
      const buf = await fontRes.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);
      const dataUri = `data:font/woff2;base64,${b64}`;
      // Rewrite the original block: swap the http url() for the data
      // URI, leave font-family / font-style / font-weight / unicode-range
      // intact so the browser still picks the right variant per glyph.
      const rewritten = body.replace(woff2Pattern, `url(${dataUri})`);
      blocks.push(`@font-face{${rewritten}}`);
      woff2Pattern.lastIndex = 0;
    }
    const out = blocks.length > 0 ? blocks.join('\n') : null;
    fontFaceCache.set(family, out);
    return out;
  } catch {
    fontFaceCache.set(family, null);
    return null;
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  // btoa expects a binary string; chunk to avoid call-stack blowups on
  // larger font files.
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

export interface RasterizeOpts {
  /** Pixels on the long side. Defaults to 1080 — enough for a sharp
   *  player view at typical viewport sizes; the projector path can ask
   *  for higher when calibration is in play. */
  longSidePx?: number;
}

export const DEFAULT_LONG_SIDE = 1080;

/** Predict the pixel dimensions the rasteriser would produce for this
 *  config at the default long-side. Used by the editor save path so the
 *  asset's imageWidth / imageHeight match the rasterised output —
 *  downstream code (marker placement, calibration) assumes pixel-accurate
 *  dimensions, not pure ratios. */
export function predictTextMapPixelDimensions(
  cfg: Pick<TextMapConfig, 'width' | 'height'>,
  longSidePx: number = DEFAULT_LONG_SIDE,
): { pxW: number; pxH: number } {
  const aspect = cfg.width / cfg.height;
  if (aspect >= 1) {
    return { pxW: longSidePx, pxH: Math.max(1, Math.round(longSidePx / aspect)) };
  }
  return { pxW: Math.max(1, Math.round(longSidePx * aspect)), pxH: longSidePx };
}

export async function rasterizeTextMap(
  cfg: TextMapConfig,
  opts: RasterizeOpts = {},
): Promise<Blob> {
  const { pxW, pxH } = predictTextMapPixelDimensions(cfg, opts.longSidePx);

  // Kick off the host-page font load AND the SVG-context @font-face
  // fetch in parallel. The SVG document doesn't share font context with
  // the host page when loaded via <img>, so we embed the woff2 binary
  // inside a <style> in the SVG itself. The host-page load only helps
  // the editor preview, not this rasterisation.
  try { ensureFontsLoaded([cfg.fontFamily]); } catch { /* non-fatal */ }
  const fontFacePromise = fetchFontFaceForSvg(cfg.fontFamily);
  try { await document.fonts.ready; } catch { /* non-fatal */ }
  const fontFaceCss = await fontFacePromise;

  const sanitised = sanitizeSplashHtml(cfg.bodyHtml ?? '');
  const padPx = Math.round(pxW * 0.06);
  // Scale the base font size so a font-scale of 1 renders at a
  // comfortable reading size on the page. The editor preview uses ems
  // against the host page; here we anchor to page width.
  const basePx = Math.round((pxW / 60) * cfg.fontScale);

  const styleBlock = fontFaceCss
    ? `<style xmlns="http://www.w3.org/1999/xhtml">${fontFaceCss}</style>`
    : '';

  const svgMarkup =
    `<svg xmlns="http://www.w3.org/2000/svg" `
    + `width="${pxW}" height="${pxH}" viewBox="0 0 ${pxW} ${pxH}">`
    + `<foreignObject x="0" y="0" width="100%" height="100%">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="`
    +   `box-sizing:border-box;`
    +   `width:${pxW}px;height:${pxH}px;`
    +   `padding:${padPx}px;`
    +   `background:${cfg.backgroundColor};`
    +   `color:${cfg.textColor};`
    +   `font-family:'${escapeAttr(cfg.fontFamily)}', Georgia, serif;`
    +   `font-size:${basePx}px;`
    +   `line-height:1.45;`
    +   `overflow:hidden;`
    + `">${styleBlock}${sanitised}</div>`
    + `</foreignObject>`
    + `</svg>`;

  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await loadImage(svgUrl);
    const canvas = document.createElement('canvas');
    canvas.width = pxW;
    canvas.height = pxH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2D context unavailable');
    // Paint the background first as a safety net — some browsers don't
    // composite the foreignObject div's background-color reliably.
    ctx.fillStyle = cfg.backgroundColor;
    ctx.fillRect(0, 0, pxW, pxH);
    ctx.drawImage(img, 0, 0, pxW, pxH);
    return await canvasToBlob(canvas);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('failed to rasterise text-map SVG'));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
      'image/png',
    );
  });
}

function escapeAttr(s: string): string {
  return s.replace(/'/g, '&apos;').replace(/"/g, '&quot;');
}
