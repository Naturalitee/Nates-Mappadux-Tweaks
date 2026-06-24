/**
 * Shown when a `?bundle=<url>` load can't be fetched directly because the host
 * doesn't allow cross-origin reads (CORS). A plain download isn't subject to
 * CORS, so we fall back to a two-step, gesture-driven flow: download the pack,
 * then load it through the normal file import. Both buttons are real user
 * clicks so the browser permits the download + the file picker.
 *
 * Resolves when the dialog closes (the actual load happens via the import
 * handler once the user picks the downloaded file).
 */
export class BundleUrlFallbackDialog {
  private overlay: HTMLElement | null = null;
  private resolver: (() => void) | null = null;
  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this._close();
  };

  /** @param onLoadFile invoked when the user clicks "Load the downloaded
   *  file" — wire this to the bundle import file-picker. */
  open(bundleUrl: string, filename: string, onLoadFile: () => void): Promise<void> {
    this.overlay = this._build(bundleUrl, filename, onLoadFile);
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  private _close(): void {
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this.onKey);
    this.resolver?.();
    this.resolver = null;
  }

  private _build(bundleUrl: string, filename: string, onLoadFile: () => void): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog modal-dialog--sm';
    overlay.appendChild(dialog);

    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = 'Load Map Pack from URL';
    header.appendChild(title);
    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'modal-close';
    closeX.textContent = '×';
    closeX.addEventListener('click', () => this._close());
    header.appendChild(closeX);
    dialog.appendChild(header);

    const body = document.createElement('div');
    body.style.padding = 'var(--space-md)';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = 'var(--space-sm)';

    const intro = document.createElement('p');
    intro.style.margin = '0';
    intro.style.color = 'var(--text-secondary)';
    intro.innerHTML =
      "This pack's host doesn't allow loading it directly in the browser " +
      '(a cross-origin / CORS restriction). You can still load it in two quick steps:';
    body.appendChild(intro);

    const step1 = document.createElement('p');
    step1.style.margin = '0';
    step1.innerHTML = '<strong>1.</strong> Download the pack to your computer:';
    body.appendChild(step1);

    // Real anchor → a genuine user click, so the browser performs the download
    // without CORS. (download= is ignored cross-origin, but the octet-stream
    // pack downloads anyway; filename falls back to the URL's.)
    const dl = document.createElement('a');
    dl.className = 'btn btn--primary';
    dl.href = bundleUrl;
    dl.download = filename;
    dl.rel = 'noopener';
    dl.textContent = 'Download pack';
    dl.style.alignSelf = 'flex-start';
    body.appendChild(dl);

    const step2 = document.createElement('p');
    step2.style.margin = 'var(--space-sm) 0 0';
    step2.innerHTML = '<strong>2.</strong> Once it has finished downloading, load it:';
    body.appendChild(step2);

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'btn btn--ghost';
    loadBtn.textContent = 'Load the downloaded file…';
    loadBtn.style.alignSelf = 'flex-start';
    loadBtn.addEventListener('click', () => { this._close(); onLoadFile(); });
    body.appendChild(loadBtn);

    const tip = document.createElement('p');
    tip.style.margin = 'var(--space-sm) 0 0';
    tip.style.color = 'var(--text-secondary)';
    tip.style.fontSize = '0.78rem';
    tip.innerHTML =
      'Tip: to load packs straight from a link, host them somewhere that allows ' +
      'cross-origin access over https — a GitHub <code>raw</code> URL works as-is.';
    body.appendChild(tip);

    dialog.appendChild(body);
    return overlay;
  }
}
