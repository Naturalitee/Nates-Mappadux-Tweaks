/**
 * AnchoredLayer (v2.16.82) — base class for map-anchored annotation objects
 * (clocks, timers, notes). Position + size are stored in normalised map
 * coordinates (0..1), so an object sits at a fixed MAP location and pans /
 * zooms with the map — identical 1:1 between GM and player. A RAF loop
 * reprojects every object each frame (the same self-driving approach as
 * markers / whiteboard).
 *
 * On the GM (interactive) each object follows the editor-chrome convention:
 * a select/move handle top-left, a delete × bottom-left, and a resize grip
 * bottom-right (shown once selected). Read-only on player / projector.
 *
 * Subclasses provide renderContent() for the type-specific face, and may
 * override onResized() (e.g. notes refit their text).
 */

export interface AnchoredObject { id: string; x: number; y: number; w: number; h: number; rot?: number; }

export interface AnchoredOpts {
  /** normalised map coord → canvas-relative CSS px (null = canvas not ready). */
  project: (x: number, y: number) => { x: number; y: number } | null;
  /** viewport client px → normalised map coord (null = off-map / not ready). */
  unproject: (clientX: number, clientY: number) => { x: number; y: number } | null;
  /** Keep w:h ratio while resizing (clocks / timers). Notes resize freely. */
  aspectLock?: boolean;
}

export interface AnchoredCallbacks {
  onMove?: ((id: string, x: number, y: number) => void) | undefined;
  onResize?: ((id: string, w: number, h: number) => void) | undefined;
  onRotate?: ((id: string, rot: number) => void) | undefined;
  onRemove?: ((id: string) => void) | undefined;
}

const MIN_SIZE = 0.02; // smallest object, in map-norm units

export abstract class AnchoredLayer<T extends AnchoredObject> {
  protected objects: T[] = [];
  protected selectedId: string | null = null;
  private boxes = new Map<string, HTMLElement>();
  private raf = 0;

  constructor(
    protected root: HTMLElement,
    protected interactive: boolean,
    protected opts: AnchoredOpts,
    protected cb: AnchoredCallbacks = {},
  ) {
    this.root.classList.toggle('is-interactive', interactive);
    const loop = () => { this._position(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
    if (interactive) {
      document.addEventListener('pointerdown', (e) => {
        if (this.selectedId && !(e.target as HTMLElement).closest('.anchored-obj')) {
          this.selectedId = null;
          this._render();
        }
      }, true);
    }
  }

  setObjects(objs: T[]): void {
    this.objects = objs.map((o) => ({ ...o }));
    if (this.selectedId && !this.objects.some((o) => o.id === this.selectedId)) this.selectedId = null;
    this._render();
  }

  destroy(): void { cancelAnimationFrame(this.raf); }

  /** Render the type-specific face into `content`. */
  protected abstract renderContent(obj: T, content: HTMLElement): void;
  /** Optional hook after a live resize (e.g. refit note text). */
  protected onResized?(obj: T, content: HTMLElement): void;
  /** Optional type-specific controls (play/pause, edit, …) shown on the
   *  bottom EDGE when the object is selected — never inside the box. */
  protected edgeControls?(obj: T, content: HTMLElement): HTMLElement[];
  /** Extra class on the object box (e.g. 'a-note' / 'clock' for styling). */
  protected abstract objClass(obj: T): string;
  /** The object's chosen colour — drives the selection outline + chrome
   *  accents (instead of the view-identity green/orange). */
  protected abstract objColor(obj: T): string;

  private _render(): void {
    this.root.replaceChildren();
    this.boxes.clear();
    for (const o of this.objects) {
      const box = document.createElement('div');
      box.className = `anchored-obj ${this.objClass(o)}` + (this.selectedId === o.id ? ' is-selected' : '');
      box.style.setProperty('--obj-color', this.objColor(o));
      box.dataset['id'] = o.id;
      const content = document.createElement('div');
      content.className = 'anchored-content';
      this.renderContent(o, content);
      box.appendChild(content);
      if (this.interactive) this._addChrome(box, o, content);
      this.root.appendChild(box);
      this.boxes.set(o.id, box);
    }
    this._position();
  }

  /** Reproject every object's box from its map-norm rect each frame. */
  private _position(): void {
    for (const o of this.objects) {
      const box = this.boxes.get(o.id);
      if (!box) continue;
      const tl = this.opts.project(o.x, o.y);
      const br = this.opts.project(o.x + o.w, o.y + o.h);
      if (!tl || !br) { box.style.visibility = 'hidden'; continue; }
      box.style.visibility = '';
      box.style.left   = `${tl.x}px`;
      box.style.top    = `${tl.y}px`;
      box.style.width  = `${Math.max(8, br.x - tl.x)}px`;
      box.style.height = `${Math.max(8, br.y - tl.y)}px`;
      box.style.transform = o.rot ? `rotate(${o.rot}deg)` : '';
    }
  }

  private _addChrome(box: HTMLElement, o: T, content: HTMLElement): void {
    // Reuse the established editor-chrome visual language (marker-handle):
    // 26px fixed-size handles, circular move (TL), red trashcan delete (BL),
    // rounded-square green resize (BR), rotate above with a green stem.
    const move = mkHandle('marker-handle anchored-handle--move', 'Move', ICON_MOVE);
    box.appendChild(move);
    this._drag(move, o, content, 'move');

    if (this.selectedId === o.id) {
      const del = mkHandle('marker-handle marker-handle--delete anchored-handle--del', 'Delete', ICON_TRASH);
      del.addEventListener('pointerdown', (e) => e.stopPropagation());
      del.addEventListener('click', (e) => { e.stopPropagation(); this.cb.onRemove?.(o.id); });
      box.appendChild(del);

      const rez = mkHandle('marker-handle anchored-handle--resize', 'Resize', ICON_RESIZE);
      box.appendChild(rez);
      this._drag(rez, o, content, 'resize');

      const stem = document.createElement('div');
      stem.className = 'anchored-rotate-stem';
      box.appendChild(stem);
      const rot = mkHandle('marker-handle anchored-handle--rotate', 'Rotate', ICON_ROTATE);
      box.appendChild(rot);
      this._rotate(rot, box, o);

      // Type-specific controls live on the bottom edge (never in the box).
      const controls = this.edgeControls?.(o, content) ?? [];
      if (controls.length) {
        const bar = document.createElement('div');
        bar.className = 'anchored-controls';
        for (const c of controls) bar.appendChild(c);
        box.appendChild(bar);
      }
    }
  }

  private _rotate(handle: HTMLElement, box: HTMLElement, o: T): void {
    handle.style.touchAction = 'none';
    let active = false;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.stopPropagation();
      if (this.selectedId !== o.id) { this.selectedId = o.id; this._render(); return; }
      active = true;
      handle.setPointerCapture?.(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!active) return;
      const r = box.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let deg = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI + 90;
      deg = ((deg % 360) + 360) % 360;
      for (const card of [0, 90, 180, 270, 360]) if (Math.abs(deg - card) <= 2) deg = card % 360;
      o.rot = Math.round(deg);
      box.style.transform = `rotate(${o.rot}deg)`;
    });
    const end = () => { if (active) { active = false; this.cb.onRotate?.(o.id, o.rot ?? 0); } };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', () => { active = false; });
  }

