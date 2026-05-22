import type { MapAsset } from '../types.ts';
import { MapAssetStore } from '../maps/MapAssetStore.ts';
import { attachGestures } from '../utils/Gestures.ts';

/**
 * Map calibration UI: shows the map image full-screen with two draggable
 * crosshair handles. Scroll-wheel zooms toward the cursor; click-drag on
 * empty space pans. The user places the crosses on two points whose distance
 * they know in 1"/25mm grid squares (the table-grid unit; the in-game
 * meaning of one square is up to the GM's system) and clicks Save.
 *
 * Stored as `pixelsPerSquare` on the MapAsset — map pixels per ONE 1"/25mm
 * square. The Projector view divides by its own pixels-per-square to get
 * the projector-rectangle size on the map.
 */
export class MapCalibrationModal {
  private overlay: HTMLElement | null = null;
  private blobUrl: string | null = null;
  private resolver: (() => void) | null = null;

  /** Endpoint positions in NATURAL image coordinates. */
  private a = { x: 0, y: 0 };
  private b = { x: 0, y: 0 };

  /** Cached image dims. */
  private imgW = 1;
  private imgH = 1;

  /** Current SVG viewBox: [x, y, w, h]. Zoom = imgW / vbW. */
  private vb: [number, number, number, number] = [0, 0, 1, 1];

  /** v2.14.18 — grid offset in map pixels (the border-nudge value).
   *  Loaded from asset.gridOffsetX/Y on open; mutated by arrow-key
   *  nudges; persisted alongside other calibration data on save. */
  private gridOffsetX = 0;
  private gridOffsetY = 0;
  /** v2.14.18 — keydown handler for arrow-key nudge; attached on
   *  open, removed on close. */
  private _onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  /** Open the calibration UI; resolves once the modal closes. */
  async open(asset: MapAsset): Promise<void> {
    const blob = await MapAssetStore.getBlob(asset);
    if (!blob) { alert('Cannot calibrate — map image is unavailable.'); return; }
    this.blobUrl = URL.createObjectURL(blob);

    const dims = asset.imageWidth && asset.imageHeight
      ? { width: asset.imageWidth, height: asset.imageHeight }
      : (await MapAssetStore.readDimensions(blob)) ?? { width: 1024, height: 768 };
    this.imgW = dims.width;
    this.imgH = dims.height;
    this.vb   = [0, 0, this.imgW, this.imgH];

    // v2.14.18 — restore stored grid offset, if any.
    this.gridOffsetX = asset.gridOffsetX ?? 0;
    this.gridOffsetY = asset.gridOffsetY ?? 0;

    // Pick up where the last calibration left off if we have it; otherwise
    // a default horizontal line spanning ~50% of the image width.
    const saved = asset.calibrationLine;
    if (saved) {
      this.a = { x: saved.ax, y: saved.ay };
      this.b = { x: saved.bx, y: saved.by };
    } else {
      const cx = this.imgW / 2;
      const cy = this.imgH / 2;
      const dx = this.imgW * 0.25;
      this.a = { x: cx - dx, y: cy };
      this.b = { x: cx + dx, y: cy };
    }

    this.overlay = this._buildUI(asset);
    document.body.appendChild(this.overlay);
    return new Promise<void>((resolve) => { this.resolver = resolve; });
  }

  private close(): void {
    if (this._onKeyDown) {
      window.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = null;
    if (this.resolver) { this.resolver(); this.resolver = null; }
  }

  private _buildUI(asset: MapAsset): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'calibration-overlay';

    // Pre-fill the squares input. Prefer the exact value the user previously
    // typed (so re-opening shows e.g. "30" if they typed "30"), else infer
    // from the current pixelsPerSquare and endpoint distance, else default 10.
    const savedLine = asset.calibrationLine;
    const px0 = Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y);
    const initialSquares = savedLine?.squares
      ?? (asset.pixelsPerSquare ? (px0 / asset.pixelsPerSquare) : 10);

    // Pre-fill the by-grid inputs from the last saved grid dims if any.
    // Falling back to "" (empty) is deliberate — empty means "user is on the
    // ruler path, don't auto-prefer by-grid on save".
    const initialGridH = asset.gridSquares?.h ?? '';
    const initialGridV = asset.gridSquares?.v ?? '';

