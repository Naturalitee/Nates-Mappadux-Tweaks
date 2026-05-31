/**
 * WebAudioLoopPlayer — gapless looping playback via the Web Audio API.
 *
 * `AudioBufferSourceNode` with `loop = true` is the ONLY HTML5 path that
 * guarantees seamless looping across every container/codec, including
 * MP3 (where HTMLAudioElement always inserts a small gap from codec
 * padding). Used as the "loop" half of the Soundboard's hybrid engine:
 * one-shots stay on HTMLAudioElement (lighter retrigger story); looping
 * slots flow through this player.
 *
 * Shared by the GM-side SoundboardEngine and the player-side soundboard
 * playback in PlayerApp so the GM and players hear identical loops.
 *
 * AudioContext lifecycle: lazily created on first use. Resumes on
 * `resume()` (call after a user gesture if the autoplay policy keeps it
 * suspended). The host page's existing autoplay handling covers this.
 *
 * Buffer cache: decoded AudioBuffers stay in memory keyed by an opaque
 * cache key (typically the assetId). `evictAsset(key)` frees the entry
 * if the asset is unloaded.
 *
 * Mute semantics: AudioBufferSourceNode can't be paused mid-stream
 * (only stopped, which loses position). We silence via the per-slot
 * GainNode and keep the source running — cheap, and the loop point
 * stays synchronised so adjacent mute/unmute events don't jump phase.
 *
 * v2.16.50.
 */

interface ActiveSlot {
  source:        AudioBufferSourceNode;
  gain:          GainNode;
  /** The volume the caller asked for. The actual gain.value applied is
   *  this number if not muted, 0 if muted. Tracked so unmute can
   *  restore the right level. */
  intendedVolume: number;
  cacheKey:      string;
  /** `ctx.currentTime` at `start(0)`. Used by `getProgress()` to compute
   *  the in-loop position. */
  startedAt:     number;
}

export class WebAudioLoopPlayer {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private slots   = new Map<string, ActiveSlot>();
  private _muted  = false;

  /** Lazily create / fetch the shared AudioContext. */
  private _getCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    return this.ctx;
  }

  /** Resume the AudioContext if suspended (autoplay policy). Safe to call
   *  repeatedly — already-running contexts no-op. */
  async resume(): Promise<void> {
    const ctx = this._getCtx();
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore — caller retries on user gesture */ }
    }
  }

  /** Start looping playback for a slot. Stops any prior playback on
   *  this slot first. `fetchBytes` runs only on a cache miss, so the
   *  decoded buffer is reused across re-plays of the same asset. */
  async play(
    slotId:     string,
    cacheKey:   string,
    fetchBytes: () => Promise<ArrayBuffer>,
    volume:     number,
  ): Promise<void> {
    this.stop(slotId);
    const ctx = this._getCtx();
    await this.resume();

    let buffer = this.buffers.get(cacheKey);
    if (!buffer) {
      try {
        const ab = await fetchBytes();
        // Some browsers reject the same ArrayBuffer if it's been
        // consumed by another decode. Slice to a fresh copy so we
        // never hit that.
        const copy = ab.slice(0);
        buffer = await ctx.decodeAudioData(copy);
        this.buffers.set(cacheKey, buffer);
      } catch (err) {
        console.warn('[web-audio-loop] decode failed; falling back to native loop', err);
        // Caller decides on fallback — return without starting.
        return;
      }
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = ctx.createGain();
    const vol = Math.max(0, Math.min(1, volume));
    gain.gain.value = this._muted ? 0 : vol;

    source.connect(gain).connect(ctx.destination);
    source.start(0);

    this.slots.set(slotId, {
      source, gain, intendedVolume: vol, cacheKey,
      startedAt: ctx.currentTime,
    });
  }

  /** Progress within the current loop cycle as 0..1. -1 if not playing
   *  or duration unknown. Useful for the GM's soundboard slot UI. */
  getProgress(slotId: string): number {
    const slot = this.slots.get(slotId);
    if (!slot || !this.ctx) return -1;
    const dur = slot.source.buffer?.duration ?? 0;
    if (dur <= 0) return -1;
    const elapsed = this.ctx.currentTime - slot.startedAt;
    return (elapsed % dur) / dur;
  }

  /** Stop and tear down a slot's playback. Idempotent. */
  stop(slotId: string): void {
    const slot = this.slots.get(slotId);
    if (!slot) return;
    try { slot.source.stop(); }       catch { /* ignore — already stopped */ }
    try { slot.source.disconnect(); } catch { /* ignore */ }
    try { slot.gain.disconnect();   } catch { /* ignore */ }
    this.slots.delete(slotId);
  }

  /** Stop every active slot. Useful on map change / global reset. */
  stopAll(): void {
    for (const slotId of [...this.slots.keys()]) this.stop(slotId);
  }

  /** Adjust per-slot volume. Honours the current mute state. */
  setVolume(slotId: string, volume: number): void {
    const slot = this.slots.get(slotId);
    if (!slot) return;
    const vol = Math.max(0, Math.min(1, volume));
    slot.intendedVolume = vol;
    slot.gain.gain.value = this._muted ? 0 : vol;
  }

  /** Master mute / unmute. Slots stay running silently when muted so
   *  the loop phase is preserved across mute toggles. */
  setMuted(muted: boolean): void {
    if (this._muted === muted) return;
    this._muted = muted;
    for (const slot of this.slots.values()) {
      slot.gain.gain.value = muted ? 0 : slot.intendedVolume;
    }
  }

  isPlaying(slotId: string): boolean { return this.slots.has(slotId); }

  /** Discard the cached AudioBuffer for an asset (e.g. on unload). */
  evictAsset(cacheKey: string): void { this.buffers.delete(cacheKey); }
}
