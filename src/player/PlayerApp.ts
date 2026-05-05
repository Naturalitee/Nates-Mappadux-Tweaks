import { Guest } from '../p2p/Guest.ts';
import { Renderer } from '../rendering/Renderer.ts';
import { MarkerTexture } from '../rendering/MarkerTexture.ts';
import { filterRegistry } from '../filters/FilterRegistry.ts';
import { TransitionEngine } from '../transitions/TransitionEngine.ts';
import { transitionRegistry } from '../transitions/TransitionRegistry.ts';
import type { GMMessage, TransitionConfig, Marker, MarkerIconData } from '../types.ts';

/**
 * PlayerApp — top-level orchestrator for the player view.
 *
 * Reads the room code from the URL fragment (#roomcode).
 * If the fragment is absent or empty, waits for a room code input.
 * Connects via P2P Guest (BroadcastChannel for local window, PeerJS for network).
 * Applies all incoming state updates to the Renderer.
 *
 * Markers are rendered as a CanvasTexture inside the Three.js scene (Plane 2)
 * so they pass through the active GLSL filter pipeline.
 */
export class PlayerApp {
  private renderer!: Renderer;
  private markerTexture!: MarkerTexture;
  private transitionEngine!: TransitionEngine;
  private guest!: Guest;
  private statusEl!: HTMLElement;
  private connectPanel!: HTMLElement;
  private roomInput!: HTMLInputElement;
  /** Tracks which map ID the player is currently showing (or loading). */
  private currentMapId: string | null = null;
  private currentMarkers: Marker[]    = [];
  private playerIconCache = new Map<string, ImageBitmap>();
  /**
   * Sequence numbers of messages already processed.
   * Local player windows receive every broadcast TWICE — once via BroadcastChannel
   * (fast, sub-ms) and once via PeerJS (slower, ~50-200ms).  Without dedup, the
   * second delivery re-runs loadMap with a new loadGen, which then discards the
   * first (BC) texture decode and waits for a second, slower decode.  More
   * critically, re-processing map_change resets currentMapId mid-flight, which
   * can make valid fog_update messages appear to belong to a different map and
   * get discarded.  Tracking seqs lets us drop the PeerJS duplicate entirely.
   */
  private seenSeqs = new Set<number>();

  async init(): Promise<void> {
    this.renderer = new Renderer(
      document.querySelector<HTMLCanvasElement>('#renderer-canvas')!,
      { preserveDrawingBuffer: true },
    );
    this.markerTexture = new MarkerTexture();
    this.renderer.setMarkerCanvas(this.markerTexture.canvas);

    this.transitionEngine = new TransitionEngine(
      document.querySelector<HTMLCanvasElement>('#transition-canvas')!,
    );
    this.renderer.onMapLoaded = (aspect) => {
      this.markerTexture.setAspectRatio(aspect);
      this.markerTexture.render(this.currentMarkers, this.playerIconCache);
      this.renderer.markMarkersDirty();
    };
    this.renderer.start();

    this.statusEl     = document.querySelector('#status')!;
    this.connectPanel = document.querySelector('#connect-panel')!;
    this.roomInput    = document.querySelector<HTMLInputElement>('#room-input')!;

    const roomCode = location.hash.slice(1).trim();

    if (roomCode) {
      this.connect(roomCode);
    } else {
      this.showConnectPanel();
    }

    document.querySelector('#connect-btn')?.addEventListener('click', () => {
      const code = this.roomInput.value.trim();
      if (code) {
        this.connectPanel.hidden = true;
        this.connect(code);
      }
    });
  }

  // ─── P2P ──────────────────────────────────────────────────────────────────

  private connect(roomCode: string): void {
    this.setStatus('Connecting…');

    this.guest = new Guest({
      onConnected:    () => this.setStatus('Connected'),
      onDisconnected: () => this.setStatus('Disconnected — waiting for GM…'),
      onError: (err)  => this.setStatus(`Error: ${err.message}`),
      onMessage: (msg, blob) => this.handleMessage(msg, blob),
    });

    this.guest.connect(roomCode);
  }

  // ─── Message handling ─────────────────────────────────────────────────────

