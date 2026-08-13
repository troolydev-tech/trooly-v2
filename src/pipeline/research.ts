import { z } from 'zod';
import { MODELS } from '../config.js';
import { structured, type CostMeter } from '../lib/claude.js';
import { step, log } from '../lib/log.js';
import { resolveAuthor, recentWorks } from '../sources/openalex.js';
import { lookupDirectory } from '../sources/directory.js';
import { findLiveSignals } from '../sources/liveSignals.js';
import { ResearchBundle, type ProspectInput } from '../schemas.js';

/**
 * Extractor output — every extracted fact carries its own source_url and
 * source_quote. Nothing gets into the ResearchBundle without a receipt.
 */
const Sourced = z.object({
  value: z.string(),
  source_url: z.string(),
  source_quote: z.string().min(5),
});

const ExtractedSignals = z.object({
  department: z.string().nullable(),
  research_focus: Sourced.nullable(),
  equipment_mentioned: z.array(Sourced),
  projects: z.array(
    z.object({
      description: z.string(),
      signal_type: z.enum(['recruitment_ad', 'grant', 'tender', 'news', 'thesis']),
      dated: z.string().nullable(),
      source_url: z.string(),
      source_quote: z.string().min(5),
    }),
  ),
  publications_found: z.array(
    z.object({
      title: z.string(),
      year: z.number().nullable(),
      venue: z.string().nullable(),
      source_url: z.string(),
      source_quote: z.string().min(5),
    }),
  ),
});

export async function research(
  prospect: ProspectInput,
  meter: CostMeter,
): Promise<ResearchBundle> {
  const s = step('research');
  const sourcesUsed: string[] = [];

  // Step 1: Find their profile page via Google, and try OpenAlex
  const author = await resolveAuthor(prospect.name, prospect.institution).catch((e) => {
    log('warn', 'resolve_failed', { error: String(e) });
    return null;
  });

  // Step 2: Get structured publications from OpenAlex if we have an ID.
  // OpenAlex publications get openalex.org as their source URL.
  let publications: ResearchBundle['publications'] = [];
  if (author?.openalexId) {
    sourcesUsed.push('openalex');
    const rawPubs = await recentWorks(author.openalexId).catch(() => []);
    publications = rawPubs.map((p) => ({
      ...p,
      source_url: p.url ?? `https://openalex.org/${author.openalexId}`,
      source_quote: `${p.title}${p.year ? ` (${p.year})` : ''}${p.venue ? `, ${p.venue}` : ''}`,
    }));
  }

  // Step 3: Institutional directory
  const dir = await lookupDirectory(prospect.name, prospect.institution).catch(() => null);
  if (dir) sourcesUsed.push('directory');

  // Step 4: Live signals — recruitment ads, grants, tenders
  const signals = await findLiveSignals(prospect.name, prospect.institution).catch(() => []);
  if (signals.length) sourcesUsed.push('live_signals');

  // Step 5: Profile page from Google
  if (author?.profileUrl) sourcesUsed.push('profile_page');

  // Step 6: One extraction call to pull structured, sourced facts from all raw text.
  let extracted: z.infer<typeof ExtractedSignals> = {
    department: null,
    research_focus: null,
    equipment_mentioned: [],
    projects: [],
    publications_found: [],
  };

  const rawText = [
    author?.profileText
      ? `SOURCE_URL: ${author.profileUrl}\nCONTENT:\n${author.profileText.slice(0, 10000)}`
      : '',
    dir
      ? `SOURCE_URL: ${dir.url}\nCONTENT:\n${dir.text.slice(0, 8000)}`
      : '',
    ...signals.map(
      (sig) => `SOURCE_URL: ${sig.url}\nCONTENT:\n${sig.snippet}\n${(sig.text ?? '').slice(0, 6000)}`,
    ),
  ].filter(Boolean).join('\n\n---\n\n');

  if (rawText.length > 200) {
    extracted = await structured({
      model: MODELS.extractor,
      schemaName: 'submit_extracted_signals',
      schemaDescription: 'Sourced facts extracted verbatim from source documents.',
      schema: ExtractedSignals,
      meter,
      system:
        'You extract facts about a researcher from source documents.\n\n' +
        'CRITICAL GROUNDING RULE\n' +
        'Every fact you output must include:\n' +
        '  - source_url: the SOURCE_URL of the document where you found the fact\n' +
        '  - source_quote: a verbatim snippet (5-200 words) from that source that supports ' +
        '    the fact. This must be a direct copy from the source, not paraphrased.\n\n' +
        'If you cannot find a verbatim supporting quote in any source, you MUST NOT include ' +
        'that fact. Return an empty array or null for that field instead.\n\n' +
        'DO NOT infer, guess, or extend a source. If the source mentions "3D printing" you may ' +
        'not claim "filament development" unless the word "filament" or a clear synonym is in ' +
        'the actual quote you cite.\n\n' +
        'EXTRACTION GUIDANCE\n' +
        '- department: their department, in the sources or null if not stated\n' +
        '- research_focus: one sentence, sourced. Only claim what the source quote actually says.\n' +
        '- equipment_mentioned: instruments/lab equipment named in the sources — each sourced\n' +
        '- projects: active or recently funded projects — each sourced. A project counts as ' +
        '  active only if the source says it is ongoing, recruiting, funded, or dated within ' +
        '  the last 2 years.\n' +
        '- publications_found: paper titles and years visible in the sources — each sourced',
      prompt:
        `Person: ${prospect.name}\n` +
        `Institution: ${prospect.institution}\n\n` +
        `Extract structured, sourced facts. Every fact must include source_url + verbatim source_quote.\n\n` +
        `SOURCES:\n${rawText}`,
    }).catch((e) => {
      log('warn', 'extract_failed', { error: String(e) });
      return extracted;
    });
  }

  // Merge publications: OpenAlex structured data + anything scraped from profile page
  const scrapedPubs = extracted.publications_found.map((p) => ({
    title: p.title,
    year: p.year,
    venue: p.venue,
    abstract: null,
    url: null,
    source_url: p.source_url,
    source_quote: p.source_quote,
  }));

  const allTitles = new Set(publications.map((p) => p.title.toLowerCase()));
  for (const p of scrapedPubs) {
    if (!allTitles.has(p.title.toLowerCase())) publications.push(p);
  }

  const bundle: ResearchBundle = {
    identity: {
      resolved_name: author?.displayName ?? prospect.name,
      institution: author?.institution ?? prospect.institution,
      department: extracted.department ?? prospect.department ?? null,
      profile_url: author?.profileUrl ?? dir?.url ?? null,
      confidence: author?.profileUrl
        ? 'high'
        : author?.openalexId
        ? 'medium'
        : sourcesUsed.length > 0
        ? 'low'
        : 'none',
    },
    research_focus: extracted.research_focus,
    publications,
    live_projects: extracted.projects,
    sources_used: sourcesUsed,
  };

  s.done({
    sources: sourcesUsed.length,
    pubs: publications.length,
    projects: extracted.projects.length,
    research_focus: extracted.research_focus?.value ?? null,
    equipment_count: extracted.equipment_mentioned.length,
  });

  return bundle;
}