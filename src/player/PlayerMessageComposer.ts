/**
 * PlayerMessageComposer (v2.17 Player Voice) — compact modal for a player to
 * type a message to the GM or another player. Mirrors the PasswordPromptDialog
 * DOM/teardown convention. Resolves with the typed text, or null on cancel.
 */
export class PlayerMessageComposer {
  private overlay: HTMLElement | null = null;
  private resolver: ((value: string | null) => void) | null = null;
  private onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this._resolve(null); };

  /** @param toLabel e.g. "the GM" or a player/character name. */
  open(toLabel: string): Promise<string | null> {
    this.overlay = this._build(toLabel);
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  private _resolve(value: string | null): void {
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this.onKey);
    this.resolver?.(value);
    this.resolver = null;
  }

  private _build(toLabel: string): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog modal-dialog--sm';
    overlay.appendChild(dialog);

    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = `Message ${toLabel}`;
    header.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'modal-close';
    close.textContent = '×';
    close.addEventListener('click', () => this._resolve(null));
    header.appendChild(close);
    dialog.appendChild(header);

    const body = document.createElement('div');
    body.style.padding = 'var(--space-md)';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = 'var(--space-sm)';
    dialog.appendChild(body);

    const textarea = document.createElement('textarea');
    textarea.className = 'player-message-input';
    textarea.rows = 3;
    textarea.placeholder = 'Type your message…';
    textarea.maxLength = 500;
    body.appendChild(textarea);
    setTimeout(() => textarea.focus(), 0);

    const hint = document.createElement('p');
    hint.style.margin = '0';
    hint.style.fontSize = 'var(--font-size-sm)';
    hint.style.color = 'var(--text-secondary)';
    hint.textContent = 'Enter to send · Shift+Enter for a new line';
    body.appendChild(hint);

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
    cancelBtn.addEventListener('click', () => this._resolve(null));

    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'btn btn--primary';
    sendBtn.textContent = 'Send';

    const submit = () => {
      const text = textarea.value.trim();
      if (text) this._resolve(text);
    };
    sendBtn.addEventListener('click', submit);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });

    footer.append(cancelBtn, sendBtn);
    dialog.appendChild(footer);

    return overlay;
  }
}
