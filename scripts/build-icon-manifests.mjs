#!/usr/bin/env node
/**
 * build-icon-manifests — generate JSON manifests for image source
 * connectors that don't publish a single CDN-hosted index.
 *
 * Currently handles:
 *   - Game Icons (game-icons.net via the game-icons/icons GitHub repo)
 *
 * Lucide is handled at runtime by the connector itself (it fetches
 * lucide-static's tags.json from jsDelivr), so it doesn't need a
 * build-time generator.
 *
 * Output: src/images/connectors/manifests/<source>.json
 *
 * Usage:
 *   npm run build-icons              # all sources
 *   npm run build-icons -- game-icons   # one source
 *
 * The script writes JSON files that the connectors import as bundled
 * assets. Re-run when you want to refresh the catalog (the game-icons
 * project lands new icons every few months).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'src', 'images', 'connectors', 'manifests');

const SOURCES = {
  'game-icons': buildGameIcons,
};

const args = process.argv.slice(2);
const wantedSources = args.length > 0
  ? args
  : Object.keys(SOURCES);

await mkdir(OUT_DIR, { recursive: true });

for (const name of wantedSources) {
  const builder = SOURCES[name];
  if (!builder) {
    console.warn(`[build-icons] unknown source: ${name}`);
    continue;
  }
  console.log(`[build-icons] generating ${name}…`);
  const entries = await builder();
  const outPath = join(OUT_DIR, `${name}.json`);
  await writeFile(outPath, JSON.stringify(entries, null, 0) + '\n');
  console.log(`[build-icons] wrote ${entries.length} entries → ${outPath}`);
}

// ── Source builders ────────────────────────────────────────────────────────

/**
 * Game Icons — walks the game-icons/icons GitHub repo tree, collects every
 * .svg file, parses author + slug from the path, and derives display name
 * + tags from the slug words.
 *
 * GitHub's recursive-tree endpoint returns up to 100k items per call —
 * plenty for the ~4k-icon repo. Anonymous rate limit is 60/hour per IP,
 * which is also plenty for a one-shot build.
 */
async function buildGameIcons() {
  const url = 'https://api.github.com/repos/game-icons/icons/git/trees/master?recursive=1';
  const res = await fetch(url, {
    headers: {
      'Accept':     'application/vnd.github.v3+json',
      'User-Agent': 'mappadux-build-icons',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data.truncated) {
    console.warn('[build-icons] GitHub truncated the tree — manifest will be partial');
  }

  const entries = [];
  for (const node of data.tree ?? []) {
    if (node.type !== 'blob') continue;
    if (typeof node.path !== 'string') continue;
    if (!node.path.endsWith('.svg')) continue;
    // Only top-level <author>/<slug>.svg, not any deeper folders.
    const parts = node.path.split('/');
    if (parts.length !== 2) continue;
    const author = parts[0];
    const fileName = parts[1].replace(/\.svg$/, '');
    if (!author || !fileName) continue;

    const slug = `${author}/${fileName}`;
    const name = humanise(fileName);
    const tags = fileName.split('-').map((s) => s.toLowerCase()).filter(Boolean);

    entries.push({
      slug,
      name,
      tags,
      author: capitalise(author),
    });
  }
  // Sort by name for deterministic diffs across builds.
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function humanise(slug) {
  return slug.split('-').map(capitalise).join(' ');
}

function capitalise(s) {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
