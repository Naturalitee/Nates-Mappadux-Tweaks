import type { PersistentPlayer, TokenSize } from '../types.ts';
import { isReservedColor, pickDefaultPlayerColor } from '../players/playerColors.ts';
import { TOKEN_SIZES, DEFAULT_TOKEN_SIZE } from '../players/playerToken.ts';

export interface PlayerRowInfo {
  connected:      boolean;
  /** Token placed on the active map. */
  placed:         boolean;
  /** A player moved their token; the GM can cancel it. */
  canCancelMove:  boolean;
}

export interface PlayersPanelCallbacks {
  onAddManaged: (playerName: string, characterName: string, color: string) => void | Promise<void>;
  onUpdate: (id: string, patch: Partial<Pick<PersistentPlayer, 'playerName' | 'characterName' | 'color'>>) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
  /** Place this player's token on the active map, or remove it if already placed. */
  onToggleMarker: (id: string) => void | Promise<void>;
  /** Send a player-moved token back to where it was. */
  onCancelMove: (id: string) => void | Promise<void>;
  /** Open the image-asset picker for this player's token icon. */
  onPickIcon: (id: string) => void | Promise<void>;
  /** Clear the picked icon — token falls back to the player's initial. */
  onClearIcon: (id: string) => void | Promise<void>;
  /** Change the token's footprint size — only honoured on calibrated maps. */
  onSetTokenSize: (id: string, size: TokenSize) => void | Promise<void>;
}

/**
 * GM-side "Players" roster panel (v2.17 Player Voice).
 *
 * Lists every persistent player — those who connected and self-identified, and
 * offline players the GM added by hand for table-mates without a device. Each
 * row is inline-editable (name, character, colour) and shows live connection
 * status. The GM owns the PlayerRegistry; this panel is a pure view + event
 * surface that re-renders whenever update() is called.
 */
export class PlayersPanel {
  private listEl: HTMLElement | null;
  private addBtn: HTMLButtonElement | null;
  private cb: PlayersPanelCallbacks;
  private lastPlayers: PersistentPlayer[] = [];

  constructor(cb: PlayersPanelCallbacks) {
    this.cb = cb;
    this.listEl = document.querySelector<HTMLElement>('#players-list');
    this.addBtn = document.querySelector<HTMLButtonElement>('#add-player-btn');
    this.addBtn?.addEventListener('click', () => {
      const used = this.lastPlayers.map((p) => p.color);
      void this.cb.onAddManaged('', '', pickDefaultPlayerColor(used));
    });
  }

  update(players: PersistentPlayer[], info: (id: string) => PlayerRowInfo): void {
    this.lastPlayers = players;
    if (!this.listEl) return;
    this.listEl.replaceChildren();

    if (players.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'players-empty';
      empty.textContent = 'No players yet. Players who scan the QR and introduce themselves appear here. Add offline table-mates with the button below.';
      this.listEl.appendChild(empty);
      return;
    }

    for (const p of players) {
      this.listEl.appendChild(this._row(p, info(p.id)));
    }
  }