    overlay.innerHTML = `
      <div class="calibration-frame">
        <header class="calibration-header">
          <div>
            <h3>Calibrate &ldquo;${this._esc(asset.filename)}&rdquo;</h3>
            <p>Drag the two crosses to two points whose grid distance you know. Scroll or pinch to zoom, drag empty space to pan. Then enter how many 1&Prime;/25 mm squares the line spans.</p>
          </div>
          <label class="calibration-toggle-grid" title="Overlay a 1″/25 mm grid on the map at the current calibration. Useful for eyeballing the calculated spacing against any visible grid drawn on the map itself. Arrow keys nudge the grid to align with bordered maps (Shift+arrow for 10px steps; Esc resets the nudge).">
            <input type="checkbox" class="calibration-grid-overlay-toggle" />
            <span>Show grid</span>
          </label>
          <button class="btn btn--ghost btn--xs calibration-reset" title="Reset zoom and pan">Reset View</button>
        </header>
        <div class="calibration-canvas-wrap">
          <svg class="calibration-svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
            <image class="calibration-image" href="${this.blobUrl ?? ''}" x="0" y="0" width="${this.imgW}" height="${this.imgH}" />
            <!-- v2.14.17 — grid overlay group, populated by _updateCalGrid when the Show Grid toggle is on. -->
            <g class="calibration-grid-overlay"></g>
            <line class="calibration-line calibration-line-base" />
            <line class="calibration-line calibration-line-ants" />
            <g class="calibration-handle" data-handle="a"></g>
            <g class="calibration-handle" data-handle="b"></g>
          </svg>
        </div>
        <footer class="calibration-footer">
          <div class="calibration-mode-rows">
            <label class="calibration-distance">
              <span>This line is</span>
              <input type="number" class="calibration-distance-input" min="0.5" step="0.5" value="${initialSquares.toFixed(1)}" />
              <span>squares <small>(1&Prime;/25 mm)</small></span>
            </label>
            <div class="calibration-by-grid">
              <span>or whole map is</span>
              <input type="number" class="calibration-grid-h" min="1" step="1" placeholder="H" value="${initialGridH}" />
              <span aria-hidden="true">&times;</span>
              <input type="number" class="calibration-grid-v" min="1" step="1" placeholder="V" value="${initialGridV}" />
              <span>squares</span>
              <span class="calibration-grid-feedback" aria-live="polite"></span>
            </div>
            <div class="calibration-by-dpi">
              <span>or DPI is</span>
              <select class="calibration-dpi-select" title="Common map DPIs. VTT entries are typical for maps made for virtual tabletop apps; the others are common print/display resolutions.">
                <option value="">—</option>
                <option value="60">60</option>
                <option value="70">70 (VTT)</option>
                <option value="75">75</option>
                <option value="100">100 (VTT)</option>
                <option value="140">140 (VTT)</option>
                <option value="150">150</option>
                <option value="300">300</option>
              </select>
            </div>
          </div>
          <span class="calibration-current"></span>
          <div class="calibration-actions">
            <button class="btn btn--ghost calibration-cancel">Cancel</button>
            <button class="btn btn--primary calibration-save">Save</button>
          </div>
        </footer>
      </div>
    `;

    const svg     = overlay.querySelector<SVGSVGElement>('.calibration-svg')!;
    const line    = svg.querySelector<SVGLineElement>('.calibration-line')!;
    const handleA = svg.querySelector<SVGGElement>('[data-handle="a"]')!;
    const handleB = svg.querySelector<SVGGElement>('[data-handle="b"]')!;

    /**
     * Convert a pointer event's client position to SVG-internal natural coords
     * via the SVG's screen CTM. This automatically respects letterboxing from
     * preserveAspectRatio="xMidYMid meet" so the cursor maps to the exact
     * pixel under it, regardless of image aspect mismatch.
     */
    const svgPoint = svg.createSVGPoint();
    const clientToSvg = (cx: number, cy: number): { x: number; y: number } => {
      svgPoint.x = cx;
      svgPoint.y = cy;
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const p = svgPoint.matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    };
    const eventToSvg = (e: PointerEvent | WheelEvent) => clientToSvg(e.clientX, e.clientY);

