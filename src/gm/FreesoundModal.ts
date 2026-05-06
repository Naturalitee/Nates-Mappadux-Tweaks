import type { AudioAsset } from '../types.ts';
import { FreesoundClient, type FreesoundResult } from '../audio/FreesoundClient.ts';
import { AudioAssetStore } from '../audio/AudioAssetStore.ts';

// Duration filter options shown in the dropdown
const DURATION_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: '≤ 10s',   value: 10  },
  { label: '≤ 20s',   value: 20  },
  { label: '≤ 30s',   value: 30  },
  { label: '≤ 60s',   value: 60  },
  { label: '≤ 120s',  value: 120 },
  { label: 'Any length', value: null },
];

type AssignCallback = (asset: AudioAsset) => void;

export class FreesoundModal {
  private el!:            HTMLElement;
  private previewEl:      HTMLAudioElement | null = null;
  private previewingUrl:  string | null = null;
  private onAssign:       AssignCallback;
  private selectedDuration: number | null = 30;
  private searchResults:  FreesoundResult[] = [];
  private uploadFile:     File | null = null;

  constructor(onAssign: AssignCallback) {
    this.onAssign = onAssign;
    this._buildDOM();
    this._bindEvents();
  }

  open(onAssign?: AssignCallback): void {
    if (onAssign) this.onAssign = onAssign;
    this.el.hidden = false;
    this._renderLibrary();
  }

  close(): void {
    this.el.hidden = true;
    this._stopPreview();
    this._clearUpload();
  }

  // ─── DOM construction ─────────────────────────────────────────────────────

  private _buildDOM(): void {
    const overlay = document.getElementById('freesound-modal')!;
    this.el = overlay;

    // Populate duration options
    const sel = this.el.querySelector<HTMLSelectElement>('#fs-duration-select')!;
    sel.innerHTML = '';
    for (const opt of DURATION_OPTIONS) {
      const o = document.createElement('option');
      o.value       = opt.value === null ? '' : String(opt.value);
      o.textContent = opt.label;
      if (opt.value === 30) o.selected = true;
      sel.appendChild(o);
    }

    // Seed API key if saved
    const keyInput = this.el.querySelector<HTMLInputElement>('#fs-api-key')!;
    const saved = FreesoundClient.getApiKey();
    if (saved) keyInput.value = saved;
  }

