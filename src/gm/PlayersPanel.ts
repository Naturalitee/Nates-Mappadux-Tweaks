import type { PersistentPlayer } from '../types.ts';
import { isReservedColor, pickDefaultPlayerColor } from '../players/playerColors.ts';

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

    // Colour swatch (native colour input)
    const colour = document.createElement('input');
    colour.type = 'color';
    colour.className = 'player-row-colour';
    colour.value = p.color;
    colour.title = 'Identity colour';
    colour.addEventListener('change', () => {
      if (isReservedColor(colour.value)) {
        colour.value = p.color; // revert — near-black is GM-reserved
        colour.classList.add('flash-invalid');
        setTimeout(() => colour.classList.remove('flash-invalid'), 600);
        return;
      }
      void this.cb.onUpdate(p.id, { color: colour.value });
    });
    row.appendChild(colour);

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
