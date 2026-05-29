export interface PlayerVoiceMessage {
  id:           string;
  fromPlayerId: string;
  fromName:     string;
  fromColor:    string;
  /** Recipient — undefined = the GM; otherwise another player (copied to GM). */
  toPlayerId?:  string;
  toName?:      string;
  text:         string;
  at:           number;
  /** Reply suggestions pre-fetched from the LLM the moment this message
   *  arrived, if the assistant was configured. The reply box auto-renders
   *  them on open — by then they're usually already resolved. Errors are
   *  swallowed; the manual "Suggest replies" button still surfaces them. */
  suggestionsPromise?: Promise<string[]>;
}

export interface PlayerVoicePanelCallbacks {
  /** GM sends a reply to a player. */
  onReply: (toPlayerId: string, text: string) => void;
  /** Optional — generate AI reply suggestions for a message (Patch 5). Returns
   *  the suggestions to show as quick-fill chips. */
  onSuggest?: (msg: PlayerVoiceMessage) => Promise<string[]>;
}

/**
 * GM-side "Player Voice" panel (v2.17). Shows incoming player messages with a
 * red unread-count badge on its header, and lets the GM reply inline. The
 * reply box per message is the hook Patch 5 fills with LLM suggestions.
 */
export class PlayerVoicePanel {
  private listEl: HTMLElement | null;
  private badgeEl: HTMLElement | null;
  private cb: PlayerVoicePanelCallbacks;
  private messages: PlayerVoiceMessage[] = [];
  private unread = 0;

  constructor(cb: PlayerVoicePanelCallbacks) {
    this.cb = cb;
    this.listEl  = document.querySelector<HTMLElement>('#player-voice-list');
    this.badgeEl = document.querySelector<HTMLElement>('#player-voice-badge');
    // Clear the unread badge whenever the GM opens (or toggles) the panel.
    const title = document.querySelector<HTMLElement>('#player-voice-panel .panel-title');
    title?.addEventListener('click', () => { this.unread = 0; this._renderBadge(); });
    this._renderEmpty();
  }

  addMessage(msg: PlayerVoiceMessage): void {
    this.messages.push(msg);
    if (this._isCollapsed()) { this.unread++; this._renderBadge(); }
    this._appendRow(msg);
  }

  private _isCollapsed(): boolean {
    const title = document.querySelector<HTMLElement>('#player-voice-panel .panel-title');
    return title?.getAttribute('aria-expanded') === 'false';
  }

  private _renderBadge(): void {
    if (!this.badgeEl) return;
    this.badgeEl.textContent = String(this.unread);
    this.badgeEl.hidden = this.unread === 0;
  }

  private _renderEmpty(): void {
    if (!this.listEl || this.messages.length > 0) return;
    const empty = document.createElement('p');
    empty.className = 'players-empty';
    empty.id = 'player-voice-empty';
    empty.textContent = 'No messages yet. Players can right-click / long-press the map to message you or each other.';
    this.listEl.appendChild(empty);
  }

  private _appendRow(msg: PlayerVoiceMessage): void {
    if (!this.listEl) return;
    document.getElementById('player-voice-empty')?.remove();

    const row = document.createElement('div');
    row.className = 'pv-msg';

    const head = document.createElement('div');
    head.className = 'pv-msg-head';
    const from = document.createElement('span');
    from.className = 'pv-msg-from';
    from.style.color = msg.fromColor;
    from.textContent = msg.fromName;
    head.appendChild(from);
    if (msg.toPlayerId && msg.toName) {
      const to = document.createElement('span');
      to.className = 'pv-msg-to';
      to.textContent = `→ ${msg.toName}`;
      head.appendChild(to);
    }
    const time = document.createElement('span');
    time.className = 'pv-msg-time';
    time.textContent = new Date(msg.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    head.appendChild(time);
    row.appendChild(head);

    const text = document.createElement('div');
    text.className = 'pv-msg-text';
    text.textContent = msg.text;
    row.appendChild(text);

    // Reply affordance — toggles an inline reply box addressed to the sender.
    const replyBtn = document.createElement('button');
    replyBtn.type = 'button';
    replyBtn.className = 'btn btn--ghost btn--xs pv-msg-reply-btn';
    replyBtn.textContent = 'Reply';
    row.appendChild(replyBtn);

    const replyBox = document.createElement('div');
    replyBox.className = 'pv-reply-box';
    replyBox.hidden = true;

    const suggestions = document.createElement('div');
    suggestions.className = 'pv-reply-suggestions';
    replyBox.appendChild(suggestions);

    const replyInput = document.createElement('textarea');
    replyInput.className = 'pv-reply-input';
    replyInput.rows = 2;
    replyInput.placeholder = `Reply to ${msg.fromName}…`;
    replyBox.appendChild(replyInput);

    const replyActions = document.createElement('div');
    replyActions.className = 'pv-reply-actions';

    const renderChips = (opts: string[]): void => {
      suggestions.replaceChildren();
      for (const opt of opts) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'pv-suggestion';
        chip.textContent = opt;
        chip.title = 'Click to use; edit before sending if you like';
        chip.addEventListener('click', () => { replyInput.value = opt; replyInput.focus(); });
        suggestions.appendChild(chip);
      }
    };

    if (this.cb.onSuggest) {
      const suggestBtn = document.createElement('button');
      suggestBtn.type = 'button';
      suggestBtn.className = 'btn btn--ghost btn--xs';
      suggestBtn.textContent = 'Suggest replies';
      suggestBtn.addEventListener('click', async () => {
        suggestBtn.disabled = true;
        suggestBtn.textContent = 'Thinking…';
        try {
          const opts = (await this.cb.onSuggest?.(msg)) ?? [];
          renderChips(opts);
        } catch (err) {
          suggestions.textContent = `Suggestions unavailable: ${(err as Error).message}`;
        } finally {
          suggestBtn.disabled = false;
          suggestBtn.textContent = 'Suggest replies';
        }
      });
      replyActions.appendChild(suggestBtn);
    }

    /** Auto-render the pre-fetched suggestions once, the first time the reply
     *  box is opened. Silent on error — the manual button still surfaces it. */
    let autoAttached = false;
    const consumePrefetch = (): void => {
      if (autoAttached || !msg.suggestionsPromise) return;
      autoAttached = true;
      suggestions.textContent = 'Thinking…';
      suggestions.style.color = 'var(--text-secondary)';
      void msg.suggestionsPromise
        .then((opts) => { suggestions.style.color = ''; if (opts && opts.length > 0) renderChips(opts); else suggestions.replaceChildren(); })
        .catch(() => { suggestions.replaceChildren(); });
    };

    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'btn btn--primary btn--xs';
    sendBtn.textContent = 'Send';
    const doSend = () => {
      const text2 = replyInput.value.trim();
      if (!text2) return;
      this.cb.onReply(msg.fromPlayerId, text2);
      replyInput.value = '';
      replyBox.hidden = true;
    };
    sendBtn.addEventListener('click', doSend);
    replyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });
    replyActions.appendChild(sendBtn);
    replyBox.appendChild(replyActions);
    row.appendChild(replyBox);

    replyBtn.addEventListener('click', () => {
      replyBox.hidden = !replyBox.hidden;
      if (!replyBox.hidden) { replyInput.focus(); consumePrefetch(); }
    });

    this.listEl.appendChild(row);
    this.listEl.scrollTop = this.listEl.scrollHeight;
  }
}