    /**
     * Crosshair drawing — fixed 30-px on-screen size regardless of zoom.
     * Layered: yellow base arms + dark marching-ants overlay for visibility
     * over both light and dark map backgrounds.
     */
    const drawCrosshair = (g: SVGGElement, x: number, y: number) => {
      const rect = svg.getBoundingClientRect();
      const pxPerNatural = rect.width / this.vb[2];
      const arm = 15 / pxPerNatural; // 15 natural-unit half-arm = 30 on-screen px
      g.setAttribute('transform', `translate(${x} ${y})`);
      g.innerHTML = `
        <line class="cx-arm cx-base" x1="${-arm}" y1="0" x2="${arm}" y2="0" />
        <line class="cx-arm cx-base" x1="0" y1="${-arm}" x2="0" y2="${arm}" />
        <line class="cx-arm cx-ants" x1="${-arm}" y1="0" x2="${arm}" y2="0" />
        <line class="cx-arm cx-ants" x1="0" y1="${-arm}" x2="0" y2="${arm}" />
        <circle class="cx-dot" cx="0" cy="0" r="${arm * 0.16}" />
        <circle class="cx-hit" cx="0" cy="0" r="${arm * 1.4}" />
      `;
    };

    const redraw = () => {
      // DEBUG (v2.14.21) — should be sub-ms.
      const tStart = performance.now();
      svg.setAttribute('viewBox', this.vb.join(' '));
      [line, ...svg.querySelectorAll<SVGLineElement>('.calibration-line')].forEach((l) => {
        l.setAttribute('x1', String(this.a.x));
        l.setAttribute('y1', String(this.a.y));
        l.setAttribute('x2', String(this.b.x));
        l.setAttribute('y2', String(this.b.y));
      });
      drawCrosshair(handleA, this.a.x, this.a.y);
      drawCrosshair(handleB, this.b.x, this.b.y);
      const tEnd = performance.now();
      if (tEnd - tStart > 4) console.log(`[cal-redraw] ${(tEnd - tStart).toFixed(0)}ms`);
    };

    // Initial draw — defer so getBoundingClientRect has stable layout.
    requestAnimationFrame(redraw);
    window.addEventListener('resize', redraw);

    /** Clamp viewBox dimension to the allowed zoom range. */
    const clampW = (w: number) => Math.max(this.imgW * 0.02, Math.min(this.imgW * 4, w));

    /** Apply a discrete zoom around a natural-coord anchor point. */
    const zoomAround = (anchor: { x: number; y: number }, factor: number) => {
      const [vx, vy, vw, vh] = this.vb;
      const newW = clampW(vw * factor);
      const newH = newW * (vh / vw);
      this.vb = [
        anchor.x - (anchor.x - vx) * (newW / vw),
        anchor.y - (anchor.y - vy) * (newH / vh),
        newW,
        newH,
      ];
    };

    // Wheel + pointer drag + pinch via the shared Gestures helper. The helper
    // also sets touch-action:none so two-finger pinches don't trigger native
    // browser zoom on touch screens.
    let panStartVb: [number, number, number, number] | null = null;
    let twoLast = { midX: 0, midY: 0, scale: 1 };

    attachGestures(svg, {
      // Skip if the press hit a crosshair handle — its own pointerdown
      // captures and stops propagation, but the gesture helper attaches to
      // the SVG so it still sees the event. Returning false leaves the
      // handle's behaviour intact.
      shouldStart: (e) => !(e.target as Element).closest('.calibration-handle'),

      onWheel: ({ clientX, clientY, factor }) => {
        zoomAround(clientToSvg(clientX, clientY), factor);
        redraw();
      },

      onDrag: (e) => {
        if (e.phase === 'start') {
          panStartVb = [...this.vb];
        } else if (e.phase === 'move' && panStartVb) {
          const ctm = svg.getScreenCTM();
          const ratioX = ctm ? 1 / ctm.a : 1;
          const ratioY = ctm ? 1 / ctm.d : 1;
          this.vb = [
            panStartVb[0] - e.dx * ratioX,
            panStartVb[1] - e.dy * ratioY,
            panStartVb[2],
            panStartVb[3],
          ];
          redraw();
        } else {
          panStartVb = null;
        }
      },

      onTwoFinger: (e) => {
        if (e.phase === 'start') {
          twoLast = { midX: e.midX, midY: e.midY, scale: 1 };
        } else if (e.phase === 'move') {
          // Incremental: per-frame zoom around the current midpoint, then pan
          // by the per-frame midpoint delta. Small per-frame deltas keep the
          // CTM-based ratio close enough to correct without a full re-solve.
          const stepScale = e.scale / twoLast.scale;
          const dxClient  = e.midX - twoLast.midX;
          const dyClient  = e.midY - twoLast.midY;
          twoLast = { midX: e.midX, midY: e.midY, scale: e.scale };

          zoomAround(clientToSvg(e.midX, e.midY), 1 / stepScale);
          const ctm = svg.getScreenCTM();
          const ratioX = ctm ? 1 / ctm.a : 1;
          const ratioY = ctm ? 1 / ctm.d : 1;
          this.vb[0] -= dxClient * ratioX;
          this.vb[1] -= dyClient * ratioY;
          redraw();
        }
      },
    });

