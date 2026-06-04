/**
 * MeasureTool — a transient on-map ruler shared by the GM and player views.
 *
 * Flow: the host opens its context menu and, on "Measure from here", calls
 * start(origin) with the right-clicked map-normalised point. The tool then
 * drops a transparent crosshair capture layer over the map; as the pointer
 * moves it draws a live dashed line from the origin to the cursor with a
 * running distance label, and the next click commits the line (solid) which
 * then fades out after 5 seconds. Escape or a right-click cancels.
 *
 * Coordinate spaces: the tool works entirely in map-normalised (0..1) points
 * and leans on two host-supplied projections — `project` (norm → CSS px
 * relative to the overlay host) and `unproject` (client px → norm) — so the
 * drawn line stays glued to the map under pan / zoom via a self-driving RAF
 * loop, exactly like PingLayer / the annotate layers.
 *
 * Distance: `squaresBetween` returns the grid-square count between two norm
 * points (null when the map isn't calibrated), and `unit` supplies the
 * value-per-square + suffix (e.g. 5 + "'"). The label is one decimal place.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const FADE_AFTER_MS = 5000;

export interface MeasurePoint { x: number; y: number; }

/**
 * Grid-square distance between two map-normalised (0..1) points.
 *
 * Normalised deltas are scaled by the map's intrinsic pixel dimensions to get
 * a pixel distance, then divided by `pixelsPerSquare` (the calibrated square
 * size in those same map pixels — see drawGrid). Returns null when the map
 * isn't calibrated / sized, which the caller surfaces as "—".
 */
export function squaresBetweenNorm(
  a: MeasurePoint,
  b: MeasurePoint,
  mapImageWidth: number,
  mapImageHeight: number,
  pixelsPerSquare: number | null,
): number | null {
  if (!pixelsPerSquare || pixelsPerSquare <= 0 || mapImageWidth <= 0 || mapImageHeight <= 0) return null;
  const dx = (b.x - a.x) * mapImageWidth;
  const dy = (b.y - a.y) * mapImageHeight;
  return Math.hypot(dx, dy) / pixelsPerSquare;
}

export interface MeasureToolDeps {
  /** Overlay host — covers the map area 1:1 with the renderer canvas. The
   *  capture layer + drawing layer mount here. Must be position:relative or
   *  an inset:0 absolute box over the canvas. */
  host: HTMLElement;
  /** Map-normalised (0..1) → CSS px relative to `host`. Null when off-layout. */
  project: (mx: number, my: number) => { x: number; y: number } | null;
  /** Client px → map-normalised (0..1). Null when off-layout / off-map. */
  unproject: (clientX: number, clientY: number) => { x: number; y: number } | null;
  /** Grid-square distance between two norm points; null if map not scaled. */
  squaresBetween: (a: MeasurePoint, b: MeasurePoint) => number | null;
  /** Current distance unit — `value` per square, `suffix` tag appended. */
  unit: () => { value: number; suffix: string };
}

export class MeasureTool {
  private deps: MeasureToolDeps;

  private _capture: HTMLDivElement | null = null;
  private _svg:   SVGSVGElement | null = null;
  private _line:  SVGLineElement | null = null;
  private _capA:  SVGCircleElement | null = null;
  private _capB:  SVGCircleElement | null = null;
  private _label: HTMLDivElement | null = null;

  private _origin: MeasurePoint | null = null;
  private _end:    MeasurePoint | null = null;
  private _committed = false;
  private _raf = 0;
  private _fadeTimer = 0;

  constructor(deps: MeasureToolDeps) {
    this.deps = deps;
  }

  /** Is a measurement currently being placed (capture layer live)? */
  get active(): boolean { return !!this._capture; }

  /** Begin a measurement anchored at `origin` (map-normalised). Arms the
   *  crosshair capture layer; the next click commits, Escape/right-click
   *  cancels. A second start() while active restarts cleanly. */
  start(origin: MeasurePoint): void {
    this.cancel();
    this._origin = { ...origin };
    this._end = { ...origin };
    this._committed = false;
    this._ensureLayer();
    this._mountCapture();
    this._startLoop();
  }

  /** Tear down an in-progress measurement (no committed line left behind). */
  cancel(): void {
    this._unmountCapture();
    this._stopLoop();
    this._clearFade();
    this._hideDrawing();
    this._origin = this._end = null;
    this._committed = false;
  }

  /** Fully dispose — removes every mounted element. */
  destroy(): void {
    this.cancel();
    this._svg?.remove();   this._svg = null;
    this._label?.remove(); this._label = null;
  }

  // ── Capture layer ──────────────────────────────────────────────────────────

  private _mountCapture(): void {
    const el = document.createElement('div');
    el.className = 'measure-capture';
    el.addEventListener('pointermove', this._onPointerMove);
    el.addEventListener('pointerdown', this._onPointerDown);
    // Right-click while measuring just cancels — never re-opens a menu.
    el.addEventListener('contextmenu', this._onContextMenu);
    this.deps.host.appendChild(el);
    this._capture = el;
    window.addEventListener('keydown', this._onKeyDown);
  }

