import type { TextMapVideoElement } from '../types.ts';
import { loadYouTubeApi, YT_STATE } from '../stagecraft/youtubePlayer.ts';

type Project = (x: number, y: number) => { x: number; y: number } | null;

/** Playback snapshot the GM emits and viewers reconcile against. */
export interface VideoPlaybackState {
  id: string;
  videoId: string;
  state: number;
  seconds: number;
  volume: number;
}

export interface TextMapVideoLayerOpts {
  /** 'gm'     — interactive YouTube controls; the GM is the only surface that
   *             can play / pause / seek / set volume. Muted locally so the GM
   *             screen never echoes the room screen, and reports state via
   *             onPlayback for the viewers to follow.
   *  'viewer' — no controls, non-interactive (clicks pass through); audible;
   *             driven entirely by applyPlayback(). */
  mode: 'gm' | 'viewer';
  /** GM only — fired on every YouTube state change + a periodic tick while a
   *  video exists, so the host can broadcast it to viewers. */
  onPlayback?: (ev: VideoPlaybackState) => void;
}

/** Minimal slice of the YT IFrame player we use here. */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  mute(): void;
  setVolume(v: number): void;
  getVolume(): number;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface Host {
  id: string;
  el: HTMLElement;
  videoId: string;
  player: YTPlayer | null;
  ready: boolean;
}

/**
 * TextMapVideoLayer (v2.16.95) — renders the LIVE YouTube players for a
 * text-map's video elements over the rendered map (GM canvas + player +
 * projector). Video isn't baked into the rasterised page image, so this
 * overlay tracks each element's map-relative geometry every frame (project
 * the element's % rect -> screen px), keeping the video glued to the map
 * through pan / zoom.
 *
 * Control model: the GM owns playback. The GM player has YouTube's own
 * controls and is muted (so it doesn't echo the room screen); it reports
 * play/pause/seek/volume via onPlayback. Viewers (player + projector) have
 * NO controls and are non-interactive — applyPlayback() reconciles their
 * iframe to the GM (match play/pause, seek when drift > ~0.5 s, set volume).
 * Not frame-accurate by design.
 */
export class TextMapVideoLayer {
  private videos: TextMapVideoElement[] = [];
  private hosts = new Map<string, Host>();
  /** Last playback state per element id, applied when a viewer player becomes
   *  ready after the message already arrived (late-join / rebuild). */
  private pending = new Map<string, VideoPlaybackState>();
  private raf = 0;
  private tick = 0;
  private readonly mode: 'gm' | 'viewer';
  private readonly onPlayback: ((ev: VideoPlaybackState) => void) | undefined;