  private _drag(handle: HTMLElement, o: T, content: HTMLElement, mode: 'move' | 'resize'): void {
    handle.style.touchAction = 'none';
    let startN: { x: number; y: number } | null = null;
    let base: { x: number; y: number; w: number; h: number } | null = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.stopPropagation();
      const n = this.opts.unproject(e.clientX, e.clientY);
      if (!n) return;
      if (this.selectedId !== o.id) { this.selectedId = o.id; this._render(); }
      startN = n;
      base = { x: o.x, y: o.y, w: o.w, h: o.h };
      handle.setPointerCapture?.(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!startN || !base) return;
      const n = this.opts.unproject(e.clientX, e.clientY);
      if (!n) return;
      const dx = n.x - startN.x, dy = n.y - startN.y;
      if (mode === 'move') {
        o.x = base.x + dx;
        o.y = base.y + dy;
      } else {
        let w = Math.max(MIN_SIZE, base.w + dx);
        let h = Math.max(MIN_SIZE, base.h + dy);
        if (this.opts.aspectLock) {
          const k = base.w / base.h;
          // Drive height from width to keep ratio.
          h = w / k;
        }
        o.w = w; o.h = h;
        this.onResized?.(o, content);
      }
      this._position(); // live; RAF also keeps it in sync
    });
    const end = () => {
      if (!base) return;
      const cur = { ...o };
      startN = null; base = null;
      if (mode === 'move') this.cb.onMove?.(o.id, cur.x, cur.y);
      else this.cb.onResize?.(o.id, cur.w, cur.h);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', () => { startN = null; base = null; });
  }
}

// ── Editor-chrome icons (match the established marker handles) ───────────────

/** Build a 24×24 stroked SVG (matches the editor-chrome icon style). */
export const svgIcon = (paths: string): string =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICON_MOVE = svgIcon('<polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>');
const ICON_RESIZE = svgIcon('<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>');
const ICON_TRASH = svgIcon('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>');
const ICON_ROTATE = svgIcon('<path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 9 8 9"/>');

/** Build a chrome handle (marker-handle look) with an SVG icon. */
export function mkHandle(className: string, title: string, iconSvg: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.title = title;
  el.innerHTML = iconSvg;
  return el;
}
