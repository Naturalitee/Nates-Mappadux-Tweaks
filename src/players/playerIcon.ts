import type { ImageAsset } from '../types.ts';
import { renderLibIconFromAsset } from '../images/libIconRender.ts';

export interface PlayerIconForm {
  iconChar?:    string;
  iconDataUrl?: string;
}

/**
 * Turn a picked ImageAsset into the rendered form a player token can display.
 *
 * Player tokens have a dark coloured disc background (the player's identity
 * colour mixed with ~55% black), so tintable SVGs are baked white at pick
 * time so they contrast crisply. Raster and non-tintable assets render as-is.
 * Unicode glyphs are passed through as `iconChar` — cheaper than encoding a
 * one-character data URL and rasterising at every render.
 */
export async function assetToPlayerIcon(asset: ImageAsset): Promise<PlayerIconForm> {
  if (asset.source === 'unicode' && asset.unicodeChar) {
    return { iconChar: asset.unicodeChar };
  }
  const rendered = await renderLibIconFromAsset(asset, '#ffffff');
  if (rendered) return { iconDataUrl: rendered.dataUrl };
  if (asset.unicodeChar) return { iconChar: asset.unicodeChar };
  return {};
}
