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

// ── Serper: Google search ──────────────────────────────────────────────────

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

// ── Profile page finder ────────────────────────────────────────────────────

const TRUSTED_PROFILE_DOMAINS = [
  'scholar.google',
  'researchgate.net',
  'academia.edu',
  'ncl.res.in',
  'irins.org',
  'vidwan.inflibnet.ac.in',
  'iitb.ac.in',
  'iitd.ac.in',
  'iitm.ac.in',
  'iisc.ac.in',
  'bits-pilani.ac.in',
];

function isProfilePage(url: string): boolean {
  return TRUSTED_PROFILE_DOMAINS.some((d) => url.includes(d));
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
 * Step 1: Google the person to find their real profile page.
 * Step 2: Try OpenAlex for structured publication data.
 * Step 3: Return whatever we found — even if OpenAlex has nothing,
 *         the profile page text is still valuable for the research step.
 */
export async function resolveAuthor(name: string, institution: string): Promise<AuthorMatch | null> {
  let profileUrl: string | null = null;
  let profileText: string | null = null;

  // Google them first
  const results = await googleSearch(
    `"${name}" ${institution} research publications`,
    8,
  ).catch(() => []);

  // Find the best profile page from results
  const profileHit = results.find((r) => isProfilePage(r.link));
  if (profileHit) {
    profileUrl = profileHit.link;
    profileText = await readUrl(profileHit.link).catch(() => null);
  }

  // Also try OpenAlex in parallel
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

  // Score OpenAlex results by institution overlap
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

  const scored = (oaData.results ?? []).map((a) => {
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

  scored.sort((x, y) =>
    y.institutionConfidence - x.institutionConfidence || y.worksCount - x.worksCount,
  );

  const top = scored[0];
  const hasOA = top && top.institutionConfidence >= 0.25;

  // Return something as long as we found either a profile page or an OA record
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

// ── Publications from OpenAlex ─────────────────────────────────────────────

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

  return (data.results ?? []).map((w) => ({
    title: w.title ?? w.display_name ?? 'Untitled',
    year: w.publication_year,
    venue: w.primary_location?.source?.display_name ?? null,
    abstract: reconstructAbstract(w.abstract_inverted_index),
    url: w.doi,
  }));
}