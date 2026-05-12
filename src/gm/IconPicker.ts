import { generateId } from '../utils/id.ts';
import { ImageAssetStore } from '../images/ImageAssetStore.ts';
import { renderLibIconFromAsset, LIB_ICON_PREFIX } from '../images/libIconRender.ts';
import { SYSTEM_CATEGORY_IDS, type ImageAsset } from '../types.ts';

const PRESET_ICONS = [
  '◆','◇','●','○','■','□','▲','△','▼','▽',
  '★','☆','✦','✧','❖','♦','♠','♥','♣','♟',
  '✚','✖','✗','✘','✓','✔','🔊',
  '①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩',
  '⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳',
];

/**
 * IconPicker — popover for selecting marker icons.
 *
 * Supports preset Unicode symbols and Small Asset Library entries (the
 * third first-class library introduced in v2.11). Library entries emit
 * 'libAsset:<id>' as the marker.icon value; tintable assets are bitmap-
 * baked with the marker's colour, raster assets render verbatim.
 *
 * The pre-v2.11 'asset:<uuid>' custom-icon store is no longer surfaced
 * in this picker — those records were migrated into the library under
 * "Uncategorised" by `migrateLegacyIconsIfNeeded`.
 */
export class IconPicker {
  private readonly _el: HTMLElement;
  private readonly _fileInput: HTMLInputElement;
  private _onSelect:     ((icon: string) => void) | null = null;
  private _currentIcon  = '◆';
  private _currentColor = '#e03e3e';
  readonly iconCache    = new Map<string, ImageBitmap>();
  /** data URLs keyed by their compound cache key — used when broadcasting markers over P2P */
  readonly iconDataUrls = new Map<string, string>();

  constructor() {
    this._el = document.createElement('div');
    this._el.className = 'icon-picker';
    this._el.hidden = true;
    document.body.appendChild(this._el);

    this._fileInput = document.createElement('input');
    this._fileInput.type = 'file';
    this._fileInput.accept = 'image/*';
    this._fileInput.hidden = true;
    document.body.appendChild(this._fileInput);

    this._bindClose();
    this._bindUpload();
  }

  /** Pre-warm the iconCache with raster library assets so first-render
   *  of saved markers doesn't fall back to a circle. Tintable assets are
   *  rendered lazily because they depend on per-marker colour. */
  async load(): Promise<void> {
    const all = await ImageAssetStore.getAll();
    await Promise.all(all.map(async (asset) => {
      if (asset.tintable) return; // colour-dependent — render on demand
      if (asset.source === 'unicode' || asset.source === 'font') return;
      const key = LIB_ICON_PREFIX + asset.id;
      if (this.iconCache.has(key)) return;
      const rendered = await renderLibIconFromAsset(asset, this._currentColor);
      if (!rendered) return;
      this.iconCache.set(rendered.key, rendered.bitmap);
      this.iconDataUrls.set(rendered.key, rendered.dataUrl);
    }));
  }

  /** Drop the in-memory cache and reload — call after the library is wiped. */
  async reload(): Promise<void> {
    this.iconCache.clear();
    this.iconDataUrls.clear();
    await this.load();
  }

  /** Open the picker anchored below `anchor`. `currentIcon` is highlighted;
   *  `currentColor` is used to tint tintable library previews. */
  open(
    anchor: HTMLElement,
    currentIcon: string,
    currentColor: string,
    onSelect: (icon: string) => void,
  ): void {
    this._onSelect     = onSelect;
    this._currentIcon  = currentIcon;
    this._currentColor = currentColor;
    void this._rebuild();
    const rect = anchor.getBoundingClientRect();
    this._el.style.left = `${Math.min(rect.left, window.innerWidth - 270)}px`;
    this._el.style.top  = `${rect.bottom + 4}px`;
    this._el.hidden = false;
  }

  close(): void {
    this._el.hidden = true;
    this._onSelect  = null;
  }

  private async _rebuild(): Promise<void> {
    this._el.innerHTML = '';

    // ── Preset section ──────────────────────────────────────────────────────
    this._appendSectionLabel('Preset');
    const presetGrid = this._makeGrid();
    for (const icon of PRESET_ICONS) {
      const btn = this._makeButton(icon === this._currentIcon);
      btn.textContent = icon;
      btn.addEventListener('click', () => {
        this._onSelect?.(icon);
        this.close();
      });
      presetGrid.appendChild(btn);
    }
    this._el.appendChild(presetGrid);

    // ── Small Asset Library section ─────────────────────────────────────────
    const [assets, categories] = await Promise.all([
      ImageAssetStore.getAll(),
      ImageAssetStore.getAllCategories(),
    ]);

    // Render library assets only — exclude unicode (already in Preset) and
    // font references (not usable as marker bitmaps).
    const renderable = assets.filter((a) => a.source !== 'unicode' && a.source !== 'font');

    if (renderable.length > 0) {
      this._appendSep();
      const libWrap = document.createElement('div');
      libWrap.className = 'icon-picker-scroll';
      this._el.appendChild(libWrap);

      // Group by category, in category sortOrder. Skip empty groups.
      for (const cat of categories) {
        const inCat = renderable.filter((a) => a.categoryId === cat.id);
        if (inCat.length === 0) continue;
        const label = document.createElement('div');
        label.className = 'icon-picker-section-label';
        label.textContent = cat.name;
        libWrap.appendChild(label);

        const grid = this._makeGrid();
        for (const asset of inCat) {
          grid.appendChild(this._makeLibAssetButton(asset));
        }
        libWrap.appendChild(grid);
      }
    }

    // ── Upload custom icon ──────────────────────────────────────────────────
    this._appendSep();
    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'icon-picker-upload';
    uploadBtn.textContent = '+ Upload custom icon';
    uploadBtn.addEventListener('click', () => this._fileInput.click());
    this._el.appendChild(uploadBtn);
  }

