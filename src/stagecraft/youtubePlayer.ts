/**
 * Thin wrapper around YouTube's IFrame Player API. The API itself is
 * loaded lazily from https://www.youtube.com/iframe_api and exposes a
 * global `YT.Player` constructor. We hide the iframe (1x1 px,
 * off-screen) since this is audio-only — Mappadux drives play/pause/
 * seek/volume but the user never sees the player chrome.
 *
 * YouTube Music URLs share video ids with the main YouTube domain, so
 * a music.youtube.com link extracts to the same id as the equivalent
 * youtube.com/watch?v=... link and plays through the same IFrame.
 *
 * Loaded lazily so a pack without Stagecraft Soundtracks never pulls
 * the YouTube IFrame script + never opens a network connection to
 * googlevideo.com.
 *
 * v2.16 — first cut. Single-player. Multi-slot (Theme / Intro /
 * Outro / Playlist) panel multiplexes one player instance onto the
 * currently-active slot.
 */

/** Extract the YouTube video id from a URL. Accepts:
 *  - youtu.be/<id>
 *  - youtube.com/watch?v=<id>
 *  - youtube.com/embed/<id>
 *  - music.youtube.com/watch?v=<id>
 *  Returns null if no id can be parsed. */
export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Bare id (11 chars, alnum + - _).
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  let url: URL;
  try { url = new URL(trimmed); } catch { return null; }
  // youtu.be short form.
  if (url.hostname === 'youtu.be') {
    const id = url.pathname.replace(/^\/+/, '').split('/')[0];
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  // youtube.com / music.youtube.com — watch?v=
  if (/(^|\.)youtube\.com$/.test(url.hostname)) {
    if (url.pathname === '/watch') {
      const v = url.searchParams.get('v');
      return v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null;
    }
    const embedMatch = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})$/);
    if (embedMatch) return embedMatch[1]!;
  }
  return null;
}

let _apiPromise: Promise<void> | null = null;

/** Lazy-load https://www.youtube.com/iframe_api. Resolves once the
 *  global YT object + YT.Player are available. Safe to call multiple
 *  times; only the first call injects the script. */
export function loadYouTubeApi(): Promise<void> {
  if (_apiPromise) return _apiPromise;
  _apiPromise = new Promise((resolve) => {
    const w = window as unknown as {
      YT?: { Player?: unknown };
      onYouTubeIframeAPIReady?: () => void;
    };
    if (w.YT && w.YT.Player) { resolve(); return; }
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    document.head.appendChild(tag);
  });
  return _apiPromise;
}

interface YTPlayerLike {
  loadVideoById(opts: { videoId: string; startSeconds?: number }): void;
  cueVideoById(opts:  { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  setVolume(v: number): void;
  getVolume(): number;
  getPlayerState(): number;
  destroy(): void;
}

/** YouTube player states (from the IFrame Player API). */
export const YT_STATE = {
  UNSTARTED: -1,
  ENDED:      0,
  PLAYING:    1,
  PAUSED:     2,
  BUFFERING:  3,
  CUED:       5,
} as const;

export interface YouTubeSoundtrackPlayer {
  load(videoId: string, opts?: { autoplay?: boolean; volume?: number }): void;
  play(): void;
  pause(): void;
  stop(): void;
  setVolume(v: number): void;
  destroy(): void;
  onStateChange(cb: (state: number) => void): void;
}

/** Create a YouTube IFrame player bound to a hidden div. Inserts the
 *  div if absent. Resolves once the iframe is ready to receive load /
 *  play commands.
 *
 *  Hosting div lives in the DOM at id="stagecraft-yt-host" — a 1x1
 *  off-screen container. The IFrame Player constructor replaces THIS
 *  element with the actual iframe, so the host has to be a fresh
 *  element each construction. We wrap in an outer keep-alive div. */
export async function createYouTubePlayer(): Promise<YouTubeSoundtrackPlayer> {
  await loadYouTubeApi();
  const w = window as unknown as { YT: { Player: new (el: HTMLElement, opts: object) => YTPlayerLike } };

  // Ensure host container exists.
  let outer = document.getElementById('stagecraft-yt-host');
  if (!outer) {
    outer = document.createElement('div');
    outer.id = 'stagecraft-yt-host';
    outer.style.position = 'fixed';
    outer.style.left = '-10000px';
    outer.style.top = '-10000px';
    outer.style.width = '1px';
    outer.style.height = '1px';
    outer.style.pointerEvents = 'none';
    document.body.appendChild(outer);
  }
  // Fresh inner div per player; IFrame Player replaces it with an iframe.
  outer.innerHTML = '';
  const inner = document.createElement('div');
  inner.id = 'stagecraft-yt-player';
  outer.appendChild(inner);

  const stateListeners: Array<(state: number) => void> = [];

  const player: YTPlayerLike = await new Promise<YTPlayerLike>((resolve) => {
    const p = new w.YT.Player(inner, {
      width:  '1',
      height: '1',
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        modestbranding: 1,
        rel: 0,
      },
      events: {
        onReady: () => resolve(p),
        onStateChange: (ev: { data: number }) => {
          for (const cb of stateListeners) cb(ev.data);
        },
      },
    });
  });

  return {
    load(videoId, opts) {
      const auto = opts?.autoplay !== false;
      if (opts?.volume !== undefined) player.setVolume(Math.max(0, Math.min(100, opts.volume)));
      if (auto) player.loadVideoById({ videoId });
      else      player.cueVideoById({ videoId });
    },
    play()  { player.playVideo(); },
    pause() { player.pauseVideo(); },
    stop()  { player.stopVideo(); },
    setVolume(v: number) { player.setVolume(Math.max(0, Math.min(100, v))); },
    destroy() { try { player.destroy(); } catch { /* nothing */ } },
    onStateChange(cb)    { stateListeners.push(cb); },
  };
}
