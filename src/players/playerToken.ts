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

/** Constant gap (in map squares) shaved off each axis of the footprint so
 *  adjacent tokens never visually touch AND the facing-pointer tick has
 *  room to protrude past the disc edge. 2026-05-30: bumped from 0.25 →
 *  0.35 (1x1 = 65 % fill, 2x2 = 165 %, 3x3 = 265 %) when the pointer was
 *  reshaped from a straddling triangle to a tick-and-arrow handle that
 *  sits FULLY outside the disc — the extra ~5 px of breathing room makes
 *  the handle easier to grab without overlapping adjacent tokens. */
export const TOKEN_FOOTPRINT_GAP_SQUARES = 0.35;
