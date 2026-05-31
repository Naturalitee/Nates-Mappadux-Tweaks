/**
 * MessageThreadPanel — body builder for the per-player message thread
 * side panel. Renders the thread chronologically + a reply composer at
 * the bottom. Lives in the right-edge SidePanel framework (v2.16.35).
 *
 * v2.16.47 first cut: GM ↔ player only. Player ↔ player ambient stream
 * + LLM reply assistant come in patch 2.
 */

import type { ThreadMessage } from './MessageThreads.ts';

export interface MessageThreadPanelOptions {
  /** Messages to render (chronological — caller passes them already
   *  ordered from oldest to newest). */
  messages: ThreadMessage[];
  /** Timestamp the GM last marked the thread as "seen" (panel close).
   *  Messages with `at > lastSeenAt` render BOLD to mark them as new
   *  since the GM last looked. 0 = never opened. v2.16.49. */
  lastSeenAt: number;
  /** The player this thread belongs to — used in the empty-state hint
   *  and the composer placeholder. */
  toName: string;
  /** Send a GM reply text. The caller wires this to a broadcast. */
  onSend: (text: string) => void;
  /** Optional LLM reply-suggestions helper. When provided, the panel
   *  surfaces a "Suggest replies" button that fills chips above the
   *  composer for the GM to one-click + edit. */
  onSuggest?: () => Promise<string[]>;
  /** Pre-fetched suggestions for the most recent inbound message, if
   *  the assistant was configured at message-arrival time. Resolved
   *  before the panel opens, so chips appear instantly. */
  prefetchedSuggestions?: Promise<string[]>;
}

/** Populate a SidePanel body element with the thread view. */
export function buildMessageThreadPanel(body: HTMLElement, opts: MessageThreadPanelOptions): void {
  body.classList.add('mt-panel');

  // ─── Thread (chronological) ──────────────────────────────────────────────
  const thread = document.createElement('div');
  thread.className = 'mt-thread';
  if (opts.messages.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'mt-empty';
    empty.textContent = 'No messages yet. Type below to start.';
    thread.appendChild(empty);
  } else {
    for (const m of opts.messages) thread.appendChild(_buildBubble(m, m.at > opts.lastSeenAt));
  }
  body.appendChild(thread);

  // ─── Composer ────────────────────────────────────────────────────────────
  const composer = document.createElement('div');
  composer.className = 'mt-composer';

  // Suggestion chips slot (filled either from prefetched, or by the
  // Suggest button below).
  const chips = document.createElement('div');
  chips.className = 'mt-chips';
  composer.appendChild(chips);

  const input = document.createElement('textarea');
  input.className = 'mt-input';
  input.rows = 2;
  input.placeholder = `Reply to ${opts.toName}…`;
  composer.appendChild(input);

  const actions = document.createElement('div');
  actions.className = 'mt-actions';

  if (opts.onSuggest) {
    const suggestBtn = document.createElement('button');
    suggestBtn.type = 'button';
    suggestBtn.className = 'btn btn--ghost btn--xs';
    suggestBtn.textContent = 'Suggest replies';
    suggestBtn.addEventListener('click', async () => {
      suggestBtn.disabled = true;
      suggestBtn.textContent = 'Thinking…';
      try {
        const opts2 = (await opts.onSuggest?.()) ?? [];
        _renderChips(chips, opts2, input);
      } catch (err) {
        chips.textContent = `Suggestions unavailable: ${(err as Error).message}`;
      } finally {
        suggestBtn.disabled = false;
        suggestBtn.textContent = 'Suggest replies';
      }
    });
    actions.appendChild(suggestBtn);
  }

  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'btn btn--primary btn--xs';
  sendBtn.textContent = 'Send';
  const doSend = () => {
    const text = input.value.trim();
    if (!text) return;
    opts.onSend(text);
    input.value = '';
    chips.replaceChildren();
  };
  sendBtn.addEventListener('click', doSend);
  // Enter to send; Shift+Enter for newline.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });
  actions.appendChild(sendBtn);

  composer.appendChild(actions);
  body.appendChild(composer);

  // Resolve pre-fetched suggestions. v2.16.49 — show an animated "…"
  // placeholder while the LLM is still thinking so the GM knows
  // chips are on the way. Replaced by real chips when the promise
  // resolves; cleared if the request errors / returns nothing.
  if (opts.prefetchedSuggestions) {
    const waiting = document.createElement('span');
    waiting.className = 'mt-chips-waiting';
    waiting.title = 'LLM is thinking…';
    waiting.textContent = '…';
    chips.appendChild(waiting);
    void opts.prefetchedSuggestions.then((arr) => {
      if (arr.length > 0) _renderChips(chips, arr, input);
      else chips.replaceChildren();
    }).catch(() => chips.replaceChildren());
  }

  // Autoscroll thread to bottom on render.
  requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
  // Focus composer so a returning GM can just start typing.
  requestAnimationFrame(() => input.focus());
}

function _buildBubble(m: ThreadMessage, isNew: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mt-msg '
    + (m.fromKind === 'gm' ? 'mt-msg--gm' : 'mt-msg--player')
    + (isNew ? ' mt-msg--new' : '');

  const head = document.createElement('div');
  head.className = 'mt-msg-head';
  const from = document.createElement('span');
  from.className = 'mt-msg-from';
  from.style.color = m.fromColor;
  from.textContent = m.fromName;
  head.appendChild(from);
  if (m.toName && m.fromKind === 'player' && m.origin === 'peer-bound') {
    // v2.16.51 — arrow stays white + bright so the "→" reads as a clear
    // direction marker even at a glance; the recipient name renders bold
    // in their own identity colour so the GM spots "this wasn't for me"
    // immediately.
    const arrow = document.createElement('span');
    arrow.className = 'mt-msg-arrow';
    arrow.textContent = '→';
    head.appendChild(arrow);
    const to = document.createElement('span');
    to.className = 'mt-msg-to';
    if (m.toColor) to.style.color = m.toColor;
    to.textContent = m.toName;
    head.appendChild(to);
  }
  const time = document.createElement('span');
  time.className = 'mt-msg-time';
  time.textContent = new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  head.appendChild(time);
  row.appendChild(head);

  const text = document.createElement('div');
  text.className = 'mt-msg-text';
  text.textContent = m.text;
  row.appendChild(text);
  return row;
}

function _renderChips(host: HTMLElement, options: string[], input: HTMLTextAreaElement): void {
  host.replaceChildren();
  for (const opt of options) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mt-chip';
    chip.textContent = opt;
    chip.title = 'Click to use; edit before sending';
    chip.addEventListener('click', () => { input.value = opt; input.focus(); });
    host.appendChild(chip);
  }
}
