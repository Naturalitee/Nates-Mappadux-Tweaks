import { PLAYER_COLOR_PALETTE, isReservedColor, normaliseHex } from '../players/playerColors.ts';

export interface PlayerIdentity {
  playerName:    string;
  characterName: string;
  color:         string;
}

/**
 * Player-side "introduce yourself" modal (v2.17 Player Voice).
 *
 * Collects the player's name, character name, and identity colour on first
 * connect, and is reopenable from the player view so they can retake their
 * identity on reconnection. Black / near-black is rejected (GM/threat
 * reserved). Resolves with the chosen identity, or null on cancel.
 *
 * Mirrors the PasswordPromptDialog DOM/teardown convention.
 */
export class PlayerIdentifyModal {
  private overlay: HTMLElement | null = null;
  private resolver: ((value: PlayerIdentity | null) => void) | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this._resolve(null);
  };

  open(current?: Partial<PlayerIdentity>, opts?: { onForget?: () => void }): Promise<PlayerIdentity | null> {
    this.overlay = this._build(current ?? {}, opts);
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  private _resolve(value: PlayerIdentity | null): void {
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this.onKey);
    this.resolver?.(value);
    this.resolver = null;
  }

  private _build(current: Partial<PlayerIdentity>, opts?: { onForget?: () => void }): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog modal-dialog--sm';
    overlay.appendChild(dialog);

    // Adapt copy to whether this is a fresh introduction or an edit pass.
    const isUpdating = !!(current.playerName || current.characterName || current.color);

    // Header
    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = isUpdating ? 'Update your details' : 'Introduce yourself';
    header.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'modal-close';
    close.textContent = '×';
    close.addEventListener('click', () => this._resolve(null));
    header.appendChild(close);
    dialog.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.style.padding = 'var(--space-md)';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = 'var(--space-md)';
    dialog.appendChild(body);

    const intro = document.createElement('p');
    intro.style.color = 'var(--text-secondary)';
    intro.style.margin = '0';
    intro.style.fontSize = 'var(--font-size-sm)';
    intro.textContent = 'Tell the GM who you are. You can change this any time.';
    body.appendChild(intro);

    const mkField = (labelText: string, placeholder: string, value: string): HTMLInputElement => {
      const label = document.createElement('label');
      label.style.display = 'flex';
      label.style.flexDirection = 'column';
      label.style.gap = '4px';
      label.style.fontSize = 'var(--font-size-sm)';
      label.style.color = 'var(--text-secondary)';
      label.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'select-full';
      input.placeholder = placeholder;
      input.value = value;
      input.autocomplete = 'off';
      label.appendChild(input);
      body.appendChild(label);
      return input;
    };

    const nameInput = mkField('Your name', 'e.g. Alex', current.playerName ?? '');
    const charInput = mkField('Character name', 'e.g. Thorin', current.characterName ?? '');
    setTimeout(() => nameInput.focus(), 0);

    // Colour picker
    let selected = current.color && !isReservedColor(current.color)
      ? normaliseHex(current.color)
      : PLAYER_COLOR_PALETTE[0]!;

    // "Your colour" label row with the live preview disc to its right — shows
    // exactly what your token / chat chip / initiative card will look like.
    const colourRow = document.createElement('div');
    colourRow.style.display = 'flex';
    colourRow.style.alignItems = 'center';
    colourRow.style.gap = 'var(--space-md)';
    const colourLabel = document.createElement('span');
    colourLabel.style.fontSize = 'var(--font-size-sm)';
    colourLabel.style.color = 'var(--text-secondary)';
    colourLabel.textContent = 'Your colour';
    colourRow.appendChild(colourLabel);
    const preview = document.createElement('div');
    preview.className = 'modal-identity-preview';
    colourRow.appendChild(preview);
    body.appendChild(colourRow);

    const swatches = document.createElement('div');
    swatches.className = 'player-colour-swatches';
    body.appendChild(swatches);

    // Hidden native colour input — clicked by the "+" swatch at the end of the grid.
    const customInput = document.createElement('input');
    customInput.type = 'color';
    customInput.style.position = 'absolute';
    customInput.style.left = '-9999px';
    customInput.style.opacity = '0';
    body.appendChild(customInput);

    const refreshPreview = () => {
      preview.style.background = selected;
      preview.style.borderColor = selected;
      const initial = ((charInput.value.trim() || nameInput.value.trim() || '?')[0] ?? '?').toUpperCase();
      preview.textContent = initial;
    };
    const refreshSelection = () => {
      for (const el of Array.from(swatches.children)) {
        const sw = el as HTMLElement;
        sw.classList.toggle('is-selected', normaliseHex(sw.dataset['colour'] ?? '') === selected);
      }
      customInput.value = selected;
      refreshPreview();
    };

    for (const colour of PLAYER_COLOR_PALETTE) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'player-colour-swatch';
      sw.dataset['colour'] = colour;
      sw.style.background = colour;
      sw.title = colour;
      sw.addEventListener('click', () => { selected = normaliseHex(colour); refreshSelection(); err.textContent = ''; });
      swatches.appendChild(sw);
    }

    // Custom swatch — "+" tile at the end of the grid opens the native picker.
    const customSwatch = document.createElement('button');
    customSwatch.type = 'button';
    customSwatch.className = 'player-colour-swatch player-colour-swatch--custom';
    customSwatch.title = 'Pick a custom colour';
    customSwatch.setAttribute('aria-label', 'Pick a custom colour');
    customSwatch.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    customSwatch.addEventListener('click', () => customInput.click());
    swatches.appendChild(customSwatch);

    customInput.addEventListener('input', () => {
      if (isReservedColor(customInput.value)) {
        err.textContent = 'That colour is too dark — it is reserved for the GM. Pick a brighter one.';
        return;
      }
      selected = normaliseHex(customInput.value);
      refreshSelection();
      err.textContent = '';
    });

    const err = document.createElement('p');
    err.style.color = '#ff8a8a';
    err.style.fontSize = 'var(--font-size-sm)';
    err.style.margin = '0';
    err.style.minHeight = '1.2em';
    body.appendChild(err);

    // Live preview reflects the names too, so the player sees their initial
    // appear as soon as they type.
    nameInput.addEventListener('input', refreshPreview);
    charInput.addEventListener('input', refreshPreview);
    refreshSelection();

    // Footer
    const footer = document.createElement('div');
    footer.style.padding = 'var(--space-md)';
    footer.style.borderTop = '1px solid var(--border)';
    footer.style.display = 'flex';
    footer.style.alignItems = 'center';
    footer.style.gap = 'var(--space-sm)';

    // Forget-me — wipes local state + asks the GM to drop the registry record.
    // Left-aligned + danger styling so it doesn't get confused with Save/Cancel.
    if (opts?.onForget) {
      const forgetBtn = document.createElement('button');
      forgetBtn.type = 'button';
      forgetBtn.className = 'btn btn--ghost';
      forgetBtn.style.color = 'var(--danger)';
      forgetBtn.textContent = 'Forget me';
      forgetBtn.title = 'Clear your saved identity on this device AND ask the GM to remove your record. Useful for testing a clean connect.';
      forgetBtn.addEventListener('click', () => {
        if (!confirm('Wipe your identity here and ask the GM to remove your record? The page will reload.')) return;
        opts.onForget?.();
        this._resolve(null);
      });
      footer.appendChild(forgetBtn);
    }
    // Spacer pushes Save / Cancel to the right.
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    footer.appendChild(spacer);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn--ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this._resolve(null));

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn--primary';
    saveBtn.textContent = isUpdating ? 'Save' : 'Join';

    const submit = () => {
      const playerName = nameInput.value.trim();
      const characterName = charInput.value.trim();
      if (!playerName && !characterName) {
        err.textContent = 'Enter at least a name or a character name.';
        return;
      }
      if (isReservedColor(selected)) {
        err.textContent = 'Pick a brighter colour — that one is reserved for the GM.';
        return;
      }
      this._resolve({ playerName, characterName, color: normaliseHex(selected) });
    };

    saveBtn.addEventListener('click', submit);
    charInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); charInput.focus(); } });

    footer.append(cancelBtn, saveBtn);
    dialog.appendChild(footer);
    // (Footer DOM order is: forget (left) | spacer | cancel | save — handled
    // by separate appends above so we don't disturb the keyboard handlers.)

    return overlay;
  }
}
