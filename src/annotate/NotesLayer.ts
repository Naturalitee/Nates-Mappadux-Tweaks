import type { AnnotateNote } from '../types.ts';

export interface NotesLayerCallbacks {
  onMove?: (id: string, x: number, y: number) => void;
  onResize?: (id: string, w: number, h: number) => void;
  onRemove?: (id: string) => void;
  onEditText?: (id: string, text: string) => void;
}

/**
 * NotesLayer (v2.16.80) — free text notes overlaid on the view. The text
 * auto-fits the box (shrink the box → smaller font), reflowing as needed.
 * On the GM (interactive) each note follows the established editor-chrome
 * convention: a select handle top-left (drag to move), a delete × bottom-
 * left, and a resize grip bottom-right; double-click to edit the text.
 * Read-only on player / projector.
 */
export class NotesLayer {
  private notes: AnnotateNote[] = [];
  private selectedId: string | null = null;
  private ro: ResizeObserver | null = null;

  constructor(
    private root: HTMLElement,
    private interactive: boolean,
    private cb: NotesLayerCallbacks = {},
  ) {
    this._render();
    // Refit text when the container (viewport) resizes.
    if ('ResizeObserver' in window) {
      this.ro = new ResizeObserver(() => this._fitAll());
      this.ro.observe(this.root);
    }
    // Click anywhere that isn't a note → deselect (GM only).
    if (interactive) {
      document.addEventListener('pointerdown', (e) => {
        if (this.selectedId && !(e.target as HTMLElement).closest('.a-note')) this.deselect();
      }, true);
    }
  }

  setNotes(notes: AnnotateNote[]): void {
    this.notes = notes;
    if (this.selectedId && !notes.some((n) => n.id === this.selectedId)) this.selectedId = null;
    this._render();
  }

  deselect(): void { this.selectedId = null; this._render(); }

  destroy(): void { this.ro?.disconnect(); }

  private _render(): void {
    this.root.replaceChildren();
    this.root.classList.toggle('is-interactive', this.interactive);
    for (const n of this.notes) this.root.appendChild(this._renderNote(n));
    requestAnimationFrame(() => this._fitAll());
  }

  private _fitAll(): void {
    for (const box of this.root.querySelectorAll<HTMLElement>('.a-note')) {
      const text = box.querySelector<HTMLElement>('.a-note-text');
      if (text) fitText(box, text);
    }
  }

