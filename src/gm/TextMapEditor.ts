import type { MapAsset, TextMapConfig, TextMapElement, TextMapTextElement, TextMapAnimation } from '../types.ts';
import { transitionRegistry } from '../transitions/TransitionRegistry.ts';
import { SYSTEM_CATEGORY_IDS } from '../types.ts';
import { MapAssetStore } from '../maps/MapAssetStore.ts';
import { predictTextMapPixelDimensions } from '../maps/rasterizeTextMap.ts';
import {
  ensureTextMapElements,
  newTextElement,
  newImageElement,
  clampElementGeometry,
} from '../maps/textMapElements.ts';
import { ImageAssetStore } from '../images/ImageAssetStore.ts';
import { ImageAssetModal } from '../images/ImageAssetModal.ts';
import { ensureFontsLoaded, registerLocalFontsFromAssets, BUNDLED_FONTS } from '../images/fontCatalog.ts';
import { generateId } from '../utils/id.ts';
import { sanitizeSplashHtml } from '../utils/sanitizeHtml.ts';
import { pickTextboxEmptyHint } from '../utils/emptyHints.ts';
import { wireSliderTooltip } from '../utils/sliderReadout.ts';
import { renderAssetToInlineHtml } from '../utils/resolveAssetImages.ts';

/**
 * TextMapEditor — element-canvas handout editor (v2.11 Stream C, M4).
 *
 * Each handout is a page with free-positioned text and image elements,
 * edited directly on the parchment rather than via a side-panel rich-
 * text field. Text content is contenteditable in-place; geometry (x, y,
 * w, h) lives in % of the page so the same layout rasterises crisply at
 * any resolution.
 *
 * Mental model:
 *   - The dialog opens at 96vw x 94vh.
 *   - A toolbar across the top carries page-level controls + add buttons.
 *   - The page below sizes to fit the available canvas area and keeps
 *     the chosen aspect ratio.
 *   - Each element is an absolutely-positioned div inside the page. A
 *     thin drag-bar at the top and a resize-handle at the bottom-right
 *     are visible when the element is selected; everything else stays
 *     out of the way of normal contenteditable typing.
 *
 * Round-trips with the legacy single-bodyHtml model via
 * ensureTextMapElements() — older saves open as a single full-page
 * text element.
 */

export interface TextMapEditorResult {
  asset: MapAsset;
}

const ASPECT_PRESETS: ReadonlyArray<{ label: string; w: number; h: number }> = [
  { label: '16 : 9 Landscape',         w: 16,  h: 9   },
  { label: 'A4 Portrait (1 : √2)',     w: 210, h: 297 },
  { label: 'A4 Landscape (√2 : 1)',    w: 297, h: 210 },
  { label: '4 : 3 Landscape',          w: 4,   h: 3   },
  { label: 'Square (1 : 1)',           w: 1,   h: 1   },
  { label: '2 : 3 Tall',               w: 2,   h: 3   },
];

const DEFAULT_CONFIG: TextMapConfig = {
  width:           16,
  height:          9,
  fontFamily:      'Cinzel',
  fontScale:       1,
  backgroundColor: '#f4e9c8',
  textColor:       '#1a1a1a',
  elements:        [],
};

// Floor of the font dropdown — always present regardless of what the
// ImageAssetStore returns. Two slices:
//
//   • BASE_FONTS_GOOGLE — the 12 BUNDLED_FONTS families. These are
//     real Google Fonts entries; ensureFontsLoaded() builds a css2
//     <link> that fetches them at runtime.
//
//   • BASE_FONTS_SYSTEM — operating-system serifs that ship with
//     every browser. They MUST NOT be sent to Google's css2 API:
//     when an unknown family lands in the request the whole
//     stylesheet response can come back 400 and even the valid
//     families fail to load. Caught 2026-05-17 on beta when v2.13.1
//     dropdown listed all 14 names but only the OS serifs rendered
//     (no console error — the css2 fetch failed silently).
const BASE_FONTS_GOOGLE: ReadonlyArray<string> = BUNDLED_FONTS.map((f) => f.family);
const BASE_FONTS_SYSTEM: ReadonlyArray<string> = ['Georgia', 'Times New Roman'];
const BASE_FONTS: ReadonlyArray<string> = [...BASE_FONTS_GOOGLE, ...BASE_FONTS_SYSTEM];

// Inline Lucide-style SVGs used for the clipboard + edit icon buttons.
// Stroked monochrome, currentColor, 14px viewport — matches the rest of
// the app's flat-icon aesthetic.
const SVG_EDIT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" '
  + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M12 20h9"/>'
  + '<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
const SVG_SCISSORS =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" '
  + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/>'
  + '<circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/></svg>';
const SVG_COPY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" '
  + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>'
  + '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const SVG_CLIPBOARD =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" '
  + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>'
  + '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>';
// v2.14.100 — Undo / Redo icons for the History toolbar section.
// Matches the same flat-stroke 14px Lucide-style chrome the rest of
// the toolbar uses.
const SVG_UNDO =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" '
  + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>';
const SVG_REDO =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" '
  + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/></svg>';

type DragMode = 'move' | 'resize';

interface DragState {
  elementId: string;
  mode:      DragMode;
  startClientX: number;
  startClientY: number;
  startGeom:    { x: number; y: number; w: number; h: number };
  pageWidthPx:  number;
  pageHeightPx: number;
  capture:      HTMLElement;
  pointerId:    number;
  onMove:       (ev: PointerEvent) => void;
  onUp:         (ev: PointerEvent) => void;
}

export class TextMapEditor {
  private overlay:  HTMLElement | null = null;
  private resolver: ((value: TextMapEditorResult | null) => void) | null = null;
  private cfg:      TextMapConfig = { ...DEFAULT_CONFIG };
  private elements: TextMapElement[] = [];
  private name:     string = 'New Handout';
  private existingAssetId: string | null = null;
  private existingAddedAt: number | null = null;

