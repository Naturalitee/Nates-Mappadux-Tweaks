/**
 * Player identity colours (v2.17 Player Voice).
 *
 * Players pick a colour to brand their marker, pings, and messages. Black /
 * near-black is reserved for the GM and initiative threats, so the picker
 * rejects anything that dark. A curated palette gives one-tap distinct
 * choices; the GM/player can still enter an arbitrary (non-reserved) hex.
 */

/** Curated, mutually-distinct player colours. None are near-black. */
export const PLAYER_COLOR_PALETTE: readonly string[] = [
  '#e03e3e', // red
  '#e8730c', // orange
  '#e3b505', // gold
  '#4caf50', // green
  '#2bb3a3', // teal
  '#3b82f6', // blue
  '#7c5cff', // indigo
  '#c44dd6', // magenta
  '#ec4899', // pink
  '#9b6b3f', // brown
  '#94a3b8', // slate
  '#5eead4', // aqua
];

/** Parse a #rgb / #rrggbb string into 0–255 components, or null if unparseable. */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * True when a colour is black or close enough to it to be confused with the
 * GM/threat reserved range. Uses perceptual (Rec. 709) luminance so very dark
 * but saturated colours (deep navy, dark maroon) are still allowed — only the
 * genuinely-near-black band is rejected.
 */
export function isReservedColor(hex: string): boolean {
  const rgb = parseHex(hex);
  if (!rgb) return true; // unparseable → treat as invalid/reserved so the picker rejects it
  // Rec. 709 relative luminance, 0 (black) … 255 (white).
  const lum = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
  return lum < 40;
}

/** Normalise to lower-case #rrggbb for stable comparison. */
export function normaliseHex(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex.toLowerCase();
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`;
}

/**
 * Pick a sensible default colour for a new player: the first palette entry not
 * already taken by an existing player. Falls back to the first palette colour
 * if every one is in use.
 */
export function pickDefaultPlayerColor(usedColors: string[]): string {
  const used = new Set(usedColors.map(normaliseHex));
  for (const c of PLAYER_COLOR_PALETTE) {
    if (!used.has(normaliseHex(c))) return c;
  }
  return PLAYER_COLOR_PALETTE[0]!;
}
