import type { TokenSize } from '../types.ts';

export const TOKEN_SIZES: readonly TokenSize[] = ['1x1', '1x2', '2x2', '2x3', '3x3'] as const;
export const DEFAULT_TOKEN_SIZE: TokenSize = '1x1';

/** Width and height of a token in map squares. */
export function parseTokenSize(s: TokenSize | undefined): { w: number; h: number } {
  if (!s) return { w: 1, h: 1 };
  const m = /^(\d+)x(\d+)$/.exec(s);
  if (!m) return { w: 1, h: 1 };
  return { w: parseInt(m[1]!, 10), h: parseInt(m[2]!, 10) };
}

/** True when the token footprint is a square (renders as a circle). */
export function isSquareSize(s: TokenSize | undefined): boolean {
  const { w, h } = parseTokenSize(s);
  return w === h;
}

/** Fraction of the WxH-square footprint a token actually fills — never the
 *  whole footprint so adjacent tokens don't visually touch / overlap.
 *  Alex 2026-05-30: 75%. */
export const TOKEN_FOOTPRINT_FILL = 0.75;
