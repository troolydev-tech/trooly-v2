import { config } from '../config.js';
import { readUrl } from './scrape.js';
import type { Publication } from '../schemas.js';

const BASE = 'https://api.openalex.org';

function withMailto(url: string): string {
  if (!config.openAlexMailto) return url;
  return url + (url.includes('?') ? '&' : '?') + `mailto=${encodeURIComponent(config.openAlexMailto)}`;
}

async function openAlexGet<T>(path: string): Promise<T> {
  const res = await fetch(withMailto(`${BASE}${path}`), {
    headers: { 'User-Agent': `trooly/0.1 (${config.openAlexMailto || 'no-contact'})` },
  });
  if (!res.ok) throw new Error(`OpenAlex ${res.status} on ${path}`);
  return (await res.json()) as T;
}

function reconstructAbstract(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null;
  const slots: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const p of positions) slots[p] = word;
  }
  const text = slots.filter(Boolean).join(' ').trim();
  return text.length > 0 ? text : null;
}

// ── Google search via SerpAPI ─────────────────────────────────────────────

async function googleSearch(query: string, limit = 5): Promise<{ link: string; snippet: string }[]> {
  if (!config.serperKey) return [];
  const params = new URLSearchParams({
    api_key: config.serperKey,
    q: query,
    num: String(limit),
    gl: 'in',
  });
  const res = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { organic_results?: { link: string; snippet?: string }[] };
  return (data.organic_results ?? []).map((o) => ({ link: o.link, snippet: o.snippet ?? '' }));
}

// ── Profile page discovery ────────────────────────────────────────────────
// No hardcoded domain whitelist. We trust Google's ranking, skip obvious noise,
// then use content signals to pick the page most likely to be the right person.

const NOISE_DOMAINS = [
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
  'youtube.com', 'youtu.be',
  'reddit.com', 'quora.com',
  'pinterest.com', 'tumblr.com',
];

function isNoise(url: string): boolean {
  return NOISE_DOMAINS.some((d) => url.includes(d));
}

export type AuthorMatch = {
  openalexId: string | null;
  displayName: string;
  institution: string | null;
  worksCount: number;
  institutionConfidence: number;
  profileUrl: string | null;
  profileText: string | null;
};

/**
 * Step 1: Google the person, read the top few results, pick the one whose content
 *         most clearly matches them (their name + institution + evidence of a profile).
 * Step 2: Try OpenAlex for structured publication data as a bonus.
 * Step 3: Return whatever we found. Profile page text alone is valuable if OA has nothing.
 */
