import { WebAudioLoopPlayer } from './WebAudioLoopPlayer.ts';

/**
 * SoundboardEngine — GM-side audio playback.
 *
 * v2.16.50 — HYBRID engine:
 *   - One-shots (loop=false) go through `HTMLAudioElement` (lighter
 *     story for pew-pew retrigger; native `ended` event).
 *   - Loops (loop=true) go through a shared `WebAudioLoopPlayer`
 *     using `AudioBufferSourceNode` so MP3s loop GAPLESSLY (HTML5
 *     audio loops have a codec-padding gap on MP3 that the browser
 *     can't avoid).
 *
 * Slots can play/stop/loop independently with individual volumes.
 * Blobs are stored as object URLs and data URLs for P2P delivery.
 */
export class SoundboardEngine {
  private audioEls   = new Map<string, HTMLAudioElement>(); // slotId → <audio>
  private blobUrls   = new Map<string, string>();           // assetId → object URL
  private dataUrls   = new Map<string, string>();           // assetId → data URL
  private _muteAll   = false;
  /** Slots paused by setMuteAll(true) — used to resume the right ones on unmute. */
  private _pausedByMute = new Set<string>();
  /** v2.16.50 — gapless looping path. Engine routes loop=true plays
   *  through this player; one-shots stay on HTMLAudio. */
  private _loopPlayer = new WebAudioLoopPlayer();
  /** v2.16.50 — track which slots are currently on the loop player so
   *  stop/setVolume/setMuteAll routes to the right engine. */
  private _loopSlots  = new Set<string>();

  /** Fired when a non-looping slot finishes playing naturally. */
  onSlotEnded: ((slotId: string) => void) | null = null;

  prepareAsset(assetId: string, blobUrl: string, dataUrl: string): void {
    const old = this.blobUrls.get(assetId);
    if (old) URL.revokeObjectURL(old);
    this.blobUrls.set(assetId, blobUrl);
    this.dataUrls.set(assetId, dataUrl);
  }

  async play(slotId: string, assetId: string, loop: boolean, volume: number): Promise<void> {
    const blobUrl = this.blobUrls.get(assetId);
    if (!blobUrl) return;

    // v2.16.50 — route loops through the Web Audio path; one-shots
    // keep the HTMLAudio path so retrigger semantics + ended events
    // stay simple.
    if (loop) {
      // Make sure no HTMLAudio is also playing for this slot.
      const html = this.audioEls.get(slotId);
      if (html) { html.pause(); html.currentTime = 0; }
      this._loopSlots.add(slotId);
      await this._loopPlayer.play(
        slotId,
        assetId,
        async () => {
          const resp = await fetch(blobUrl);
          return resp.arrayBuffer();
        },
        volume,
      );
      this._loopPlayer.setMuted(this._muteAll);
      return;
    }

    // Non-loop / one-shot — clear any prior loop on this slot first.
    if (this._loopSlots.has(slotId)) {
      this._loopPlayer.stop(slotId);
      this._loopSlots.delete(slotId);
    }

    let el = this.audioEls.get(slotId);
    if (!el) {
      el = new Audio();
      this.audioEls.set(slotId, el);
    }

    if (el.src !== blobUrl) {
      el.pause();
      el.src = blobUrl;
    }

    // Always restart from the beginning — supports pew-pew retriggering
    el.currentTime = 0;
    el.loop        = false;
    el.volume      = Math.max(0, Math.min(1, volume));
    el.muted       = this._muteAll;

    // Wire ended callback so one-shot sounds reset the play button
    el.onended = () => { this.onSlotEnded?.(slotId); };

    return el.play().catch(() => { /* autoplay blocked — caller handles */ });
  }

  stop(slotId: string): void {
    // Stop whichever engine is hosting this slot. Loop slots tracked
    // in _loopSlots; one-shots live in audioEls.
    if (this._loopSlots.has(slotId)) {
      this._loopPlayer.stop(slotId);
      this._loopSlots.delete(slotId);
    }
    const el = this.audioEls.get(slotId);
    if (el) { el.pause(); el.currentTime = 0; }
  }

