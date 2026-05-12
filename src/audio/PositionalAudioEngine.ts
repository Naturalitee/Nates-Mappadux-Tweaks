import type { Marker } from '../types.ts';

interface Source {
  node:       AudioBufferSourceNode | null; // null = between random plays
  gain:       GainNode;
  assetId:    string;
  x:          number;
  y:          number;
  maxDist:    number;
  volume:     number;
  loop:       boolean;
  random:     boolean;
  randomFreq: number;
  randomTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Positional audio engine for marker-based audio sources.
 *
 * Behaves like the soundboard engine (loop / random / one-shot) but multiplies
 * gain by an inverse-square distance attenuation based on a listener marker.
 *
 * Coordinate system: normalised map coords (0–1 on each axis).
 * Gain formula:
 *   refDistance = maxDistance * 0.1  (full volume within 10% of range)
 *   positionalGain = clamp(refDist² / dist², 0, 1)
 *   finalGain = baseVolume * positionalGain
 */
export class PositionalAudioEngine {
  private ctx:        AudioContext | null = null;
  private sources     = new Map<string, Source>();    // markerId → Source
  private buffers     = new Map<string, AudioBuffer>(); // assetId → decoded buffer
  private listenerX   = 0.5;
  private listenerY   = 0.5;
  private hasListener = false;
  private _muteAll    = false;

  /** Fired when a source starts playing (or a random one-shot fires).
   *  GMApp uses this to broadcast positional_play to players. */
  onSourceStart?: (markerId: string, assetId: string, loop: boolean, gain: number) => void;
  /** Fired when a source is explicitly removed.
   *  GMApp uses this to broadcast positional_stop to players. */
  onSourceStop?: (markerId: string) => void;

  // ── Buffer management ────────────────────────────────────────────────────

  async storeBuffer(assetId: string, raw: ArrayBuffer): Promise<void> {
    if (this.buffers.has(assetId)) return;
    try {
      const ctx = this._ctx();
      const buf = await ctx.decodeAudioData(raw.slice(0));
      this.buffers.set(assetId, buf);
    } catch (err) {
      console.error(`[PAE] decode failed assetId=${assetId}`, err);
    }
  }

  // ── State updates (called on every marker_update) ────────────────────────

  setListenerPosition(x: number, y: number): void {
    const wasListener = this.hasListener;
    this.listenerX   = x;
    this.listenerY   = y;
    this.hasListener = true;
    // Listener just appeared — notify GMApp about sources that are already running
    if (!wasListener && this.onSourceStart) {
      for (const [id, src] of this.sources.entries()) {
        if (src.node !== null) {
          this.onSourceStart(id, src.assetId, src.loop, this._calcGain(src.x, src.y, src.maxDist, src.volume));
        }
      }
    }
    this._refreshGains();
  }

  clearListener(): void {
    this.hasListener = false;
    for (const src of this.sources.values()) src.gain.gain.value = 0;
  }

  /**
   * Reconcile the live source set with the current marker array.
   * Call this whenever marker_update arrives (after updating listener position).
   */
  setSources(markers: Marker[]): void {
    const wanted = new Map<string, Marker>(
      markers
        .filter((m) => m.roles.audio === 'source' && m.audioTrackId && !m.audioMuted)
        .map((m) => [m.id, m])
    );
    // Stop and remove sources that are no longer wanted
    for (const [id, src] of this.sources.entries()) {
      if (!wanted.has(id)) {
        this.onSourceStop?.(id);
        this._stopSource(src);
        this.sources.delete(id);
      }
    }

    // Start or update remaining/new sources
    for (const [id, marker] of wanted.entries()) {
      const existing = this.sources.get(id);
      const buf      = this.buffers.get(marker.audioTrackId!);
      const isRandom = !!(marker.audioRandom && !marker.audioLoop);

      if (!buf) continue; // buffer not yet received

      if (existing && existing.assetId === marker.audioTrackId) {
        // Same sound — check if playback mode has changed
        if (existing.loop !== marker.audioLoop || existing.random !== isRandom) {
          // Mode changed — restart with new settings
          this._stopSource(existing);
          this.sources.delete(id);
          this._startSource(id, marker, buf);
        } else {
          // Update mutable params in place
          existing.x          = marker.position.x;
          existing.y          = marker.position.y;
          existing.maxDist    = marker.audioMaxDistance;
          existing.volume     = marker.audioVolume ?? 1;
          existing.randomFreq = marker.audioRandomFreq ?? 10;
        }
      } else {
        // New sound or asset changed
        if (existing) { this._stopSource(existing); this.sources.delete(id); }
        this._startSource(id, marker, buf);
      }
    }

    this._refreshGains();
  }

