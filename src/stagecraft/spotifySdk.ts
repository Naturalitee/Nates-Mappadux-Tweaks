/**
 * Spotify Web Playback SDK wrapper. Matches the YouTubeSoundtrackPlayer
 * surface (load / play / pause / stop / setVolume / onEnded) so the
 * SoundtracksPanel can route both providers through one engine
 * interface, including fade-in / fade-out / seek.
 *
 * Requires:
 *   - Spotify Developer App (Client ID) registered + Redirect URIs
 *     including this origin (https://www.mappadux.com/ and any dev
 *     origins such as http://localhost:5173/).
 *   - User connected via OAuth PKCE in src/stagecraft/spotifyAuth.ts.
 *   - **Spotify Premium account** — the SDK refuses to play for free
 *     accounts. We surface the product status in Settings so the GM
 *     knows.
 *
 * The SDK creates a Spotify Connect device in the browser; we then
 * use the standard Spotify Web API to /me/player to transfer playback
 * to that device and to start tracks. Volume + seek are SDK methods
 * (more responsive than Web API calls).
 */

import { getAccessToken } from './spotifyAuth.ts';
import { parseSpotifyUri } from './soundtrackUrl.ts';

const SDK_URL  = 'https://sdk.scdn.co/spotify-player.js';
const API_BASE = 'https://api.spotify.com/v1';

interface SpotifySdkPlayerCtor {
  new (opts: {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }): SpotifySdkPlayer;
}

interface SpotifySdkPlayer {
  connect():    Promise<boolean>;
  disconnect(): void;
  resume():     Promise<void>;
  pause():      Promise<void>;
  seek(ms: number):    Promise<void>;
  setVolume(v: number): Promise<void>;
  getCurrentState():    Promise<SpotifyPlayerState | null>;
  addListener(event: 'ready',            cb: (e: { device_id: string }) => void): void;
  addListener(event: 'not_ready',        cb: (e: { device_id: string }) => void): void;
  addListener(event: 'player_state_changed', cb: (e: SpotifyPlayerState | null) => void): void;
  addListener(event: 'initialization_error', cb: (e: { message: string }) => void): void;
  addListener(event: 'authentication_error', cb: (e: { message: string }) => void): void;
  addListener(event: 'account_error',        cb: (e: { message: string }) => void): void;
  addListener(event: 'playback_error',       cb: (e: { message: string }) => void): void;
}

interface SpotifyPlayerState {
  paused:   boolean;
  position: number;   // ms
  duration: number;   // ms
  track_window?: { current_track?: { uri: string; name: string } };
}

let _sdkPromise: Promise<SpotifySdkPlayerCtor> | null = null;

/** Load the Spotify Web Playback SDK script lazily. */
export function loadSdk(): Promise<SpotifySdkPlayerCtor> {
  if (_sdkPromise) return _sdkPromise;
  _sdkPromise = new Promise((resolve) => {
    const w = window as unknown as {
      Spotify?: { Player: SpotifySdkPlayerCtor };
      onSpotifyWebPlaybackSDKReady?: () => void;
    };
    if (w.Spotify?.Player) { resolve(w.Spotify.Player); return; }
    const prev = w.onSpotifyWebPlaybackSDKReady;
    w.onSpotifyWebPlaybackSDKReady = () => {
      prev?.();
      if (w.Spotify?.Player) resolve(w.Spotify.Player);
    };
    const tag = document.createElement('script');
    tag.src = SDK_URL;
    tag.async = true;
    document.head.appendChild(tag);
  });
  return _sdkPromise;
}

