/**
 * Spotify OAuth (PKCE) flow for browser-side auth without a server.
 * The user registers a Spotify Developer App
 * (https://developer.spotify.com/dashboard), gives Mappadux the
 * Client ID, picks Connect — Mappadux redirects to Spotify's auth
 * page, Spotify redirects back with a code, we exchange it for an
 * access + refresh token, store both, the SDK takes over.
 *
 * Storage:
 *  - Client ID, refresh token, access token + expiry: localStorage,
 *    per-machine. Never travel in `.mappadux` bundles.
 *  - PKCE code_verifier: sessionStorage (short-lived; only needs to
 *    survive the redirect round-trip).
 *
 * Scopes:
 *  - streaming: required to play audio via Web Playback SDK
 *  - user-read-email + user-read-private: required for token grant
 *    (Spotify rejects 'streaming' alone without identity scopes)
 *  - user-modify-playback-state: lets us pause / resume from outside
 *    the SDK device
 */

const CLIENT_ID_KEY      = 'mappadux:spotify_client_id';
const ACCESS_TOKEN_KEY   = 'mappadux:spotify_access_token';
const ACCESS_EXPIRES_KEY = 'mappadux:spotify_access_expires';
const REFRESH_TOKEN_KEY  = 'mappadux:spotify_refresh_token';
const PROFILE_KEY        = 'mappadux:spotify_profile';
const PKCE_VERIFIER_KEY  = 'mappadux:spotify_pkce_verifier';
const PKCE_RETURN_KEY    = 'mappadux:spotify_pkce_return';

const AUTH_URL  = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const ME_URL    = 'https://api.spotify.com/v1/me';

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-modify-playback-state',
].join(' ');

export interface SpotifyProfile {
  id:           string;
  displayName:  string;
  product:      string;   // 'premium' | 'free' | ...
  email?:       string;
}

// ─── Public storage accessors ──────────────────────────────────────────

export function getSpotifyClientId(): string {
  try { return localStorage.getItem(CLIENT_ID_KEY) ?? ''; } catch { return ''; }
}
export function setSpotifyClientId(v: string): void {
  try {
    const trimmed = v.trim();
    if (trimmed) localStorage.setItem(CLIENT_ID_KEY, trimmed);
    else         localStorage.removeItem(CLIENT_ID_KEY);
  } catch { /* private mode etc. — no-op */ }
}

export function getSpotifyProfile(): SpotifyProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SpotifyProfile;
  } catch { return null; }
}

export function clearSpotifyAuth(): void {
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(ACCESS_EXPIRES_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(PROFILE_KEY);
  } catch { /* nothing */ }
}

export function isSpotifyConnected(): boolean {
  try { return !!localStorage.getItem(REFRESH_TOKEN_KEY); } catch { return false; }
}

// ─── PKCE helpers ──────────────────────────────────────────────────────

function _b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function _sha256(s: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(buf);
}

function _randomString(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return _b64url(bytes);
}

// ─── Redirect URI derivation ───────────────────────────────────────────

/** Use the current origin as the redirect URI. The user MUST register
 *  this exact URI in their Spotify Developer App settings:
 *    https://www.mappadux.com/
 *    http://localhost:5173/  (for npm run dev)
 *    and whatever else they use. */
export function getRedirectUri(): string {
  return location.origin + '/';
}

// ─── OAuth: start the redirect ─────────────────────────────────────────

/** Build the Spotify auth URL + redirect the browser. Stores a PKCE
 *  verifier in sessionStorage. The auth callback (?code= on return)
 *  is handled by handleAuthCallback() at app boot. */
export async function startConnect(): Promise<void> {
  const clientId = getSpotifyClientId();
  if (!clientId) throw new Error('Set a Spotify Client ID first.');

  const verifier  = _randomString(64);
  const challenge = _b64url(await _sha256(verifier));
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  // Remember where the user was so we can put them back after the
  // redirect (Spotify only sends them back to the registered origin).
  sessionStorage.setItem(PKCE_RETURN_KEY, location.pathname + location.search + location.hash);

  const params = new URLSearchParams({
    client_id:             clientId,
    response_type:         'code',
    redirect_uri:          getRedirectUri(),
    scope:                 SCOPES,
    code_challenge_method: 'S256',
    code_challenge:        challenge,
  });
  location.href = `${AUTH_URL}?${params.toString()}`;
}

