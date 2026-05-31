/**
 * MessageThreads — GM-side store for per-player message history + unread
 * counts. Replaces the v2.16.x PlayerVoicePanel store; the panel itself
 * is now a SidePanel opened by clicking a per-player badge on the
 * Players row.
 *
 * Two channels per thread (foreshadowing the v2.16.48 player↔player
 * patch — for now only the GM-bound stream is populated):
 *   - gmBound: messages addressed to the GM. Drive the RED unread badge.
 *   - peerBound: messages between this player and another player; the
 *     GM watches them ambiently. Drive the ORANGE unread badge.
 *
 * Each thread is per-playerId. The store fires `onChange` after any
 * mutation so subscribers (PlayersPanel re-render, open SidePanel
 * refresh) can update without each call site sequencing the call.
 */

export type MessageOrigin = 'gm-bound' | 'peer-bound';

export interface ThreadMessage {
  id:        string;
  fromKind:  'gm' | 'player';
  /** PlayerId of the sender, or null when fromKind === 'gm'. */
  fromPlayerId: string | null;
  fromName:  string;
  fromColor: string;
  /** Recipient PlayerId. For GM-bound: the GM (represented by null on the
   *  receiver-recipient axis but the thread is keyed by fromPlayerId).
   *  For peer-bound: the other player's id. */
  toPlayerId: string | null;
  toName?:   string;
  text:      string;
  at:        number;
  /** Pre-fetched LLM reply suggestions for GM-bound messages, if the
   *  assistant was configured at arrival time. */
  suggestionsPromise?: Promise<string[]>;
  /** Which channel the message belongs to, for badge accounting. */
  origin:    MessageOrigin;
}

interface Thread {
  messages: ThreadMessage[];
  unreadGm:   number;
  unreadPeer: number;
}

export class MessageThreads {
  private byPlayer = new Map<string, Thread>();
  private listeners: Array<() => void> = [];

  /** Subscribe to any-mutation notifications. Returns an unsubscribe fn. */
  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Append an inbound message from a player. Increments the matching
   *  unread counter unless the consumer claims the thread is already
   *  visible (`alreadyOpenPlayerId`). */
  addIncoming(playerId: string, msg: ThreadMessage, alreadyOpenPlayerId: string | null): void {
    const t = this._ensure(playerId);
    t.messages.push(msg);
    if (alreadyOpenPlayerId !== playerId) {
      if (msg.origin === 'gm-bound')   t.unreadGm   += 1;
      if (msg.origin === 'peer-bound') t.unreadPeer += 1;
    }
    this._fire();
  }

  /** Append an outgoing message FROM the GM TO this player. No unread
   *  bump (the GM authored it). */
  addOutgoing(playerId: string, msg: ThreadMessage): void {
    const t = this._ensure(playerId);
    t.messages.push(msg);
    this._fire();
  }

  /** Clear unread counters for a thread — typically when the GM opens
   *  the side panel for that player. */
  markRead(playerId: string): void {
    const t = this.byPlayer.get(playerId);
    if (!t) return;
    if (t.unreadGm === 0 && t.unreadPeer === 0) return;
    t.unreadGm   = 0;
    t.unreadPeer = 0;
    this._fire();
  }

  /** Read accessor — returns the thread's messages (copy) or [] if none. */
  messagesFor(playerId: string): ThreadMessage[] {
    return [...(this.byPlayer.get(playerId)?.messages ?? [])];
  }

  /** Unread counts — red (gm-bound) and orange (peer-bound). */
  unreadFor(playerId: string): { gm: number; peer: number } {
    const t = this.byPlayer.get(playerId);
    return { gm: t?.unreadGm ?? 0, peer: t?.unreadPeer ?? 0 };
  }

  /** Forget a thread entirely — e.g. when the GM removes a player. */
  drop(playerId: string): void {
    if (this.byPlayer.delete(playerId)) this._fire();
  }

  private _ensure(playerId: string): Thread {
    let t = this.byPlayer.get(playerId);
    if (!t) {
      t = { messages: [], unreadGm: 0, unreadPeer: 0 };
      this.byPlayer.set(playerId, t);
    }
    return t;
  }

  private _fire(): void {
    for (const fn of this.listeners) {
      try { fn(); } catch { /* listener bugs shouldn't kill the rest */ }
    }
  }
}
