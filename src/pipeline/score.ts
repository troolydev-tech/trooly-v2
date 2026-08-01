import { MODELS } from '../config.js';
import { structured, type CostMeter } from '../lib/claude.js';
import { step } from '../lib/log.js';
import { RelevanceScore, type ResearchBundle } from '../schemas.js';
import type { CampaignContext } from './context.js';

/**
 * Decide whether this prospect is worth emailing at all, and if so, what the
 * email should hang on. One cheap call. Nothing downstream runs if this says skip.
 *
 * Deliberately industry-neutral: it reasons about what the product does versus what
 * the person is working on, with no assumptions about what field either is in.
 */
export async function score(
  ctx: CampaignContext,
  bundle: ResearchBundle,
  meter: CostMeter,
): Promise<RelevanceScore> {
  const s = step('score');

  const pubLines = bundle.publications
    .slice(0, 8)
    .map((p) => `- (${p.year ?? 'n.d.'}) ${p.title}${p.abstract ? `\n  ${p.abstract.slice(0, 400)}` : ''}`)
    .join('\n');

  const projectLines = bundle.live_projects
    .map((p) => `- [${p.signal_type}${p.dated ? ` ${p.dated}` : ''}] ${p.description}`)
    .join('\n');

  const result = await structured({
    model: MODELS.cheap,
    schemaName: 'submit_relevance_score',
    schemaDescription: 'A four-dimension relevance assessment and the single best hook.',
    schema: RelevanceScore,
    meter,
    system:
      'You assess whether a specific product is genuinely relevant to a specific person, ' +
      'based only on evidence supplied to you. You are strict. Most pairings are not a good ' +
      'fit, and saying so is the correct answer. You never assume anything about the industry ' +
      'either party operates in. You never treat a shared keyword as evidence of fit.\n\n' +
      'Score each dimension 0-10:\n' +
      '- problem_match: does the product address a problem this person demonstrably has?\n' +
      '- capability_gap: is there evidence they currently lack this capability?\n' +
      '- active_work: are they working on something relevant right now, not years ago?\n' +
      '- recency: how recent is the strongest piece of evidence?\n\n' +
      'overall is your judgement, not an average. verdict must be skip if overall is below 5.\n' +
      'hook must be one specific, verifiable fact from the evidence — not a category or a ' +
      'generic observation. If no such fact exists, return an empty hook and verdict skip.\n' +
      'unverified_claims must list anything you were tempted to assert but could not ' +
      'support from the evidence given.',
    prompt:
      `PRODUCT BEING SOLD\n` +
      `Name: ${ctx.productName}\n` +
      `What it does: ${ctx.productDescription}\n` +
      `Capabilities: ${ctx.productCapabilities}\n` +
      `Sold by: ${ctx.sellerCompany} — ${ctx.sellerSummary}\n\n` +
      `PERSON\n` +
      `Name: ${bundle.identity.resolved_name}\n` +
      `Institution: ${bundle.identity.institution}\n` +
      `Department: ${bundle.identity.department ?? 'unknown'}\n` +
      `Identity confidence: ${bundle.identity.confidence}\n\n` +
      `RECENT PUBLICATIONS\n${pubLines || '(none found)'}\n\n` +
      `ACTIVE PROJECT SIGNALS\n${projectLines || '(none found)'}\n\n` +
      `Assess the fit.`,
  });

  s.done({ overall: result.overall, verdict: result.verdict });
  return result;
}
