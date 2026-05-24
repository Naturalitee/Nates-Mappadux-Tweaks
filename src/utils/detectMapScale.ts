import { extractImageDpi } from './imageDpi.ts';

/**
 * Heuristic map-scale detector. Combines three signals — filename WxH,
 * embedded image DPI, and integer divisors of the image dimensions (assuming
 * square cells) — and returns a ranked candidate list with a confidence
 * badge. Pure: no side effects, no IDB access.
 *
 * Confidence levels:
 *   • scaled       — best candidate scores ≥ 8 with a clear gap. At least one
 *                    external signal (DPI or filename) aligns with a standard
 *                    DPI divisor. Auto-apply on import, no dialog.
 *   • auto-scaled  — best candidate scores ≥ 5 with a clear gap, OR ≥ 3 but
 *                    ambiguous. Either auto-apply or open the candidate
 *                    dialog depending on `needsConfirmation`.
 *   • unscaled     — no candidate scored enough. Manual calibration only.
 *   • no-grid      — never produced by the detector; only set by the user
 *                    opting a map out of scaling entirely.
 */

export type ScaleBadge = 'scaled' | 'auto-scaled' | 'inferred' | 'unscaled' | 'no-grid';

export interface ScaleCandidate {
  pixelsPerSquare: number;
  gridWidth:       number;
  gridHeight:      number;
  score:           number;
  reasons:         string[];
  /** v2.14.40 — true when this candidate came from a filename W×H
   *  hint whose image-divided pps wasn't a clean integer (so the
   *  detector rounded). Propagates to the badge for distinct pill
   *  rendering. */
  inferred?:       boolean;
}

export interface ScaleSignals {
  /** Grid dimensions parsed from a name hint (filename or map name). */
  nameWxH:  { w: number; h: number } | null;
  dpi:      number | null;
  imageGcd: number;
}

export interface ScaleDetection {
  best:               ScaleCandidate | null;
  /** Top candidates (best first), up to 3. */
  alternates:         ScaleCandidate[];
  badge:              ScaleBadge;
  /** True when the detector picked a `best` but multiple viable candidates
   *  remain — caller should open the candidate dialog. */
  needsConfirmation:  boolean;
  signals:            ScaleSignals;
}

export interface DetectInputs {
  /** Text sources to scan for a "WxH" grid hint — typically the file name
   *  and/or the map's display name. First plausible match wins. Users often
   *  put "[40x30]" in either, so we accept both. Order doesn't matter much
   *  in practice since plausible matches are unique. */
  nameHints?:  string[];
  imageWidth:  number;
  imageHeight: number;
  /** Optional blob — when provided, parsed for embedded DPI. Without it the
   *  detector relies on name + GCD signals only (lower confidence). */
  blob?:       Blob;
}

const PX_PER_SQ_MIN  = 50;
const PX_PER_SQ_MAX  = 600;
const GRID_MIN       = 5;
const GRID_MAX       = 200;
const HOLY_TRINITY: readonly number[] = [75, 150, 300];
const SECONDARY:    readonly number[] = [72, 100, 200];