    // Drag handles. Capture the offset between the cursor and the crosshair
    // centre at pointerdown so the cross stays under whatever point of itself
    // the user originally grabbed (rather than snapping its centre to the cursor).
    const startHandleDrag = (which: 'a' | 'b') => (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startPt    = eventToSvg(e);
      const handle     = which === 'a' ? this.a : this.b;
      const offX       = handle.x - startPt.x;
      const offY       = handle.y - startPt.y;
      const move = (ev: PointerEvent) => {
        // DEBUG: timer around the per-pointer-move handler. Should be
        // <2ms; anything more is the freeze culprit.
        const tMove = performance.now();
        const p  = eventToSvg(ev);
        const cx = Math.max(0, Math.min(this.imgW, p.x + offX));
        const cy = Math.max(0, Math.min(this.imgH, p.y + offY));
        if (which === 'a') this.a = { x: cx, y: cy };
        else                this.b = { x: cx, y: cy };
        const tRedrawStart = performance.now();
        redraw();
        const tRedrawEnd = performance.now();
        // v2.14.17 — live grid update during drag so the GM can
        // align the calculated 1″ spacing against the map's own
        // gridlines visually.
        updateCalGrid();
        const tEnd = performance.now();
        const total = tEnd - tMove;
        if (total > 8) {
          console.log(`[cal-drag] move total=${total.toFixed(0)}ms  redraw=${(tRedrawEnd - tRedrawStart).toFixed(0)}ms  updateCalGrid=${(tEnd - tRedrawEnd).toFixed(0)}ms`);
        }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup',   up);
        // v2.14.3 — drag-end makes the line the master; H, V, DPI follow.
        syncInputsFromLine();
        updateCalGrid();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup',   up);
    };
    handleA.addEventListener('pointerdown', startHandleDrag('a'));
    handleB.addEventListener('pointerdown', startHandleDrag('b'));

    // Reset zoom + pan.
    overlay.querySelector<HTMLButtonElement>('.calibration-reset')?.addEventListener('click', () => {
      this.vb = [0, 0, this.imgW, this.imgH];
      redraw();
    });

    // ─── By-grid path: live feedback + save-time precedence ───────────────
    // The user can skip the ruler entirely if they know the map's grid
    // dimensions (e.g. "this map is 25 × 30"), or — v2.14.2 — pick a
    // DPI from the common-VTT/print list. All three controls (H/V, DPI,
    // and the ruler line) drive `pixelsPerSquare`; H/V ↔ DPI are
    // self-reactive so you can think in whichever frame is easier.
    const gridHInput   = overlay.querySelector<HTMLInputElement>('.calibration-grid-h')!;
    const gridVInput   = overlay.querySelector<HTMLInputElement>('.calibration-grid-v')!;
    const gridFeedback = overlay.querySelector<HTMLSpanElement>('.calibration-grid-feedback')!;
    const dpiSelect    = overlay.querySelector<HTMLSelectElement>('.calibration-dpi-select')!;

    // Common DPIs from the dropdown — keep in sync with the <option>s
    // above. Used by both the dropdown→H/V flow and the H/V→green-
    // highlight match feedback.
    const COMMON_DPIS: ReadonlyArray<{ dpi: number; label: string }> = [
      { dpi: 60,  label: '60'         },
      { dpi: 70,  label: '70 (VTT)'   },
      { dpi: 75,  label: '75'         },
      { dpi: 100, label: '100 (VTT)'  },
      { dpi: 140, label: '140 (VTT)'  },
      { dpi: 150, label: '150'        },
      { dpi: 300, label: '300'        },
    ];
    const matchCommonDpi = (pps: number): { dpi: number; label: string } | null => {
      // Tolerance: half-pixel slop so an honest 100.4 still flags as "100 (VTT)".
      for (const c of COMMON_DPIS) if (Math.abs(pps - c.dpi) < 0.6) return c;
      return null;
    };

    type GridSolve = {
      ok: boolean;
      pps: number | null;
      hPps: number | null;
      vPps: number | null;
      hClean: boolean;
      vClean: boolean;
      matched: boolean;
    };
    const solveGrid = (): GridSolve => {
      const h = parseInt(gridHInput.value, 10);
      const v = parseInt(gridVInput.value, 10);
      const hValid = Number.isFinite(h) && h > 0;
      const vValid = Number.isFinite(v) && v > 0;
      if (!hValid && !vValid) {
        return { ok: false, pps: null, hPps: null, vPps: null, hClean: false, vClean: false, matched: false };
      }
      const hPps = hValid ? this.imgW / h : null;
      const vPps = vValid ? this.imgH / v : null;
      const hClean = hPps !== null && Math.abs(hPps - Math.round(hPps)) < 1e-6;
      const vClean = vPps !== null && Math.abs(vPps - Math.round(vPps)) < 1e-6;
      const matched = hPps !== null && vPps !== null && Math.abs(hPps - vPps) < 0.5;
      const ok = hValid && vValid;
      const pps = ok ? ((hPps! + vPps!) / 2) : null;
      return { ok, pps, hPps, vPps, hClean, vClean, matched };
    };

    // v2.14.2 — reflect the live pps into the DPI dropdown so the GM
    // can see "ah, this maps to 100 (VTT)" without doing the maths.
    // Set to the exact match when one exists, else blank.
    const syncDpiSelectFromPps = (pps: number | null) => {
      if (pps === null || !Number.isFinite(pps)) { dpiSelect.value = ''; return; }
      const match = matchCommonDpi(pps);
      dpiSelect.value = match ? String(match.dpi) : '';
    };

    // v2.14.5 — live "Current:" line tracks the pending pps as inputs
    // change, instead of frozen on the saved value at open-time. Helps
    // the GM see what would actually be saved before they click Save.
    const currentEl = overlay.querySelector<HTMLElement>('.calibration-current');
    const refreshCurrent = (pendingPps: number | null) => {
      if (!currentEl) return;
      if (pendingPps !== null && Number.isFinite(pendingPps) && pendingPps > 0) {
        const m = matchCommonDpi(pendingPps);
        currentEl.textContent = m
          ? `Will save: ${pendingPps.toFixed(1)} map-px / square · ${m.label} DPI`
          : `Will save: ${pendingPps.toFixed(1)} map-px / square`;
      } else if (asset.pixelsPerSquare) {
        currentEl.textContent = `Current: ${asset.pixelsPerSquare.toFixed(1)} map-px per square`;
      } else {
        currentEl.textContent = 'Not yet calibrated';
      }
    };
    refreshCurrent(null);

    const updateGridFeedback = () => {
      const tStart = performance.now();
      const g = solveGrid();
      gridFeedback.classList.remove('is-ok', 'is-warn');
      if (!g.ok) {
        if (g.hPps !== null || g.vPps !== null) {
          // One field filled — show what it'd give as a hint, no decision yet.
          const single = g.hPps ?? g.vPps!;
          gridFeedback.textContent = `→ ${single.toFixed(1)} px/sq (need both)`;
        } else {
          gridFeedback.textContent = '';
        }
        syncDpiSelectFromPps(null);
        refreshCurrent(g.hPps ?? g.vPps ?? null);
        return;
      }
      // Both filled — judge cleanliness and match.
      const messages: string[] = [];
      if (!g.hClean) messages.push(`H not whole (${g.hPps!.toFixed(2)})`);
      if (!g.vClean) messages.push(`V not whole (${g.vPps!.toFixed(2)})`);
      if (!g.matched) messages.push(`H≠V (${g.hPps!.toFixed(1)} vs ${g.vPps!.toFixed(1)})`);
      // v2.14.2 — common-DPI match flips the row green even when there's
      // no warning to suppress; it's a positive "this looks right" cue.
      const dpiMatch = matchCommonDpi(g.pps!);
      if (messages.length === 0) {
        gridFeedback.textContent = dpiMatch
          ? `✓ ${g.pps!.toFixed(0)} px/sq · matches ${dpiMatch.label} DPI`
          : `✓ ${g.pps!.toFixed(0)} px/sq`;
        gridFeedback.classList.add('is-ok');
      } else {
        gridFeedback.textContent = `⚠ ${messages.join(', ')}`;
        gridFeedback.classList.add('is-warn');
      }
      syncDpiSelectFromPps(g.pps);
      refreshCurrent(g.pps);
      const tEnd = performance.now();
      if (tEnd - tStart > 4) console.log(`[cal-feedback] ${(tEnd - tStart).toFixed(0)}ms`);
    };
    // v2.14.2 — when the user fills one of H / V and leaves the other
    // empty, auto-fill the empty side assuming a square (1:1) pixel
    // grid. Eliminates the "fill one box, other defaults to 0" edge
    // that produced the <line> attribute -Infinity errors in v2.14,
    // and also gives the GM a sensible default for typical maps where
    // squares are actually square. The user can still overwrite the
    // auto-filled value before saving.
    const autoFillCounterpart = (source: 'h' | 'v') => {
      const srcInput   = source === 'h' ? gridHInput : gridVInput;
      const otherInput = source === 'h' ? gridVInput : gridHInput;
      const srcRaw = srcInput.value.trim();
      if (srcRaw === '' || otherInput.value.trim() !== '') return;
      const srcN = parseInt(srcRaw, 10);
      if (!Number.isFinite(srcN) || srcN <= 0) return;
      // Assume square pixels: srcPps = imgX / srcN.  otherN = imgY / srcPps.
      // Collapses to: otherN = srcN * (imgY / imgX).
      const ratio = source === 'h' ? (this.imgH / this.imgW) : (this.imgW / this.imgH);
      const otherN = Math.max(1, Math.round(srcN * ratio));
      otherInput.value = String(otherN);
    };
    // v2.14.3 — line ↔ H/V ↔ DPI master-follower. The last control the
    // user touched is the master; the other two follow. Implementation
    // is two helpers + carefully threaded calls:
    //   • repositionLineFromPps — given a pps, re-centre the ruler line
    //     horizontally across the map middle with length N × pps. Used
    //     when H/V or DPI is the master.
    //   • syncInputsFromLine — given the current line endpoints, derive
    //     pps = distance / N and back-fill H, V, and the DPI dropdown.
    //     Used when the line (or N) is the master.
    // N stays where the user typed it (default 10) — independent control.
    const distInput = overlay.querySelector<HTMLInputElement>('.calibration-distance-input')!;
    const currentN = () => {
      const n = parseFloat(distInput.value);
      return Number.isFinite(n) && n > 0 ? n : 10;
    };
    const repositionLineFromPps = (pps: number) => {
      if (!Number.isFinite(pps) || pps <= 0) return;
      const N = currentN();
      const cx = this.imgW / 2;
      const cy = this.imgH / 2;
      // Clamp the line so it never extends past the map bounds.
      const half = Math.min((N * pps) / 2, cx - 1);
      if (half <= 0) return;
      this.a = { x: cx - half, y: cy };
      this.b = { x: cx + half, y: cy };
      redraw();
    };
    const syncInputsFromLine = () => {
      const dist = Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y);
      const N = currentN();
      if (dist < 1) return;
      const pps = dist / N;
      // Programmatic .value assignment doesn't fire 'input' — safe.
      gridHInput.value = String(Math.max(1, Math.round(this.imgW / pps)));
      gridVInput.value = String(Math.max(1, Math.round(this.imgH / pps)));
      updateGridFeedback();
    };