  private _bindEvents(): void {
    // Close
    this.el.querySelector('#modal-close-btn')?.addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });

    // Tab switching
    this.el.querySelectorAll('.modal-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.el.querySelectorAll('.modal-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const name = (tab as HTMLElement).dataset['tab']!;
        this.el.querySelectorAll<HTMLElement>('.tab-content').forEach((c) => {
          c.hidden = c.id !== `tab-${name}`;
        });
        if (name === 'library') this._renderLibrary();
      });
    });

    // Library search filter
    this.el.querySelector('#library-search')?.addEventListener('input', () => this._renderLibrary());

    // Freesound search
    this.el.querySelector('#fs-search-btn')?.addEventListener('click', () => void this._doSearch());
    this.el.querySelector<HTMLInputElement>('#fs-search-input')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') void this._doSearch();
    });

    // Duration select
    this.el.querySelector('#fs-duration-select')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      this.selectedDuration = v ? Number(v) : null;
    });

    // API key save
    this.el.querySelector('#fs-save-key-btn')?.addEventListener('click', () => {
      const val = this.el.querySelector<HTMLInputElement>('#fs-api-key')!.value.trim();
      if (val) {
        FreesoundClient.setApiKey(val);
        this._setSearchStatus('API key saved.');
      }
    });

    // Upload tab
    const dropZone  = this.el.querySelector<HTMLElement>('#upload-drop-zone')!;
    const fileInput = this.el.querySelector<HTMLInputElement>('#upload-file-input')!;

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('upload-drop-zone--over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('upload-drop-zone--over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('upload-drop-zone--over');
      const file = (e as DragEvent).dataTransfer?.files[0];
      if (file) this._handleUploadFile(file);
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) this._handleUploadFile(file);
    });

    this.el.querySelector('#upload-add-btn')?.addEventListener('click',   () => void this._addUpload());
    this.el.querySelector('#upload-clear-btn')?.addEventListener('click', () => this._clearUpload());
  }

  // ─── Library tab ──────────────────────────────────────────────────────────

  private async _renderLibrary(): Promise<void> {
    const listEl  = this.el.querySelector<HTMLElement>('#library-list')!;
    const emptyEl = this.el.querySelector<HTMLElement>('#library-empty')!;
    const filter  = (this.el.querySelector<HTMLInputElement>('#library-search')?.value ?? '').toLowerCase();

    const all = await AudioAssetStore.getAll();
    const filtered = filter ? all.filter((a) => a.name.toLowerCase().includes(filter)) : all;

    emptyEl.hidden = filtered.length > 0;
    listEl.innerHTML = '';

    for (const asset of filtered) {
      listEl.appendChild(this._libraryRow(asset));
    }
  }

  private _libraryRow(asset: AudioAsset): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sound-row';
    row.innerHTML = `
      <div class="sound-row-info">
        <span class="sound-name">${this._esc(asset.name)}</span>
        <span class="sound-meta">${this._esc(asset.license ?? asset.source)}</span>
      </div>
      <div class="sound-row-actions">
        <button class="btn btn--ghost btn--xs sound-preview-btn" data-url="">▶ Preview</button>
        <button class="btn btn--primary btn--xs sound-use-btn">Use</button>
        <button class="btn btn--danger btn--xs sound-del-btn" title="Remove from library">✕</button>
      </div>
    `;

    const previewBtn = row.querySelector<HTMLButtonElement>('.sound-preview-btn')!;
    const useBtn     = row.querySelector<HTMLButtonElement>('.sound-use-btn')!;
    const delBtn     = row.querySelector<HTMLButtonElement>('.sound-del-btn')!;

    previewBtn.addEventListener('click', async () => {
      const blob = await AudioAssetStore.getBlob(asset);
      if (!blob) { previewBtn.textContent = '⚠ Missing'; return; }
      const url = URL.createObjectURL(blob);
      this._previewAudio(url, previewBtn);
    });

    useBtn.addEventListener('click', () => {
      this.onAssign(asset);
      this.close();
    });

    delBtn.addEventListener('click', async () => {
      if (!confirm(`Remove "${asset.name}" from your library?`)) return;
      await AudioAssetStore.delete(asset.id);
      await this._renderLibrary();
    });

    return row;
  }

  // ─── Freesound search tab ─────────────────────────────────────────────────

  private async _doSearch(): Promise<void> {
    const query = this.el.querySelector<HTMLInputElement>('#fs-search-input')!.value.trim();
    if (!query) return;

    this._setSearchStatus('Searching…');
    const resultsEl = this.el.querySelector<HTMLElement>('#fs-results')!;
    resultsEl.innerHTML = '';

    try {
      this.searchResults = await FreesoundClient.search(query, this.selectedDuration);
      this._setSearchStatus('');
      if (this.searchResults.length === 0) {
        this._setSearchStatus('No results found.');
        return;
      }
      for (const r of this.searchResults) {
        resultsEl.appendChild(this._resultRow(r));
      }
    } catch (err) {
      this._setSearchStatus(`Error: ${(err as Error).message}`);
    }
  }

  private _resultRow(result: FreesoundResult): HTMLElement {
    const needsAttrib = !result.license.startsWith('CC0');
    const row = document.createElement('div');
    row.className = 'sound-row';
    row.innerHTML = `
      <div class="sound-row-info">
        <span class="sound-name">${this._esc(result.name)}</span>
        <span class="sound-meta">${this._esc(result.username)} · ${result.durationSecs}s ·
          <span class="sound-license ${needsAttrib ? 'sound-license--attrib' : ''}">${this._esc(result.license)}</span>
        </span>
        ${needsAttrib ? `<span class="sound-attrib-hint">Attribution required: "${this._esc(result.attribution)}"</span>` : ''}
      </div>
      <div class="sound-row-actions">
        <button class="btn btn--ghost btn--xs sound-preview-btn">▶ Preview</button>
        <button class="btn btn--primary btn--xs sound-import-btn">Import</button>
      </div>
    `;

    const previewBtn = row.querySelector<HTMLButtonElement>('.sound-preview-btn')!;
    const importBtn  = row.querySelector<HTMLButtonElement>('.sound-import-btn')!;

    previewBtn.addEventListener('click', () => {
      this._previewAudio(result.previewUrl, previewBtn);
    });

    importBtn.addEventListener('click', async () => {
      importBtn.disabled = true;
      importBtn.textContent = 'Importing…';
      try {
        const id   = crypto.randomUUID();
        const blob = await FreesoundClient.downloadPreview(result.previewUrl);
        const asset = FreesoundClient.resultToAsset(result, id);
        await AudioAssetStore.save(asset, blob);
        this.onAssign(asset);
        this.close();
      } catch (err) {
        importBtn.disabled = false;
        importBtn.textContent = 'Import';
        this._setSearchStatus(`Import failed: ${(err as Error).message}`);
      }
    });

    return row;
  }

  // ─── Audio preview ────────────────────────────────────────────────────────

  private _previewAudio(url: string, btn: HTMLButtonElement): void {
    if (this.previewingUrl === url) {
      this._stopPreview();
      btn.textContent = '▶ Preview';
      return;
    }
    this._stopPreview();

    this.previewEl = new Audio(url);
    this.previewEl.volume = 0.6;
    this.previewingUrl = url;
    btn.textContent = '⏹ Stop';

    this.previewEl.addEventListener('ended', () => {
      btn.textContent = '▶ Preview';
      this.previewingUrl = null;
    });

    void this.previewEl.play().catch(() => {
      btn.textContent = '▶ Preview';
    });
  }

  private _stopPreview(): void {
    if (this.previewEl) {
      this.previewEl.pause();
      this.previewEl = null;
    }
    this.previewingUrl = null;
    // Reset all preview buttons
    this.el.querySelectorAll('.sound-preview-btn').forEach((b) => {
      if ((b as HTMLButtonElement).textContent?.startsWith('⏹')) {
        (b as HTMLButtonElement).textContent = '▶ Preview';
      }
    });
  }

  private _setSearchStatus(msg: string): void {
    const el = this.el.querySelector<HTMLElement>('#fs-status');
    if (el) el.textContent = msg;
  }

  // ─── Upload tab ───────────────────────────────────────────────────────────

  private _handleUploadFile(file: File): void {
    this.uploadFile = file;
    const nameInput = this.el.querySelector<HTMLInputElement>('#upload-name-input')!;
    nameInput.value = file.name.replace(/\.[^.]+$/, ''); // strip extension
    this.el.querySelector<HTMLElement>('#upload-drop-zone')!.hidden  = true;
    this.el.querySelector<HTMLElement>('#upload-file-info')!.hidden = false;
  }

  private _clearUpload(): void {
    this.uploadFile = null;
    const fileInput = this.el.querySelector<HTMLInputElement>('#upload-file-input');
    if (fileInput) fileInput.value = '';
    const dropZone = this.el.querySelector<HTMLElement>('#upload-drop-zone');
    const fileInfo = this.el.querySelector<HTMLElement>('#upload-file-info');
    if (dropZone) dropZone.hidden = false;
    if (fileInfo) fileInfo.hidden  = true;
  }

  private async _addUpload(): Promise<void> {
    if (!this.uploadFile) return;
    const addBtn    = this.el.querySelector<HTMLButtonElement>('#upload-add-btn')!;
    const nameInput = this.el.querySelector<HTMLInputElement>('#upload-name-input')!;
    const name = nameInput.value.trim() || this.uploadFile.name.replace(/\.[^.]+$/, '');

    addBtn.disabled    = true;
    addBtn.textContent = 'Saving…';
    try {
      const asset: AudioAsset = {
        id:      crypto.randomUUID(),
        name,
        source:  'upload',
        license: 'Unknown / Manual import',
        addedAt: Date.now(),
      };
      await AudioAssetStore.save(asset, this.uploadFile);
      this.onAssign(asset);
      this.close();
    } catch {
      addBtn.disabled    = false;
      addBtn.textContent = 'Add to Library';
    }
  }

  private _esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
