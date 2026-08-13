import { z } from 'zod';
import { readUrl } from './scrape.js';
import { MODELS } from '../config.js';
import { structured, CostMeter } from '../lib/claude.js';

/**
 * Scrape a company website:
 *  1. Read the homepage in HTML mode (for link discovery) AND markdown mode (for content).
 *  2. Extract all internal links from the HTML.
 *  3. Ask Claude to pick the most relevant ones (industry-agnostic — no hardcoded keywords).
 *  4. Read those pages in parallel.
 *  5. Return all pages combined.
 */

function extractLinks(text: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const base = new URL(baseUrl);

  // Normalise: strip www and protocol for comparison
  const baseHost = base.hostname.replace(/^www\./, '');

  // Only match markdown-style links — HTML mode from Jina is too noisy on JS-heavy sites
  const pattern = /\[([^\]]+)\]\(([^)]+)\)/g;

  for (const match of text.matchAll(pattern)) {
    const url = match[2];
    if (!url) continue;
    try {
      const abs = new URL(url, base).toString();
      const parsed = new URL(abs);
      const parsedHost = parsed.hostname.replace(/^www\./, '');

      // Same host (with or without www), not a fragment, not a file asset
      if (
        parsedHost === baseHost &&
        !abs.includes('#') &&
        !abs.match(/\.(pdf|jpg|jpeg|png|svg|gif|webp|css|js)$/i)
      ) {
        // Rebuild with base's canonical host so www/non-www don't split into two entries
        const canonical = `${base.protocol}//${baseHost}${parsed.pathname}${parsed.search}`;
        links.add(canonical.replace(/\/$/, ''));
      }
    } catch {
      // ignore bad URLs
    }
  }
  return [...links];
}

const RelevantLinks = z.object({
  chosen_urls: z.array(z.string()).max(6),
  reasoning: z.string(),
});

export type ScrapedPage = { url: string; text: string };

export async function scrapeCompanyWebsite(
  websiteUrl: string,
  opts: { maxPages?: number; meter?: CostMeter } = {},
): Promise<ScrapedPage[]> {
  const maxPages = opts.maxPages ?? 5;
  const meter = opts.meter ?? new CostMeter();
  const pages: ScrapedPage[] = [];

  // 1. Read the homepage in markdown mode
  const home = await readUrl(websiteUrl).catch(() => null);

  if (!home) return pages;
  pages.push({ url: websiteUrl, text: home });

  // 2. Extract internal links from the markdown
  const allLinks = extractLinks(home, websiteUrl)
    .filter((url) => url.replace(/\/$/, '') !== websiteUrl.replace(/\/$/, ''));

  if (allLinks.length === 0) return pages;

  // 3. Ask Claude to pick relevant ones
  const linksToShow = allLinks.slice(0, 60).join('\n');

  const picked = await structured({
    model: MODELS.extractor,
    schemaName: 'submit_relevant_urls',
    schemaDescription: 'Which URLs on this company website are most likely product / service / about pages.',
    schema: RelevantLinks,
    maxTokens: 1500,
    meter,
    system:
      'You are picking which pages of a company website are worth reading to understand what ' +
      'the company sells. Choose pages describing products, services, solutions, equipment, ' +
      'catalog items, or "about the company". IGNORE pages that are: contact forms, privacy ' +
      'policies, terms, blog posts, news articles, careers, individual case studies, login/signup, ' +
      'shopping cart. Choose at most 5 URLs. Return the exact URLs as given.',
    prompt:
      `Company website: ${websiteUrl}\n\n` +
      `Here are the internal links found on the homepage:\n${linksToShow}\n\n` +
      `Which ones should we read to understand their products and services?`,
  }).catch(() => ({ chosen_urls: [], reasoning: '' }));

  // 4. Read them in parallel — only ones that were actually in our list
  const validUrls = picked.chosen_urls
    .filter((url) => allLinks.some((l) => l.replace(/\/$/, '') === url.replace(/\/$/, '')))
    .slice(0, maxPages - 1);

  const results = await Promise.all(
    validUrls.map(async (url) => {
      const text = await readUrl(url).catch(() => null);
      return text ? { url, text } : null;
    }),
  );

  for (const r of results) if (r) pages.push(r);
  return pages;
}