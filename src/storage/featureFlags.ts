/**
 * Feature flags — runtime toggles for features that aren't fully
 * baked. Hides the configuration UI from regular users so the
 * feature is invisible unless someone explicitly opts in. Existing
 * configurations are untouched — once a user has set up Stagecraft
 * or Soundtracks, the sidebar panels appear normally regardless of
 * this flag.
 *
 * v2.15.17 — added so the v2.16 Stagecraft + Soundtracks scaffold
 * can ride along on production builds without surfacing to anyone
 * who hasn't been told about it.
 */

const IN_PROGRESS_KEY = 'mappadux:enable_in_progress_features';

/** Default for the flag when the user hasn't explicitly set it.
 *
 *  - Production (www.mappadux.com) → false. New users see nothing.
 *  - Anywhere else (beta.*, localhost, deploy previews, file://)
 *    → true. Beta testers see the in-progress UI by default; they
 *    can still flip it off in Danger Zone to test "as if production".
 *
 *  Detection is by hostname rather than build env so the same
 *  bundle can ship to both channels — Vercel's deploy-preview URLs
 *  end up "on" by default which is exactly what we want for
 *  reviewing PRs. */
function _defaultEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  const host = location.hostname.toLowerCase();
  // Treat www.mappadux.com (and a future apex mappadux.com) as
  // production. Everything else is some form of preview / dev /
  // beta and gets the in-progress UI on by default.
  return !(host === 'www.mappadux.com' || host === 'mappadux.com');
}

export function isInProgressEnabled(): boolean {
  try {
    const raw = localStorage.getItem(IN_PROGRESS_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return _defaultEnabled();
  } catch {
    return _defaultEnabled();
  }
}

export function setInProgressEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(IN_PROGRESS_KEY, enabled ? '1' : '0');
  } catch { /* private mode etc. — no-op */ }
}

/** Clear the override so the default-by-hostname kicks back in.
 *  Useful if a tester gets confused about their current state. */
export function resetInProgressFlag(): void {
  try { localStorage.removeItem(IN_PROGRESS_KEY); } catch { /* nothing */ }
}

/** Human-readable description of where the default came from —
 *  used in the Danger Zone toggle's help text so the user knows
 *  why the toggle starts at whatever state. */
export function inProgressFlagOrigin(): string {
  try {
    const raw = localStorage.getItem(IN_PROGRESS_KEY);
    if (raw === '1') return 'manually enabled';
    if (raw === '0') return 'manually disabled';
  } catch { /* fall through */ }
  return _defaultEnabled() ? 'default on (beta / dev)' : 'default off (production)';
}