  private pageEl:        HTMLElement | null = null;
  private elementToolbarEl: HTMLElement | null = null;
  private elementSectionEl: HTMLElement | null = null;
  private animationNameEl:  HTMLElement | null = null;
  private elementNodes   = new Map<string, HTMLElement>();
  private selectedId:    string | null = null;
  /** v2.12 — last font + colour the GM picked on ANY text element
   *  this session. New text elements inherit these (instead of the
   *  page-level defaults) so the GM doesn't have to re-pick on
   *  every new box. Reset when the editor closes; not persisted to
   *  the bundle. */
  private _lastFontChosen:  string | null = null;
  private _lastColorChosen: string | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private dragState: DragState | null = null;
  private libraryFonts: string[] = [];
  /** Internal clipboard for Ctrl+C / Ctrl+X / Ctrl+V on whole elements.
   *  Stores a snapshot of the source element's data (not a live ref) so
   *  paste creates a true duplicate. */
  private clipboardElement: TextMapElement | null = null;
  /** v2.14.99 — undo / redo stacks (per-modal-session, same pattern
   *  as the Composite Editor). Snapshots capture the element list +
   *  current selection. Cleared on close. Ctrl+Z / Ctrl+Y in the
   *  onKey handler; structural mutations (add / delete / drag start)
   *  push the BEFORE-state to undo before running. */
  private _undoStack: { elements: TextMapElement[]; selectedId: string | null }[] = [];
  private _redoStack: { elements: TextMapElement[]; selectedId: string | null }[] = [];

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !this.dragState) {
      this._resolve(null);
      return;
    }
    // Skip everything below when the user is typing into an input /
    // select / contenteditable so the browser's native behaviour wins
    // (typing characters, copy/paste of text inside a text element).
    const t = document.activeElement;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement
        || t instanceof HTMLTextAreaElement || this._editingActiveSelection()) {
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (this.selectedId) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this._deleteSelected();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        this._copySelected();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        this._copySelected();
        this._deleteSelected();
        return;
      }
    }
    if (ctrl && e.key.toLowerCase() === 'v' && this.clipboardElement) {
      e.preventDefault();
      this._pasteFromClipboard();
      return;
    }
    // v2.14.99 — Ctrl+Z = undo, Ctrl+Y or Ctrl+Shift+Z = redo.
    // Same convention as the Composite Editor. Skipped above when
    // an input / contenteditable has focus so the browser's native
    // text undo wins inside text elements.
    if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      this._undo();
      return;
    }
    if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
      e.preventDefault();
      this._redo();
    }
  };

  /** v2.14.99 — Push the current element state to the undo stack
   *  BEFORE a structural mutation. Caps the stack at 100 entries +
   *  clears redo (new action invalidates the redo path). */
  private _pushUndo(): void {
    this._undoStack.push({
      elements: JSON.parse(JSON.stringify(this.elements)) as TextMapElement[],
      selectedId: this.selectedId,
    });
    if (this._undoStack.length > 100) this._undoStack.shift();
    this._redoStack = [];
    this._updateHistoryButtons();
  }

  private _snapshotCurrent(): { elements: TextMapElement[]; selectedId: string | null } {
    return {
      elements: JSON.parse(JSON.stringify(this.elements)) as TextMapElement[],
      selectedId: this.selectedId,
    };
  }

  private _undo(): void {
    if (this._undoStack.length === 0) return;
    this._redoStack.push(this._snapshotCurrent());
    const snap = this._undoStack.pop()!;
    this.elements = snap.elements;
    this.selectedId = snap.selectedId;
    this._renderAllElements();
    if (this.selectedId) this._select(this.selectedId);
    this._updateHistoryButtons();
  }

  private _redo(): void {
    if (this._redoStack.length === 0) return;
    this._undoStack.push(this._snapshotCurrent());
    const snap = this._redoStack.pop()!;
    this.elements = snap.elements;
    this.selectedId = snap.selectedId;
    this._renderAllElements();
    if (this.selectedId) this._select(this.selectedId);
    this._updateHistoryButtons();
  }

  /** Snapshot the selected element into the internal clipboard. Deep
   *  enough — TextMapElement values are flat (primitives + string
   *  fields), so a shallow spread is a true copy. */
  private _copySelected(): void {
    if (!this.selectedId) return;
    const el = this.elements.find((e) => e.id === this.selectedId);
    if (!el) return;
    this.clipboardElement = { ...el };
  }

  /** Duplicate the clipboard element with a fresh id, slightly offset
   *  so it doesn't sit exactly on top of the original. Select the new
   *  element so the user can immediately drag / type into it. */
  private _pasteFromClipboard(): void {
    const src = this.clipboardElement;
    if (!src) return;
    const offsetX = Math.max(0, Math.min(100 - src.w, src.x + 5));
    const offsetY = Math.max(0, Math.min(100 - src.h, src.y + 5));
    let fresh: TextMapElement;
    if (src.type === 'text') {
      fresh = { ...src, id: 'text-' + generateId(), x: offsetX, y: offsetY };
    } else {
      fresh = { ...src, id: 'img-' + generateId(), x: offsetX, y: offsetY };
    }
    this._pushUndo();
    this.elements.push(fresh);
    this._mountElement(fresh);
    this._select(fresh.id);
  }

  open(opts: { existing?: MapAsset } = {}): Promise<TextMapEditorResult | null> {
    if (opts.existing?.textMap) {
      this.cfg = { ...DEFAULT_CONFIG, ...opts.existing.textMap };
      this.name = opts.existing.filename;
      this.existingAssetId = opts.existing.id;
      this.existingAddedAt = opts.existing.addedAt;
    } else {
      this.cfg = { ...DEFAULT_CONFIG, elements: [newTextElement()] };
    }
    // Resolve elements (handles legacy bodyHtml migration).
    this.elements = ensureTextMapElements(this.cfg);
    if (this.elements.length === 0) this.elements = [newTextElement()];

    this.overlay = this._build(!!opts.existing);
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
    void this._loadFontsForPreview();
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  private async _loadFontsForPreview(): Promise<void> {
    const all = await ImageAssetStore.getAll();
    const fontAssets = all.filter((a) => a.source === 'font' && a.fontFamily);
    const families = fontAssets.map((a) => a.fontFamily!);
    // Register any uploaded-font blobs via FontFace first; that filters
    // them out of the Google CDN request so we don't double-fetch.
    await registerLocalFontsFromAssets(fontAssets);
    // v2.12.4 — also load fonts referenced by the page itself: the
    // cfg-level default plus any per-element overrides. Previously only
    // library fonts were loaded, so a saved handout whose elements
    // used a font that wasn't in the live library (e.g. Cinzel removed
    // from the user's assets after a bundle was saved with it) rendered
    // in system serif on the editor canvas — only the GM main view
    // looked correct because the rasterizer pulls page + element fonts
    // separately. Mirror that here so what you see in the editor is
    // what the GM main view shows.
    // Pre-load Google Fonts for the 12 bundled catalog families so
    // the editor renders their preview glyphs even when the IDB seed
    // missed on this install. System serifs (BASE_FONTS_SYSTEM) are
    // deliberately EXCLUDED from the request — see the comment on
    // BASE_FONTS_SYSTEM above for why a stray "Times New Roman" in
    // the css2 URL can sink the whole stylesheet.
    const usedFamilies = new Set<string>(families);
    for (const f of BASE_FONTS_GOOGLE) usedFamilies.add(f);
    if (this.cfg.fontFamily && !BASE_FONTS_SYSTEM.includes(this.cfg.fontFamily)) {
      usedFamilies.add(this.cfg.fontFamily);
    }
    for (const el of this.cfg.elements ?? []) {
      if (el.type === 'text' && el.fontFamily
          && !BASE_FONTS_SYSTEM.includes(el.fontFamily)) {
        usedFamilies.add(el.fontFamily);
      }
    }
    ensureFontsLoaded(Array.from(usedFamilies));
    // Dropdown = BASE_FONTS first (guaranteed floor — the 12 bundled
    // catalog families plus the two system serifs), then any user-
    // added font assets in the Image Library. Dedup preserves first-
    // seen order so the floor sits at the top and user additions
    // follow underneath.
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const f of [...BASE_FONTS, ...families]) {
      if (!seen.has(f)) { seen.add(f); merged.push(f); }
    }
    this.libraryFonts = merged;
    this._renderElementToolbar();
  }

  private _resolve(value: TextMapEditorResult | null): void {
    if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
    if (this.dragState) this._abortDrag();
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this.onKey);
    // v2.14.99 — undo history is per-modal-session; reset on close
    // so reopening the editor starts with empty stacks.
    this._undoStack = [];
    this._redoStack = [];
    this.resolver?.(value);
    this.resolver = null;
  }

  // ─── Build ──────────────────────────────────────────────────────────────

  private _build(isEdit: boolean): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    // Click-outside-to-dismiss intentionally disabled — use Cancel / × / Escape.

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog txt-map-dialog txt-map-dialog--canvas';
    overlay.appendChild(dialog);

    // ── Header ───────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = isEdit ? 'Edit Handout' : 'Create Handout';
    header.appendChild(title);
    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'modal-close';
    closeX.textContent = '×';
    closeX.addEventListener('click', () => this._resolve(null));
    header.appendChild(closeX);
    dialog.appendChild(header);

    // ── Toolbar ──────────────────────────────────────────────────────────
    // Three sections: left (Name), centre (add buttons + contextual
    // element controls), right (Layout = paper size + colour). The
    // per-element controls slot is appended inside the centre section
    // by _buildToolbar() so they sit next to the add buttons.
    dialog.appendChild(this._buildToolbar());

    // ── Canvas wrap ──────────────────────────────────────────────────────
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'txt-map-canvas-wrap';
    canvasWrap.addEventListener('pointerdown', (e) => {
      // Click in the empty canvas area (not on an element) → deselect.
      if (e.target === canvasWrap || e.target === this.pageEl) {
        this._select(null);
      }
    });
    dialog.appendChild(canvasWrap);

    const page = document.createElement('div');
    page.className = 'txt-map-page';
    page.id = 'txt-map-page';
    // 'transparent' uses a CSS checkerboard class so the editor
    // visualises the paper as "empty alpha" (the image-editor
    // convention) instead of leaking the host page colour through.
    // Solid colours go through inline style as before.
    if (this.cfg.backgroundColor === 'transparent') {
      page.classList.add('txt-map-page--transparent');
    } else {
      page.style.backgroundColor = this.cfg.backgroundColor;
    }
    page.style.color = this.cfg.textColor;
    page.style.fontFamily = `'${this.cfg.fontFamily}', serif`;
    canvasWrap.appendChild(page);
    this.pageEl = page;

    // ── Footer ───────────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.className = 'txt-map-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn--ghost';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this._resolve(null));
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn--primary';
    save.textContent = isEdit ? 'Save' : 'Create';
    save.addEventListener('click', () => void this._onSave());
    footer.append(cancel, save);
    dialog.appendChild(footer);

    // Initial paint after mount so getBoundingClientRect is valid.
    requestAnimationFrame(() => {
      this._renderAllElements();
      this._fitPage();
      if (!this.resizeObserver) {
        this.resizeObserver = new ResizeObserver(() => this._fitPage());
        this.resizeObserver.observe(canvasWrap);
      }
    });

    return overlay;
  }

  private _buildToolbar(): HTMLElement {
    const tb = document.createElement('div');
    tb.className = 'txt-map-toolbar';

    // v2.12.4 — toolbar reorganised to free horizontal room for the
    // centre Element Properties slot. Sections that were across the
    // whole row are now stacked into two-row columns:
    //
    //   COL 1: Name        COL 2: Add Content    COL 3: Clipboard
    //          Layout              Animation
    //
    //   CENTRE: Element Properties (flexes to fill remaining space)
    //
    // The old left/right wrappers are gone — narrow GM screens used
    // to crush the element controls; now Layout / Animation tuck
    // underneath their thematic neighbours.
    const left = document.createElement('div');
    left.className = 'txt-map-toolbar-left';
    left.appendChild(this._buildToolbarColumn(this._buildNameSection(), this._buildLayoutSection()));
    left.appendChild(this._buildToolbarDivider());
    left.appendChild(this._buildToolbarColumn(this._buildAddContentSection(), this._buildAnimationSection()));
    left.appendChild(this._buildToolbarDivider());
    left.appendChild(this._buildClipboardSection());
    left.appendChild(this._buildToolbarDivider());
    left.appendChild(this._buildHistorySection());
    tb.appendChild(left);

    // ── CENTRE — Element Properties section (label + slot). Hidden
    //            when nothing is selected.
    const centre = document.createElement('div');
    centre.className = 'txt-map-toolbar-centre';
    const centreSection = document.createElement('div');
    centreSection.className = 'txt-map-toolbar-section';
    centreSection.hidden = true;
    const centreLabel = document.createElement('span');
    centreLabel.className = 'txt-map-toolbar-section-label';
    centreLabel.textContent = 'Element Properties:';
    centreSection.appendChild(centreLabel);
    const elSlot = document.createElement('div');
    elSlot.className = 'txt-map-toolbar-section-row txt-map-toolbar-element';
    centreSection.appendChild(elSlot);
    centre.appendChild(centreSection);
    tb.appendChild(centre);
    this.elementToolbarEl = elSlot;
    this.elementSectionEl = centreSection;

    return tb;
  }

  /** v2.12.4 — wrap two toolbar sections into a vertical column.
   *  Used to stack Name/Layout and AddContent/Animation so the centre
   *  Element Properties slot gets meaningfully more horizontal room
   *  on narrow GM screens. CSS gives the wrapper a small gap and
   *  flex-direction: column. */
  private _buildToolbarColumn(top: HTMLElement, bottom: HTMLElement): HTMLElement {
    const col = document.createElement('div');
    col.className = 'txt-map-toolbar-col';
    col.append(top, bottom);
    return col;
  }

  /** Generic "section heading + content row below" wrapper. The
   *  toolbar uses this pattern for every section so labels align and
   *  vertical rhythm is consistent. */
  private _buildSectionShell(labelText: string): { section: HTMLElement; row: HTMLElement } {
    const section = document.createElement('div');
    section.className = 'txt-map-toolbar-section';
    const label = document.createElement('span');
    label.className = 'txt-map-toolbar-section-label';
    label.textContent = labelText;
    const row = document.createElement('div');
    row.className = 'txt-map-toolbar-section-row';
    section.append(label, row);
    return { section, row };
  }

  private _buildToolbarDivider(): HTMLElement {
    const d = document.createElement('div');
    d.className = 'txt-map-toolbar-divider';
    return d;
  }

  private _buildNameSection(): HTMLElement {
    const { section, row } = this._buildSectionShell('Name:');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'txt-map-input txt-map-toolbar-name';
    nameInput.value = this.name;
    nameInput.placeholder = 'Handout name';
    // Suppress browser autofill — without this it'll happily offer up
    // phone numbers / email / whatever else it's stored for a generic
    // text input on this page.
    nameInput.autocomplete = 'off';
    nameInput.setAttribute('autocomplete', 'off');
    nameInput.name = 'mappadux-handout-name';
    nameInput.spellcheck = false;
    nameInput.addEventListener('input', () => { this.name = nameInput.value; });
    row.appendChild(nameInput);
    return section;
  }

  private _buildAddContentSection(): HTMLElement {
    const { section, row } = this._buildSectionShell('Add Content:');

    const addText = document.createElement('button');
    addText.type = 'button';
    addText.className = 'btn btn--ghost btn--sm';
    addText.textContent = '+ Text';
    addText.addEventListener('click', () => this._addNewText());
    row.appendChild(addText);

    const addImg = document.createElement('button');
    addImg.type = 'button';
    addImg.className = 'btn btn--ghost btn--sm';
    addImg.textContent = '+ Image Asset';
    addImg.title = 'Pick an image from the Small Assets Library';
    addImg.addEventListener('click', () => void this._addNewImage());
    row.appendChild(addImg);

    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'btn btn--ghost btn--sm';
    uploadBtn.textContent = '+ Upload New Image';
    uploadBtn.title = 'Upload an image from disk and drop it on the page';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.hidden = true;
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) void this._uploadAndAddImage(f);
      fileInput.value = '';
    });
    uploadBtn.addEventListener('click', () => fileInput.click());
    row.append(uploadBtn, fileInput);

    return section;
  }

  private _buildClipboardSection(): HTMLElement {
    const { section, row } = this._buildSectionShell('Clipboard:');
    const cutBtn   = this._mkIconBtn(SVG_SCISSORS,  'Cut selected element (Ctrl+X)',
      () => { if (this.selectedId) { this._copySelected(); this._deleteSelected(); } });
    const copyBtn  = this._mkIconBtn(SVG_COPY,      'Copy selected element (Ctrl+C)',
      () => { if (this.selectedId) this._copySelected(); });
    const pasteBtn = this._mkIconBtn(SVG_CLIPBOARD, 'Paste element (Ctrl+V)',
      () => { if (this.clipboardElement) this._pasteFromClipboard(); });
    row.append(cutBtn, copyBtn, pasteBtn);
    return section;
  }

  /** v2.14.100 — Toolbar section holding the Undo / Redo pair so
   *  the affordance is visible (not just keyboard-only). Disabled
   *  states wire the same way the Composite Editor does — refreshed
   *  any time the stacks change via _updateHistoryButtons. */
  private _historyUndoBtn: HTMLButtonElement | null = null;
  private _historyRedoBtn: HTMLButtonElement | null = null;
  private _buildHistorySection(): HTMLElement {
    const { section, row } = this._buildSectionShell('History:');
    const undoBtn = this._mkIconBtn(SVG_UNDO, 'Undo (Ctrl+Z)', () => this._undo());
    const redoBtn = this._mkIconBtn(SVG_REDO, 'Redo (Ctrl+Y)', () => this._redo());
    undoBtn.disabled = true;
    redoBtn.disabled = true;
    this._historyUndoBtn = undoBtn;
    this._historyRedoBtn = redoBtn;
    row.append(undoBtn, redoBtn);
    return section;
  }
  private _updateHistoryButtons(): void {
    if (this._historyUndoBtn) this._historyUndoBtn.disabled = this._undoStack.length === 0;
    if (this._historyRedoBtn) this._historyRedoBtn.disabled = this._redoStack.length === 0;
  }

  private _buildLayoutSection(): HTMLElement {
    const { section, row } = this._buildSectionShell('Layout:');

    const aspectSel = document.createElement('select');
    aspectSel.className = 'txt-map-input';
    aspectSel.title = 'Paper size / aspect ratio';
    for (const p of ASPECT_PRESETS) {
      const o = document.createElement('option');
      o.value = `${p.w}x${p.h}`;
      o.textContent = p.label;
      if (p.w === this.cfg.width && p.h === this.cfg.height) o.selected = true;
      aspectSel.appendChild(o);
    }
    aspectSel.addEventListener('change', () => {
      const parts = aspectSel.value.split('x').map((n) => parseInt(n, 10));
      const w = parts[0];
      const h = parts[1];
      if (w && h) { this.cfg.width = w; this.cfg.height = h; this._fitPage(); }
    });
    row.appendChild(aspectSel);

    // Paper colour + transparent toggle. When 'Transparent' is on,
    // the colour swatch is disabled and the textmap rasterises with
    // a clear background — alpha channel preserved through to the
    // final PNG, so a backdrop / underlying map can show through any
    // gaps in the body when the textmap is used as a map.
    const swatchSlot   = document.createElement('span');
    const transToggle  = document.createElement('label');
    transToggle.className = 'txt-map-toolbar-checkbox';
    const transCheck   = document.createElement('input');
    transCheck.type    = 'checkbox';
    transCheck.checked = this.cfg.backgroundColor === 'transparent';
    transToggle.appendChild(transCheck);
    const transText    = document.createElement('span');
    transText.textContent = 'Transparent';
    transToggle.appendChild(transText);
    transToggle.title  = 'Transparent paper — the textmap rasterises with a clear background so anything behind the map (backdrop effects, underlying terrain) shows through.';

    // The last-picked solid colour, restored when Transparent is
    // unchecked. Falls back to the registered default if the
    // textmap loaded with backgroundColor='transparent'.
    let lastSolid = this.cfg.backgroundColor === 'transparent' ? '#f4e9c8' : this.cfg.backgroundColor;
    const swatch = this._buildColourInput('Paper colour', lastSolid, (v) => {
      lastSolid = v;
      if (!transCheck.checked) {
        this.cfg.backgroundColor = v;
        if (this.pageEl) this.pageEl.style.background = v;
      }
    });
    (swatch as HTMLInputElement).disabled = transCheck.checked;
    swatchSlot.appendChild(swatch);
    transCheck.addEventListener('change', () => {
      (swatch as HTMLInputElement).disabled = transCheck.checked;
      const next = transCheck.checked ? 'transparent' : lastSolid;
      this.cfg.backgroundColor = next;
      if (this.pageEl) {
        if (transCheck.checked) {
          // Drop any inline solid colour so the checkerboard from
          // .txt-map-page--transparent can show through.
          this.pageEl.style.background = '';
          this.pageEl.classList.add('txt-map-page--transparent');
        } else {
          this.pageEl.classList.remove('txt-map-page--transparent');
          this.pageEl.style.background = next;
        }
      }
    });

    row.appendChild(swatchSlot);
    row.appendChild(transToggle);

    return section;
  }

  private _buildAnimationSection(): HTMLElement {
    const { section, row } = this._buildSectionShell('Animation:');

    // Enable checkbox — mirror of the master switch in the picker
    // modal. Toggling on populates cfg.animation with defaults if
    // empty; toggling off keeps the saved config but flags it
    // disabled, so flipping back on restores the previous picked
    // transition.
    const enableLabel = document.createElement('label');
    enableLabel.className = 'txt-map-toolbar-checkbox';
    const enableCheck = document.createElement('input');
    enableCheck.type = 'checkbox';
    enableCheck.checked = this.cfg.animation?.enabled === true;
    enableCheck.addEventListener('change', () => {
      if (enableCheck.checked) {
        if (!this.cfg.animation) {
          this.cfg.animation = {
            enabled: true, autoReveal: true,
            transitionId: 'written_reveal',
            params: { ...transitionRegistry.defaultParams('written_reveal') },
          };
        } else {
          this.cfg.animation.enabled = true;
        }
      } else {
        if (this.cfg.animation) this.cfg.animation.enabled = false;
      }
      this._refreshAnimationSection();
    });
    enableLabel.append(enableCheck, document.createTextNode(' Enable'));
    row.appendChild(enableLabel);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'txt-map-animation-name';
    row.appendChild(nameSpan);
    this.animationNameEl = nameSpan;

    const editBtn = this._mkIconBtn(SVG_EDIT, 'Edit animation settings', () => {
      this._openAnimationPicker();
    });
    row.appendChild(editBtn);

    this._refreshAnimationSection();
    return section;
  }

  /** Update the Animation section's name span + checkbox to reflect the
   *  current cfg.animation. Called on init, on the Enable checkbox
   *  change, and after the animation picker closes. */
  private _refreshAnimationSection(): void {
    if (!this.animationNameEl) return;
    if (!this.cfg.animation?.enabled) {
      this.animationNameEl.textContent = '(disabled)';
      this.animationNameEl.style.opacity = '0.55';
    } else {
      const def = transitionRegistry.get(this.cfg.animation.transitionId);
      this.animationNameEl.textContent = def?.label ?? this.cfg.animation.transitionId;
      this.animationNameEl.style.opacity = '1';
    }
  }

  /** Open the reveal-animation picker. Lets the GM enable the reveal,
   *  pick a handout-suitable transition, tweak its params, and choose
   *  whether the reveal fires automatically on map load or waits for
   *  a GM trigger. Stored on cfg.animation. */
  private _openAnimationPicker(): void {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog modal-dialog--sm';
    overlay.appendChild(dialog);

    // Working copy — committed back to cfg.animation on Save. The
    // master Enable lives on the toolbar's Animation row now, so we
    // mirror its state in `cur.enabled` but don't render a checkbox
    // for it inside this modal. autoReveal defaults OFF — the GM
    // usually wants to click Start themselves rather than have the
    // reveal fire the moment the map loads.
    const cur: TextMapAnimation = this.cfg.animation
      ? { ...this.cfg.animation, params: { ...this.cfg.animation.params } }
      : { enabled: true, autoReveal: false, transitionId: 'written_reveal', params: {} };

    // Header
    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = 'Reveal Animation';
    header.appendChild(title);
    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'modal-close';
    closeX.textContent = '×';
    const close = (commit: boolean): void => {
      if (commit) {
        if (cur.enabled) {
          this.cfg.animation = cur;
        } else {
          // Disabled: drop the field entirely so the player / projector
          // skip the reveal pathway altogether.
          const { animation: _a, ...rest } = this.cfg;
          void _a;
          this.cfg = rest as TextMapConfig;
        }
        // Keep the toolbar's Animation row in sync with the saved
        // config — the Enable checkbox + name span both pull from
        // cfg.animation.
        this._refreshAnimationSection();
      }
      overlay.remove();
    };
    closeX.addEventListener('click', () => close(false));
    header.appendChild(closeX);
    dialog.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.style.padding = 'var(--space-md)';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = 'var(--space-md)';
    dialog.appendChild(body);

    // (The master "Reveal animation enabled" checkbox is intentionally
    //  not rendered here — it's externalised to the toolbar's
    //  Animation row. The modal preserves the existing enabled state
    //  on save so opening + saving doesn't flip the master switch.)

    // Auto / manual trigger
    const auto = document.createElement('label');
    auto.className = 'txt-map-toolbar-checkbox';
    const autoCheck = document.createElement('input');
    autoCheck.type = 'checkbox';
    autoCheck.checked = cur.autoReveal;
    auto.append(autoCheck, document.createTextNode(' Play automatically when map loads (otherwise the GM kicks it off via the Start button)'));
    body.appendChild(auto);

    // Transition picker — filtered to forHandout-tagged definitions.
    const sel = document.createElement('select');
    sel.className = 'select-full';
    const handoutDefs = transitionRegistry.getAll().filter((d) => d.forHandout);
    for (const d of handoutDefs) {
      const o = document.createElement('option');
      o.value = d.id; o.textContent = d.label;
      if (d.id === cur.transitionId) o.selected = true;
      sel.appendChild(o);
    }
    const selWrap = document.createElement('div');
    const selLabel = document.createElement('div');
    selLabel.className = 'txt-map-toolbar-group-label';
    selLabel.textContent = 'Transition';
    selWrap.append(selLabel, sel);
    body.appendChild(selWrap);

    // Param panel — re-rendered when the transition changes.
    const paramHost = document.createElement('div');
    paramHost.style.display = 'flex';
    paramHost.style.flexDirection = 'column';
    paramHost.style.gap = 'var(--space-sm)';
    body.appendChild(paramHost);

    const renderParams = (): void => {
      const def = transitionRegistry.get(cur.transitionId);
      paramHost.innerHTML = '';
      if (!def || def.params.length === 0) return;
      for (const p of def.params) {
        const row = document.createElement('label');
        row.style.display = 'flex';
        row.style.flexDirection = 'column';
        row.style.gap = '4px';
        const lbl = document.createElement('span');
        lbl.className = 'txt-map-toolbar-group-label';
        lbl.textContent = p.label;
        row.appendChild(lbl);
        if (p.type === 'slider') {
          const sliderRow = document.createElement('div');
          sliderRow.style.display = 'flex';
          sliderRow.style.alignItems = 'center';
          sliderRow.style.gap = 'var(--space-sm)';
          const slider = document.createElement('input');
          slider.type = 'range';
          slider.min = String(p.min); slider.max = String(p.max); slider.step = String(p.step);
          slider.style.flex = '1';
          slider.value = String(cur.params[p.id] ?? p.default);
          const valSpan = document.createElement('span');
          valSpan.className = 'txt-map-element-slider-val';
          // Display milliseconds as seconds (1 decimal) — easier to
          // parse than "30000 ms". Param is still stored in ms; only
          // the displayed text changes.
          const fmt = (n: number): string => {
            if (p.unit === 'ms') return `${(n / 1000).toFixed(1)} s`;
            return `${n}${p.unit ? ' ' + p.unit : ''}`;
          };
          valSpan.textContent = fmt(parseFloat(slider.value));
          slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            cur.params[p.id] = v;
            valSpan.textContent = fmt(v);
          });
          sliderRow.append(slider, valSpan);
          row.appendChild(sliderRow);
        } else if (p.type === 'select') {
          const optSel = document.createElement('select');
          optSel.className = 'select-full';
          for (const opt of p.options) {
            const o = document.createElement('option');
            o.value = opt.value; o.textContent = opt.label;
            if ((cur.params[p.id] ?? p.default) === opt.value) o.selected = true;
            optSel.appendChild(o);
          }
          optSel.addEventListener('change', () => { cur.params[p.id] = optSel.value; });
          row.appendChild(optSel);
        } else if (p.type === 'color') {
          // v2.14.82 — colour pickers reach the handout reveal panel
          // too via the same shared transition param schema. Native
          // <input type="color"> is enough; reveals only fire once
          // per handout, so no live preview wiring needed.
          const colourInput = document.createElement('input');
          colourInput.type = 'color';
          colourInput.value = (cur.params[p.id] as string) ?? p.default;
          colourInput.addEventListener('input', () => { cur.params[p.id] = colourInput.value; });
          row.appendChild(colourInput);
        }
        paramHost.appendChild(row);
      }
    };

    sel.addEventListener('change', () => {
      cur.transitionId = sel.value;
      // Reset params to the new transition's defaults — params are
      // per-transition so old values rarely apply.
      cur.params = transitionRegistry.defaultParams(sel.value);
      renderParams();
    });
    // Ensure defaults are filled in for the initially-selected transition
    // if cur.params is empty.
    if (Object.keys(cur.params).length === 0) {
      cur.params = transitionRegistry.defaultParams(cur.transitionId);
    }
    renderParams();

    autoCheck.addEventListener('change', () => {
      cur.autoReveal = autoCheck.checked;
    });

    // Footer
    const footer = document.createElement('div');
    footer.style.padding = 'var(--space-md)';
    footer.style.borderTop = '1px solid var(--border)';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = 'var(--space-sm)';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn--ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => close(false));
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'btn btn--primary';
    okBtn.textContent = 'Save';
    okBtn.addEventListener('click', () => close(true));
    footer.append(cancelBtn, okBtn);
    dialog.appendChild(footer);

    document.body.appendChild(overlay);
  }

  /** Save a user-picked image file to the Image Library (Textmap
   *  category, tintable: false so raster colour is preserved), then
   *  drop a new image element onto the canvas pointing at it. */
  private async _uploadAndAddImage(file: File): Promise<void> {
    const id = `upload-${generateId()}`;
    const asset = {
      id,
      name:        file.name.replace(/\.[^.]+$/, '') || 'Uploaded image',
      source:      'upload' as const,
      categoryId:  SYSTEM_CATEGORY_IDS.textmap,
      tintable:    false,
      blob:        file,
      mimeType:    file.type || 'image/png',
      addedAt:     Date.now(),
    };
    await ImageAssetStore.save(asset);
    const el = newImageElement(id);
    this.elements.push(el);
    this._mountElement(el);
    this._select(el.id);
  }

  private _buildColourInput(title: string, value: string, onInput: (v: string) => void): HTMLElement {
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'txt-map-color';
    input.title = title;
    input.value = value;
    input.addEventListener('input', () => onInput(input.value));
    return input;
  }

  /** Build a small icon button — inline monochrome SVG, ghost-style
   *  background. Used for the cut/copy/paste cluster next to the add
   *  buttons. */
  private _mkIconBtn(svg: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--ghost btn--sm txt-map-icon-btn';
    b.title = title;
    b.innerHTML = svg;
    b.addEventListener('click', onClick);
    return b;
  }

  // (page-level font picker removed — font is a per-element concern.
  //  The per-element font select builds its list from this.libraryFonts
  //  in _buildTextElementToolbar.)

  // ─── Page fit ───────────────────────────────────────────────────────────

  private _fitPage(): void {
    const page = this.pageEl;
    const wrap = page?.parentElement;
    if (!page || !wrap) return;
    const cw = wrap.clientWidth  - 16;
    const ch = wrap.clientHeight - 16;
    if (cw <= 0 || ch <= 0) return;
    const aspect = this.cfg.width / this.cfg.height;
    let w = cw;
    let h = w / aspect;
    if (h > ch) { h = ch; w = h * aspect; }
    page.style.width  = `${Math.round(w)}px`;
    page.style.height = `${Math.round(h)}px`;
    // Anchor base font-size to page width — matches the rasteriser's
    // pxW / 60 formula so preview and rasterised map render at the same
    // scale.
    const basePx = Math.max(1, Math.round((w / 60) * this.cfg.fontScale));
    page.style.fontSize = `${basePx}px`;
  }

  // ─── Elements ───────────────────────────────────────────────────────────

  private _renderAllElements(): void {
    if (!this.pageEl) return;
    for (const node of this.elementNodes.values()) node.remove();
    this.elementNodes.clear();
    for (const el of this.elements) this._mountElement(el);
  }

  private _mountElement(el: TextMapElement): HTMLElement {
    if (!this.pageEl) throw new Error('page not mounted');
    const host = document.createElement('div');
    host.className = `txt-map-el txt-map-el--${el.type}`;
    host.dataset.elementId = el.id;
    // v2.14.102 — _applyGeometry MUST run after the body is mounted
    // (it queries the body for the flip transform). Earlier this ran
    // here, before host.appendChild(body) below, so the flip never
    // applied on first paint and the editor re-entry showed an un-
    // flipped element even though the asset had the flipH/V flags
    // set. Set x/y/w/h inline now; defer full geometry (including
    // rotation + flip) to AFTER body is mounted at the end of this
    // method.
    host.style.left   = `${el.x}%`;
    host.style.top    = `${el.y}%`;
    host.style.width  = `${el.w}%`;
    host.style.height = `${el.h}%`;

    // Body (the typeable / image-rendering region)
    const body = document.createElement('div');
    body.className = 'txt-map-el-body';
    if (el.type === 'text') {
      body.contentEditable = 'true';
      body.spellcheck = true;
      this._applyTextStyle(body, el);
      body.innerHTML = sanitizeSplashHtml(el.html ?? '');
      // Empty-state placeholder. The CSS rule
      //   .txt-map-el-body--text:empty::before { content: attr(data-placeholder); ... }
      // shows this hint while the element is empty and hides it as
      // soon as the GM types. One pick per element so the same text
      // box doesn't rotate the joke on every keystroke. The earlier
      // "Click to edit…" hardcode was a misread of the original
      // feedback — the GM wanted personality here, not a generic
      // affordance.
      body.classList.add('txt-map-el-body--text');
      body.dataset['placeholder'] = pickTextboxEmptyHint();
      body.addEventListener('input', () => this._onTextInput(el.id, body));
      body.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = e.clipboardData?.getData('text/plain') ?? '';
        document.execCommand('insertText', false, text);
      });
      // Click → select. Don't focus contenteditable on first click of an
      // unselected element so the drag-bar is reachable.
      body.addEventListener('pointerdown', (e) => {
        if (this.selectedId !== el.id) {
          e.preventDefault();
          this._select(el.id);
        }
      });
    } else if (el.type === 'image') {
      body.classList.add('txt-map-el-body--image');
      // v2.14.104 — Carry the lock state on the host so the CSS can
      // toggle object-fit on the inner image (contain when locked,
      // fill when unlocked).
      if (el.lockAspect === false) host.classList.add('txt-map-el--unlocked');
      // Async resolve — paint a placeholder while we wait.
      body.textContent = '🖼';
      void renderAssetToInlineHtml(el.assetId, { sizeEm: 1 }).then((html) => {
        if (html) {
          body.innerHTML = html;
          // SVG aspect respects preserveAspectRatio; default is
          // "xMidYMid meet" (= contain-like). When the element is
          // unlocked the user wants the SVG to stretch with the
          // box, so flip the SVG's attribute on the fly.
          if (el.lockAspect === false) {
            const svg = body.querySelector('svg');
            if (svg) svg.setAttribute('preserveAspectRatio', 'none');
          }
        }
      });
      // Image bodies are draggable from ANYWHERE in their frame.
      // There's no text-edit mode to compete with, and the cursor
      // already advertises grab. Without this, an image dragged to the
      // page edge becomes unrecoverable because the drag-bar handle
      // (positioned outside the element bounds) sits offscreen.
      body.addEventListener('pointerdown', (e) => this._startDrag(e, el.id, 'move'));
      // Apply persisted tint so currentColor inside the SVG resolves
      // correctly on mount, not just on edit.
      if (el.tint) host.style.color = el.tint;
    }
    host.appendChild(body);

    // Chrome — top-left drag handle, top-centre flip-V (under
    // rotation), right-edge mid flip-H, bottom-right resize, etc.
    //
    // v2.14.108 — The drag handle is back at top-left for BOTH text
    // and image elements (parity with Composite Editor + matches the
    // GM's muscle memory). Image bodies still also accept pointerdown
    // for an additional drag surface — the explicit handle is purely
    // for affordance and to give a hit-target outside the body for
    // images flipped to edge-of-canvas positions.
    const dragBar = document.createElement('div');
    dragBar.className = 'txt-map-el-drag';
    dragBar.title = 'Drag to move';
    dragBar.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="5 9 2 12 5 15"/>' +
        '<polyline points="9 5 12 2 15 5"/>' +
        '<polyline points="15 19 12 22 9 19"/>' +
        '<polyline points="19 9 22 12 19 15"/>' +
        '<line x1="2" y1="12" x2="22" y2="12"/>' +
        '<line x1="12" y1="2" x2="12" y2="22"/>' +
      '</svg>';
    dragBar.addEventListener('pointerdown', (e) => this._startDrag(e, el.id, 'move'));
    host.appendChild(dragBar);

    const resize = document.createElement('div');
    resize.className = 'txt-map-el-resize';
    resize.title = 'Drag to resize';
    resize.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="15 3 21 3 21 9"/>' +
        '<polyline points="9 21 3 21 3 15"/>' +
        '<line x1="21" y1="3" x2="14" y2="10"/>' +
        '<line x1="3"  y1="21" x2="10" y2="14"/>' +
      '</svg>';
    resize.addEventListener('pointerdown', (e) => this._startDrag(e, el.id, 'resize'));
    host.appendChild(resize);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'txt-map-el-delete';
    del.title = 'Delete element';
    del.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 6h18"/>' +
        '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>' +
        '<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
        '<line x1="10" y1="11" x2="10" y2="17"/>' +
        '<line x1="14" y1="11" x2="14" y2="17"/>' +
      '</svg>';
    del.addEventListener('pointerdown', (e) => e.stopPropagation());
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      this._deleteElement(el.id);
    });
    host.appendChild(del);

    // v2.14.101 — Rotation handle (composite-editor style): a small
    // ball above the element's top centre with a dashed stem
    // connecting down to the element edge. Drag to rotate; snaps to
    // 0/90/180/270 (±5°), 45 family (±2°), 30 family (±2°).
    const rotStem = document.createElement('div');
    rotStem.className = 'txt-map-el-rotate-stem';
    host.appendChild(rotStem);
    const rotHandle = document.createElement('button');
    rotHandle.type = 'button';
    rotHandle.className = 'txt-map-el-rotate-handle';
    rotHandle.title = 'Drag to rotate. Snaps to common angles.';
    rotHandle.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 12a9 9 0 1 1-3-6.7"/>' +
        '<polyline points="21 4 21 9 16 9"/>' +
      '</svg>';
    this._bindRotateDrag(rotHandle, host, el.id);
    host.appendChild(rotHandle);

    // v2.14.101 — Flip H + Flip V buttons on the top corners of the
    // selected element. Match composite editor's visual treatment +
    // active-state colour when the flip is engaged.
    const flipH = document.createElement('button');
    flipH.type = 'button';
    flipH.className = `txt-map-el-flip txt-map-el-flip--h${el.flipH ? ' is-active' : ''}`;
    flipH.title = 'Mirror this element horizontally (left ↔ right).';
    flipH.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="6 4 2 12 6 20"/>' +
        '<polyline points="18 4 22 12 18 20"/>' +
        '<line x1="12" y1="2" x2="12" y2="22"/>' +
      '</svg>';
    flipH.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    flipH.addEventListener('click', (ev) => { ev.stopPropagation(); this._toggleFlip(el.id, 'h'); });
    host.appendChild(flipH);

    const flipV = document.createElement('button');
    flipV.type = 'button';
    flipV.className = `txt-map-el-flip txt-map-el-flip--v${el.flipV ? ' is-active' : ''}`;
    flipV.title = 'Mirror this element vertically (top ↔ bottom).';
    flipV.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="4 6 12 2 20 6"/>' +
        '<polyline points="4 18 12 22 20 18"/>' +
        '<line x1="2" y1="12" x2="22" y2="12"/>' +
      '</svg>';
    flipV.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    flipV.addEventListener('click', (ev) => { ev.stopPropagation(); this._toggleFlip(el.id, 'v'); });
    host.appendChild(flipV);

    // v2.14.103 — Image-only chrome cluster: aspect-lock + reset
    // stack ABOVE the resize handle in the bottom-right corner,
    // mirroring the Composite Editor pattern. Reset snaps the
    // element's bounding box to the IMAGE'S NATURAL aspect ratio
    // at the current width — undoes any stretching the GM did.
    // Text elements skip this — handout text boxes are designed
    // for free reflow at any aspect.
    if (el.type === 'image') {
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'txt-map-el-reset';
      resetBtn.title = 'Reset bounding box to the image\'s natural aspect at the current width.';
      resetBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M3 12a9 9 0 1 0 3-6.7"/>' +
          '<polyline points="3 4 3 9 8 9"/>' +
        '</svg>';
      resetBtn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      resetBtn.addEventListener('click', (ev) => { ev.stopPropagation(); void this._resetElementAspect(el.id); });
      host.appendChild(resetBtn);

      const locked = el.lockAspect ?? true;
      const lockBtn = document.createElement('button');
      lockBtn.type = 'button';
      lockBtn.className = `txt-map-el-lock${locked ? ' is-active' : ''}`;
      lockBtn.title = locked
        ? 'Aspect ratio LOCKED — resize preserves the box\'s current shape. Click to unlock and stretch freely.'
        : 'Aspect ratio UNLOCKED — width and height resize independently. Click to re-lock.';
      lockBtn.innerHTML = locked
        ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
        : '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>';
      lockBtn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      lockBtn.addEventListener('click', (ev) => { ev.stopPropagation(); this._toggleLockAspect(el.id); });
      host.appendChild(lockBtn);
    }

    this.pageEl.appendChild(host);
    this.elementNodes.set(el.id, host);
    // v2.14.102 — Now that the body is in place, apply the full
    // geometry including rotation + flip. Re-entering the editor
    // (or any time _renderAllElements rebuilds the DOM) will hit
    // this path and the flip transform will actually show.
    this._applyGeometry(host, el);
    return host;
  }

  /** v2.14.101 — Snap a free-rotated angle to common tile-set angles
   *  (matches the Composite Editor's snap rules). */
  private _snapRotation(deg: number): number {
    const wrap = (a: number): number => ((a % 360) + 360) % 360;
    const distTo = (a: number, b: number): number => Math.abs(wrap(a - b + 180) - 180);
    // v2.14.106 — Right-angle snap dropped to ±2° (was ±5°) to
    // match the 45° + 30° families. See CompositeMapEditor for
    // the same rationale.
    const near90 = Math.round(deg / 90) * 90;
    if (distTo(deg, near90) <= 2) return wrap(near90);
    const near45 = Math.round(deg / 45) * 45;
    if (distTo(deg, near45) <= 2) return wrap(near45);
    const near30 = Math.round(deg / 30) * 30;
    if (distTo(deg, near30) <= 2) return wrap(near30);
    return wrap(deg);
  }

  /** v2.14.101 — Bind the rotation-drag handler. atan2-based angle
   *  from element centre to pointer; live-update host.style.transform
   *  during the drag for instant visual feedback. */
  private _bindRotateDrag(handle: HTMLElement, host: HTMLElement, elementId: string): void {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const el = this.elements.find((x) => x.id === elementId);
      if (!el) return;
      this._pushUndo();
      handle.setPointerCapture(e.pointerId);
      const rect = host.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top  + rect.height / 2;
      const onMove = (ev: PointerEvent): void => {
        const dx = ev.clientX - cx;
        const dy = ev.clientY - cy;
        const deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        const snapped = this._snapRotation(deg);
        el.rotation = snapped;
        host.style.transform = `rotate(${snapped}deg)`;
      };
      const onUp = (ev: PointerEvent): void => {
        try { handle.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup',     onUp);
        handle.removeEventListener('pointercancel', onUp);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup',     onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  /** v2.14.103 — Snap an image element's bounding box to the
   *  IMAGE's natural aspect at the current width. Undoes any
   *  stretch the GM did while the lock was off. Loads the asset
   *  to measure natural dimensions; SVG sources read viewBox,
   *  raster sources decode the blob into an Image to measure.
   *  Unicode-char assets have no measurable dimensions — skip. */
  private async _resetElementAspect(elementId: string): Promise<void> {
    const el = this.elements.find((x) => x.id === elementId);
    if (!el || el.type !== 'image') return;
    const { ImageAssetStore } = await import('../images/ImageAssetStore.ts');
    const asset = await ImageAssetStore.get(el.assetId);
    if (!asset) return;

    let nw = 0;
    let nh = 0;
    if (asset.svgSource) {
      // Pull the viewBox or width/height attributes from the SVG.
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/.exec(asset.svgSource);
      if (vb) {
        nw = parseFloat(vb[1]!);
        nh = parseFloat(vb[2]!);
      }
      if (!nw || !nh) {
        const w = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)/.exec(asset.svgSource);
        const h = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)/.exec(asset.svgSource);
        if (w && h) { nw = parseFloat(w[1]!); nh = parseFloat(h[1]!); }
      }
    }
    if ((!nw || !nh) && asset.blob) {
      const url = URL.createObjectURL(asset.blob);
      try {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => { nw = img.naturalWidth; nh = img.naturalHeight; resolve(); };
          img.onerror = () => resolve();
          img.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    if (!nw || !nh) return;

    this._pushUndo();
    // Element w/h are in % of page; the image aspect is in pixels.
    // Convert via the page's own pixel aspect so the rendered box
    // matches the image's natural shape at the current width.
    const imageAspect = nw / nh;
    const pageAspect = this.cfg.width / Math.max(1, this.cfg.height);
    el.h = el.w * pageAspect / imageAspect;
    clampElementGeometry(el);
    const host = this.elementNodes.get(elementId);
    if (host) this._applyGeometry(host, el);
  }

  /** v2.14.102 — Toggle the per-element aspect-ratio lock on an
   *  image element. Pushes undo + re-mounts the element so the
   *  lock button's icon + active state refresh. */
  private _toggleLockAspect(elementId: string): void {
    const el = this.elements.find((x) => x.id === elementId);
    if (!el || el.type !== 'image') return;
    this._pushUndo();
    el.lockAspect = !(el.lockAspect ?? true);
    // Re-mount so the lock button's SVG + active class swap. Cheap
    // — the only one element rebuilds, not the whole page.
    const host = this.elementNodes.get(elementId);
    if (host) {
      host.remove();
      this.elementNodes.delete(elementId);
    }
    this._mountElement(el);
    if (this.selectedId === elementId) this._select(elementId);
  }

  /** v2.14.101 — Toggle a flip flag + re-apply transform to the body. */
  private _toggleFlip(elementId: string, axis: 'h' | 'v'): void {
    const el = this.elements.find((x) => x.id === elementId);
    if (!el) return;
    this._pushUndo();
    if (axis === 'h') el.flipH = !el.flipH;
    else              el.flipV = !el.flipV;
    const host = this.elementNodes.get(elementId);
    if (host) this._applyGeometry(host, el);
    // Toggle the active state on the relevant button so the user
    // sees the active green chrome immediately without a full
    // re-mount.
    if (host) {
      const sel = axis === 'h' ? '.txt-map-el-flip--h' : '.txt-map-el-flip--v';
      const btn = host.querySelector<HTMLElement>(sel);
      btn?.classList.toggle('is-active', !!(axis === 'h' ? el.flipH : el.flipV));
    }
  }

  private _applyGeometry(host: HTMLElement, el: TextMapElement): void {
    host.style.left   = `${el.x}%`;
    host.style.top    = `${el.y}%`;
    host.style.width  = `${el.w}%`;
    host.style.height = `${el.h}%`;
    // v2.14.101 — rotation lives on the host so chrome rotates with
    // the element; flip stays on the body so chrome stays unmirrored.
    host.style.transform = el.rotation ? `rotate(${el.rotation}deg)` : '';
    host.style.transformOrigin = 'center center';
    // Apply flip to the inner body if mounted.
    const body = host.querySelector<HTMLElement>('.txt-map-el-body');
    if (body) {
      const sx = el.flipH ? -1 : 1;
      const sy = el.flipV ? -1 : 1;
      body.style.transform = (sx !== 1 || sy !== 1) ? `scale(${sx}, ${sy})` : '';
      body.style.transformOrigin = 'center center';
    }
  }

  private _applyTextStyle(body: HTMLElement, el: TextMapTextElement): void {
    if (el.fontFamily) body.style.fontFamily = `'${el.fontFamily}', serif`;
    else               body.style.fontFamily = '';
    if (el.fontScale)  body.style.fontSize   = `${el.fontScale * 100}%`;
    else               body.style.fontSize   = '';
    if (el.color)      body.style.color      = el.color;
    else               body.style.color      = '';
    if (el.textAlign)  body.style.textAlign  = el.textAlign;
    else               body.style.textAlign  = '';
  }

  private _select(id: string | null): void {
    // v2.14.104 — Don't early-return on the same id. When an element
    // re-mounts (e.g. _toggleLockAspect rebuilds the host so the
    // lock icon refreshes), the NEW DOM node has no --selected class.
    // Re-applying is safe + idempotent; the previous DOM node may
    // already be gone, in which case the remove is a no-op.
    if (this.selectedId && this.selectedId !== id) {
      const prev = this.elementNodes.get(this.selectedId);
      prev?.classList.remove('txt-map-el--selected');
    }
    this.selectedId = id;
    if (id) {
      const cur = this.elementNodes.get(id);
      cur?.classList.add('txt-map-el--selected');
    }
    this._renderElementToolbar();
  }

  /** Rebuild the per-element toolbar based on what's selected. The
   *  containing section ("Element Properties:") hides entirely when
   *  nothing is selected so the centre column collapses. Re-runs
   *  after every selection change AND after async font loads complete
   *  (so the font picker can fill in). */
  private _renderElementToolbar(): void {
    const tb = this.elementToolbarEl;
    const section = this.elementSectionEl;
    if (!tb || !section) return;
    tb.innerHTML = '';
    if (!this.selectedId) { section.hidden = true; return; }
    const el = this.elements.find((x) => x.id === this.selectedId);
    if (!el) { section.hidden = true; return; }
    section.hidden = false;

    if (el.type === 'text')  this._buildTextElementToolbar(tb, el);
    if (el.type === 'image') this._buildImageElementToolbar(tb, el);

    // Trailing controls — shared between text + image elements.
    this._buildElementCommonControls(tb, el);
  }

  /** Layering + animation-flag controls common to every element type.
   *  Appended after the per-type controls so the bar reads:
   *    Element Properties: [type-specific] | To Back | To Front | [✓] Don't animate */
  private _buildElementCommonControls(tb: HTMLElement, el: TextMapElement): void {
    // Subtle divider before the shared controls so the per-type group
    // visually separates from the universal ones.
    const sep = document.createElement('span');
    sep.className = 'txt-map-toolbar-sep';
    tb.appendChild(sep);

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'btn btn--ghost btn--sm';
    backBtn.textContent = 'To Back';
    backBtn.title = 'Send element behind everything else';
    backBtn.addEventListener('click', () => this._moveToBack(el.id));
    tb.appendChild(backBtn);

    const frontBtn = document.createElement('button');
    frontBtn.type = 'button';
    frontBtn.className = 'btn btn--ghost btn--sm';
    frontBtn.textContent = 'To Front';
    frontBtn.title = 'Bring element in front of everything else';
    frontBtn.addEventListener('click', () => this._moveToFront(el.id));
    tb.appendChild(frontBtn);

    // Don't animate — flag this element as part of the starting frame
    // of the reveal animation (it appears immediately, no transition).
    // Used by the rasteriser to split the handout into "before" and
    // "after" frames for the transition system.
    const animLabel = document.createElement('label');
    animLabel.className = 'txt-map-toolbar-checkbox';
    animLabel.title = 'When the handout reveal animation runs, this element shows immediately as part of the starting frame';
    const animCheck = document.createElement('input');
    animCheck.type = 'checkbox';
    animCheck.checked = el.noAnimate === true;
    animCheck.addEventListener('change', () => {
      el.noAnimate = animCheck.checked;
    });
    animLabel.append(animCheck, document.createTextNode(' Don\'t animate'));
    tb.appendChild(animLabel);
  }

  /** Move an element to the END of the elements array (paints on top).
   *  DOM follows the array via insertBefore / appendChild. */
  private _moveToFront(id: string): void {
    const idx = this.elements.findIndex((e) => e.id === id);
    if (idx < 0 || idx === this.elements.length - 1) return;
    const removed = this.elements.splice(idx, 1)[0];
    if (!removed) return;
    this.elements.push(removed);
    const node = this.elementNodes.get(id);
    if (node && this.pageEl) this.pageEl.appendChild(node);
  }

  /** Move an element to the START of the elements array (paints behind
   *  everything else). */
  private _moveToBack(id: string): void {
    const idx = this.elements.findIndex((e) => e.id === id);
    if (idx <= 0) return;
    const removed = this.elements.splice(idx, 1)[0];
    if (!removed) return;
    this.elements.unshift(removed);
    const node = this.elementNodes.get(id);
    if (node && this.pageEl) this.pageEl.insertBefore(node, this.pageEl.firstChild);
  }

  private _buildTextElementToolbar(tb: HTMLElement, el: TextMapTextElement): void {
    // Label
    tb.appendChild(this._toolbarLabel('Text'));

    // Colour — defaults to page textColor when the element doesn't override.
    const colour = document.createElement('input');
    colour.type = 'color';
    colour.className = 'txt-map-color';
    colour.title = 'Text colour for this element';
    colour.value = el.color ?? this.cfg.textColor;
    // v2.14.100 — Snapshot BEFORE the user drags the colour picker.
    // pointerdown fires once at the start of interaction; input fires
    // many times as the picker drags; using pointerdown keeps the
    // undo stack at one entry per picker session.
    colour.addEventListener('pointerdown', () => this._pushUndo());
    colour.addEventListener('input', () => {
      el.color = colour.value;
      this._lastColorChosen = colour.value;
      const node = this.elementNodes.get(el.id);
      const body = node?.querySelector<HTMLElement>('.txt-map-el-body');
      if (body) this._applyTextStyle(body, el);
    });
    tb.appendChild(colour);

    // Font size — slider 0.5..4 multiplier on the page-level basePx.
    // No visible numeric readout (v2.12 sliders-are-feel rule); the
    // value rides in the tooltip for hover / screenshot use.
    tb.appendChild(this._toolbarLabel('Size'));
    const size = document.createElement('input');
    size.type = 'range';
    size.min = '0.5'; size.max = '4'; size.step = '0.1';
    size.value = String(el.fontScale ?? 1);
    size.className = 'txt-map-element-slider';
    size.addEventListener('pointerdown', () => this._pushUndo());
    size.addEventListener('input', () => {
      const v = parseFloat(size.value);
      el.fontScale = v;
      const node = this.elementNodes.get(el.id);
      const body = node?.querySelector<HTMLElement>('.txt-map-el-body');
      if (body) this._applyTextStyle(body, el);
    });
    wireSliderTooltip(size, 'Size');
    tb.appendChild(size);

    // Font family — pulls from the Image Library's font registry.
    // Each option is rendered in its OWN font so the user previews the
    // glyph shapes in the dropdown rather than guessing from family
    // names. The closed select also mirrors the picked font.
    tb.appendChild(this._toolbarLabel('Font'));
    const fontSel = document.createElement('select');
    fontSel.className = 'txt-map-input';
    const currentFamily = el.fontFamily ?? this.cfg.fontFamily;
    fontSel.style.fontFamily = `'${currentFamily}', sans-serif`;
    // v2.12.4 — guarantee the saved font is one of the dropdown's
    // options even if it isn't in the library list right now (font
    // was removed, library not yet seeded, etc.). Without this the
    // dropdown silently snaps to its first option and the GM loses
    // track of what font the element is actually using.
    const fontList = (this.libraryFonts.length > 0 ? this.libraryFonts : BASE_FONTS).slice();
    if (currentFamily && !fontList.includes(currentFamily)) fontList.unshift(currentFamily);
    for (const f of fontList) {
      const o = document.createElement('option');
      o.value = f; o.textContent = f;
      o.style.fontFamily = `'${f}', sans-serif`;
      if (f === currentFamily) o.selected = true;
      fontSel.appendChild(o);
    }
    fontSel.addEventListener('change', () => {
      this._pushUndo();
      el.fontFamily = fontSel.value;
      this._lastFontChosen = fontSel.value;
      fontSel.style.fontFamily = `'${fontSel.value}', sans-serif`;
      const node = this.elementNodes.get(el.id);
      const body = node?.querySelector<HTMLElement>('.txt-map-el-body');
      if (body) this._applyTextStyle(body, el);
    });
    tb.appendChild(fontSel);

    // Bold / Italic / Underline buttons. The body is contentEditable
    // so CTRL-B / CTRL-I / CTRL-U already work via the browser; these
    // buttons are for discoverability and mouse-only workflows. Each
    // calls execCommand on the focused selection — if no selection,
    // toggles the typing state so the next characters typed get the
    // formatting.
    tb.appendChild(this._toolbarLabel('Style'));
    const styleWrap = document.createElement('div');
    styleWrap.className = 'txt-map-align-group';
    const styleBtn = (label: string, cmd: 'bold' | 'italic' | 'underline', italic = false): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--ghost btn--sm';
      btn.textContent = label;
      btn.title = `${cmd.charAt(0).toUpperCase()}${cmd.slice(1)} (Ctrl+${label.toUpperCase()})`;
      if (italic) btn.style.fontStyle = 'italic';
      if (cmd === 'bold')      btn.style.fontWeight    = '700';
      if (cmd === 'underline') btn.style.textDecoration = 'underline';
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); }); // keep contentEditable focused
      btn.addEventListener('click', () => {
        this._pushUndo();
        // Make sure the target body is focused (so execCommand acts
        // on the right contentEditable). The GM may have clicked the
        // button without first clicking into the body.
        const node = this.elementNodes.get(el.id);
        const body = node?.querySelector<HTMLElement>('.txt-map-el-body');
        if (body && document.activeElement !== body) body.focus();
        document.execCommand(cmd);
        // Persist the resulting HTML so it survives a reload.
        if (body) this._onTextInput(el.id, body);
      });
      return btn;
    };
    styleWrap.appendChild(styleBtn('B', 'bold'));
    styleWrap.appendChild(styleBtn('I', 'italic', true));
    styleWrap.appendChild(styleBtn('U', 'underline'));
    tb.appendChild(styleWrap);

    // Alignment
    tb.appendChild(this._toolbarLabel('Align'));
    const alignWrap = document.createElement('div');
    alignWrap.className = 'txt-map-align-group';
    for (const a of ['left', 'center', 'right', 'justify'] as const) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--ghost btn--sm';
      btn.textContent = a === 'left' ? '⯇' : a === 'center' ? '═' : a === 'right' ? '⯈' : '☰';
      btn.title = a.charAt(0).toUpperCase() + a.slice(1);
      if (el.textAlign === a) btn.classList.add('btn--active');
      btn.addEventListener('click', () => {
        this._pushUndo();
        el.textAlign = a;
        const node = this.elementNodes.get(el.id);
        const body = node?.querySelector<HTMLElement>('.txt-map-el-body');
        if (body) this._applyTextStyle(body, el);
        // Refresh button states.
        alignWrap.querySelectorAll('.btn--active').forEach((b) => b.classList.remove('btn--active'));
        btn.classList.add('btn--active');
      });
      alignWrap.appendChild(btn);
    }
    tb.appendChild(alignWrap);
  }

  private _buildImageElementToolbar(tb: HTMLElement, el: TextMapElement): void {
    if (el.type !== 'image') return;
    // Tint colour — applied to the host element's `color` so any inline
    // SVG inside (Lucide / game-icons) using currentColor takes this
    // colour. Has no visible effect on raster bitmaps; harmless to show
    // anyway. The rasteriser persists this via el.tint.
    tb.appendChild(this._toolbarLabel('Colour'));
    const colour = document.createElement('input');
    colour.type = 'color';
    colour.className = 'txt-map-color';
    colour.title = 'Tint colour for monochrome SVG icons (no effect on raster images)';
    colour.value = el.tint ?? this.cfg.textColor;
    colour.addEventListener('input', () => {
      el.tint = colour.value;
      const node = this.elementNodes.get(el.id);
      if (node) (node as HTMLElement).style.color = colour.value;
    });
    tb.appendChild(colour);
    const hint = document.createElement('span');
    hint.className = 'txt-map-element-hint';
    hint.textContent = 'Drag handle bar to move • corner to resize';
    tb.appendChild(hint);
  }

  private _toolbarLabel(text: string): HTMLElement {
    const l = document.createElement('span');
    l.className = 'txt-map-element-toolbar-label';
    l.textContent = text;
    return l;
  }

  private _editingActiveSelection(): boolean {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;
    return active.isContentEditable === true;
  }

  private _onTextInput(id: string, body: HTMLElement): void {
    const el = this.elements.find((e) => e.id === id) as TextMapTextElement | undefined;
    if (!el) return;
    el.html = body.innerHTML;
  }

  /** Pick a text element to copy font params off when creating a new
   *  one. Selected text wins (the GM has just been tuning it, so it
   *  IS the "current style"); otherwise the most recent text element
   *  on the page (the GM was last working on it). Returns null when
   *  the page has no text elements yet. */
  private _pickFontInheritanceSource(): TextMapTextElement | null {
    if (this.selectedId) {
      const sel = this.elements.find((e) => e.id === this.selectedId);
      if (sel && sel.type === 'text') return sel;
    }
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const e = this.elements[i];
      if (e && e.type === 'text') return e;
    }
    return null;
  }

  private _addNewText(): void {
    const el = newTextElement();
    // Inherit font parameters from the currently selected text
    // element, or fall back to the most recent text element on
    // this page. Lets the GM tap '+ Text' repeatedly to add boxes
    // that match the look they've already established without
    // re-picking on each one. When the page has no text elements
    // yet, fall through to the session-wide last-picked scalars
    // (carries picks made on a now-deleted element). Page defaults
    // apply when both miss. B/I/U live inline in `html` and can't
    // carry to an empty new element.
    const source = this._pickFontInheritanceSource();
    if (source) {
      if (source.fontFamily !== undefined) el.fontFamily = source.fontFamily;
      if (source.fontScale  !== undefined) el.fontScale  = source.fontScale;
      if (source.color      !== undefined) el.color      = source.color;
      if (source.textAlign  !== undefined) el.textAlign  = source.textAlign;
    } else {
      if (this._lastFontChosen)  el.fontFamily = this._lastFontChosen;
      if (this._lastColorChosen) el.color      = this._lastColorChosen;
    }
    this._pushUndo();
    this.elements.push(el);
    const node = this._mountElement(el);
    this._select(el.id);
    // Move caret into the new element so the user can just start typing.
    setTimeout(() => {
      const body = node.querySelector<HTMLElement>('.txt-map-el-body');
      if (body) {
        body.focus();
        const range = document.createRange();
        range.selectNodeContents(body);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }, 0);
  }

  private async _addNewImage(): Promise<void> {
    const modal = new ImageAssetModal();
    return new Promise<void>((resolve) => {
      let picked = false;
      void modal.open({
        initialCategoryId: SYSTEM_CATEGORY_IDS.textmap,
        pickMode: true,
        onPick: (asset) => {
          picked = true;
          const el = newImageElement(asset.id);
          this._pushUndo();
          this.elements.push(el);
          this._mountElement(el);
          this._select(el.id);
          resolve();
        },
      });
      const origClose = modal.close.bind(modal);
      modal.close = () => {
        origClose();
        if (!picked) resolve();
      };
    });
  }

  private _deleteSelected(): void {
    if (!this.selectedId) return;
    this._deleteElement(this.selectedId);
  }

  private _deleteElement(id: string): void {
    const idx = this.elements.findIndex((e) => e.id === id);
    if (idx < 0) return;
    this._pushUndo();
    this.elements.splice(idx, 1);
    const node = this.elementNodes.get(id);
    node?.remove();
    this.elementNodes.delete(id);
    if (this.selectedId === id) this.selectedId = null;
  }

  // ─── Drag / resize ──────────────────────────────────────────────────────

  private _startDrag(e: PointerEvent, id: string, mode: DragMode): void {
    if (!this.pageEl) return;
    e.preventDefault();
    e.stopPropagation();
    this._select(id);
    const el = this.elements.find((x) => x.id === id);
    if (!el) return;
    // v2.14.99 — snapshot BEFORE the move/resize so undo reverts
    // to the pre-drag geometry.
    this._pushUndo();
    const rect = this.pageEl.getBoundingClientRect();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const state: DragState = {
      elementId:    id,
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startGeom:    { x: el.x, y: el.y, w: el.w, h: el.h },
      pageWidthPx:  rect.width,
      pageHeightPx: rect.height,
      capture:      target,
      pointerId:    e.pointerId,
      onMove:       (ev) => this._onDragMove(ev),
      onUp:         (ev) => this._onDragEnd(ev),
    };
    this.dragState = state;
    target.addEventListener('pointermove', state.onMove);
    target.addEventListener('pointerup',   state.onUp);
    target.addEventListener('pointercancel', state.onUp);
  }

  private _onDragMove(ev: PointerEvent): void {
    const state = this.dragState;
    if (!state) return;
    const el = this.elements.find((x) => x.id === state.elementId);
    if (!el) return;
    const dxPct = ((ev.clientX - state.startClientX) / state.pageWidthPx)  * 100;
    const dyPct = ((ev.clientY - state.startClientY) / state.pageHeightPx) * 100;
    if (state.mode === 'move') {
      el.x = state.startGeom.x + dxPct;
      el.y = state.startGeom.y + dyPct;
    } else {
      let newW = state.startGeom.w + dxPct;
      let newH = state.startGeom.h + dyPct;
      // v2.14.102 — Image elements lock aspect ratio on resize by
      // default (matches the Composite Editor's lockAspect). The
      // dominant axis wins — whichever the cursor pulled further
      // from the start drives the other through the start aspect.
      // Text elements always free-resize; their content reflows.
      if (el.type === 'image' && (el.lockAspect ?? true)
          && state.startGeom.w > 0 && state.startGeom.h > 0) {
        const aspect = state.startGeom.w / state.startGeom.h;
        const wRel = Math.abs((newW - state.startGeom.w) / state.startGeom.w);
        const hRel = Math.abs((newH - state.startGeom.h) / state.startGeom.h);
        if (wRel >= hRel) {
          newH = newW / aspect;
        } else {
          newW = newH * aspect;
        }
      }
      el.w = newW;
      el.h = newH;
    }
    clampElementGeometry(el);
    const node = this.elementNodes.get(state.elementId);
    if (node) this._applyGeometry(node, el);
  }

  private _onDragEnd(_ev: PointerEvent): void {
    this._abortDrag();
  }

  private _abortDrag(): void {
    const state = this.dragState;
    if (!state) return;
    try { state.capture.releasePointerCapture(state.pointerId); } catch { /* ignore */ }
    state.capture.removeEventListener('pointermove', state.onMove);
    state.capture.removeEventListener('pointerup',   state.onUp);
    state.capture.removeEventListener('pointercancel', state.onUp);
    this.dragState = null;
  }

  // ─── Save ───────────────────────────────────────────────────────────────

  private async _onSave(): Promise<void> {
    const name = this.name.trim() || 'New Handout';
    // Sanitise every text element's html before persistence.
    const elementsClean: TextMapElement[] = this.elements.map((e) => {
      if (e.type === 'text') {
        return { ...e, html: sanitizeSplashHtml(e.html ?? '') };
      }
      return { ...e };
    });
    const cfgToSave: TextMapConfig = {
      ...this.cfg,
      elements: elementsClean,
    };
    // Drop the legacy bodyHtml field now that we have proper elements —
    // exactOptionalPropertyTypes won't let us assign undefined, so the
    // delete is required.
    delete (cfgToSave as { bodyHtml?: string }).bodyHtml;
    const { pxW, pxH } = predictTextMapPixelDimensions(cfgToSave);
    const asset: MapAsset = {
      id:            this.existingAssetId ?? ('textmap-' + generateId()),
      filename:      name,
      source:        'text-map',
      locallyStored: true,
      imageWidth:    pxW,
      imageHeight:   pxH,
      noGrid:        true,
      textMap:       cfgToSave,
      addedAt:       this.existingAddedAt ?? Date.now(),
    };
    await MapAssetStore.save(asset);
    MapAssetStore.invalidateRuntimeCache(asset.id);
    this._resolve({ asset });
  }
}
