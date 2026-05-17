/**
 * Message of the Day — one-off popup shown the first time a user
 * launches Mappadux after a version bump. Bump the `version` field
 * whenever you want the message to re-show for everyone; edit the
 * `title` + `body` lines to whatever you want to surface that release
 * (new feature highlight, breaking change, ask for feedback, etc.).
 *
 * Suppression rules (enforced in GMApp):
 *   • Suppressed entirely on first install — the auto-About dialog is
 *     the welcome message in that case.
 *   • Deferred to the next session if the About dialog happens to be
 *     open at startup time (a fresh user mid-exploration shouldn't be
 *     stacked-up with two popups).
 *   • Marked seen on dismiss — won't reappear until the version field
 *     here changes again.
 *
 * Versioning convention:
 *   • Use the app version the message is "about" (e.g. '2.12.0').
 *   • Bumping the patch number on a non-MOTD release is fine — leave
 *     `version` alone unless you actually want to talk to users.
 *   • Setting `version` to an empty string disables the MOTD globally.
 */

export interface MotdEntry {
  /** Trigger key. Re-shows whenever this value differs from the
   *  user's stored 'last seen' value. Empty string disables. */
  version: string;
  /** Headline shown in the modal's title bar. */
  title:   string;
  /** Paragraphs of plain-text body. Each entry becomes its own <p>;
   *  no HTML interpretation (textContent only) — keeps the popup
   *  safe to render even if a future build accidentally pastes
   *  unescaped content here. */
  body:    string[];
}

export const CURRENT_MOTD: MotdEntry = {
  version: '2.12.0',
  title:   'Welcome to v2.12 — Immersion',
  body:    [
    "Animated backdrops, MapFX shaders, and per-polygon shader effects landed in this release. Pop a Coloured Flames patch on a campfire, try the new Aurora or Embers backdrops in the FX menu, and tweak the colours to match your map.",
    "If you spot bugs or have ideas, the Discord link is in the About dialog (hamburger menu → About). Thanks for trying Mappadux at home.",
  ],
};