export async function detectMapScale(inputs: DetectInputs): Promise<ScaleDetection> {
  const { imageWidth, imageHeight } = inputs;
  if (imageWidth <= 0 || imageHeight <= 0) {
    return emptyDetection({ nameWxH: null, dpi: null, imageGcd: 0 });
  }

  const nameWxH = inputs.nameHints ? findNameGrid(inputs.nameHints) : null;
  let dpi: number | null = null;
  if (inputs.blob) {
    try { dpi = await extractImageDpi(inputs.blob); } catch { dpi = null; }
  }
  const g = gcd(imageWidth, imageHeight);
  const signals: ScaleSignals = { nameWxH, dpi, imageGcd: g };

  const candidates: ScaleCandidate[] = [];

  // v2.14.40 — Name-first short-circuit. When the filename declares
  // an explicit grid (e.g. "[40x40]"), use it as the primary signal
  // even when the resulting pps is fractional or sits outside the
  // divisor-sweep band. Three cases:
  //   • Image divides cleanly + square pixels → 'scaled' candidate
  //     (score 10, badge=scaled, auto-applied).
  //   • Image aspect roughly matches the name's aspect (within 10%)
  //     but doesn't divide cleanly → 'inferred' candidate. Rounded
  //     pps, distinct badge. Close enough to be useful at the table
  //     without claiming surveyor accuracy. Auto-applied with the
  //     amber pill so the GM can verify visually.
  //   • Otherwise → no candidate from this path (divisor sweep below
  //     might still find one).
  if (nameWxH) {
    const ppsW = imageWidth  / nameWxH.w;
    const ppsH = imageHeight / nameWxH.h;
    const avg  = (ppsW + ppsH) / 2;
    if (avg >= 10 && avg <= 1000) {
      const integerExact = Number.isInteger(ppsW) && Number.isInteger(ppsH) && ppsW === ppsH;
      const aspectMatch  = avg > 0 && Math.abs(ppsW - ppsH) / avg < 0.10;
      if (integerExact) {
        candidates.push({
          pixelsPerSquare: ppsW,
          gridWidth:       nameWxH.w,
          gridHeight:      nameWxH.h,
          score:           10,
          reasons:         [`filename grid ${nameWxH.w}×${nameWxH.h} → ${ppsW} px/sq`],
        });
      } else if (aspectMatch) {
        const pps = Math.round(avg);
        candidates.push({
          pixelsPerSquare: pps,
          gridWidth:       nameWxH.w,
          gridHeight:      nameWxH.h,
          score:           8,
          reasons:         [`filename ${nameWxH.w}×${nameWxH.h} inferred → ${pps} px/sq (rounded)`],
          inferred:        true,
        });
      }
    }
  }
  for (const d of divisors(g)) {
    if (d < PX_PER_SQ_MIN || d > PX_PER_SQ_MAX) continue;
    const gw = imageWidth  / d;
    const gh = imageHeight / d;
    if (!Number.isInteger(gw) || !Number.isInteger(gh)) continue;
    if (gw < GRID_MIN || gw > GRID_MAX || gh < GRID_MIN || gh > GRID_MAX) continue;

    const reasons: string[] = [];
    let score = 0;
    if (dpi !== null && dpi === d) {
      score += 5; reasons.push(`matches image DPI (${dpi})`);
    }
    if (nameWxH) {
      if (nameWxH.w === gw && nameWxH.h === gh) {
        score += 5; reasons.push(`matches name ${gw}×${gh}`);
      } else if (nameWxH.w === gh && nameWxH.h === gw) {
        score += 5; reasons.push(`matches name ${gh}×${gw} (rotated)`);
      }
    }
    if (HOLY_TRINITY.includes(d))      { score += 3; reasons.push(`standard DPI (${d})`); }
    else if (SECONDARY.includes(d))    { score += 2; reasons.push(`common DPI (${d})`); }
    if (gw % 4 === 0 && gh % 4 === 0)  { score += 1; reasons.push('grid divisible by 4'); }
    if (d % 25 === 0)                  { score += 1; reasons.push('round DPI'); }

    candidates.push({ pixelsPerSquare: d, gridWidth: gw, gridHeight: gh, score, reasons });
  }

  // Sort by score descending. Break ties by preferring larger grids (smaller
  // pxPerSquare) because modern battlemaps cluster at 70–150 px/sq.
  candidates.sort((a, b) => b.score - a.score || a.pixelsPerSquare - b.pixelsPerSquare);

  if (candidates.length === 0) {
    return { best: null, alternates: [], badge: 'unscaled', needsConfirmation: false, signals };
  }

  const best   = candidates[0]!;
  const second = candidates[1];
  const gap    = best.score - (second?.score ?? 0);

  let badge: ScaleBadge;
  let needsConfirmation: boolean;
  // v2.14.40 — inferred candidates carry their own badge so the
  // library renders the amber 'Inferred' pill rather than green
  // 'Scaled'. They auto-apply (no confirmation dialog) — the GM
  // can verify visually via Recalibrate this Map.
  if (best.inferred) {
    badge = 'inferred';
    needsConfirmation = false;
  } else if (best.score >= 8 && gap >= 3) {
    badge = 'scaled';
    needsConfirmation = false;
  } else if (best.score >= 5 && gap >= 2) {
    badge = 'auto-scaled';
    needsConfirmation = false;
  } else if (best.score >= 3) {
    badge = 'auto-scaled';
    needsConfirmation = true;
  } else {
    badge = 'unscaled';
    needsConfirmation = false;
  }

  return { best, alternates: candidates.slice(0, 3), badge, needsConfirmation, signals };
}

function emptyDetection(signals: ScaleSignals): ScaleDetection {
  return { best: null, alternates: [], badge: 'unscaled', needsConfirmation: false, signals };
}

/**
 * If the detection result should be auto-applied to a MapAsset without
 * prompting the user, returns the field patch to merge in. Returns null
 * when no auto-apply is warranted — caller should either ignore the
 * detection (badge='unscaled') or open the candidate dialog
 * (needsConfirmation=true).
 */
export function autoApplyPatch(d: ScaleDetection):
  { pixelsPerSquare: number; scaleConfidence: 'scaled' | 'auto-scaled' | 'inferred' } | null
{
  if (!d.best) return null;
  if (d.needsConfirmation) return null;
  if (d.badge !== 'scaled' && d.badge !== 'auto-scaled' && d.badge !== 'inferred') return null;
  return { pixelsPerSquare: d.best.pixelsPerSquare, scaleConfidence: d.badge };
}

/** Pull a "WxH" grid hint out of arbitrary text — e.g. "Stockade [32x44].png"
 *  or "Tavern 40 × 30 Battlemap". Both numbers must fall inside [5, 200] —
 *  values larger than that are almost always pixel dimensions (1920×1080)
 *  rather than grid counts. */
export function parseNameGrid(text: string): { w: number; h: number } | null {
  const re = /(\d{1,3})\s*[x×]\s*(\d{1,3})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (w >= GRID_MIN && w <= GRID_MAX && h >= GRID_MIN && h <= GRID_MAX) return { w, h };
  }
  return null;
}

/** Walk multiple text sources (filename, map name, etc.) and return the
 *  first plausible WxH found. */
function findNameGrid(texts: string[]): { w: number; h: number } | null {
  for (const t of texts) {
    if (!t) continue;
    const m = parseNameGrid(t);
    if (m) return m;
  }
  return null;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a | 0); b = Math.abs(b | 0);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

function divisors(n: number): number[] {
  if (n <= 0) return [];
  const out: number[] = [];
  for (let i = 1; i * i <= n; i++) {
    if (n % i === 0) {
      out.push(i);
      if (i !== n / i) out.push(n / i);
    }
  }
  return out.sort((a, b) => a - b);
}
