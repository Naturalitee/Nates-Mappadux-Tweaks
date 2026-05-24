import type { TransitionDefinition } from '../../schema.ts';
import { animate, easeIn, easeInOut, easeOut } from '../../easing.ts';

/**
 * Blood Spatter — a horror transition for the genres where the GM
 * wants the table to flinch. Four phases:
 *
 *   1. Heartbeat dim    — a soft red vignette pulses in twice; primer
 *                         that something is about to happen.
 *   2. Lightning flash  — two rapid white frames with dark between.
 *                         Classic horror startle.
 *   3. Spatter burst    — irregular crimson blots erupt across the
 *                         frame from procedurally-seeded origins, each
 *                         growing from a small dot to a large
 *                         multi-lobed splatter.
 *   4. Drip + reveal    — the spatters extend into downward streaks
 *                         that are punched out via destination-out so
 *                         the new map shows through the dripping
 *                         shapes. Final clearing fades remaining blood.
 *
 * Procedural — no textures, no audio (transitions can't sample audio).
 * The shapes are deterministic per spatter index so a given GM session
 * always sees the same layout (no jarring "different blood each time").
 * Use sparingly; not every map deserves to bleed.
 */

/** Fixed-seed pseudo-random: deterministic per integer seed, ~uniform
 *  in [0, 1). Used to lay out spatter origins, lobes, streaks. */
