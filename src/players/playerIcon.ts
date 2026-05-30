import type { ImageAsset } from '../types.ts';
import { renderLibIconFromAsset } from '../images/libIconRender.ts';

export interface PlayerIconForm {
  iconChar?:    string;
  iconDataUrl?: string;
}

/** Maximum longest-side resolution for the rasterised icon. Tuned for the
 *  worst-case display: a 3×3 token at typical map scale + HiDPI supersampling
 *  fits comfortably inside 500px (Alex 2026-05-30). Raster icons smaller than
 *  this cap keep their native size; larger ones scale down. SVGs are vector
 *  so we always render them AT this size — their intrinsic dimensions are
 *  arbitrary and frequently tiny (32×32 etc.). */
const ICON_MAX_PX = 500;

/**
 * Turn a picked ImageAsset into the rendered form a player token can display.
 *
 * Tokens have a dark coloured disc background (the player's identity colour
 * mixed with ~55% black), so tintable SVGs are baked white at pick time so
 * they contrast crisply. Raster and multi-colour SVG icons render in their
 * own colours. Unicode glyphs are passed through as `iconChar` — cheaper
 * than encoding a one-character data URL and rasterising at every render.
 *
 * Image paths are rasterised to PNG at the asset's native resolution so the
 * delivered icon never looks worse than the source. The chunked binary
 * transport handles arbitrary sizes (same path that ships map blobs).
 */
export async function assetToPlayerIcon(asset: ImageAsset): Promise<PlayerIconForm> {
  if (asset.source === 'unicode' && asset.unicodeChar) {
    return { iconChar: asset.unicodeChar };
  }
  const rendered = await renderLibIconFromAsset(asset, '#ffffff');
  if (rendered) {
    try {
      return { iconDataUrl: await rasterizeToPng(rendered.dataUrl) };
    } catch (err) {
      // Falling back to the source data URL would break remote delivery
      // (an SVG URL is URL-encoded UTF-8, not base64, so the wire chunker
      // can't reproduce it). Drop the icon instead — player falls back to
      // the initial-letter disc rather than getting a corrupt image.
      console.warn('[player-icon] rasterise failed; dropping icon', err);
    }
  }
  if (asset.unicodeChar) return { iconChar: asset.unicodeChar };
  return {};
}

/** Decode a data URL into an `<img>` and re-encode as PNG. SVGs always render
 *  at ICON_MAX_PX (longest side) since they're vector and their intrinsic
 *  size is often tiny. Raster icons use their native size up to the cap.
 *  crossOrigin is deliberately not set — for data URLs that attribute can
 *  prevent the image from loading at all on some browsers. */
function rasterizeToPng(srcDataUrl: string): Promise<string> {
  const isSvg = srcDataUrl.startsWith('data:image/svg+xml');
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const iw = img.naturalWidth  || img.width  || ICON_MAX_PX;
      const ih = img.naturalHeight || img.height || ICON_MAX_PX;
      const longest = Math.max(iw, ih);
      const scale = isSvg
        ? (longest > 0 ? ICON_MAX_PX / longest : 1) // SVG → always render at cap
        : (longest > ICON_MAX_PX ? ICON_MAX_PX / longest : 1); // raster → cap, don't upscale
      const w = Math.max(1, Math.round(iw * scale));
      const h = Math.max(1, Math.round(ih * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('no canvas 2D context')); return; }
      try {
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('canvas export failed'));
      }
    };
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = srcDataUrl;
  });
}
