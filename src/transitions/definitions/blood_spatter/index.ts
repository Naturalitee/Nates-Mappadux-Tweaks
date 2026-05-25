import type { TransitionDefinition } from '../../schema.ts';
import { animate, easeIn, easeOut } from '../../easing.ts';

/**
 * Blood Splatter — three phases, three controls.
 *
 *   1. Lightning flashes  — two rapid white frames with a dark gap.
 *                           Skip with the toggle for non-horror uses
 *                           (e.g. a green-slime variant).
 *   2. Splatter fill      — coloured blots accumulate on a jittered
 *                           grid until the screen is completely
 *                           covered in the chosen colour.
 *   3. Runoff             — the filled splatter layer slides down
 *                           off-screen, revealing the new map as if
 *                           the blood is running off the bottom.
 *
 * Default colour is crimson (blood); pick the colour select for
 * green slime, blue ichor, black ink, purple poison, yellow acid.
 *
 * v2.14.81 — rewrite. The previous five-control version was hard to
 * tune and rarely produced a satisfying full-screen result. This
 * version guarantees fill via a dense overlapping grid and reduces
 * the surface area to: duration / colour / lightning on-off.
 */

/** Fixed-seed pseudo-random: deterministic per integer seed, ~uniform
 *  in [0, 1). Used to jitter splatter positions + lobe placement. */
function srand(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Parse '#rrggbb' into {r, g, b}. Falls back to crimson on malformed
 *  input so the transition still runs visibly. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { r: 140, g: 8, b: 12 };
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

interface Splatter {
  cx:     number;
  cy:     number;
  radius: number;
  lobes:  { dx: number; dy: number; r: number }[];
}

/** One pendant-shaped drip hanging off the descending wipe line.
 *  `halfWidth` + `length` are in CSS px; placement is determinist-
 *  ically jittered across the frame width so the silhouette feels
 *  organic, not regular. */
interface Drip {
  x:         number;
  halfWidth: number;
  length:    number;
}

/** Build a dense overlapping grid of splatter positions sized so the
 *  union ALWAYS covers the full frame at maximum growth. Cell radius
 *  is 90% of the cell diagonal so even with jitter the splatters
 *  overlap their neighbours. */
function buildSplatters(w: number, h: number): Splatter[] {
  const aspect = w / h;
  const cols = Math.max(8, Math.round(12 * Math.sqrt(aspect)));
  const rows = Math.max(6, Math.round(12 / Math.sqrt(aspect)));
  const cellW = w / cols;
  const cellH = h / rows;
  // 90% of the cell DIAGONAL gives generous overlap with neighbours
  // — guarantees full coverage even with jitter pulling centres apart.
  const cellDiag = Math.sqrt(cellW * cellW + cellH * cellH);
  const baseRadius = cellDiag * 0.9;
  const splatters: Splatter[] = [];
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const jx = (srand(idx * 11 + 1) - 0.5) * cellW * 0.6;
      const jy = (srand(idx * 11 + 2) - 0.5) * cellH * 0.6;
      const cx = (c + 0.5) * cellW + jx;
      const cy = (r + 0.5) * cellH + jy;
      const radius = baseRadius * (0.85 + srand(idx * 11 + 3) * 0.3);
      // 5-9 overlapping lobes per splatter — irregular silhouette.
      const lobeCount = 5 + Math.floor(srand(idx * 11 + 4) * 5);
      const lobes: { dx: number; dy: number; r: number }[] = [];
      for (let j = 0; j < lobeCount; j++) {
        const ang  = srand(idx * 31 + j * 7) * Math.PI * 2;
        const dist = srand(idx * 31 + j * 7 + 3) * radius * 0.5;
        const r0   = (0.25 + srand(idx * 31 + j * 7 + 5) * 0.55) * radius;
        lobes.push({ dx: Math.cos(ang) * dist, dy: Math.sin(ang) * dist, r: r0 });
      }
      splatters.push({ cx, cy, radius, lobes });
      idx++;
    }
  }
  // Deterministic shuffle so the order they LAND in is varied (not
  // top-to-bottom) — feels more like "splatters thrown at the
  // screen" instead of a scanline fill.
  for (let i = splatters.length - 1; i > 0; i--) {
    const j = Math.floor(srand(i * 97) * (i + 1));
    const tmp = splatters[i]!;
    splatters[i] = splatters[j]!;
    splatters[j] = tmp;
  }
  return splatters;
}

/** Build drip silhouettes for the runoff wipe. ~one drip per 60 CSS
 *  px so the line reads as drips-not-zigzag at any aspect; lengths
 *  vary 30..90 px so some hang lower than others (a pure even row
 *  reads as a regular comb). */
function buildDrips(w: number): Drip[] {
  const drips: Drip[] = [];
  const count = Math.max(10, Math.round(w / 60));
  for (let i = 0; i < count; i++) {
    const slot = (i + 0.5) / count;
    const jitter = (srand(i * 53 + 11) - 0.5) * 0.4 / count;
    const x = (slot + jitter) * w;
    drips.push({
      x,
      halfWidth: 14 + srand(i * 53 + 13) * 14,
      length:    30 + srand(i * 53 + 17) * 60,
    });
  }
  return drips;
}