    // v2.14.17 — Show Grid overlay during calibration. Toggle in the
    // header; redraws on every input that changes pps (line drag, N
    // input, H/V edits, DPI pick). Lets the GM eyeball the calculated
    // 1″ spacing against any visible grid drawn on the map itself.
    const gridOverlayG    = overlay.querySelector<SVGGElement>('.calibration-grid-overlay')!;
    const gridOverlayCb   = overlay.querySelector<HTMLInputElement>('.calibration-grid-overlay-toggle')!;
    const derivePps = (): number | null => {
      const dist = Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y);
      const N = currentN();
      if (dist <= 0 || N <= 0) return null;
      return dist / N;
    };
    const updateCalGrid = () => {
      // DEBUG (v2.14.21) — count lines emitted + total time. Skip
      // logging when below threshold to avoid console noise.
      const tStart = performance.now();
      gridOverlayG.innerHTML = '';
      if (!gridOverlayCb.checked) return;
      const pps = derivePps();
      if (!pps || pps < 2) return;
      // v2.14.18 — grid origin = centre + offset (mod pps so the
      // walk stays in a bounded band; mathematically equivalent to
      // walking from any congruent base position).
      const modX = ((this.gridOffsetX % pps) + pps) % pps;
      const modY = ((this.gridOffsetY % pps) + pps) % pps;
      const cx = this.imgW / 2 + modX;
      const cy = this.imgH / 2 + modY;
      const lines: string[] = [];
      // Vertical lines from centre outward.
      for (let x = cx; x <= this.imgW; x += pps) {
        lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${this.imgH}" />`);
      }
      for (let x = cx - pps; x >= 0; x -= pps) {
        lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${this.imgH}" />`);
      }
      // Horizontal lines from centre outward.
      for (let y = cy; y <= this.imgH; y += pps) {
        lines.push(`<line x1="0" y1="${y}" x2="${this.imgW}" y2="${y}" />`);
      }
      for (let y = cy - pps; y >= 0; y -= pps) {
        lines.push(`<line x1="0" y1="${y}" x2="${this.imgW}" y2="${y}" />`);
      }
      gridOverlayG.innerHTML = lines.join('');
      const tEnd = performance.now();
      if (tEnd - tStart > 4) {
        console.log(`[cal-grid] updateCalGrid lines=${lines.length} took=${(tEnd - tStart).toFixed(0)}ms (pps=${pps.toFixed(2)} imgW=${this.imgW} imgH=${this.imgH})`);
      }
    };
    gridOverlayCb.addEventListener('change', updateCalGrid);

    // v2.14.18 — arrow-key nudge for the grid offset. Only listens
    // while the calibration modal is open AND Show Grid is on.
    // Shift+arrow nudges 10px; plain arrow nudges 1px. Esc resets
    // the offset to (0, 0). Handler removed on close().
    this._onKeyDown = (ev: KeyboardEvent) => {
      if (!gridOverlayCb.checked) return;
      // Don't fight focused inputs — arrow keys in number inputs
      // mean "increment/decrement value".
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      const step = ev.shiftKey ? 10 : 1;
      let consumed = true;
      switch (ev.key) {
        case 'ArrowLeft':  this.gridOffsetX -= step; break;
        case 'ArrowRight': this.gridOffsetX += step; break;
        case 'ArrowUp':    this.gridOffsetY -= step; break;
        case 'ArrowDown':  this.gridOffsetY += step; break;
        case 'Escape':     this.gridOffsetX = 0; this.gridOffsetY = 0; break;
        default: consumed = false;
      }
      if (consumed) {
        ev.preventDefault();
        updateCalGrid();
      }
    };
    window.addEventListener('keydown', this._onKeyDown);

    gridHInput.addEventListener('input', () => {
      const t0 = performance.now();
      autoFillCounterpart('h');
      const t1 = performance.now();
      updateGridFeedback();
      const t2 = performance.now();
      const g = solveGrid();
      const t3 = performance.now();
      if (g.ok && g.pps !== null) repositionLineFromPps(g.pps);
      const t4 = performance.now();
      updateCalGrid();
      const t5 = performance.now();
      if (t5 - t0 > 8) console.log(`[cal-input H] total=${(t5-t0).toFixed(0)}ms auto=${(t1-t0).toFixed(0)} feedback=${(t2-t1).toFixed(0)} solve=${(t3-t2).toFixed(0)} reposLine=${(t4-t3).toFixed(0)} grid=${(t5-t4).toFixed(0)}`);
    });
    gridVInput.addEventListener('input', () => {
      const t0 = performance.now();
      autoFillCounterpart('v');
      const t1 = performance.now();
      updateGridFeedback();
      const t2 = performance.now();
      const g = solveGrid();
      const t3 = performance.now();
      if (g.ok && g.pps !== null) repositionLineFromPps(g.pps);
      const t4 = performance.now();
      updateCalGrid();
      const t5 = performance.now();
      if (t5 - t0 > 8) console.log(`[cal-input V] total=${(t5-t0).toFixed(0)}ms auto=${(t1-t0).toFixed(0)} feedback=${(t2-t1).toFixed(0)} solve=${(t3-t2).toFixed(0)} reposLine=${(t4-t3).toFixed(0)} grid=${(t5-t4).toFixed(0)}`);
    });

    // v2.14.2 — picking a DPI back-fills H × V using the map's actual
    // pixel dimensions. Round to the nearest integer; if the map's
    // aspect doesn't divide cleanly by the picked DPI, updateGridFeedback
    // will warn "H not whole" etc. so the GM knows the assumption
    // doesn't quite fit (and can switch to the ruler or another DPI).
    // v2.14.3 — DPI also drives the line (since it's the master here).
    // v2.14.5 — pin the picked DPI in the dropdown AFTER the round-trip
    // (H/V derived from DPI may render a pps that's just outside the
    // matchCommonDpi tolerance because of rounding, which would clear
    // the dropdown otherwise).
    dpiSelect.addEventListener('change', () => {
      const t0 = performance.now();
      const dpi = parseFloat(dpiSelect.value);
      if (!Number.isFinite(dpi) || dpi <= 0) return;
      gridHInput.value = String(Math.max(1, Math.round(this.imgW / dpi)));
      gridVInput.value = String(Math.max(1, Math.round(this.imgH / dpi)));
      updateGridFeedback();
      dpiSelect.value = String(dpi);
      repositionLineFromPps(dpi);
      updateCalGrid();
      const t1 = performance.now();
      if (t1 - t0 > 8) console.log(`[cal-input DPI] total=${(t1-t0).toFixed(0)}ms dpi=${dpi}`);
    });

    // v2.14.3 — N is the line's "how many squares does this represent"
    // input. Changing it doesn't move the line, but it does change the
    // implied pps (same physical line, different square count), so
    // H/V/DPI re-derive.
    distInput.addEventListener('input', () => {
      const t0 = performance.now();
      syncInputsFromLine();
      const t1 = performance.now();
      updateCalGrid();
      const t2 = performance.now();
      if (t2 - t0 > 8) console.log(`[cal-input N] total=${(t2-t0).toFixed(0)}ms syncInputs=${(t1-t0).toFixed(0)} grid=${(t2-t1).toFixed(0)}`);
    });

    updateGridFeedback();

    overlay.querySelector<HTMLButtonElement>('.calibration-cancel')?.addEventListener('click', () => this.close());
    overlay.querySelector<HTMLButtonElement>('.calibration-save')?.addEventListener('click', async () => {
      const distInput = overlay.querySelector<HTMLInputElement>('.calibration-distance-input')!;
      const squares   = parseFloat(distInput.value);

      // ── DEBUG TIMERS (v2.14.21) — chasing the multi-second Save freeze.
      //    Logs to console so we can see which segment is heavy. Remove
      //    once the slow op is identified + fixed.
      const tSaveStart = performance.now();
      console.log('[cal-save] click → entered handler');

      // By-grid takes precedence when both H and V are filled with positive
      // integers — the user explicitly chose the "I know the map dims" path.
      const g = solveGrid();
      if (g.ok && g.pps !== null) {
        const t1 = performance.now();
        await MapAssetStore.update(asset.id, {
          pixelsPerSquare:  g.pps,
          gridSquares:      { h: parseInt(gridHInput.value, 10), v: parseInt(gridVInput.value, 10) },
          scaleConfidence:  'manual',
          noGrid:           false,
          // v2.14.18 — border-nudge offset travels alongside the
          // calibration value so every viewer aligns the same way.
          gridOffsetX:      this.gridOffsetX,
          gridOffsetY:      this.gridOffsetY,
        });
        const t2 = performance.now();
        console.log(`[cal-save] MapAssetStore.update (by-grid): ${(t2 - t1).toFixed(0)}ms`);
        this.close();
        console.log(`[cal-save] close() done; total ${(performance.now() - tSaveStart).toFixed(0)}ms`);
        return;
      }

      // Ruler path (existing behaviour).
      if (!isFinite(squares) || squares <= 0) { alert('Enter a positive number of squares, or fill both grid H and V.'); return; }
      const px = Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y);
      if (px < 4) { alert('Drag the two crosses further apart before saving.'); return; }
      const pixelsPerSquare = px / squares;
      const t1 = performance.now();
      await MapAssetStore.update(asset.id, {
        pixelsPerSquare,
        calibrationLine: {
          ax: this.a.x, ay: this.a.y,
          bx: this.b.x, by: this.b.y,
          squares,
        },
        // User drew the line themselves — top-trust calibration; the auto-
        // detector will skip this asset on retrofit passes.
        scaleConfidence: 'manual',
        // Re-calibrating a map clears any prior "no grid" opt-out.
        noGrid: false,
        // v2.14.18 — border-nudge offset travels alongside the
        // calibration value so every viewer aligns the same way.
        gridOffsetX:    this.gridOffsetX,
        gridOffsetY:    this.gridOffsetY,
      });
      const t2 = performance.now();
      console.log(`[cal-save] MapAssetStore.update (ruler): ${(t2 - t1).toFixed(0)}ms`);
      this.close();
      console.log(`[cal-save] close() done; total ${(performance.now() - tSaveStart).toFixed(0)}ms`);
    });

    return overlay;
  }

  private _esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
  }
}
