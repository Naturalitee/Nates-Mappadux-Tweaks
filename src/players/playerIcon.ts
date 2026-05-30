import type { ImageAsset } from '../types.ts';
import { renderLibIconFromAsset } from '../images/libIconRender.ts';

export interface PlayerIconForm {
  iconChar?:    string;
  iconDataUrl?: string;
}

/** Downscale target — small enough that even a 5-player table sending icons
 *  separately keeps each message well under the PeerJS DataChannel limit, and
 *  big enough that the icon still reads at a typical 30–60px display size on
 *  a player token. PNG preserves transparency for SVG icons with alpha. */
const ICON_PX = 64;

/**
 * Turn a picked ImageAsset into the rendered form a player token can display.
 *
 * Tokens have a dark coloured disc background (the player's identity colour
 * mixed with ~55% black), so tintable SVGs are baked white at pick time so
 * they contrast crisply. Raster and multi-colour SVG icons render in their
 * own colours. Unicode glyphs are passed through as `iconChar` — cheaper
 * than encoding a one-character data URL and rasterising at every render.
 *
 * Raster + SVG paths are downscaled to a 64-px square PNG so individual icon
 * messages stay well under the PeerJS DataChannel size limit.
 */
export async function assetToPlayerIcon(asset: ImageAsset): Promise<PlayerIconForm> {
  if (asset.source === 'unicode' && asset.unicodeChar) {
    return { iconChar: asset.unicodeChar };
  }
  const rendered = await renderLibIconFromAsset(asset, '#ffffff');
  if (rendered) {
    try { return { iconDataUrl: await downscalePngDataUrl(rendered.dataUrl, ICON_PX) }; }
    catch { return { iconDataUrl: rendered.dataUrl }; } // fall back to source if canvas refuses
  }
  if (asset.unicodeChar) return { iconChar: asset.unicodeChar };
  return {};
}

/** Decode a data URL into an `<img>`, draw downscaled, re-encode as PNG. */
function downscalePngDataUrl(srcDataUrl: string, maxPx: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const wh = Math.max(img.width || maxPx, img.height || maxPx);
      const scale = wh > 0 ? Math.min(1, maxPx / wh) : 1;
      const w = Math.max(1, Math.round((img.width || maxPx) * scale));
      const h = Math.max(1, Math.round((img.height || maxPx) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('no canvas 2D context')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = srcDataUrl;
  });
}
