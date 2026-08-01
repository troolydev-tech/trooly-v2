import { readUrl } from './scrape.js';

/**
 * Institutional researcher directories (VIDWAN / IRINS).
 *
 * These have no public API, so this is a scrape adapter. It is isolated behind one
 * function on purpose: when a directory changes its HTML, you fix it here and nothing
 * else in the pipeline needs to know.
 *
 * Returns raw page text. Extraction into structured fields happens in the pipeline
 * with a single cheap model call, not with brittle selectors.
 */

export type DirectoryHit = { url: string; text: string };

/** IRINS runs per-institute subdomains. Add the ones your customers actually target. */
const IRINS_HOSTS: Record<string, string> = {
  // 'iit bombay': 'iitb.irins.org',
  // 'iit delhi':  'iitd.irins.org',
};

function normaliseInstitution(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Best-effort directory lookup. Returns null when it can't find anything —
 * the pipeline is designed to degrade gracefully rather than fail.
 */
export async function lookupDirectory(
  name: string,
  institution: string,
): Promise<DirectoryHit | null> {
  const key = normaliseInstitution(institution);
  const host = Object.entries(IRINS_HOSTS).find(([k]) => key.includes(k))?.[1];
  if (!host) return null;

  const searchUrl = `https://${host}/profile/search?q=${encodeURIComponent(name)}`;
  const text = await readUrl(searchUrl);
  if (!text || text.length < 200) return null;
  return { url: searchUrl, text };
}
