/**
 * Marker icons come in two shapes: image icons (`data:` / `asset:` /
 * `libAsset:`, resolved to bitmaps) and FONT/Unicode glyph icons (the default
 * 47 presets, bare characters like "◆" / "🐉"), which the map draws with
 * fillText rather than a bitmap. Anything that wants a marker's picture OUTSIDE
 * the map canvas (e.g. an initiative card) therefore needs to rasterise the
 * glyph itself — that's what this does, matching MarkerLayer's draw (black
 * stroke + colour fill, system font).
 */

/** True for font/Unicode glyph icons (no image prefix). */
export function isGlyphIcon(icon: string): boolean {
  return !(icon.startsWith('data:') || icon.startsWith('asset:') || icon.startsWith('libAsset:'));
}

/** Rasterise a glyph icon to a transparent-background dataURL, styled like the
 *  on-map marker (outline + colour fill). Returns '' if a 2D context isn't
 *  available. */
export function glyphToDataUrl(glyph: string, color: string, px = 128): string {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const iconPx = Math.floor(px * 0.7);
  ctx.font         = `${iconPx}px system-ui,sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle  = 'rgba(0,0,0,0.75)';
  ctx.lineWidth    = Math.max(2, iconPx * 0.15);
  ctx.strokeText(glyph || '?', px / 2, px / 2);
  ctx.fillStyle = color;
  ctx.fillText(glyph || '?', px / 2, px / 2);
  return canvas.toDataURL();
}