  /**
   * Called when a new buffer arrives — start any sources that were waiting for it.
   */
  onBufferReady(assetId: string, markers: Marker[]): void {
    for (const m of markers) {
      if (
        m.roles.audio === 'source' &&
        m.audioTrackId === assetId &&
        !m.audioMuted &&
        !this.sources.has(m.id)
      ) {
        const buf = this.buffers.get(assetId);
        if (buf) this._startSource(m.id, m, buf);
      }
    }
    this._refreshGains();
  }

  /** Compute the current positional gain for a marker (used by GMApp for volume broadcasts). */
  calcGainForMarker(m: Marker): number {
    if (!this.hasListener) return 0;
    return this._calcGain(m.position.x, m.position.y, m.audioMaxDistance, m.audioVolume ?? 1);
  }

  /** Call on any user gesture to unblock the browser's autoplay policy. */
  tryResume(): void {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  dispose(): void {
    for (const src of this.sources.values()) this._stopSource(src);
    this.sources.clear();
    void this.ctx?.close();
    this.ctx = null;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private _ctx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private _startSource(markerId: string, marker: Marker, buf: AudioBuffer): void {
    const ctx  = this._ctx();
    const gain = ctx.createGain();
    gain.gain.value = 0; // _refreshGains sets real value
    gain.connect(ctx.destination);

    const isRandom = !!(marker.audioRandom && !marker.audioLoop);

    const src: Source = {
      node:       null,
      gain,
      assetId:    marker.audioTrackId!,
      x:          marker.position.x,
      y:          marker.position.y,
      maxDist:    marker.audioMaxDistance,
      volume:     marker.audioVolume ?? 1,
      loop:       marker.audioLoop,
      random:     isRandom,
      randomFreq: marker.audioRandomFreq ?? 10,
    };
    this.sources.set(markerId, src);

    if (isRandom) {
      this._scheduleRandom(markerId);
    } else {
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.loop   = marker.audioLoop;
      node.connect(gain);
      node.start();
      src.node = node;
      // Notify GMApp so it can broadcast positional_play to players
      if (this.hasListener) {
        this.onSourceStart?.(markerId, src.assetId, src.loop,
          this._calcGain(src.x, src.y, src.maxDist, src.volume));
      }
      // For non-looping one-shots: clean up when done
      if (!marker.audioLoop) {
        node.onended = () => { src.node = null; };
      }
    }
  }

  private _stopSource(src: Source): void {
    if (src.randomTimer !== undefined) clearTimeout(src.randomTimer);
    if (src.node) {
      try { src.node.stop(); } catch { /* already stopped */ }
      src.node.disconnect();
    }
    src.gain.disconnect();
  }

  private _scheduleRandom(markerId: string): void {
    const src = this.sources.get(markerId);
    if (!src || !src.random) return;
    const baseMs = (10 * 60 * 1000) / src.randomFreq;
    const delay  = Math.min(-Math.log(Math.random() || 1e-9) * baseMs, 4 * baseMs);
    src.randomTimer = setTimeout(() => this._triggerRandom(markerId), delay);
  }

  private _triggerRandom(markerId: string): void {
    const src = this.sources.get(markerId);
    if (!src || !src.random) return;
    const buf = this.buffers.get(src.assetId);
    if (!buf) { this._scheduleRandom(markerId); return; }

    const ctx  = this._ctx();
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.loop   = false;
    node.connect(src.gain);
    const gain2 = this._calcGain(src.x, src.y, src.maxDist, src.volume);
    src.gain.gain.value = this._muteAll ? 0 : gain2;
    node.start();
    src.node = node;
    // Notify GMApp so it can broadcast each random fire to players
    this.onSourceStart?.(markerId, src.assetId, false, gain2);
    node.onended = () => {
      src.node = null;
      this._scheduleRandom(markerId);
    };
  }

  /** Master mute for all positional sources — zeros every gain node so
   *  loops keep their playback position but produce no sound until
   *  unmuted, mirroring the soundboard's mute-all behaviour. */
  setMuteAll(muted: boolean): void {
    this._muteAll = muted;
    this._refreshGains();
  }
  isMutedAll(): boolean { return this._muteAll; }

  private _refreshGains(): void {
    if (!this.hasListener) return;
    for (const src of this.sources.values()) {
      if (src.node !== null) {
        src.gain.gain.value = this._muteAll
          ? 0
          : this._calcGain(src.x, src.y, src.maxDist, src.volume);
      }
    }
  }

  private _calcGain(sx: number, sy: number, maxDist: number, volume = 1): number {
    const dx   = sx - this.listenerX;
    const dy   = sy - this.listenerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= maxDist || maxDist <= 0) return 0;
    if (dist < 1e-6) return volume;
    const ref = maxDist * 0.1;
    return volume * Math.min(1, (ref * ref) / (dist * dist));
  }
}
