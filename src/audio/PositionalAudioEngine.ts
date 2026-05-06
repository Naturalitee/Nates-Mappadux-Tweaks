import type { Marker } from '../types.ts';

interface Source {
  node:    AudioBufferSourceNode;
  gain:    GainNode;
  assetId: string;
  x: number; y: number;
  maxDist: number;
}

/**
 * Positional audio engine for marker-based audio sources.
 *
 * Coordinate system: normalised map coords (0–1 on each axis).
 * Volume uses an inverse-square roll-off identical to the design plan:
 *   refDistance = maxDistance * 0.1  (full volume within 10% of range)
 *   gain = clamp(refDist² / dist², 0, 1)
 *
 * No stereo panning for now — pure volume attenuation only.
 */
export class PositionalAudioEngine {
  private ctx:         AudioContext | null = null;
  private sources      = new Map<string, Source>();   // markerId → Source
  private buffers      = new Map<string, AudioBuffer>(); // assetId  → decoded buffer
  private listenerX    = 0.5;
  private listenerY    = 0.5;
  private hasListener  = false;

  // ── Buffer management ────────────────────────────────────────────────────

  async storeBuffer(assetId: string, raw: ArrayBuffer): Promise<void> {
    if (this.buffers.has(assetId)) return;
    try {
      const ctx = this._ctx();
      const buf = await ctx.decodeAudioData(raw.slice(0)); // slice = defensive copy
      this.buffers.set(assetId, buf);
    } catch {
      // Corrupt or unsupported format — ignore silently
    }
  }

  // ── State updates (called on every marker_update) ────────────────────────

  setListenerPosition(x: number, y: number): void {
    this.listenerX   = x;
    this.listenerY   = y;
    this.hasListener = true;
    this._refreshGains();
  }

  clearListener(): void {
    this.hasListener = false;
    // Mute all sources until a listener is defined
    for (const src of this.sources.values()) src.gain.gain.value = 0;
  }

  /**
   * Reconcile the live source set with the current marker array.
   * Call this whenever marker_update arrives (after updating listener position).
   */
  setSources(markers: Marker[]): void {
    const wanted = new Map<string, Marker>(
      markers
        .filter((m) => m.role === 'audio_source' && m.audioTrackId && !m.audioMuted)
        .map((m) => [m.id, m])
    );

    // Stop and remove sources that are no longer wanted
    for (const [id, src] of this.sources.entries()) {
      if (!wanted.has(id)) {
        this._stopSource(src);
        this.sources.delete(id);
      }
    }

    // Start or update remaining/new sources
    for (const [id, marker] of wanted.entries()) {
      const existing = this.sources.get(id);
      const buf      = this.buffers.get(marker.audioTrackId!);

      if (!buf) continue; // audio not yet received — will start when buffer arrives

      if (existing && existing.assetId === marker.audioTrackId) {
        // Same sound — just update position and gain
        existing.x       = marker.position.x;
        existing.y       = marker.position.y;
        existing.maxDist = marker.audioMaxDistance;
      } else {
        // New sound or sound changed — stop old, start new
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
      if (m.role === 'audio_source' && m.audioTrackId === assetId && !this.sources.has(m.id)) {
        const buf = this.buffers.get(assetId);
        if (buf) this._startSource(m.id, m, buf);
      }
    }
    this._refreshGains();
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
    // Resume if suspended (browser autoplay policy)
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private _startSource(markerId: string, marker: Marker, buf: AudioBuffer): void {
    const ctx  = this._ctx();
    const gain = ctx.createGain();
    gain.gain.value = 0; // starts silent; _refreshGains sets the real value
    gain.connect(ctx.destination);

    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.loop   = marker.audioLoop;
    node.connect(gain);
    node.start();

    this.sources.set(markerId, {
      node, gain,
      assetId: marker.audioTrackId!,
      x:       marker.position.x,
      y:       marker.position.y,
      maxDist: marker.audioMaxDistance,
    });
  }

  private _stopSource(src: Source): void {
    try { src.node.stop(); } catch { /* already stopped */ }
    src.node.disconnect();
    src.gain.disconnect();
  }

  private _refreshGains(): void {
    if (!this.hasListener) return;
    for (const src of this.sources.values()) {
      src.gain.gain.value = this._calcGain(src.x, src.y, src.maxDist);
    }
  }

  private _calcGain(sx: number, sy: number, maxDist: number): number {
    const dx   = sx - this.listenerX;
    const dy   = sy - this.listenerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= maxDist || maxDist <= 0) return 0;
    if (dist < 1e-6) return 1;
    const ref = maxDist * 0.1;
    return Math.min(1, (ref * ref) / (dist * dist));
  }
}
