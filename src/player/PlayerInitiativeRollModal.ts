/**
 * PlayerInitiativeRollModal (v2.17 Player Voice) — pops on the player view
 * when the GM hits "Call for Initiative". Player types their roll result and
 * the value goes back to the GM, who creates / updates their card on the rail.
 */
export class PlayerInitiativeRollModal {
  private overlay: HTMLElement | null = null;
  private resolver: ((value: string | null) => void) | null = null;
  private onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this._resolve(null); };

  open(message?: string): Promise<string | null> {
    this._resolve(null); // close any prior open call so a fresh broadcast wins
    this.overlay = this._build(message);
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

  private _build(message?: string): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog modal-dialog--sm';
    overlay.appendChild(dialog);

    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = 'Roll for Initiative';
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

    if (message?.trim()) {
      const note = document.createElement('p');
      note.style.margin = '0';
      note.style.fontSize = 'var(--font-size-sm)';
      note.style.color = 'var(--text-secondary)';
      note.textContent = message;
      body.appendChild(note);
    }
    const intro = document.createElement('p');
    intro.style.margin = '0';
    intro.style.fontSize = 'var(--font-size-sm)';
    intro.style.color = 'var(--text-secondary)';
    intro.textContent = 'Type the result you rolled (e.g. 18, or "Fast" — whatever fits your system).';
    body.appendChild(intro);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'select-full';
    input.placeholder = 'e.g. 18';
    input.autocomplete = 'off';
    body.appendChild(input);
    setTimeout(() => input.focus(), 0);

    const footer = document.createElement('div');
    footer.style.padding = 'var(--space-md)';
    footer.style.borderTop = '1px solid var(--border)';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = 'var(--space-sm)';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn--ghost';
    cancelBtn.textContent = 'Skip';
    cancelBtn.addEventListener('click', () => this._resolve(null));

    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'btn btn--primary';
    sendBtn.textContent = 'Send';

    const submit = () => {
      const v = input.value.trim();
      if (!v) return;
      this._resolve(v);
    };
    sendBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

    footer.append(cancelBtn, sendBtn);
    dialog.appendChild(footer);

    return overlay;
  }
}
