import { getAllMaps, clearEverything, loadSession, saveSession } from './db.ts';
import { importBundle } from './bundleIO.ts';
import { DEFAULT_SEED_DONE_KEY, setWelcomePackSeededVersion } from './localSettings.ts';

const DEFAULT_BUNDLE_URL = '/default-bundle.json';

/**
 * v2.17.19 — Content version of the bundled Getting Started pack
 * (public/default-bundle.json). BUMP THIS whenever the default bundle is
 * regenerated with new content. The seeded version is recorded per browser;
 * when this constant is newer, the GM is offered a one-click refresh of the
 * tour (it is never auto-replaced — see GMApp._maybeOfferWelcomePackRefresh).
 *
 *   1 — original tour (no walkthrough video)
 *   2 — adds the embedded walkthrough video (shipped 2026-06-05)
 */
export const WELCOME_PACK_VERSION = 2;

/**
 * On first run (empty map library) fetch and import the default bundle from
 * public/default-bundle.json. If the file is absent or the bundle is empty
 * the app simply starts with no maps — non-fatal.
 *
 * Returns the suggested pack name to attach to the session when the seed
 * actually fired (e.g. "Getting Started" for the canned starter pack), or
 * `null` if nothing was seeded. The session record itself doesn't exist
 * yet at this point — startHost creates it — so the caller is responsible
 * for forwarding this value into the eventual saveSession call.
 */
export async function seedDefaultMaps(): Promise<string | null> {
  // v2.17.3 — Getting Started seeds only ONCE, ever. After the first run (or
  // after the user takes control via New Map Pack / having their own maps) the
  // workspace stays empty when empty, instead of re-seeding Getting Started
  // every time the DB has no maps. Delete All Data wipes this flag, so a
  // genuine fresh install still seeds.
  try { if (localStorage.getItem(DEFAULT_SEED_DONE_KEY) === '1') return null; } catch { /* private mode */ }

  const existing = await getAllMaps();
  if (existing.length > 0) {
    // Existing content means the user already has a workspace — never auto-seed.
    try { localStorage.setItem(DEFAULT_SEED_DONE_KEY, '1'); } catch { /* private mode */ }
    return null;
  }

  try {
    const res = await fetch(DEFAULT_BUNDLE_URL);
    if (!res.ok) return null; // No default bundle present — that's fine

    const file = new File([await res.blob()], 'default-bundle.json', { type: 'application/json' });
    const { added } = await importBundle(file);
    if (added > 0) {
      try { localStorage.setItem(DEFAULT_SEED_DONE_KEY, '1'); } catch { /* private mode */ }
      // Record which welcome-pack version this browser now holds, so a future
      // content bump can offer a refresh without re-nagging users already current.
      setWelcomePackSeededVersion(WELCOME_PACK_VERSION);
      return 'Getting Started';
    }
    return null;
  } catch {
    // Non-fatal — app still works without a preloaded bundle
    return null;
  }
}

/**
 * v2.17.19 — Replace the workspace with a fresh copy of the current default
 * bundle (the updated Getting Started tour). Used by the "a new tour is
 * available" offer once the GM has CONSENTED — this wipes the current
 * workspace, so the caller must confirm first and reload the UI afterwards.
 * The room code is preserved so the GM keeps the same join link.
 *
 * Returns true on success, false if the bundle couldn't be fetched/imported
 * (in which case the workspace has already been cleared — the caller should
 * reload regardless so the app re-seeds cleanly).
 */
export async function reseedWelcomePack(): Promise<boolean> {
  const session = await loadSession();
  const peerId = session?.peerId ?? '';
  await clearEverything();
  // Recreate a minimal session so importBundle can restore the pack's
  // metadata (packName, lastMapId, any splash/theme) into it.
  await saveSession({ key: 'current', peerId, lastMapId: null, packName: 'Getting Started' });
  try {
    const res = await fetch(DEFAULT_BUNDLE_URL);
    if (!res.ok) return false;
    const file = new File([await res.blob()], 'default-bundle.json', { type: 'application/json' });
    const { added } = await importBundle(file);
    if (added <= 0) return false;
    try { localStorage.setItem(DEFAULT_SEED_DONE_KEY, '1'); } catch { /* private mode */ }
    setWelcomePackSeededVersion(WELCOME_PACK_VERSION);
    return true;
  } catch {
    return false;
  }
}