export async function resolveAuthor(name: string, institution: string): Promise<AuthorMatch | null> {
  let profileUrl: string | null = null;
  let profileText: string | null = null;

  // Google them
  const results = await googleSearch(
    `"${name}" ${institution} research publications`,
    8,
  ).catch(() => []);

  // Read the top few non-noise results in parallel
  const candidates = results.filter((r) => !isNoise(r.link)).slice(0, 3);

  const scraped = await Promise.all(
    candidates.map(async (c) => {
      const text = await readUrl(c.link).catch(() => null);
      return text && text.length > 500 ? { url: c.link, text } : null;
    }),
  );

  // Score each scraped page by content match: does it mention their name AND
  // institution, and does it look like a profile / publication page?
  const nameParts = name.toLowerCase().split(/\s+/).filter((p) => p.length > 2);
  const instFirstWord = institution.toLowerCase().split(/\s+/)[0] ?? '';

  let bestPage: { url: string; text: string } | null = null;
  let bestScore = 0;
  for (const page of scraped) {
    if (!page) continue;
    const t = page.text.toLowerCase();
    const nameHits = nameParts.filter((p) => t.includes(p)).length;
    const instHit = instFirstWord && t.includes(instFirstWord) ? 1 : 0;
    const profileSignal = /publication|paper|research|author|professor|faculty|scholar/.test(t) ? 1 : 0;
    const score = nameHits * 2 + instHit + profileSignal;
    if (score > bestScore) {
      bestScore = score;
      bestPage = page;
    }
  }

  if (bestPage && bestScore >= 3) {
    profileUrl = bestPage.url;
    profileText = bestPage.text;
  }

  // Try OpenAlex in parallel for structured publication data
  type OAAuthor = {
    id: string;
    display_name: string;
    works_count: number;
    last_known_institutions?: { display_name: string }[];
    last_known_institution?: { display_name: string } | null;
    affiliations?: { institution: { display_name: string } }[];
  };

  const oaData = await openAlexGet<{ results: OAAuthor[] }>(
    `/authors?search=${encodeURIComponent(name)}&per-page=10`,
  ).catch(() => ({ results: [] }));

  function overlap(a: string, b: string): number {
    const norm = (s: string) =>
      new Set(
        s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
          .filter((t) => t.length > 2 && !['the', 'and', 'for', 'institute', 'university', 'national'].includes(t)),
      );
    const A = norm(a); const B = norm(b);
    if (A.size === 0 || B.size === 0) return 0;
    let hits = 0;
    for (const t of A) if (B.has(t)) hits++;
    return hits / Math.min(A.size, B.size);
  }

  const scoredOA = (oaData.results ?? []).map((a) => {
    const insts: string[] = [];
    if (a.last_known_institutions) insts.push(...a.last_known_institutions.map((i) => i.display_name));
    if (a.last_known_institution) insts.push(a.last_known_institution.display_name);
    if (a.affiliations) insts.push(...a.affiliations.map((f) => f.institution.display_name));
    const unique = [...new Set(insts.filter(Boolean))];
    const best = unique.reduce((m, i) => Math.max(m, overlap(institution, i)), 0);
    return {
      openalexId: a.id.replace('https://openalex.org/', ''),
      displayName: a.display_name,
      institution: unique[0] ?? null,
      worksCount: a.works_count,
      institutionConfidence: best,
    };
  });

  scoredOA.sort((x, y) =>
    y.institutionConfidence - x.institutionConfidence || y.worksCount - x.worksCount,
  );

  const top = scoredOA[0];
  const hasOA = top && top.institutionConfidence >= 0.25;

  // Return null only if we found nothing on either path
  if (!profileUrl && !hasOA) return null;

  return {
    openalexId: hasOA && top ? top.openalexId : null,
    displayName: hasOA && top ? top.displayName : name,
    institution: hasOA && top ? top.institution : institution,
    worksCount: hasOA && top ? top.worksCount : 0,
    institutionConfidence: hasOA && top ? top.institutionConfidence : 0.5,
    profileUrl,
    profileText,
  };
}

// ── Publications from OpenAlex ────────────────────────────────────────────

type OAWork = {
  title: string | null;
  display_name: string | null;
  publication_year: number | null;
  doi: string | null;
  abstract_inverted_index: Record<string, number[]> | null;
  primary_location: { source: { display_name: string } | null } | null;
};

export async function recentWorks(
  openalexId: string,
  opts: { sinceYear?: number; limit?: number } = {},
): Promise<Publication[]> {
  const sinceYear = opts.sinceYear ?? new Date().getFullYear() - 4;
  const limit = opts.limit ?? 15;

  const data = await openAlexGet<{ results: OAWork[] }>(
    `/works?filter=author.id:${openalexId},from_publication_date:${sinceYear}-01-01` +
      `&sort=publication_date:desc&per-page=${limit}`,
  );

  return (data.results ?? []).map((w) => {
    const title = w.title ?? w.display_name ?? 'Untitled';
    const year = w.publication_year;
    const venue = w.primary_location?.source?.display_name ?? 'OpenAlex';
    const source_url = w.doi ? `https://doi.org/${w.doi.replace(/^https?:\/\//, '').replace(/^doi:\/?/, '')}` : `https://openalex.org/${openalexId}`;
    const source_quote = `${title} (${year ?? 'n.d.'}), ${venue}`.trim();

    return {
      title,
      year,
      venue: w.primary_location?.source?.display_name ?? null,
      abstract: reconstructAbstract(w.abstract_inverted_index),
      url: w.doi,
      source_url,
      source_quote,
    };
  });
}