  stopAll(): void {
    this._loopPlayer.stopAll();
    this._loopSlots.clear();
    for (const slotId of this.audioEls.keys()) {
      const el = this.audioEls.get(slotId);
      if (el) { el.pause(); el.currentTime = 0; }
    }
  }

  setVolume(slotId: string, volume: number): void {
    if (this._loopSlots.has(slotId)) {
      this._loopPlayer.setVolume(slotId, volume);
      return;
    }
    const el = this.audioEls.get(slotId);
    if (el) el.volume = Math.max(0, Math.min(1, volume));
  }

  setLoop(slotId: string, loop: boolean): void {
    // v2.16.50 — toggling loop mid-play crosses engines; simplest
    // robust behaviour is to swap onto the right path and let the
    // caller restart playback to pick up the new mode. The existing
    // HTMLAudio loop=true path still works (with a gap) until next
    // explicit play() routes the slot through Web Audio.
    const el = this.audioEls.get(slotId);
    if (el) {
      el.loop = loop;
      el.onended = loop ? null : () => { this.onSlotEnded?.(slotId); };
    }
  }

  setMuteAll(muted: boolean): void {
    const wasMuted = this._muteAll;
    this._muteAll = muted;
    // v2.16.50 — silence any loop-engine slots via gain (keeps phase).
    this._loopPlayer.setMuted(muted);
    if (muted && !wasMuted) {
      // Snapshot which slots are currently playing so unmute can resume
      // exactly those — pausing freezes the playback position so looping
      // background tracks pick up where they left off.
      this._pausedByMute.clear();
      for (const [slotId, el] of this.audioEls.entries()) {
        if (!el.paused) {
          this._pausedByMute.add(slotId);
          el.pause();
        }
      }
    } else if (!muted && wasMuted) {
      // Clear el.muted on anything that was started during the mute
      // (play() copies this._muteAll onto the new element), then resume
      // the slots we paused so loops continue where they left off.
      for (const el of this.audioEls.values()) el.muted = false;
      for (const slotId of this._pausedByMute) {
        const el = this.audioEls.get(slotId);
        if (el) void el.play().catch(() => { /* autoplay blocked — caller handles */ });
      }
      this._pausedByMute.clear();
    }
  }

  isMutedAll(): boolean { return this._muteAll; }

  isPlaying(slotId: string): boolean {
    if (this._loopSlots.has(slotId)) return this._loopPlayer.isPlaying(slotId);
    const el = this.audioEls.get(slotId);
    return !!el && !el.paused;
  }

  isLoaded(assetId: string): boolean {
    return this.blobUrls.has(assetId);
  }

  /** 0–1 playback progress for a slot; -1 if not playing or duration unknown. */
  getProgress(slotId: string): number {
    // v2.16.50 — loop slots live on the Web Audio path; one-shots on
    // HTMLAudio. Route accordingly so the soundboard panel's slot
    // playhead works on both.
    if (this._loopSlots.has(slotId)) return this._loopPlayer.getProgress(slotId);
    const el = this.audioEls.get(slotId);
    if (!el || el.paused || !el.duration || isNaN(el.duration)) return -1;
    return el.currentTime / el.duration;
  }

  getDataUrl(assetId: string): string | undefined {
    return this.dataUrls.get(assetId);
  }

  unloadAsset(assetId: string): void {
    const blobUrl = this.blobUrls.get(assetId);
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      this.blobUrls.delete(assetId);
    }
    this.dataUrls.delete(assetId);
    // v2.16.50 — drop any cached decoded buffer too.
    this._loopPlayer.evictAsset(assetId);
  }

  dispose(): void {
    this.stopAll();
    for (const url of this.blobUrls.values()) URL.revokeObjectURL(url);
    this.blobUrls.clear();
    this.dataUrls.clear();
    this.audioEls.clear();
  }
}