  private _row(p: PersistentPlayer, info: PlayerRowInfo): HTMLElement {
    const connected = info.connected;
    const row = document.createElement('div');
    row.className = 'player-row';

    // Status dot
    const dot = document.createElement('span');
    dot.className = 'player-status-dot' + (connected ? ' is-online' : '');
    dot.title = p.managedByGm ? 'GM-managed (offline player)' : (connected ? 'Connected' : 'Disconnected');
    row.appendChild(dot);

    // Combined icon + colour control. The big icon button shows the picked
    // token icon (image / glyph / initial fallback); a small colour-input
    // badge attached to it edits the player's identity colour. Hover reveals
    // a clear-icon × when an icon is set.
    const iconWrap = document.createElement('div');
    iconWrap.className = 'player-row-icon-wrap';

    const iconBtn = document.createElement('button');
    iconBtn.type = 'button';
    iconBtn.className = 'player-row-icon';
    iconBtn.style.setProperty('--row-icon-color', p.color);
    iconBtn.title = p.iconAssetId ? 'Change token icon' : 'Pick a token icon';
    iconBtn.setAttribute('aria-label', 'Pick token icon');
    iconBtn.addEventListener('click', () => void this.cb.onPickIcon(p.id));
    if (p.iconDataUrl) {
      const img = document.createElement('img');
      img.src = p.iconDataUrl;
      img.alt = '';
      iconBtn.appendChild(img);
    } else if (p.iconChar) {
      iconBtn.textContent = p.iconChar;
      iconBtn.classList.add('player-row-icon--char');
    } else {
      iconBtn.classList.add('player-row-icon--empty');
      iconBtn.textContent = (p.characterName || p.playerName || '?').trim()[0]?.toUpperCase() ?? '?';
    }
    iconWrap.appendChild(iconBtn);

    // Colour badge — small <input type="color"> attached to the icon button.
    const colour = document.createElement('input');
    colour.type = 'color';
    colour.className = 'player-row-colour-badge';
    colour.value = p.color;
    colour.title = 'Identity colour';
    colour.setAttribute('aria-label', 'Identity colour');
    colour.addEventListener('change', () => {
      if (isReservedColor(colour.value)) {
        colour.value = p.color;
        colour.classList.add('flash-invalid');
        setTimeout(() => colour.classList.remove('flash-invalid'), 600);
        return;
      }
      void this.cb.onUpdate(p.id, { color: colour.value });
    });
    iconWrap.appendChild(colour);

    if (p.iconAssetId || p.iconDataUrl || p.iconChar) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'player-row-icon-clear';
      clear.title = 'Remove icon (token falls back to the player initial)';
      clear.setAttribute('aria-label', 'Remove icon');
      clear.textContent = '×';
      clear.addEventListener('click', () => void this.cb.onClearIcon(p.id));
      iconWrap.appendChild(clear);
    }
    row.appendChild(iconWrap);

    // Names (player + character), inline-editable
    const names = document.createElement('div');
    names.className = 'player-row-names';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'player-row-name';
    nameInput.placeholder = 'Player name';
    nameInput.value = p.playerName;
    nameInput.addEventListener('change', () => void this.cb.onUpdate(p.id, { playerName: nameInput.value.trim() }));

    const charInput = document.createElement('input');
    charInput.type = 'text';
    charInput.className = 'player-row-char';
    charInput.placeholder = 'Character';
    charInput.value = p.characterName;
    charInput.addEventListener('change', () => void this.cb.onUpdate(p.id, { characterName: charInput.value.trim() }));

    names.append(nameInput, charInput);
    row.appendChild(names);

    // Token footprint picker — only meaningful on calibrated maps. We always
    // show it because the same player might appear on calibrated and
    // uncalibrated maps in the same session.
    const sizeSel = document.createElement('select');
    sizeSel.className = 'player-row-tokensize';
    sizeSel.title = 'Token footprint in map squares (only applied on scaled maps)';
    sizeSel.setAttribute('aria-label', 'Token footprint size');
    for (const size of TOKEN_SIZES) {
      const opt = document.createElement('option');
      opt.value = size;
      opt.textContent = size;
      if ((p.tokenSize ?? DEFAULT_TOKEN_SIZE) === size) opt.selected = true;
      sizeSel.appendChild(opt);
    }
    sizeSel.addEventListener('change', () => void this.cb.onSetTokenSize(p.id, sizeSel.value as TokenSize));
    row.appendChild(sizeSel);

    // Cancel-move (shown only after a player moved their own token)
    if (info.canCancelMove) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'player-row-cancelmove';
      cancel.title = 'Cancel the player’s move — send their token back';
      cancel.setAttribute('aria-label', 'Cancel move');
      cancel.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>';
      cancel.addEventListener('click', () => void this.cb.onCancelMove(p.id));
      row.appendChild(cancel);
    }

    // Token place / remove on the active map
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'player-row-marker' + (info.placed ? ' is-placed' : '');
    marker.title = info.placed ? 'Remove this player’s token from the current map' : 'Place this player’s token on the current map';
    marker.setAttribute('aria-label', info.placed ? 'Remove token' : 'Place token');
    marker.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
    marker.addEventListener('click', () => void this.cb.onToggleMarker(p.id));
    row.appendChild(marker);

    // Delete
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'player-row-delete';
    del.title = 'Remove this player';
    del.setAttribute('aria-label', 'Remove player');
    del.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
    del.addEventListener('click', () => {
      const who = p.playerName || p.characterName || 'this player';
      if (confirm(`Remove ${who} from the roster? Their token will be removed from every map.`)) {
        void this.cb.onRemove(p.id);
      }
    });
    row.appendChild(del);

    return row;
  }
}
