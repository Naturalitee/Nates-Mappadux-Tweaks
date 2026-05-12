import type { AudioAsset } from '../../types.ts';
import { PositionalAudioEngine } from '../../audio/PositionalAudioEngine.ts';
import { AudioAssetStore } from '../../audio/AudioAssetStore.ts';
import { blobToDataUrl } from '../../utils/blob.ts';
import type { MarkerInteraction, InteractionContext } from './MarkerInteraction.ts';

interface ActiveSource {
  loop:       boolean;
  lastVolume: number;
}

/**
 * Drives the positional audio engine from marker state.
 * Emitter:  marker.roles.audio === 'source'
 * Receiver: marker.roles.audio === 'listener' (singleton)
 *
 * Owns its own asset-buffer cache and active-source tracking; broadcasts
 * positional_play / positional_stop / positional_volume to connected players.
 */
export class PositionalAudioInteraction implements MarkerInteraction {
  readonly id = 'audio';
  private engine = new PositionalAudioEngine();
  /** assetId → cached dataUrl. Sent inside positional_play so players can decode without a separate fetch. */
  private assetDataUrls = new Map<string, string>();
  /** markerId → last-broadcast active state. Used to deduplicate volume updates as the listener moves. */
  private active = new Map<string, ActiveSource>();
  /** Captured from the most recent context — engine callbacks fire outside of notify cycles. */
  private broadcast: ((msg: any) => void) | null = null;

  constructor() {
    this.engine.onSourceStart = (markerId, assetId, loop, gain) => {
      const dataUrl = this.assetDataUrls.get(assetId);
      if (!dataUrl) return;
      this.active.set(markerId, { loop, lastVolume: gain });
      this.broadcast?.({ type: 'positional_play', markerId, assetId, loop, volume: gain, dataUrl });
    };
    this.engine.onSourceStop = (markerId) => {
      if (this.active.has(markerId)) {
        this.active.delete(markerId);
        this.broadcast?.({ type: 'positional_stop', markerId });
      }
    };
  }

  /** Resume the underlying audio context — wire to user-gesture listeners. */
  tryResume(): void {
    this.engine.tryResume();
  }

  /** Master mute for the local engine — GMApp handles broadcasting to
   *  players separately so the toggle works even before the first
   *  marker_update sets up the broadcast callback. */
  setMuteAll(muted: boolean): void {
    this.engine.setMuteAll(muted);
  }
  isMutedAll(): boolean { return this.engine.isMutedAll(); }

  onMarkersChanged(ctx: InteractionContext): void {
    this.broadcast = ctx.broadcast;
    const markers = ctx.markers;
    const listener = markers.find((m) => m.roles.audio === 'listener');

    if (!listener || listener.audioMuted) {
      // No audible listener — stop every active source on the players' side
      for (const markerId of this.active.keys()) {
        ctx.broadcast({ type: 'positional_stop', markerId });
      }
      this.active.clear();
      this.engine.clearListener();
    } else {
      this.engine.setListenerPosition(listener.position.x, listener.position.y);
    }

    this.engine.setSources(markers);

    // For currently-looping sources, broadcast a volume tweak as the listener moves
    if (listener) {
      for (const [markerId, state] of this.active.entries()) {
        if (!state.loop) continue;
        const marker = markers.find((m) => m.id === markerId);
        if (!marker) continue;
        const gain = this.engine.calcGainForMarker(marker);
        if (Math.abs(gain - state.lastVolume) > 0.01) {
          state.lastVolume = gain;
          ctx.broadcast({ type: 'positional_volume', markerId, volume: gain });
        }
      }
    }
  }

  async onMapLoaded(ctx: InteractionContext): Promise<void> {
    // Preload buffers + dataURLs for every audio_source on the new map
    const all = await AudioAssetStore.getAll();
    for (const m of ctx.markers) {
      if (m.roles.audio !== 'source' || !m.audioTrackId) continue;
      const asset = all.find((a) => a.id === m.audioTrackId);
      if (!asset) continue;
      await this._cacheAsset(asset);
    }
    // Re-sync now that buffers are present so engine.setSources can attach them
    this.onMarkersChanged(ctx);
  }

  reset(): void {
    this.engine.setSources([]);
    this.active.clear();
    this.assetDataUrls.clear();
  }

  /** UI-initiated: load buffer/dataUrl for a freshly-assigned asset and resync. */
  async loadAsset(asset: AudioAsset, ctx: InteractionContext): Promise<void> {
    await this._cacheAsset(asset);
    this.onMarkersChanged(ctx);
  }

  private async _cacheAsset(asset: AudioAsset): Promise<void> {
    if (this.assetDataUrls.has(asset.id)) return; // engine.storeBuffer is idempotent on its own
    const blob = await AudioAssetStore.getBlob(asset);
    if (!blob) return;
    const [arrayBuf, dataUrl] = await Promise.all([
      blob.arrayBuffer(),
      blobToDataUrl(blob),
    ]);
    this.assetDataUrls.set(asset.id, dataUrl);
    await this.engine.storeBuffer(asset.id, arrayBuf);
  }
}
