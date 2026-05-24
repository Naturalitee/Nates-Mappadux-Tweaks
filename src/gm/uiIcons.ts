/**
 * uiIcons — shared flat-stroke SVG icon strings for the GM UI chrome.
 *
 * Style matches the Composite Editor's bottom-right cluster (resize /
 * lock / reset / rotate handles): inline monochrome SVG, stroke-only,
 * 2px stroke, rounded caps + joins, 12px box by default. `currentColor`
 * so the surrounding button's `color:` controls the tint — including
 * danger / hover states inherited from existing button classes.
 *
 * v2.14.64 — initial sweep replaces the older unicode glyphs (✎ ⬇ ✕)
 * scattered across the asset modals (Map / Image / Freesound).
 * Corner mute / select icons on map overlays are deliberately
 * untouched — they match the per-marker surround instead.
 */

/** Standard inline icon wrapper. The result is an `<svg>` ready to
 *  drop straight into an innerHTML / template string. */
function svg(path: string, size = 12): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

/** Pencil — used for "edit" actions (licence / attribution / rename). */
export function iconPencil(size = 12): string {
  return svg(`
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>
  `, size);
}

/** Download arrow — used for "save to disk" actions on library rows. */
export function iconDownload(size = 12): string {
  return svg(`
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  `, size);
}

/** Plain X — used for "close" / "remove from list" actions. Neutral
 *  in colour (the host button's color: rules the tint). */
export function iconX(size = 12): string {
  return svg(`
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6"  y1="6" x2="18" y2="18"/>
  `, size);
}