  private handleMessage(msg: GMMessage, mapBlob?: ArrayBuffer): void {
    // ── Sequence-number deduplication ────────────────────────────────────────
    // Local player windows receive every broadcast twice: once via the fast
    // BroadcastChannel (sub-ms) and once via PeerJS (~50-200ms later).
    // The first delivery (BC) is canonical.  When the PeerJS copy arrives we
    // recognise the seq and drop it before any state is touched.
    const seq = (msg as unknown as Record<string, unknown>)['_seq'];
    if (typeof seq === 'number') {
      if (this.seenSeqs.has(seq)) return; // duplicate — already handled via BC
      this.seenSeqs.add(seq);
      // Trim the set so it doesn't grow without bound over a long session.
      if (this.seenSeqs.size > 200) {
        const sorted = [...this.seenSeqs].sort((a, b) => a - b);
        this.seenSeqs = new Set(sorted.slice(-100));
      }
    }

    switch (msg.type) {
      case 'full_state': {
        this.currentMapId   = msg.payload.map?.id ?? null;
        this.currentMarkers = msg.payload.markers ?? [];
        if (mapBlob) {
          this.renderer.loadMap(mapBlob, msg.payload.fog);
        } else {
          this.renderer.updateFog(msg.payload.fog);
        }
        this.renderer.setFilter(msg.payload.filter);
        this.renderer.setView(msg.payload.view);
        void (async () => {
          if (msg.iconData?.length) await this._decodeIconData(msg.iconData);
          this.markerTexture.render(this.currentMarkers, this.playerIconCache);
          this.renderer.markMarkersDirty();
        })();
        this.setStatus('');
        break;
      }

      case 'map_change': {
        this.currentMapId = msg.payload.id;
        // Update markers immediately so onMapLoaded renders the correct set.
        if (msg.markers !== undefined) this.currentMarkers = msg.markers;
        if (mapBlob) {
          const fog    = msg.fog    ?? { polygons: [] };
          const filter = msg.filter;
          const view   = msg.view;
          const blob   = mapBlob;
          void (async () => {
            // Decode any new custom icons before the transition so onMapLoaded
            // has them ready in playerIconCache when it renders.
            if (msg.iconData?.length) await this._decodeIconData(msg.iconData);
            await this.runTransition(msg.transition, async () => {
              await this.renderer.loadMap(blob, fog);
              if (filter) this.renderer.setFilter(filter);
              if (view)   this.renderer.setView(view);
            });
          })();
        }
        break;
      }

      case 'filter_update': {
        this.renderer.setFilter(msg.payload);
        break;
      }

      case 'fog_update': {
        // Safety net: discard fog updates for a different map.
        // With seq deduplication the BC+PeerJS race is already prevented, but
        // this guard catches any edge case where mapId doesn't match.
        if (msg.mapId && msg.mapId !== this.currentMapId) break;
        this.renderer.updateFog(msg.payload);
        break;
      }

      case 'view_update': {
        this.renderer.setView(msg.payload);
        break;
      }

      case 'marker_update': {
        this.currentMarkers = msg.payload;
        void (async () => {
          if (msg.iconData?.length) await this._decodeIconData(msg.iconData);
          this.markerTexture.render(this.currentMarkers, this.playerIconCache);
          this.renderer.markMarkersDirty();
        })();
        break;
      }

      // Stub — not yet acted on
      case 'audio_update':
        break;
    }
  }

  // ─── Icon cache ───────────────────────────────────────────────────────────

  private async _decodeIconData(iconData: MarkerIconData[]): Promise<void> {
    await Promise.all(
      iconData
        .filter(({ key }) => !this.playerIconCache.has(key))
        .map(async ({ key, dataUrl }) => {
          const res  = await fetch(dataUrl);
          const blob = await res.blob();
          const bmp  = await createImageBitmap(blob);
          this.playerIconCache.set(key, bmp);
        }),
    );
  }

  // ─── Transitions ──────────────────────────────────────────────────────────

  private async runTransition(
    config: TransitionConfig | undefined,
    applyChange: () => Promise<void>,
  ): Promise<void> {
    const id  = config?.transitionId ?? 'none';
    const def = transitionRegistry.getOrFallback(id);
    const params = config?.params ?? transitionRegistry.defaultParams(id);
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas')!;
    await this.transitionEngine.run(def, params, canvas, applyChange);
  }

  // ─── UI ───────────────────────────────────────────────────────────────────

  private showConnectPanel(): void {
    this.connectPanel.hidden = false;
    this.setStatus('Enter room code to connect');
  }

  private setStatus(msg: string): void {
    this.statusEl.textContent = msg;
    this.statusEl.hidden = !msg;
  }
}

// Pre-warm filter registry so shaders are compiled on load
filterRegistry.getAll();
