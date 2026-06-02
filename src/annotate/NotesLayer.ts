import type { AnnotateNote } from '../types.ts';
import { AnchoredLayer, type AnchoredOpts } from './AnchoredLayer.ts';

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

  constructor(root: HTMLElement, interactive: boolean, opts: AnchoredOpts, cb: NotesLayerCallbacks = {}) {
    super(root, interactive, { ...opts, aspectLock: false }, {
      onMove: cb.onMove, onResize: cb.onResize, onRotate: cb.onRotate, onRemove: cb.onRemove,
    });
    this._onEditText = cb.onEditText;
  }

  setNotes(notes: AnnotateNote[]): void { this.setObjects(notes); }

  protected objClass(): string { return 'a-note'; }

  protected renderContent(n: AnnotateNote, content: HTMLElement): void {
    content.style.setProperty('--note-color', n.color);
    const text = document.createElement('div');
    text.className = 'a-note-text';
    text.textContent = n.text;
    content.appendChild(text);
    requestAnimationFrame(() => fitText(content, text));

    if (this.interactive) {
      content.addEventListener('dblclick', (e) => { e.stopPropagation(); this._editNote(content, n); });
    }
  }

  protected override onResized(_n: AnnotateNote, content: HTMLElement): void {
    const text = content.querySelector<HTMLElement>('.a-note-text');
    if (text) fitText(content, text);
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

/** Grow / shrink font-size so the text fills the box without overflow. */
function fitText(box: HTMLElement, textEl: HTMLElement): void {
  const maxH = box.clientHeight - 8;
  const maxW = box.clientWidth - 8;
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
