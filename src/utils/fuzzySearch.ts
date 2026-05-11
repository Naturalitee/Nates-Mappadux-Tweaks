/**
 * Small fuzzy-search helper used by the Image Library connector tabs (and
 * potentially the local library search too). Score-based so we can rank
 * thousands of catalog entries by relevance instead of binary substring
 * match. Pure: no DOM, no IDB, no async.
 *
 * Scoring stack (higher = better match):
 *
 *   • +100  query equals slug or name exactly
 *   • +80   query equals one of the entry's tags exactly
 *   • +60   slug or name starts with the query
 *   • +50   any tag starts with the query
 *   • +30   slug, name, or any tag contains the query as a substring
 *   • +10   query characters appear in order in the name (subsequence)
 *
 * Multiple bonuses can stack — e.g. an exact tag match on an entry whose
 * name also contains the query lands at 80 + 30 = 110.
 *
 * Empty / whitespace-only queries return everything with score=0 (caller
 * decides whether to render them in the original order).
 */

export interface FuzzySearchable {
  /** Stable id / slug — searched with high weight. */
  slug:   string;
  /** Display name — also searched. */
  name:   string;
  /** Free-text tags — searched with medium weight. */
  tags:   readonly string[];
  /** Optional author / creator — searched as a low-weight tag. */
  author?: string;
}

export interface ScoredMatch<T> {
  entry: T;
  score: number;
}

export function fuzzySearch<T extends FuzzySearchable>(
  entries: readonly T[],
  rawQuery: string,
): ScoredMatch<T>[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return entries.map((entry) => ({ entry, score: 0 }));

  const out: ScoredMatch<T>[] = [];
  for (const entry of entries) {
    const score = scoreEntry(entry, q);
    if (score > 0) out.push({ entry, score });
  }
  // Sort: highest score first, then alphabetical tie-break by name.
  out.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
  return out;
}

function scoreEntry(entry: FuzzySearchable, q: string): number {
  const slug = entry.slug.toLowerCase();
  const name = entry.name.toLowerCase();
  const tags = entry.tags.map((t) => t.toLowerCase());
  const author = entry.author?.toLowerCase() ?? '';

  let score = 0;

  if (slug === q || name === q) score += 100;
  if (tags.some((t) => t === q)) score += 80;

  if (slug.startsWith(q) || name.startsWith(q)) score += 60;
  if (tags.some((t) => t.startsWith(q))) score += 50;

  if (slug.includes(q) || name.includes(q) || tags.some((t) => t.includes(q)) || author.includes(q)) {
    score += 30;
  }

  // Subsequence: every character of q appears in name in order. Picks up
  // typos like "drgn" → "Dragon Head".
  if (score === 0 && isSubsequence(q, name)) score += 10;

  return score;
}

function isSubsequence(needle: string, haystack: string): boolean {
  if (needle.length === 0) return true;
  if (needle.length > haystack.length) return false;
  let i = 0;
  for (const c of haystack) {
    if (c === needle[i]) {
      i++;
      if (i === needle.length) return true;
    }
  }
  return false;
}