  private _unmountCapture(): void {
    if (this._capture) {
      this._capture.removeEventListener('pointermove', this._onPointerMove);
      this._capture.removeEventListener('pointerdown', this._onPointerDown);
      this._capture.removeEventListener('contextmenu', this._onContextMenu);
      this._capture.remove();
      this._capture = null;
    }
    window.removeEventListener('keydown', this._onKeyDown);
  }

  private _onPointerMove = (e: PointerEvent): void => {
    const n = this.deps.unproject(e.clientX, e.clientY);
    if (n) this._end = n;
    this._renderOnce();
  };

  private _onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button === 2) { this.cancel(); return; } // right button cancels
    const n = this.deps.unproject(e.clientX, e.clientY);
    if (n) this._end = n;
    this._commit();
  };

  private _onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    this.cancel();
  };

  private _onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.cancel();
  };

  // ── Commit + fade ────────────────────────────────────────────────────────

  /** Lock the line in, stop following the cursor, and fade after 5s. */
  private _commit(): void {
    this._committed = true;
    this._unmountCapture();
    this._renderOnce();
    // Keep the RAF loop running so the committed line tracks pan/zoom until
    // it fades; the fade timer then tears everything down.
    this._clearFade();
    this._fadeTimer = window.setTimeout(() => {
      this._svg?.classList.add('is-fading');
      this._label?.classList.add('is-fading');
      window.setTimeout(() => {
        this._stopLoop();
        this._hideDrawing();
        this._origin = this._end = null;
        this._committed = false;
      }, 650); // matches the CSS opacity transition
    }, FADE_AFTER_MS);
  }

  private _clearFade(): void {
    if (this._fadeTimer) { clearTimeout(this._fadeTimer); this._fadeTimer = 0; }
  }

  // ── Drawing layer (SVG line + caps + HTML label pill) ──────────────────────

  private _ensureLayer(): void {
    if (!this._svg) {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'measure-svg');
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', 'measure-line');
      const capA = document.createElementNS(SVG_NS, 'circle');
      capA.setAttribute('class', 'measure-cap');
      capA.setAttribute('r', '4');
      const capB = document.createElementNS(SVG_NS, 'circle');
      capB.setAttribute('class', 'measure-cap');
      capB.setAttribute('r', '4');
      svg.append(line, capA, capB);
      this.deps.host.appendChild(svg);
      this._svg = svg; this._line = line; this._capA = capA; this._capB = capB;
    }
    if (!this._label) {
      const label = document.createElement('div');
      label.className = 'measure-label';
      this.deps.host.appendChild(label);
      this._label = label;
    }
    this._svg.classList.remove('is-fading');
    this._label.classList.remove('is-fading');
    this._svg.style.display = '';
    this._label.style.display = '';
  }

  private _hideDrawing(): void {
    if (this._svg)   this._svg.style.display = 'none';
    if (this._label) this._label.style.display = 'none';
  }

  private _startLoop(): void {
    if (this._raf) return;
    const loop = (): void => { this._renderOnce(); this._raf = requestAnimationFrame(loop); };
    this._raf = requestAnimationFrame(loop);
  }

  private _stopLoop(): void {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
  }

  /** Project the two norm points and repaint the line + label. Called every
   *  RAF frame (so the line tracks the map) and on each pointer move. */
  private _renderOnce(): void {
    if (!this._origin || !this._end || !this._svg || !this._line || !this._label) return;
    const a = this.deps.project(this._origin.x, this._origin.y);
    const b = this.deps.project(this._end.x, this._end.y);
    if (!a || !b) { this._svg.style.visibility = 'hidden'; this._label.style.visibility = 'hidden'; return; }
    this._svg.style.visibility = ''; this._label.style.visibility = '';

    this._line.setAttribute('x1', String(a.x));
    this._line.setAttribute('y1', String(a.y));
    this._line.setAttribute('x2', String(b.x));
    this._line.setAttribute('y2', String(b.y));
    this._line.classList.toggle('is-live', !this._committed);
    this._capA!.setAttribute('cx', String(a.x)); this._capA!.setAttribute('cy', String(a.y));
    this._capB!.setAttribute('cx', String(b.x)); this._capB!.setAttribute('cy', String(b.y));

    this._label.textContent = this._distanceText();
    // Park the pill at the midpoint, nudged up off the line.
    this._label.style.left = `${(a.x + b.x) / 2}px`;
    this._label.style.top  = `${(a.y + b.y) / 2}px`;
  }

  private _distanceText(): string {
    if (!this._origin || !this._end) return '';
    const squares = this.deps.squaresBetween(this._origin, this._end);
    if (squares === null) return '—';
    const { value, suffix } = this.deps.unit();
    return `${(squares * value).toFixed(1)}${suffix}`;
  }
}