// ─── OAuth: callback (page load) ───────────────────────────────────────

/** Call at app boot. If the current URL has a Spotify auth ?code=,
 *  exchange it for tokens + profile. Returns true if a callback was
 *  handled (and the URL was cleaned). */
export async function handleAuthCallback(): Promise<boolean> {
  const params = new URLSearchParams(location.search);
  const code   = params.get('code');
  // Only act when we're expecting a callback (verifier exists).
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (!code || !verifier) return false;
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);

  const clientId = getSpotifyClientId();
  if (!clientId) return false;

  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  getRedirectUri(),
    client_id:     clientId,
    code_verifier: verifier,
  });
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    console.warn('[spotify] token exchange failed:', res.status, await res.text());
    _cleanUrl();
    return true;
  }
  const data = await res.json() as {
    access_token: string;
    expires_in:   number;
    refresh_token: string;
  };
  _persistTokens(data.access_token, data.expires_in, data.refresh_token);
  await _refreshProfile();
  _cleanUrl();
  return true;
}

function _cleanUrl(): void {
  // Strip ?code= (and any other Spotify-callback params) but preserve
  // the rest of the URL — the user might have been on a non-default
  // path/hash before connecting.
  const retSaved = sessionStorage.getItem(PKCE_RETURN_KEY);
  sessionStorage.removeItem(PKCE_RETURN_KEY);
  const target = retSaved && retSaved.length > 0 ? retSaved : '/';
  history.replaceState({}, document.title, target);
}

function _persistTokens(accessToken: string, expiresIn: number, refreshToken: string): void {
  try {
    localStorage.setItem(ACCESS_TOKEN_KEY,   accessToken);
    localStorage.setItem(ACCESS_EXPIRES_KEY, String(Date.now() + (expiresIn - 30) * 1000));
    localStorage.setItem(REFRESH_TOKEN_KEY,  refreshToken);
  } catch { /* nothing */ }
}

// ─── Token refresh ─────────────────────────────────────────────────────

/** Returns a valid access token, refreshing it transparently if it
 *  has expired. Returns null if not connected at all. */
export async function getAccessToken(): Promise<string | null> {
  const access  = localStorage.getItem(ACCESS_TOKEN_KEY);
  const expires = parseInt(localStorage.getItem(ACCESS_EXPIRES_KEY) ?? '0', 10);
  if (access && Date.now() < expires) return access;
  return _refreshAccessToken();
}

async function _refreshAccessToken(): Promise<string | null> {
  const refresh  = localStorage.getItem(REFRESH_TOKEN_KEY);
  const clientId = getSpotifyClientId();
  if (!refresh || !clientId) return null;
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refresh,
    client_id:     clientId,
  });
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    console.warn('[spotify] refresh failed:', res.status, await res.text());
    clearSpotifyAuth();
    return null;
  }
  const data = await res.json() as { access_token: string; expires_in: number; refresh_token?: string };
  _persistTokens(
    data.access_token,
    data.expires_in,
    data.refresh_token ?? refresh,
  );
  return data.access_token;
}

// ─── Profile (display name + product) ──────────────────────────────────

async function _refreshProfile(): Promise<SpotifyProfile | null> {
  const token = await getAccessToken();
  if (!token) return null;
  const res = await fetch(ME_URL, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json() as {
    id: string; display_name?: string; product?: string; email?: string;
  };
  const profile: SpotifyProfile = {
    id:          data.id,
    displayName: data.display_name ?? data.id,
    product:     data.product ?? 'unknown',
    ...(data.email ? { email: data.email } : {}),
  };
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* nothing */ }
  return profile;
}

/** Force-refresh the cached profile from /me. Exposed so the Settings
 *  Connect flow can show the fresh profile after a successful auth. */
export async function refreshProfile(): Promise<SpotifyProfile | null> {
  return _refreshProfile();
}
