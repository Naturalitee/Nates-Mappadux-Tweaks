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

/** Extract a YouTube / YouTube Music playlist id from a URL. Accepts:
 *  - youtube.com/playlist?list=<id>
 *  - music.youtube.com/playlist?list=<id>
 *  - youtube.com/watch?v=<videoId>&list=<id>  (returns the listId; the
 *    embed player will play the playlist starting at videoId)
 *  Playlist ids vary in length but are alnum + - _ (commonly 13–34).
 *  Returns null if no id can be parsed. */
export function extractPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try { url = new URL(trimmed); } catch { return null; }
  if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
  const list = url.searchParams.get('list');
  if (!list || !/^[A-Za-z0-9_-]+$/.test(list)) return null;
  // Skip the watch-history meta-list "WL" + auto-mix lists "RD..." —
  // those don't behave as user-pasteable playlists in the IFrame.
  if (list === 'WL') return null;
  return list;
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
  loadPlaylist(opts:  { list: string; listType?: 'playlist'; index?: number; startSeconds?: number; suggestedQuality?: string }): void;
  cuePlaylist(opts:   { list: string; listType?: 'playlist'; index?: number; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  setVolume(v: number): void;
  getVolume(): number;
  getPlayerState(): number;
  setLoop(loop: boolean): void;
  setShuffle(shuffle: boolean): void;
  previousVideo(): void;
  nextVideo(): void;
  getVideoData(): { video_id?: string; title?: string; author?: string };
  getCurrentTime(): number;
  getDuration(): number;
  getPlaylistIndex(): number;
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
  load(videoId: string, opts?: { autoplay?: boolean; volume?: number; startSeconds?: number }): void;
  /** Load a whole YouTube / YouTube Music playlist by list id. The
   *  IFrame Player iterates the playlist internally; `loop` makes
   *  it cycle back to the first track when the list ends; `shuffle`
   *  randomises the order. `index` + `startSeconds` resume from a
   *  saved position (for the slot-resume feature). */
  loadPlaylist(listId: string, opts?: { autoplay?: boolean; volume?: number; loop?: boolean; shuffle?: boolean; index?: number; startSeconds?: number }): void;
  /** Current playback position within the active video (seconds). */
  getCurrentTime(): number;
  /** Current video's total duration (seconds). 0 until known. */
  getDuration(): number;
  /** Current playlist index (0-based). -1 when not playing a playlist. */
  getPlaylistIndex(): number;
  play(): void;
  pause(): void;
  stop(): void;
  next(): void;
  previous(): void;
  setVolume(v: number): void;
  destroy(): void;
  onStateChange(cb: (state: number) => void): void;
  /** v2.15.19 — fires when the IFrame Player reports an error.
   *  See YT_ERROR_MESSAGES for code → human-readable lookup. */
  onError(cb: (code: number, message: string) => void): void;
  /** Current playing track's metadata (best-effort). Undefined
   *  until the IFrame Player reports it. */
  getNowPlaying(): { title?: string; author?: string } | null;
}

/** YouTube IFrame Player error codes (from the official docs).
 *  Mapping to friendly messages so the SoundtracksPanel can guide
 *  the user toward a fix without leaking the raw code. */
export const YT_ERROR_MESSAGES: Record<number, string> = {
  2:   'Invalid YouTube id — check the URL is right and try again.',
  5:   'YouTube player hit an internal error. Try a different track.',
  100: 'YouTube couldn\'t find this video / playlist — it may have been removed or set to private.',
  101: 'This playlist or video doesn\'t allow embedded playback. In YouTube Music, set the playlist privacy to Unlisted or Public (not Private).',
  150: 'This playlist or video doesn\'t allow embedded playback. In YouTube Music, set the playlist privacy to Unlisted or Public (not Private).',
};

export function ytErrorMessage(code: number): string {
  return YT_ERROR_MESSAGES[code] ?? `YouTube error ${code}. Try a different URL.`;
}

export interface CreateYouTubePlayerOpts {
  /** Initial video id to load with the player. Either this OR
   *  `listId` should be provided — the IFrame Player's empty
   *  embed (`https://www.youtube.com/embed/?...` with no path
   *  segment) doesn't reliably fire onReady, so we start the
   *  player with real content. */
  videoId?: string;
  listId?:  string;
}

/** Create a YouTube IFrame player bound to a visually-invisible div
 *  in the document body. Resolves once the iframe is ready to
 *  receive load / play commands.
 *
 *  v2.15.23 — the player must be created with INITIAL content
 *  (videoId or listId). Empty-embed initialisation
 *  (https://www.youtube.com/embed/?...) was observed to never fire
 *  onReady on some Edge / Chrome combinations, leaving callers
 *  stuck. Real content lets the iframe finish loading and call
 *  back normally. */
export async function createYouTubePlayer(opts?: CreateYouTubePlayerOpts): Promise<YouTubeSoundtrackPlayer> {
  await loadYouTubeApi();
  const w = window as unknown as { YT: { Player: new (el: HTMLElement, opts: object) => YTPlayerLike } };

  // Ensure host container exists. v2.15.22 — kept in normal document
  // flow (not position:fixed off-screen) because some YouTube embed
  // anti-abuse paths refuse to fire onReady when the iframe element
  // has zero rendered area. We still hide it from the user via
  // opacity:0 + pointer-events:none + tiny size so it's invisible
  // but counts as "rendered" for the IFrame Player's heuristics.
  let outer = document.getElementById('stagecraft-yt-host');
  if (!outer) {
    outer = document.createElement('div');
    outer.id = 'stagecraft-yt-host';
    outer.style.position = 'fixed';
    outer.style.bottom = '0';
    outer.style.right  = '0';
    outer.style.width  = '2px';
    outer.style.height = '2px';
    outer.style.opacity = '0.01';
    outer.style.pointerEvents = 'none';
    outer.style.zIndex = '-1';
    document.body.appendChild(outer);
  }
  // Fresh inner div per player; IFrame Player replaces it with an iframe.
  outer.innerHTML = '';
  const inner = document.createElement('div');
  inner.id = 'stagecraft-yt-player';
  outer.appendChild(inner);

  const stateListeners: Array<(state: number) => void> = [];
  const errorListeners: Array<(code: number, message: string) => void> = [];

  // 10s timeout. If onReady doesn't fire (off-screen iframe
  // rejected, ad blocker, security headers, network) we surface a
  // diagnostic error instead of hanging at "Loading…". v2.15.22
  // includes iframe state in the message so we know which of the
  // possible causes is biting.
  const player: YTPlayerLike = await new Promise<YTPlayerLike>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const iframe = outer.querySelector('iframe');
      const diag = iframe
        ? `iframe present; FULL src="${iframe.src}"; readyState=${(iframe as HTMLIFrameElement).contentDocument?.readyState ?? 'cross-origin'}`
        : 'NO iframe element was created — YT.Player(new) probably threw or never inserted.';
      console.warn('[soundtracks][yt-timeout]', diag);
      reject(new Error(
        'YouTube player didn\'t respond in 10 seconds. ' +
        'See console for the full iframe URL. ' +
        diag.slice(0, 200),
      ));
    }, 10_000);
    // v2.15.24 — Explicit host + origin so the IFrame Player's
    // postMessage handshake knows where to look. Without these,
    // YT's widgetapi has been observed to post messages with
    // mismatched target origins on subdomain origins (beta.*).
    const config: Record<string, unknown> = {
      width:  '1',
      height: '1',
      host:   'https://www.youtube.com',
      playerVars: {
        autoplay:    0,
        controls:    0,
        disablekb:   1,
        modestbranding: 1,
        rel:         0,
        enablejsapi: 1,
        origin:      location.origin,
        ...(opts?.listId
          ? { list: opts.listId, listType: 'playlist' }
          : {}),
      },
      events: {
        onReady: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(p);
        },
        onStateChange: (ev: { data: number }) => {
          for (const cb of stateListeners) cb(ev.data);
        },
        onError: (ev: { data: number }) => {
          const msg = ytErrorMessage(ev.data);
          for (const cb of errorListeners) cb(ev.data, msg);
        },
      },
    };
    if (opts?.videoId) config['videoId'] = opts.videoId;
    const p = new w.YT.Player(inner, config);
  });

  return {
    load(videoId, opts) {
      const auto = opts?.autoplay !== false;
      if (opts?.volume !== undefined) player.setVolume(Math.max(0, Math.min(100, opts.volume)));
      const arg = opts?.startSeconds !== undefined
        ? { videoId, startSeconds: opts.startSeconds }
        : { videoId };
      if (auto) player.loadVideoById(arg);
      else      player.cueVideoById(arg);
    },
    loadPlaylist(listId, opts) {
      const auto = opts?.autoplay !== false;
      if (opts?.volume !== undefined) player.setVolume(Math.max(0, Math.min(100, opts.volume)));
      const arg: { list: string; listType: 'playlist'; index?: number; startSeconds?: number } = {
        list: listId,
        listType: 'playlist',
      };
      if (opts?.index       !== undefined) arg.index       = opts.index;
      if (opts?.startSeconds !== undefined) arg.startSeconds = opts.startSeconds;
      if (auto) player.loadPlaylist(arg);
      else      player.cuePlaylist(arg);
      // setLoop reliably works immediately after load — it just sets
      // a flag the player consults at end-of-playlist.
      try { player.setLoop(opts?.loop ?? false); } catch { /* nothing */ }
      // v2.15.30 — setShuffle is documented as needing the playlist
      // to be loaded first; calling it synchronously after
      // loadPlaylist no-ops on most YT IFrame versions because the
      // playlist queue hasn't been built yet. Defer to the FIRST
      // onStateChange (any state except UNSTARTED=-1 means the
      // playlist is processed enough for setShuffle to take).
      if (opts?.shuffle !== undefined) {
        const wantShuffle = opts.shuffle;
        const onceOnState = (state: number): void => {
          if (state === YT_STATE.UNSTARTED) return;
          try { player.setShuffle(wantShuffle); } catch { /* nothing */ }
          const i = stateListeners.indexOf(onceOnState);
          if (i >= 0) stateListeners.splice(i, 1);
        };
        stateListeners.push(onceOnState);
      }
    },
    getCurrentTime()   { try { return player.getCurrentTime();   } catch { return 0; } },
    getDuration()      { try { return player.getDuration();      } catch { return 0; } },
    getPlaylistIndex() { try { return player.getPlaylistIndex(); } catch { return -1; } },
    play()  { player.playVideo(); },
    pause() { player.pauseVideo(); },
    stop()  { player.stopVideo(); },
    setVolume(v: number) { player.setVolume(Math.max(0, Math.min(100, v))); },
    next()    { try { player.nextVideo();     } catch { /* nothing */ } },
    previous() { try { player.previousVideo(); } catch { /* nothing */ } },
    destroy() { try { player.destroy(); } catch { /* nothing */ } },
    onStateChange(cb)    { stateListeners.push(cb); },
    onError(cb)          { errorListeners.push(cb); },
    getNowPlaying() {
      try {
        const d = player.getVideoData();
        return d?.title ? { title: d.title, ...(d.author ? { author: d.author } : {}) } : null;
      } catch { return null; }
    },
  };
}
