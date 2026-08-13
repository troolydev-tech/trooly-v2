import { z } from 'zod';
import { MODELS } from '../config.js';
import { structured, CostMeter } from '../lib/claude.js';
import { step, log } from '../lib/log.js';
import { scrapeCompanyWebsite } from '../sources/companyScraper.js';

/**
 * Given a company name + website + optional file contents,
 * scrape the site, combine everything, and ask Claude to extract:
 * - a summary of the company
 * - a list of products with their details
 *
 * EVERY factual field carries a source_url and a source_quote — the exact
 * span of text from a source document that supports the claim. This lets
 * the writer downstream only make claims that trace to a real source.
 */

// A single sourced fact: the value + where it came from
const Sourced = z.object({
  value: z.string(),
  source_url: z.string(),
  source_quote: z.string().min(5),
});

export const ExtractedProduct = z.object({
  name: z.string().min(2).max(200),
  description: Sourced,
  capabilities: z.array(Sourced),
  use_cases: z.array(Sourced),
  technical_specs: z.array(Sourced),
});
export type ExtractedProduct = z.infer<typeof ExtractedProduct>;

export const CompanyAnalysis = z.object({
  company_summary: Sourced,
  products: z.array(ExtractedProduct),
});
export type CompanyAnalysis = z.infer<typeof CompanyAnalysis>;

export type AnalyzeInput = {
  company_name: string;
  website: string;
  uploaded_files?: { filename: string; text: string }[];
};

export async function analyzeCompany(
  input: AnalyzeInput,
): Promise<{ analysis: CompanyAnalysis; sources: string[]; cost_usd: number }> {
  const s = step('analyze_company');
  const meter = new CostMeter();
  const sources: string[] = [];

  // 1. Scrape the website
  const pages = await scrapeCompanyWebsite(input.website, { maxPages: 5, meter })
    .catch((e) => {
      log('warn', 'company_scrape_failed', { error: String(e) });
      return [];
    });

  for (const p of pages) sources.push(p.url);

  // 2. Combine all source text (website + uploaded files)
  const websiteText = pages
    .map((p) => `SOURCE_URL: ${p.url}\nCONTENT:\n${p.text.slice(0, 12000)}`)
    .join('\n\n---\n\n');

  const fileText = (input.uploaded_files ?? [])
    .map((f) => `SOURCE_URL: file:${f.filename}\nCONTENT:\n${f.text.slice(0, 15000)}`)
    .join('\n\n---\n\n');

  for (const f of input.uploaded_files ?? []) sources.push(`file:${f.filename}`);

  const allSourceText = [websiteText, fileText].filter(Boolean).join('\n\n===\n\n');

  if (allSourceText.length < 200) {
    throw new Error(
      `Could not gather enough content from ${input.website} or uploaded files. ` +
      `Check the URL is correct and reachable.`,
    );
  }

  // 3. Ask Claude to extract structured data, WITH SOURCES
  const analysis = await structured({
    model: MODELS.extractor,
    schemaName: 'submit_company_analysis',
    schemaDescription: 'A company summary and a list of products, every fact carrying its source.',
    schema: CompanyAnalysis,
    maxTokens: 12000,
    meter,
    system:
      'You extract information about a company and its products from source documents.\n\n' +
      'CRITICAL GROUNDING RULE\n' +
      'Every factual field you output must include:\n' +
      '  - value: the claim itself, in your own words if needed but ONLY containing information ' +
      '    that is actually present in the source text.\n' +
      '  - source_url: the SOURCE_URL of the specific document where you found this fact.\n' +
      '  - source_quote: a verbatim snippet (5-200 words) from that source that supports the ' +
      '    claim. This must be a direct copy from the source, not paraphrased.\n\n' +
      'If you cannot find a supporting quote in any source, you MUST NOT include that fact. ' +
      'For arrays like capabilities and use_cases, only include entries you can support with a quote.\n\n' +
      'DO NOT infer, guess, or extend a source. If the source says "process various materials" ' +
      'you may NOT claim "biocompatible materials" unless the word biocompatible appears in a source.\n\n' +
      'EXTRACTION GUIDANCE\n' +
      'For company_summary: 2-3 sentences on what this company does and who they sell to.\n\n' +
      'For products: identify every distinct product mentioned. For each:\n' +
      '- name: the product name exactly as it appears\n' +
      '- description: 1-2 sentences on what it is\n' +
      '- capabilities: array of what the product can do — each with source\n' +
      '- use_cases: array of what customers use it for — each with source\n' +
      '- technical_specs: array of numbers, measurements, materials, tolerances — each with source\n\n' +
      'Combine products with the same name into one entry. Do not include services, blog posts, ' +
      'or news articles as products.',
    prompt:
      `Company name: ${input.company_name}\n` +
      `Website: ${input.website}\n\n` +
      `Extract the company summary and all products from the sources below. ` +
      `Every field must include a source_url and a verbatim source_quote.\n\n` +
      `SOURCES:\n${allSourceText}`,
  });

  s.done({
    pages_scraped: pages.length,
    files_provided: input.uploaded_files?.length ?? 0,
    products_found: analysis.products.length,
    cost_usd: meter.totalUsd,
  });

  return { analysis, sources, cost_usd: meter.totalUsd };
}