/** Trace the bottom-edge clip path for the runoff wipe at cutY.
 *  Starts off-canvas left at the bottom, climbs to the cut line,
 *  draws each drip as a downward pendant, then closes back along
 *  the bottom. The resulting region == "the splat layer is still
 *  visible here". */
function buildDripPath(
  ctx:   CanvasRenderingContext2D,
  cutY:  number,
  drips: Drip[],
  w:     number,
  h:     number,
): void {
  ctx.beginPath();
  ctx.moveTo(-10, h + 10);
  ctx.lineTo(-10, cutY);
  let lastX = -10;
  for (const d of drips) {
    const left  = d.x - d.halfWidth;
    const right = d.x + d.halfWidth;
    if (left > lastX) ctx.lineTo(left, cutY);
    // Pendant: bezier control points pull out + down then inward
    // to the tip, giving a teardrop bulge.
    ctx.bezierCurveTo(
      left - 2,              cutY + d.length * 0.45,
      d.x - d.halfWidth * 0.30, cutY + d.length * 0.92,
      d.x,                   cutY + d.length,
    );
    ctx.bezierCurveTo(
      d.x + d.halfWidth * 0.30, cutY + d.length * 0.92,
      right + 2,             cutY + d.length * 0.45,
      right,                 cutY,
    );
    lastX = right;
  }
  if (lastX < w + 10) ctx.lineTo(w + 10, cutY);
  ctx.lineTo(w + 10, h + 10);
  ctx.closePath();
}

/** Stroke a thin glossy highlight along the drip silhouette so the
 *  blood reads as wet + reflective rather than flat. Uses a soft
 *  white-to-transparent gradient + a tiny offset above the cut line
 *  (suggests an overhead light source). */