  private _makeLibAssetButton(asset: ImageAsset): HTMLButtonElement {
    const key = LIB_ICON_PREFIX + asset.id;
    const active = this._currentIcon === key;
    const btn = this._makeButton(active);
    btn.title = asset.name;

    const img = document.createElement('img');
    btn.appendChild(img);

    // Preview source: tintables get tinted with the current marker colour
    // so the picker visualises the on-canvas result; raster renders verbatim.
    if (asset.tintable && asset.svgSource) {
      void renderLibIconFromAsset(asset, this._currentColor).then((r) => {
        if (r) img.src = r.dataUrl;
      });
    } else if (asset.blob) {
      const url = URL.createObjectURL(asset.blob);
      img.src = url;
      img.onload = () => URL.revokeObjectURL(url);
    } else if (asset.svgSource) {
      img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(asset.svgSource);
    }

    btn.addEventListener('click', async () => {
      // Pre-warm the cache with a bitmap rendered at the current colour
      // so the marker canvas has something to draw immediately. The
      // GMApp markers_change handler also pre-renders, but doing it
      // here means the first render after the click is already correct
      // rather than briefly showing a fallback circle.
      const rendered = await renderLibIconFromAsset(asset, this._currentColor);
      if (rendered) {
        this.iconCache.set(rendered.key, rendered.bitmap);
        this.iconDataUrls.set(rendered.key, rendered.dataUrl);
      }
      this._onSelect?.(key);
      this.close();
    });
    return btn;
  }

  private _appendSectionLabel(text: string): void {
    const el = document.createElement('div');
    el.className = 'icon-picker-section-label';
    el.textContent = text;
    this._el.appendChild(el);
  }

  private _appendSep(): void {
    const sep = document.createElement('div');
    sep.className = 'icon-picker-sep';
    this._el.appendChild(sep);
  }

  private _makeGrid(): HTMLDivElement {
    const grid = document.createElement('div');
    grid.className = 'icon-picker-grid';
    return grid;
  }

  private _makeButton(active: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-picker-btn' + (active ? ' icon-picker-btn--active' : '');
    return btn;
  }

  private _bindClose(): void {
    document.addEventListener('pointerdown', (e) => {
      if (!this._el.hidden && !this._el.contains(e.target as Node)) {
        this.close();
      }
    }, { capture: true });
  }

  private _bindUpload(): void {
    this._fileInput.addEventListener('change', async () => {
      const file = this._fileInput.files?.[0];
      if (!file) return;
      this._fileInput.value = '';

      const blob = await this._resize(file, 64);
      const id   = generateId();
      const asset: ImageAsset = {
        id,
        name:       file.name,
        source:     'upload',
        categoryId: SYSTEM_CATEGORY_IDS.uncategorised,
        tintable:   false,
        blob,
        mimeType:   blob.type || 'image/png',
        addedAt:    Date.now(),
      };
      await ImageAssetStore.save(asset);

      const rendered = await renderLibIconFromAsset(asset, this._currentColor);
      const key = LIB_ICON_PREFIX + id;
      if (rendered) {
        this.iconCache.set(rendered.key, rendered.bitmap);
        this.iconDataUrls.set(rendered.key, rendered.dataUrl);
      }

      this._onSelect?.(key);
      this.close();
    });
  }

  private async _resize(file: File, size: number): Promise<Blob> {
    const bmp = await createImageBitmap(file);
    const cv  = document.createElement('canvas');
    cv.width  = size;
    cv.height = size;
    cv.getContext('2d')!.drawImage(bmp, 0, 0, size, size);
    bmp.close();
    return new Promise<Blob>((resolve) =>
      cv.toBlob((b) => resolve(b!), 'image/png')
    );
  }

  // Used by the marker icon button's tintability check — caller already has
  // the asset id; expose this so we don't duplicate the prefix logic.
  static stripPrefix(icon: string): string {
    return icon.startsWith(LIB_ICON_PREFIX) ? icon.slice(LIB_ICON_PREFIX.length) : icon;
  }
}
