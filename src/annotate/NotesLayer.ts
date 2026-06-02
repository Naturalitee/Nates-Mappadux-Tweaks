import type { AnnotateNote } from '../types.ts';
import { AnchoredLayer, type AnchoredOpts, mkHandle, svgIcon } from './AnchoredLayer.ts';

const ICON_EDIT = svgIcon('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>');

export interface NotesLayerCallbacks {
  onMove?: (id: string, x: number, y: number) => void;
  onResize?: (id: string, w: number, h: number) => void;
  onRotate?: (id: string, rot: number) => void;
  onRemove?: (id: string) => void;
  onEditText?: (id: string, text: string) => void;
}

/**
 * NotesLayer (v2.16.82) — map-anchored free text notes. Extends AnchoredLayer
 * for projection + the move/resize/rotate/delete chrome. Text auto-fits the
 * box (shrink the box → smaller font, reflowing); double-click to edit. Notes
 * resize FREELY (no aspect lock) so the GM can reshape the box.
 */
export class NotesLayer extends AnchoredLayer<AnnotateNote> {
  private _onEditText: ((id: string, text: string) => void) | undefined;
  /** Refits the text whenever a note box changes size — including the
   *  continuous box resize the map zoom drives each frame, so the font
   *  always fills the frame at any zoom. */
  private ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const text = (e.target as HTMLElement).querySelector<HTMLElement>('.a-note-text');
      if (text) fitText(text);
    }
  });

  constructor(root: HTMLElement, interactive: boolean, opts: AnchoredOpts, cb: NotesLayerCallbacks = {}) {
    super(root, interactive, { ...opts, aspectLock: false }, {
      onMove: cb.onMove, onResize: cb.onResize, onRotate: cb.onRotate, onRemove: cb.onRemove,
    });
    this._onEditText = cb.onEditText;
  }

  setNotes(notes: AnnotateNote[]): void { this.setObjects(notes); }

  override setObjects(objs: AnnotateNote[]): void {
    this.ro.disconnect(); // drop observers on the about-to-be-replaced boxes
    super.setObjects(objs);
  }

  protected objClass(): string { return 'a-note'; }
  protected objColor(n: AnnotateNote): string { return n.color; }

  protected renderContent(n: AnnotateNote, content: HTMLElement): void {
    content.style.setProperty('--note-color', n.color);
    const text = document.createElement('div');
    text.className = 'a-note-text';
    text.textContent = n.text;
    content.appendChild(text);
    requestAnimationFrame(() => fitText(text));
    this.ro.observe(content); // re-fit on every box size change (zoom, resize)
    // v2.16.86 — no double-click-to-edit; the edge edit control is the
    // single, deliberate way in (and only once selected).
  }

  protected override onResized(_n: AnnotateNote, content: HTMLElement): void {
    const text = content.querySelector<HTMLElement>('.a-note-text');
    if (text) fitText(text);
  }

  /** Edit control on the bottom edge (shown when selected). Double-click
   *  still works too. */
  protected override edgeControls(n: AnnotateNote, content: HTMLElement): HTMLElement[] {
    const edit = mkHandle('marker-handle anchored-ctrl', 'Edit text', ICON_EDIT);
    edit.addEventListener('pointerdown', (e) => e.stopPropagation());
    edit.addEventListener('click', (e) => { e.stopPropagation(); this._editNote(content, n); });
    return [edit];
  }

  private _editNote(content: HTMLElement, n: AnnotateNote): void {
    const text = content.querySelector<HTMLElement>('.a-note-text');
    if (!text || content.querySelector('.a-note-edit')) return;
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
      if (save) this._onEditText?.(n.id, ta.value);
      else this.setObjects(this.objects);
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

/** Grow / shrink font-size so the text fills its OWN box (inside the
 *  content padding + border) without overflow — measuring the text
 *  element's client box, not the padded content, so the last line is
 *  never clipped by the border. v2.16.86. */
function fitText(textEl: HTMLElement): void {
  const maxH = textEl.clientHeight;
  const maxW = textEl.clientWidth;
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
