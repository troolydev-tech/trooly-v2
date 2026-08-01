import { z } from 'zod';
import { MODELS } from '../config.js';
import { structured, type CostMeter } from '../lib/claude.js';
import { step, log } from '../lib/log.js';
import { resolveAuthor, recentWorks } from '../sources/openalex.js';
import { lookupDirectory } from '../sources/directory.js';
import { findLiveSignals } from '../sources/liveSignals.js';
import { ResearchBundle, type ProspectInput } from '../schemas.js';

const ExtractedSignals = z.object({
  department: z.string().nullable(),
  research_focus: z.string().nullable(),
  equipment_mentioned: z.array(z.string()),
  projects: z.array(
    z.object({
      description: z.string(),
      evidence_url: z.string().nullable(),
      signal_type: z.enum(['recruitment_ad', 'grant', 'tender', 'news', 'thesis']),
      dated: z.string().nullable(),
    }),
  ),
  publications_found: z.array(
    z.object({
      title: z.string(),
      year: z.number().nullable(),
      venue: z.string().nullable(),
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

  // Step 2: Get structured publications from OpenAlex if we have an ID
  let publications: ResearchBundle['publications'] = [];
  if (author?.openalexId) {
    sourcesUsed.push('openalex');
    publications = await recentWorks(author.openalexId).catch(() => []);
  }

  // Step 3: Institutional directory
  const dir = await lookupDirectory(prospect.name, prospect.institution).catch(() => null);
  if (dir) sourcesUsed.push('directory');

  // Step 4: Live signals — recruitment ads, grants, tenders
  const signals = await findLiveSignals(prospect.name, prospect.institution).catch(() => []);
  if (signals.length) sourcesUsed.push('live_signals');

  // Step 5: If we found a profile page, that's a source too
  if (author?.profileUrl) sourcesUsed.push('profile_page');

  // Step 6: One Haiku call to extract structured facts from ALL raw text sources
  let extracted: z.infer<typeof ExtractedSignals> = {
    department: null,
    research_focus: null,
    equipment_mentioned: [],
    projects: [],
    publications_found: [],
  };

  const rawText = [
    author?.profileText
      ? `SOURCE: ${author.profileUrl}\n${author.profileText.slice(0, 10000)}`
      : '',
    dir
      ? `SOURCE: ${dir.url}\n${dir.text.slice(0, 8000)}`
      : '',
    ...signals.map(
      (sig) => `SOURCE: ${sig.url}\n${sig.snippet}\n${(sig.text ?? '').slice(0, 6000)}`,
    ),
  ].filter(Boolean).join('\n\n---\n\n');

  if (rawText.length > 200) {
    extracted = await structured({
      model: MODELS.cheap,
      schemaName: 'submit_extracted_signals',
      schemaDescription: 'Structured facts extracted from source documents about this researcher.',
      schema: ExtractedSignals,
      meter,
      system:
        'You extract facts from source documents about a researcher. ' +
        'You never infer, guess, or add information not written in the text. ' +
        'If a field is not stated in the sources, return null or an empty array. ' +
        'For publications_found, extract any paper titles and years you can see in the sources. ' +
        'For equipment_mentioned, list any lab equipment, instruments, or machines named. ' +
        'For research_focus, write one sentence summarising their main research area based only on what you read.',
      prompt:
        `Person: ${prospect.name}\n` +
        `Institution: ${prospect.institution}\n\n` +
        `Extract structured facts about this person from the sources below.\n\n` +
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
  }));

  // OpenAlex pubs take priority; add scraped ones that aren't already there
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
    publications,
    live_projects: extracted.projects,
    sources_used: sourcesUsed,
  };

  s.done({
    sources: sourcesUsed.length,
    pubs: publications.length,
    projects: extracted.projects.length,
    research_focus: extracted.research_focus,
    equipment: extracted.equipment_mentioned,
  });

  return bundle;
}