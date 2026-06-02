/**
 * AudioCoordinator — same-browser mutual exclusion for audio output.
 *
 * Mappadux can have several tabs / windows open at once: the GM page, a
 * popped-out player preview, a projector, real player tabs on the same
 * machine, etc. When more than one of them has audio enabled the user
 * hears the same sounds two or three times over.
 *
 * This coordinator uses a shared BroadcastChannel (`dmr-audio-coord`) to
 * elect a single "active" window at a time:
 *
 *   - When a window has audio on (mute=off), it calls `claim()`. That
 *     broadcasts a claim and starts a periodic heartbeat.
 *   - Any other coordinator that receives the claim with a `at` timestamp
 *     later than its own stored claim moment force-mutes itself via the
 *     `onForceMute` callback the caller supplied. The latest claim wins.
 *   - When the active window mutes (user toggled, tab closed, etc.) it
 *     calls `release()` so heartbeats stop.
 *
 * Sticky semantics: force-muted windows do NOT auto-unmute when the
 * winner releases. The user re-enables explicitly. Auto-unmute would
 * make audio reappear unexpectedly long after the user looked away.
 *
 * Heartbeats every 3 s let new windows discover live active claims via a
 * `?audio-query` broadcast on their startup — the response is just the
 * next heartbeat tick, so timing-wise a fresh window sees the live
 * audio holder within one heartbeat period. v2.16.44.
 */

const CHANNEL_NAME  = 'dmr-audio-coord';
const HEARTBEAT_MS  = 3000;

interface AudioCoordMsg {
  type:     'audio-claim' | 'audio-release' | 'audio-heartbeat' | 'audio-query';
  clientId: string;
  at:       number;
}

export interface AudioCoordinatorOptions {
  /** Unique id for this window. Used to dedupe own broadcasts and to
   *  identify the winner. */
  clientId: string;
  /** Called when this window should mute itself because another window
   *  has claimed audio more recently. The callback is responsible for
   *  flipping the local audio state + UI; the coordinator itself just
   *  decides who should be silent. */
  onForceMute: () => void;
}

export class AudioCoordinator {
  private readonly channel: BroadcastChannel;
  private readonly clientId: string;
  private readonly onForceMute: () => void;
  private isActive   = false;
  private claimedAt  = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: AudioCoordinatorOptions) {
    this.channel     = new BroadcastChannel(CHANNEL_NAME);
    this.clientId    = opts.clientId;
    this.onForceMute = opts.onForceMute;
    this.channel.addEventListener('message', (e: MessageEvent<AudioCoordMsg>) => this._onMessage(e.data));
    // Probe for any existing audio owner so a fresh window can find
    // out who holds audio without waiting for the next heartbeat tick.
    // Any active coordinator out there will respond with a heartbeat.
    this._send('audio-query');
  }

  /** Mark this window as the audio owner. Other windows will force-mute. */
  claim(): void {
    this.claimedAt = Date.now();
    this.isActive  = true;
    this._send('audio-claim');
    if (this.heartbeatTimer === null) {
      this.heartbeatTimer = setInterval(() => {
        if (this.isActive) this._send('audio-heartbeat');
      }, HEARTBEAT_MS);
    }
  }

  /** Release audio ownership (user muted, tab closing, etc.). */
  release(): void {
    if (!this.isActive) return;
    this.isActive = false;
    this._send('audio-release');
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Tear down. Releases first so other windows know we're gone. */
  destroy(): void {
    this.release();
    this.channel.close();
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private _send(type: AudioCoordMsg['type']): void {
    try {
      this.channel.postMessage({ type, clientId: this.clientId, at: Date.now() });
    } catch { /* channel closed — ignore */ }
  }

  private _onMessage(msg: AudioCoordMsg): void {
    if (!msg || msg.clientId === this.clientId) return;

    if (msg.type === 'audio-query') {
      // Another window came online — if we're active, ping a heartbeat
      // so they see us immediately rather than waiting for the next tick.
      if (this.isActive) this._send('audio-heartbeat');
      return;
    }

    if (msg.type === 'audio-claim') {
      // Latest claim wins. If we were holding audio and the new claim
      // is newer than ours, mute ourselves.
      if (this.isActive && msg.at > this.claimedAt) {
        this.isActive = false;
        if (this.heartbeatTimer !== null) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = null;
        }
        // Do NOT broadcast 'audio-release' — we didn't release, the
        // other window asserted dominance. They expect to be the only
        // active holder; our release message would just be noise.
        this.onForceMute();
      }
      return;
    }

    // 'audio-heartbeat' / 'audio-release' — no action needed in the
    // minimal coordinator. (We could track other-active windows for
    // sticky-unmute heuristics later, but the v2.16.44 model is
    // "claim wins, others mute, no auto-unmute".)
  }
}