function drawDripGloss(
  ctx:   CanvasRenderingContext2D,
  cutY:  number,
  drips: Drip[],
  rgb:   { r: number; g: number; b: number },
): void {
  ctx.save();
  // Thin bright stroke along the silhouette edge — fakes the
  // reflective rim of wet liquid catching a key light.
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(255, 240, 240, 0.75)`;
  ctx.beginPath();
  ctx.moveTo(-10, cutY);
  for (const d of drips) {
    const left  = d.x - d.halfWidth;
    const right = d.x + d.halfWidth;
    ctx.lineTo(left, cutY);
    ctx.bezierCurveTo(
      left - 2,              cutY + d.length * 0.45,
      d.x - d.halfWidth * 0.30, cutY + d.length * 0.92,
      d.x,                   cutY + d.length,
    );
    ctx.bezierCurveTo(
      d.x + d.halfWidth * 0.30, cutY + d.length * 0.92,
      right + 2,             cutY + d.length * 0.45,
      right,                 cutY,
    );
  }
  ctx.stroke();
  // Per-drip inner highlight: a small bright ellipse offset to the
  // upper-left of each drip's bulge, suggesting a wet specular hit.
  for (const d of drips) {
    const hx = d.x - d.halfWidth * 0.35;
    const hy = cutY + d.length * 0.55;
    const rx = d.halfWidth * 0.18;
    const ry = d.length * 0.10;
    const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, Math.max(rx, ry) * 3);
    grad.addColorStop(0,   `rgba(255, 255, 255, 0.55)`);
    grad.addColorStop(0.6, `rgba(${rgb.r + 40}, ${rgb.g + 40}, ${rgb.b + 40}, 0.20)`);
    grad.addColorStop(1,   'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(hx, hy, rx * 3, ry * 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Draw one splatter (full opacity) into ctx using the supplied RGB.
 *  Uses overlapping radial gradients so the edge stays irregular. */
function drawSplatter(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  sp:  Splatter,
  rgb: { r: number; g: number; b: number },
): void {
  for (const lobe of sp.lobes) {
    const x = sp.cx + lobe.dx;
    const y = sp.cy + lobe.dy;
    const r = lobe.r;
    if (r < 0.5) continue;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0,    `rgba(${Math.max(0, rgb.r - 40)}, ${Math.max(0, rgb.g - 40)}, ${Math.max(0, rgb.b - 40)}, 1)`);
    g.addColorStop(0.55, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.95)`);
    g.addColorStop(1,    `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export default {
  id: 'blood_spatter',
  label: 'Blood Splatter',
  params: [
    {
      type: 'slider',
      id: 'duration',
      label: 'Duration',
      min: 800,
      max: 5000,
      step: 100,
      default: 2000,
      unit: 'ms',
    },
    {
      type: 'select',
      id: 'colour',
      label: 'Colour',
      options: [
        { value: '#8c080c', label: 'Crimson (blood)'      },
        { value: '#15803d', label: 'Forest Green (slime)' },
        { value: '#1e3a8a', label: 'Deep Blue (ichor)'    },
        { value: '#111111', label: 'Ink Black'            },
        { value: '#6b21a8', label: 'Toxic Purple'         },
        { value: '#ca8a04', label: 'Acid Yellow'          },
      ],
      default: '#8c080c',
    },
    {
      type: 'select',
      id: 'lightning',
      label: 'Lightning flash',
      options: [
        { value: 'on',  label: 'On'  },
        { value: 'off', label: 'Off' },
      ],
      default: 'on',
    },
  ],

  async play({ overlay, snapshot, params, signal }) {
    const duration  = (params['duration']  as number) ?? 2000;
    const colourHex = (params['colour']    as string) ?? '#8c080c';
    const lightning = (params['lightning'] as string) ?? 'on';
    const ctx = overlay.getContext('2d')!;
    const { width: w, height: h } = overlay;
    const rgb = hexToRgb(colourHex);
    const useLightning = lightning === 'on';

    // Phase budget (% of total).
    const dLight  = useLightning ? duration * 0.10 : 0;
    const dFill   = duration * (useLightning ? 0.40 : 0.45);
    const dRunoff = duration - dLight - dFill;

    // Pre-build all splatter positions for this run.
    const splatters = buildSplatters(w, h);

    // ── Phase 1: Lightning ────────────────────────────────────────────
    if (useLightning) {
      await animate(dLight, (t) => {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(snapshot, 0, 0, w, h);
        // Two flash spikes; dark gap between.
        const spike = (centre: number, width: number): number => {
          const d = Math.abs(t - centre);
          return d > width ? 0 : 1 - d / width;
        };
        const flash = Math.max(spike(0.20, 0.10), spike(0.70, 0.10));
        if (flash > 0) {
          ctx.fillStyle = `rgba(255, 250, 245, ${flash})`;
          ctx.fillRect(0, 0, w, h);
        } else {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.40)';
          ctx.fillRect(0, 0, w, h);
        }
      }, undefined, signal);
      if (signal?.aborted) return;
    }

    // ── Phase 2: Splatter fill ────────────────────────────────────────
    // Accumulate splatters onto an offscreen canvas so Phase 3 can
    // slide the whole layer downward as one piece.
    let splatLayer: OffscreenCanvas | HTMLCanvasElement;
    let splatCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
    if (typeof OffscreenCanvas !== 'undefined') {
      splatLayer = new OffscreenCanvas(w, h);
      splatCtx   = splatLayer.getContext('2d')!;
    } else {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      splatLayer = c;
      splatCtx   = c.getContext('2d')!;
    }
    let drawnSoFar = 0;
    await animate(dFill, (t) => {
      // Drive how many splatters should be visible by now.
      const target = Math.ceil(t * splatters.length);
      for (let i = drawnSoFar; i < target; i++) {
        drawSplatter(splatCtx, splatters[i]!, rgb);
      }
      drawnSoFar = target;
      // Composite display: snapshot under, accumulated splatters over.
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(snapshot, 0, 0, w, h);
      ctx.drawImage(splatLayer as CanvasImageSource, 0, 0);
    }, easeOut, signal);
    if (signal?.aborted) return;

    // Belt + braces: guarantee 100% fill at end of phase 2. Lay down
    // every remaining splatter + a final opaque wash so any micro-
    // gaps between the radial-gradient lobes fully close.
    for (let i = drawnSoFar; i < splatters.length; i++) {
      drawSplatter(splatCtx, splatters[i]!, rgb);
    }
    splatCtx.globalCompositeOperation = 'source-atop';
    splatCtx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`;
    splatCtx.fillRect(0, 0, w, h);
    splatCtx.globalCompositeOperation = 'destination-over';
    splatCtx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`;
    splatCtx.fillRect(0, 0, w, h);
    splatCtx.globalCompositeOperation = 'source-over';

    // ── Phase 3: Runoff (drip-edged downward wipe) ────────────────────
    // The cut line descends from above the top of the frame to just
    // below the bottom. Above the line + drips: revealed (new map).
    // Below: the filled splat layer still shows. A glossy specular
    // highlight rides the wipe edge so the blood reads as wet,
    // reflective material rather than a flat paint fill.
    const drips = buildDrips(w);
    const maxDrip = drips.reduce((m, d) => Math.max(m, d.length), 0);
    await animate(dRunoff, (t) => {
      ctx.clearRect(0, 0, w, h);
      // Start with the cut line above the top so the first frame is
      // still fully covered; end well below the bottom so even the
      // longest drip's tip clears the frame.
      const cutY = -maxDrip + easeIn(t) * (h + maxDrip * 2);
      // Clip to the still-covered region (below the drip line) and
      // draw the filled splat layer there.
      ctx.save();
      buildDripPath(ctx, cutY, drips, w, h);
      ctx.clip();
      ctx.drawImage(splatLayer as CanvasImageSource, 0, 0);
      ctx.restore();
      // Gloss highlight along the drip edge.
      drawDripGloss(ctx, cutY, drips, rgb);
    }, undefined, signal);
  },
} satisfies TransitionDefinition;