function srand(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

interface Spatter {
  cx:     number;          // origin x (px)
  cy:     number;          // origin y (px)
  radius: number;          // overall extent (px)
  lobes:  { dx: number; dy: number; r: number }[];
}

interface Drip {
  spatterIdx: number;
  ox:         number;          // start x offset from spatter centre
  width:      number;          // streak width at top (px)
  reach:      number;          // 0..1 fraction of remaining h the drip will travel
  delay:      number;          // 0..1 fraction of drip phase before this drip starts
}

/** Seed N spatter origins across the frame so they FEEL random but
 *  cover the area — biased to upper two thirds since drips fall down. */
function buildSpatters(count: number, w: number, h: number): Spatter[] {
  const spatters: Spatter[] = [];
  for (let i = 0; i < count; i++) {
    const cx = (0.08 + srand(i * 5 + 1) * 0.84) * w;
    const cy = (0.10 + srand(i * 5 + 2) * 0.55) * h;
    const radius = (0.10 + srand(i * 5 + 3) * 0.12) * Math.min(w, h);
    // Each spatter is 5-9 overlapping irregular circles.
    const lobeCount = 5 + Math.floor(srand(i * 5 + 4) * 5);
    const lobes: { dx: number; dy: number; r: number }[] = [];
    for (let j = 0; j < lobeCount; j++) {
      const ang = srand(i * 31 + j * 7) * Math.PI * 2;
      const dist = srand(i * 31 + j * 7 + 3) * radius * 0.6;
      const r = (0.18 + srand(i * 31 + j * 7 + 5) * 0.55) * radius;
      lobes.push({ dx: Math.cos(ang) * dist, dy: Math.sin(ang) * dist, r });
    }
    spatters.push({ cx, cy, radius, lobes });
  }
  return spatters;
}

/** Seed drip streaks: each spatter spawns 1-3 streaks at staggered
 *  delays + varying widths. */
function buildDrips(spatters: Spatter[]): Drip[] {
  const drips: Drip[] = [];
  for (let i = 0; i < spatters.length; i++) {
    const sp = spatters[i]!;
    const dripCount = 1 + Math.floor(srand(i * 13 + 1) * 3);
    for (let j = 0; j < dripCount; j++) {
      drips.push({
        spatterIdx: i,
        ox:         (srand(i * 13 + j * 4 + 2) - 0.5) * sp.radius * 1.4,
        width:      (0.08 + srand(i * 13 + j * 4 + 3) * 0.18) * sp.radius,
        reach:      0.4 + srand(i * 13 + j * 4 + 4) * 0.6,
        delay:      srand(i * 13 + j * 4 + 5) * 0.35,
      });
    }
  }
  return drips;
}

/** Draw a spatter at a given growth fraction (0 = invisible, 1 = full).
 *  Uses overlapping radial gradients so the edge stays irregular as it
 *  grows, rather than just a circle scaling up. */
function drawSpatter(
  ctx:   CanvasRenderingContext2D,
  sp:    Spatter,
  grow:  number,
  alpha: number,
): void {
  if (grow <= 0 || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const lobe of sp.lobes) {
    const r = lobe.r * grow;
    if (r < 0.5) continue;
    const x = sp.cx + lobe.dx * grow;
    const y = sp.cy + lobe.dy * grow;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0,    'rgba(110, 0, 0, 1)');
    g.addColorStop(0.55, 'rgba(140, 8, 12, 0.95)');
    g.addColorStop(1,    'rgba(140, 8, 12, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Draw a downward drip streak from a spatter. Width tapers from
 *  full at the top to ~30% at the tail; the tail droplet is a small
 *  blob that swells slightly as it falls. */
function drawDripStreak(
  ctx:    CanvasRenderingContext2D,
  sp:     Spatter,
  drip:   Drip,
  hFrac:  number,      // 0..1 — how far this drip has fallen
  alpha:  number,
  hPx:    number,
): void {
  if (hFrac <= 0 || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const startX = sp.cx + drip.ox;
  const startY = sp.cy;
  const dripLen = drip.reach * (hPx - startY) * hFrac;
  if (dripLen < 1) { ctx.restore(); return; }
  // Tapered streak via a path: trapezoid wider at top.
  const wTop = drip.width;
  const wBot = drip.width * 0.35;
  const xL_top = startX - wTop / 2;
  const xR_top = startX + wTop / 2;
  const xL_bot = startX - wBot / 2;
  const xR_bot = startX + wBot / 2;
  const endY   = startY + dripLen;
  const grad = ctx.createLinearGradient(0, startY, 0, endY);
  grad.addColorStop(0,   'rgba(120, 4, 8, 0.95)');
  grad.addColorStop(0.7, 'rgba(140, 8, 12, 0.85)');
  grad.addColorStop(1,   'rgba(100, 0, 0, 0.7)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(xL_top, startY);
  ctx.lineTo(xR_top, startY);
  ctx.lineTo(xR_bot, endY);
  ctx.lineTo(xL_bot, endY);
  ctx.closePath();
  ctx.fill();
  // Tail droplet — small ellipse, swells with fall progress.
  const dropR = wBot * (0.9 + hFrac * 0.6);
  ctx.beginPath();
  ctx.ellipse(startX, endY + dropR * 0.6, dropR * 0.9, dropR, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Same trapezoid + droplet shape but used in destination-out so the
 *  new map shows through the drip path. */
function punchDripStreak(
  ctx:    CanvasRenderingContext2D,
  sp:     Spatter,
  drip:   Drip,
  hFrac:  number,
  hPx:    number,
): void {
  if (hFrac <= 0) return;
  const startX = sp.cx + drip.ox;
  const startY = sp.cy;
  const dripLen = drip.reach * (hPx - startY) * hFrac;
  if (dripLen < 1) return;
  const wTop = drip.width;
  const wBot = drip.width * 0.35;
  const endY = startY + dripLen;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.beginPath();
  ctx.moveTo(startX - wTop / 2, startY);
  ctx.lineTo(startX + wTop / 2, startY);
  ctx.lineTo(startX + wBot / 2, endY);
  ctx.lineTo(startX - wBot / 2, endY);
  ctx.closePath();
  ctx.fill();
  const dropR = wBot * (0.9 + hFrac * 0.6);
  ctx.beginPath();
  ctx.ellipse(startX, endY + dropR * 0.6, dropR * 0.9, dropR, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export default {
  id: 'blood_spatter',
  label: 'Blood Spatter (horror)',
  params: [
    {
      type: 'slider',
      id: 'duration',
      label: 'Duration',
      min: 800,
      max: 3000,
      step: 100,
      default: 1500,
      unit: 'ms',
    },
    {
      type: 'select',
      id: 'intensity',
      label: 'Intensity',
      options: [
        { value: 'low',  label: 'Subtle (3 spatters)'   },
        { value: 'med',  label: 'Standard (6 spatters)' },
        { value: 'high', label: 'Heavy (10 spatters)'    },
      ],
      default: 'med',
    },
  ],

  async play({ overlay, snapshot, params, signal }) {
    const duration = (params['duration'] as number) ?? 1500;
    const intensity = (params['intensity'] as string) ?? 'med';
    const ctx = overlay.getContext('2d')!;
    const { width: w, height: h } = overlay;

    const spatterCount = intensity === 'low' ? 3 : intensity === 'high' ? 10 : 6;
    const spatters = buildSpatters(spatterCount, w, h);
    const drips    = buildDrips(spatters);

    // Phase durations as fractions of total.
    const dHeart = duration * 0.20;
    const dLight = duration * 0.10;
    const dBurst = duration * 0.20;
    const dDrip  = duration * 0.50;

    // ── Phase 1: Heartbeat dim ────────────────────────────────────────
    // Two soft red vignette pulses primed under the still snapshot.
    await animate(dHeart, (t) => {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(snapshot, 0, 0, w, h);
      // Two pulses: peak at t=0.25 and t=0.75.
      const pulse1 = Math.max(0, Math.sin(t * Math.PI * 2)) * 0.65;
      const pulse2 = Math.max(0, Math.sin((t - 0.5) * Math.PI * 2)) * 0.85;
      const intensity = Math.max(pulse1, pulse2);
      if (intensity > 0) {
        const rg = ctx.createRadialGradient(
          w / 2, h / 2, Math.min(w, h) * 0.25,
          w / 2, h / 2, Math.max(w, h) * 0.75,
        );
        rg.addColorStop(0, 'rgba(60, 0, 0, 0)');
        rg.addColorStop(1, `rgba(110, 0, 8, ${intensity * 0.55})`);
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, w, h);
      }
    }, easeInOut, signal);
    if (signal?.aborted) return;

    // ── Phase 2: Lightning flash ──────────────────────────────────────
    // Two white flashes with a hard dark gap. Quick, aggressive.
    await animate(dLight, (t) => {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(snapshot, 0, 0, w, h);
      // Two pulses at t=0.15 and t=0.65; each spikes to white and falls.
      const spike = (centre: number, width: number): number => {
        const d = Math.abs(t - centre);
        return d > width ? 0 : 1 - d / width;
      };
      const flash = Math.max(spike(0.15, 0.10), spike(0.65, 0.08));
      if (flash > 0) {
        ctx.fillStyle = `rgba(255, 250, 245, ${flash})`;
        ctx.fillRect(0, 0, w, h);
      } else {
        // Dark gap between flashes — brief vignette dim.
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(0, 0, w, h);
      }
    }, undefined, signal);
    if (signal?.aborted) return;

    // ── Phase 3: Spatter burst ────────────────────────────────────────
    // Spatters appear over a darkened still frame. Each grows from
    // dot to full extent, staggered so they don't all pop at once.
    await animate(dBurst, (t) => {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(snapshot, 0, 0, w, h);
      // Persistent darkening from the last flash going forward.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < spatters.length; i++) {
        const sp = spatters[i]!;
        // Stagger: each spatter starts at delay i/N * 0.5 and finishes by 1.
        const delay = (i / spatters.length) * 0.5;
        const local = Math.min(1, Math.max(0, (t - delay) / (1 - delay)));
        const grow = easeOut(local);
        drawSpatter(ctx, sp, grow, 1);
      }
    }, easeIn, signal);
    if (signal?.aborted) return;

    // ── Phase 4: Drip + reveal ────────────────────────────────────────
    // Drips fall from each spatter; the streaks are drawn THEN punched
    // out via destination-out so the new map shows through the drip
    // shape. As the drip phase ends, the spatters themselves fade and
    // a global clear punches the remaining blood away to full reveal.
    await animate(dDrip, (t) => {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(snapshot, 0, 0, w, h);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, 0, w, h);
      // Spatters fade out gradually over the back half of this phase.
      const spatterAlpha = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 2);
      for (const sp of spatters) drawSpatter(ctx, sp, 1, spatterAlpha);
      // Drips fall.
      for (const drip of drips) {
        const sp = spatters[drip.spatterIdx]!;
        const local = Math.min(1, Math.max(0, (t - drip.delay) / Math.max(0.01, 1 - drip.delay)));
        const hFrac = easeIn(local);
        drawDripStreak(ctx, sp, drip, hFrac, 1, h);
      }
      // Punch the drip shapes (and grown reveal) out so the new map
      // shows through. The reveal punch widens with t so by the end
      // of the phase the screen is fully clear regardless of drip
      // coverage.
      ctx.save();
      // Drip-shaped punches first — so even early in the phase the new
      // map peeks through the streaks.
      for (const drip of drips) {
        const sp = spatters[drip.spatterIdx]!;
        const local = Math.min(1, Math.max(0, (t - drip.delay) / Math.max(0.01, 1 - drip.delay)));
        const hFrac = easeIn(local);
        punchDripStreak(ctx, sp, drip, hFrac, h);
      }
      // Final-phase global fade-to-clear so any remaining blood (the
      // dark vignette + un-dripped spatter cores) goes away cleanly.
      if (t > 0.7) {
        const clearAlpha = (t - 0.7) / 0.3;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgba(0, 0, 0, ${clearAlpha})`;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.restore();
    }, easeInOut, signal);
  },
} satisfies TransitionDefinition;
