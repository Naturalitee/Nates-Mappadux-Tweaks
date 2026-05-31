/**
 * PlayerInitiativeRollModal (v2.17 Player Voice) — pops on the player view
 * when the GM hits "Call for Initiative". Player types their roll result and
 * the value goes back to the GM, who creates / updates their card on the rail.
 *
 * v2.16.54 — redesigned to feel like a card on the table rather than a
 * generic modal. A single oversized card-shaped panel materialises over a
 * dark backdrop with a deep red "INITIATIVE" overhead so the call lands
 * with the weight the spec asks for (§4.1 "atmospheric INITIATIVE alert
 * title card"). Player's identity colour edges the prompt card. Numeric
 * keypad-friendly: large input, big SEND button.
 */
export class PlayerInitiativeRollModal {
  private overlay: HTMLElement | null = null;
  private resolver: ((value: string | null) => void) | null = null;
  private onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this._resolve(null); };

  open(message?: string, playerColor?: string): Promise<string | null> {
    this._resolve(null); // close any prior open call so a fresh broadcast wins
    this.overlay = this._build(message, playerColor);
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

  private _build(message?: string, playerColor?: string): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'init-roll-overlay';

    const banner = document.createElement('div');
    banner.className = 'init-roll-banner';
    banner.textContent = 'INITIATIVE';
    overlay.appendChild(banner);

    const card = document.createElement('div');
    card.className = 'init-roll-card';
    if (playerColor) card.style.setProperty('--init-color', playerColor);
    overlay.appendChild(card);

    // Card-style edge tabs (top + bottom) mirroring the fanned-deck idiom.
    for (const side of ['top', 'bottom'] as const) {
      const tab = document.createElement('div');
      tab.className = `init-roll-card-tab init-roll-card-tab--${side}`;
      card.appendChild(tab);
    }

    const title = document.createElement('div');
    title.className = 'init-roll-title';
    title.textContent = 'Roll for Initiative';
    card.appendChild(title);

    if (message?.trim()) {
      const note = document.createElement('p');
      note.className = 'init-roll-note';
      note.textContent = message;
      card.appendChild(note);
    }

    const intro = document.createElement('p');
    intro.className = 'init-roll-intro';
    intro.textContent = 'Type your roll — a number, or whatever your system uses.';
    card.appendChild(intro);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'init-roll-input';
    input.placeholder = '—';
    input.autocomplete = 'off';
    input.inputMode = 'numeric';
    card.appendChild(input);
    setTimeout(() => input.focus(), 0);

    const actions = document.createElement('div');
    actions.className = 'init-roll-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'init-roll-skip';
    cancelBtn.textContent = 'Skip';
    cancelBtn.addEventListener('click', () => this._resolve(null));

    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'init-roll-send';
    sendBtn.textContent = 'Send';

    const submit = () => {
      const v = input.value.trim();
      if (!v) return;
      this._resolve(v);
    };
    sendBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

    actions.append(cancelBtn, sendBtn);
    card.appendChild(actions);

    return overlay;
  }
}