  constructor(private root: HTMLElement, private project: Project, opts: TextMapVideoLayerOpts) {
    this.mode = opts.mode;
    this.onPlayback = opts.onPlayback;
    const loop = (): void => { this._position(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
    if (this.mode === 'gm') {
      // Periodic re-sync so viewers correct slow drift + late state. Cheap
      // (tiny JSON, one per existing video) and only emits when videos exist.
      this.tick = window.setInterval(() => {
        for (const host of this.hosts.values()) this._report(host);
      }, 1500);
    }
  }

  setVideos(videos: TextMapVideoElement[]): void {
    const ids = new Set(videos.map((v) => v.id));
    for (const [id, host] of this.hosts) {
      if (!ids.has(id)) { this._destroyHost(host); this.hosts.delete(id); this.pending.delete(id); }
    }
    for (const v of videos) {
      let host = this.hosts.get(v.id);
      // Rebuild only if the video id changed (else keep playing).
      if (host && host.videoId !== v.videoId) { this._destroyHost(host); this.hosts.delete(v.id); host = undefined; }
      if (!host) {
        const el = document.createElement('div');
        el.className = 'textmap-video';
        el.dataset['videoId'] = v.videoId;
        if (this.mode === 'viewer') el.style.pointerEvents = 'none';
        this.root.appendChild(el);
        host = { id: v.id, el, videoId: v.videoId, player: null, ready: false };
        this.hosts.set(v.id, host);
        this._createPlayer(host);
      }
    }
    this.videos = videos;
    this._position();
  }

  /** Viewer-side: reconcile this element's iframe to the GM's playback. */
  applyPlayback(ev: VideoPlaybackState): void {
    this.pending.set(ev.id, ev);
    const host = this.hosts.get(ev.id);
    if (!host || !host.player || !host.ready) return;
    const p = host.player;
    try {
      if (ev.volume >= 0) p.setVolume(ev.volume);
      const drift = Math.abs(p.getCurrentTime() - ev.seconds);
      const local = p.getPlayerState();
      const wantPlaying = ev.state === YT_STATE.PLAYING || ev.state === YT_STATE.BUFFERING;
      if (wantPlaying) {
        if (drift > 0.5) p.seekTo(ev.seconds, true);
        if (local !== YT_STATE.PLAYING && local !== YT_STATE.BUFFERING) p.playVideo();
      } else { // paused / ended / cued -> hold position
        if (drift > 0.5) p.seekTo(ev.seconds, true);
        if (local === YT_STATE.PLAYING) p.pauseVideo();
      }
    } catch { /* player not ready yet — pending will replay on onReady */ }
  }

  clear(): void { this.setVideos([]); }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    if (this.tick) window.clearInterval(this.tick);
    for (const host of this.hosts.values()) this._destroyHost(host);
    this.hosts.clear();
  }

  private _createPlayer(host: Host): void {
    const isGm = this.mode === 'gm';
    void loadYouTubeApi().then(() => {
      // Host may have been torn down while the API loaded.
      if (!this.hosts.has(host.id) || !host.el.isConnected) return;
      const w = window as unknown as { YT: { Player: new (el: HTMLElement, opts: object) => YTPlayer } };
      const inner = document.createElement('div');
      host.el.appendChild(inner);
      host.player = new w.YT.Player(inner, {
        width: '100%',
        height: '100%',
        videoId: host.videoId,
        host: 'https://www.youtube.com',
        playerVars: {
          autoplay:       0,
          controls:       isGm ? 1 : 0,
          disablekb:      isGm ? 0 : 1,
          fs:             isGm ? 1 : 0,
          modestbranding: 1,
          rel:            0,
          playsinline:    1,
          enablejsapi:    1,
          origin:         location.origin,
        },
        events: {
          onReady: (): void => {
            host.ready = true;
            if (isGm) {
              // GM is silent so it never echoes the room screen; it still
              // drives volume for viewers via getVolume() in _report().
              try { host.player?.mute(); } catch { /* noop */ }
              this._report(host);
            } else {
              const pend = this.pending.get(host.id);
              if (pend) this.applyPlayback(pend);
            }
          },
          onStateChange: (): void => { if (isGm) this._report(host); },
        },
      });
    }).catch(() => { /* YT API failed to load — element stays empty */ });
  }

  /** GM-side: snapshot this player's state and hand it to onPlayback. */
  private _report(host: Host): void {
    if (this.mode !== 'gm' || !this.onPlayback || !host.player || !host.ready) return;
    try {
      this.onPlayback({
        id:      host.id,
        videoId: host.videoId,
        state:   host.player.getPlayerState(),
        seconds: host.player.getCurrentTime(),
        volume:  host.player.getVolume(),
      });
    } catch { /* player transiently unavailable */ }
  }

  private _destroyHost(host: Host): void {
    try { host.player?.destroy(); } catch { /* noop */ }
    host.player = null;
    host.el.remove();
  }

  private _position(): void {
    for (const v of this.videos) {
      const host = this.hosts.get(v.id);
      if (!host) continue;
      const tl = this.project(v.x / 100, v.y / 100);
      const br = this.project((v.x + v.w) / 100, (v.y + v.h) / 100);
      if (!tl || !br) { host.el.style.visibility = 'hidden'; continue; }
      host.el.style.visibility = '';
      host.el.style.left   = `${tl.x}px`;
      host.el.style.top    = `${tl.y}px`;
      host.el.style.width  = `${Math.max(8, br.x - tl.x)}px`;
      host.el.style.height = `${Math.max(8, br.y - tl.y)}px`;
      host.el.style.transform = v.rotation ? `rotate(${v.rotation}deg)` : '';
    }
  }
}
