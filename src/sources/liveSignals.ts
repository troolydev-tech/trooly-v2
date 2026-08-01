import { config } from '../config.js';
import { readUrl } from './scrape.js';

/**
 * "Is this person running a funded project right now?"
 *
 * The strongest public signal is a recruitment advertisement for project staff:
 * those posts name the principal investigator, the funding body, and the equipment.
 * Tenders, grant announcements and news pages are secondary.
 *
 * This searches narrowly — institute domain plus a few path keywords — rather than
 * crawling whole sites.
 */

export type RawSignal = { url: string; snippet: string; text: string | null };

const PATH_KEYWORDS = ['recruitment', 'jobs', 'vacancy', 'tender', 'news', 'announcement'];

async function serper(query: string, limit: number): Promise<{ link: string; snippet: string }[]> {
  if (!config.serperKey) return [];
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': config.serperKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: limit, gl: 'in' }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { organic?: { link: string; snippet?: string }[] };
  return (data.organic ?? []).map((o) => ({ link: o.link, snippet: o.snippet ?? '' }));
}

export async function findLiveSignals(
  name: string,
  institution: string,
  opts: { maxPages?: number } = {},
): Promise<RawSignal[]> {
  const maxPages = opts.maxPages ?? 3;

  const queries = [
    `"${name}" ${institution} (JRF OR SRF OR "project associate") recruitment`,
    `"${name}" ${institution} sponsored project funded`,
  ];

  const seen = new Set<string>();
  const hits: { link: string; snippet: string }[] = [];

  for (const q of queries) {
    for (const r of await serper(q, 6)) {
      if (seen.has(r.link)) continue;
      const looksRelevant = PATH_KEYWORDS.some((k) => r.link.toLowerCase().includes(k));
      if (!looksRelevant && hits.length >= maxPages) continue;
      seen.add(r.link);
      hits.push(r);
    }
  }

  const chosen = hits.slice(0, maxPages);
  return Promise.all(
    chosen.map(async (h) => ({ url: h.link, snippet: h.snippet, text: await readUrl(h.link) })),
  );
}