export interface SpotifySoundtrackPlayer {
  load(uri: string, opts?: {
    autoplay?:   boolean;
    volume?:     number;
    positionMs?: number;
    /** Toggle Spotify's repeat-context state — only meaningful when
     *  loading a playlist / album. Matches the YouTube IFrame's
     *  setLoop semantics so a slot's mode controls both engines
     *  uniformly. */
    repeat?:     boolean;
    /** Toggle Spotify's shuffle state — only meaningful for
     *  context-uri loads. */
    shuffle?:    boolean;
  }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  setVolume(v: number): Promise<void>;          // 0-100 to match YouTube
  seekMs(ms: number): Promise<void>;
  destroy(): void;
  onEnded(cb: () => void): void;
  /** Current spotify:track:<id> URI being played, or null. */
  currentUri(): string | null;
}

/** Build a connected Spotify Web Playback SDK player. Resolves when
 *  the SDK reports `ready` (the device_id is registered with
 *  Spotify Connect). */
export async function createSpotifyPlayer(name = 'Mappadux Soundtracks'): Promise<SpotifySoundtrackPlayer> {
  const SdkPlayer = await loadSdk();
  const player = new SdkPlayer({
    name,
    getOAuthToken: (cb) => {
      void (async () => {
        const t = await getAccessToken();
        if (t) cb(t);
      })();
    },
    volume: 0.8,
  });

  // Surface errors on the console without throwing — keeps the SDK
  // alive so transient hiccups (e.g. account paused, ad break) don't
  // tear down the device.
  player.addListener('initialization_error',  (e) => console.warn('[spotify-sdk] init error:', e.message));
  player.addListener('authentication_error',  (e) => console.warn('[spotify-sdk] auth error:', e.message));
  player.addListener('account_error',         (e) => console.warn('[spotify-sdk] account error (Premium required):', e.message));
  player.addListener('playback_error',        (e) => console.warn('[spotify-sdk] playback error:', e.message));

  const deviceId: string = await new Promise<string>((resolve) => {
    player.addListener('ready', ({ device_id }) => resolve(device_id));
    void player.connect();
  });

  let lastUri: string | null = null;
  let lastPosition  = 0;
  let lastDuration  = 0;
  let lastPaused    = true;
  const endedListeners: Array<() => void> = [];

  player.addListener('player_state_changed', (state) => {
    if (!state) return;
    const wasNearEnd = lastDuration > 0 && lastPosition >= lastDuration - 1000 && !lastPaused;
    const justEnded  = wasNearEnd && state.paused && state.position === 0;
    lastPosition = state.position;
    lastDuration = state.duration;
    lastPaused   = state.paused;
    if (justEnded) {
      for (const cb of endedListeners) cb();
    }
  });

  async function _api(path: string, init?: RequestInit): Promise<Response | null> {
    const token = await getAccessToken();
    if (!token) return null;
    return fetch(`${API_BASE}${path}`, {
      ...(init ?? {}),
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async function _transferIfNeeded(): Promise<void> {
    // Tell Spotify Connect to focus on our SDK device. Without this,
    // play() on a fresh page may target whatever device the user
    // last used.
    await _api(`/me/player`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ device_ids: [deviceId], play: false }),
    });
  }

  return {
    async load(uri, opts) {
      await _transferIfNeeded();
      lastUri = uri;
      const parts = parseSpotifyUri(uri);
      // /me/player/play accepts { uris: [trackUri] } for one or many
      // tracks, or { context_uri } for albums / playlists / shows.
      const body: Record<string, unknown> = parts && parts.kind === 'track'
        ? { uris: [uri] }
        : { context_uri: uri };
      if (opts?.positionMs && parts?.kind === 'track') {
        body['position_ms'] = opts.positionMs;
      }
      if (opts?.volume !== undefined) {
        await player.setVolume(Math.max(0, Math.min(100, opts.volume)) / 100);
      }
      // v2.15.15 — Set shuffle + repeat BEFORE the play call.
      // Spotify's player honours these on the next context load.
      // Only meaningful for context-uri loads (playlist / album).
      if (parts && parts.kind !== 'track') {
        if (opts?.shuffle !== undefined) {
          await _api(`/me/player/shuffle?state=${opts.shuffle}&device_id=${deviceId}`, { method: 'PUT' });
        }
        if (opts?.repeat !== undefined) {
          const state = opts.repeat ? 'context' : 'off';
          await _api(`/me/player/repeat?state=${state}&device_id=${deviceId}`,   { method: 'PUT' });
        }
      }
      await _api(`/me/player/play?device_id=${deviceId}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (opts?.autoplay === false) {
        // Spotify's play endpoint always starts. Pause immediately
        // if the caller wanted the track loaded but not playing.
        setTimeout(() => { void player.pause(); }, 200);
      }
    },
    play()                         { return player.resume(); },
    pause()                        { return player.pause(); },
    async stop() {
      try { await player.pause(); } catch { /* nothing */ }
      try { await player.seek(0); } catch { /* nothing */ }
    },
    setVolume(v: number)           { return player.setVolume(Math.max(0, Math.min(100, v)) / 100); },
    seekMs(ms: number)             { return player.seek(ms); },
    destroy()                      { player.disconnect(); },
    onEnded(cb: () => void)        { endedListeners.push(cb); },
    currentUri()                   { return lastUri; },
  };
}
