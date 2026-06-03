import { getAllMaps } from './db.ts';
import { importBundle } from './bundleIO.ts';
import { DEFAULT_SEED_DONE_KEY } from './localSettings.ts';

const DEFAULT_BUNDLE_URL = '/default-bundle.json';

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
      return 'Getting Started';
    }
    return null;
  } catch {
    // Non-fatal — app still works without a preloaded bundle
    return null;
  }
}