  private _renderNote(n: AnnotateNote): HTMLElement {
    const el = document.createElement('div');
    el.className = 'a-note' + (this.selectedId === n.id ? ' is-selected' : '');
    el.style.left   = `${n.x * 100}%`;
    el.style.top    = `${n.y * 100}%`;
    el.style.width  = `${n.w * 100}%`;
    el.style.height = `${n.h * 100}%`;
    el.style.setProperty('--note-color', n.color);
    el.dataset['id'] = n.id;

    const text = document.createElement('div');
    text.className = 'a-note-text';
    text.textContent = n.text;
    el.appendChild(text);

    if (this.interactive) {
      // Double-click to edit.
      el.addEventListener('dblclick', (e) => { e.stopPropagation(); this._editNote(el, n); });

      // Select handle (top-left) — click selects, drag moves.
      const sel = document.createElement('div');
      sel.className = 'marker-handle marker-handle--move a-note-handle a-note-handle--move';
      sel.title = 'Move note';
      el.appendChild(sel);
      this._dragMove(sel, el, n);

      if (this.selectedId === n.id) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'marker-handle marker-handle--delete a-note-handle a-note-handle--del';
        del.title = 'Delete note';
        del.addEventListener('pointerdown', (e) => e.stopPropagation());
        del.addEventListener('click', (e) => { e.stopPropagation(); this.cb.onRemove?.(n.id); });
        el.appendChild(del);

        const grip = document.createElement('div');
        grip.className = 'marker-handle marker-handle--resize a-note-handle a-note-handle--resize';
        grip.title = 'Resize note';
        el.appendChild(grip);
        this._dragResize(grip, el, n);
      }
    }
    return el;
  }

  private _dragMove(handle: HTMLElement, el: HTMLElement, n: AnnotateNote): void {
    handle.style.touchAction = 'none';
    let start: { px: number; py: number; left: number; top: number } | null = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.stopPropagation();
      if (this.selectedId !== n.id) { this.selectedId = n.id; this._render(); }
      const rect = this.root.getBoundingClientRect();
      start = { px: e.clientX, py: e.clientY, left: n.x * rect.width, top: n.y * rect.height };
      handle.setPointerCapture?.(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!start) return;
      const rect = this.root.getBoundingClientRect();
      el.style.left = `${Math.max(0, Math.min(1, (start.left + (e.clientX - start.px)) / rect.width)) * 100}%`;
      el.style.top  = `${Math.max(0, Math.min(1, (start.top  + (e.clientY - start.py)) / rect.height)) * 100}%`;
    });
    handle.addEventListener('pointerup', (e) => {
      if (!start) return;
      const rect = this.root.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (start.left + (e.clientX - start.px)) / rect.width));
      const ny = Math.max(0, Math.min(1, (start.top  + (e.clientY - start.py)) / rect.height));
      start = null;
      this.cb.onMove?.(n.id, nx, ny);
    });
    handle.addEventListener('pointercancel', () => { start = null; });
  }

  private _dragResize(handle: HTMLElement, el: HTMLElement, n: AnnotateNote): void {
    handle.style.touchAction = 'none';
    let start: { px: number; py: number; w: number; h: number } | null = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.stopPropagation();
      const rect = this.root.getBoundingClientRect();
      start = { px: e.clientX, py: e.clientY, w: n.w * rect.width, h: n.h * rect.height };
      handle.setPointerCapture?.(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!start) return;
      const rect = this.root.getBoundingClientRect();
      const w = Math.max(40, start.w + (e.clientX - start.px));
      const h = Math.max(28, start.h + (e.clientY - start.py));
      el.style.width  = `${(w / rect.width) * 100}%`;
      el.style.height = `${(h / rect.height) * 100}%`;
      const text = el.querySelector<HTMLElement>('.a-note-text');
      if (text) fitText(el, text);
    });
    handle.addEventListener('pointerup', (e) => {
      if (!start) return;
      const rect = this.root.getBoundingClientRect();
      const w = Math.max(40, start.w + (e.clientX - start.px)) / rect.width;
      const h = Math.max(28, start.h + (e.clientY - start.py)) / rect.height;
      start = null;
      this.cb.onResize?.(n.id, w, h);
    });
    handle.addEventListener('pointercancel', () => { start = null; });
  }

  private _editNote(el: HTMLElement, n: AnnotateNote): void {
    const text = el.querySelector<HTMLElement>('.a-note-text');
    if (!text || el.querySelector('.a-note-edit')) return;
    const ta = document.createElement('textarea');
    ta.className = 'a-note-edit';
    ta.value = n.text;
    text.replaceWith(ta);
    ta.focus();
    ta.select();
    let done = false;
    const commit = (save: boolean) => {
      if (done) return;
      done = true;
      if (save) this.cb.onEditText?.(n.id, ta.value);
      else this._render();
    };
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(true); }
      if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    ta.addEventListener('blur', () => commit(true));
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
}

/** Grow / shrink font-size so the text fills the box without overflow. */
function fitText(box: HTMLElement, textEl: HTMLElement): void {
  const maxH = box.clientHeight - 10;
  const maxW = box.clientWidth - 10;
  if (maxH <= 0 || maxW <= 0) return;
  let lo = 7, hi = Math.max(8, Math.floor(maxH));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    textEl.style.fontSize = `${mid}px`;
    if (textEl.scrollHeight <= maxH && textEl.scrollWidth <= maxW) lo = mid;
    else hi = mid - 1;
  }
  textEl.style.fontSize = `${lo}px`;
}
