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
    .slice(0, 10)
    .map((p) => `- (${p.year ?? 'n.d.'}) ${p.title}${p.abstract ? `\n  ${p.abstract.slice(0, 400)}` : ''}`)
    .join('\n');

  const projectLines = bundle.live_projects
    .map((p) => `- [${p.signal_type}${p.dated ? ` ${p.dated}` : ''}] ${p.description}`)
    .join('\n');

  const result = await structured({
    model: MODELS.scorer,
    schemaName: 'submit_relevance_score',
    schemaDescription: 'A four-dimension relevance assessment and the single best hook.',
    schema: RelevanceScore,
    meter,
    system:
      'You assess whether a specific product is genuinely relevant to a specific person, ' +
      'based only on evidence supplied to you.\n\n' +
      'THINKING FRAMEWORK\n' +
      'First, think about who ACTUALLY buys this product. A product has a wide buyer ' +
      'profile — not just people who explicitly name the product category in their work.\n\n' +
      'Examples of correct broad thinking:\n' +
      '- A filament extruder is bought by anyone doing polymer processing, FDM/FFF 3D printing, ' +
      '  material development, custom material experimentation, stimuli-responsive polymers, ' +
      '  polymer composites, sustainable materials, biomedical polymer scaffolds, or design ' +
      '  for additive manufacturing. Not just people who literally say "filament".\n' +
      '- A microscope is bought by biologists, materials scientists, semiconductor engineers, ' +
      '  chemists — not just people who publish on "microscopy techniques".\n' +
      '- A CNC machine is bought by mechanical designers, prototyping labs, aerospace ' +
      '  researchers, dental labs — not just people who publish on "machining".\n\n' +
      'CRITICAL: Adjacent research counts.\n' +
      'If someone works with polymers (any polymer research), they are a plausible buyer of ' +
      'polymer processing equipment. If they do additive manufacturing (any AM research), ' +
      'they are a plausible buyer of AM equipment. Do not require literal keyword matches.\n\n' +
      'PROJECTS ARE JUST AS VALID AS PUBLICATIONS\n' +
      'If someone has active project signals matching the product area, that is strong ' +
      'evidence even if publications are missing or the person is early-career.\n\n' +
      'SCORING RUBRIC (0-10)\n' +
      '- problem_match: does the product address a problem in their research area? ' +
      '  Adjacent fields count fully. Direct keyword match is not required.\n' +
      '- capability_gap: could this product open new possibilities for them?\n' +
      '- active_work: are they publishing / running projects in a relevant area? ' +
      '  Broader definition — anything in the same technical family counts.\n' +
      '- recency: how recent is the strongest evidence?\n\n' +
      'overall is your judgement, not an average.\n\n' +
      'VERDICT CALIBRATION (be generous, err toward emailing)\n' +
      '- strong (8-10): clear buyer profile. Direct evidence they work in the product\'s area.\n' +
      '  Example: selling a filament extruder to someone who publishes on FDM 3D printing ' +
      '  or custom filament development.\n' +
      '- moderate (6-7): plausible adjacent buyer. Their work overlaps meaningfully.\n' +
      '  Example: selling a filament extruder to a design-for-additive-manufacturing researcher.\n' +
      '- weak (4-5): remote but real fit. Broader domain overlap without direct application.\n' +
      '  Example: selling a filament extruder to any polymer researcher, even if they don\'t 3D print. ' +
      '  They understand the material, they might collaborate with someone who does, they might expand.\n' +
      '- skip (0-3): genuinely wrong domain. Complete miss.\n' +
      '  Example: selling a filament extruder to a pure theoretical mathematician, a historian, ' +
      '  or a medical doctor who does clinical work only.\n\n' +
      'IMPORTANT: The default when there is real research signal is at least 4. Only score below 4 ' +
      'when there is genuinely no domain overlap OR research came up empty. Weak leads are still ' +
      'valid leads — the sender chose these prospects for a reason.\n\n' +
      'hook must be one specific, verifiable fact from the evidence — not a generic ' +
      'observation. If no such fact exists, return an empty hook and verdict skip.\n' +
      'unverified_claims must list anything you were tempted to assert but could not ' +
      'support from the evidence given.',
    prompt:
      `PRODUCT BEING SOLD\n` +
      `Name: ${ctx.productName}\n` +
      `What it does: ${ctx.productDescription}\n` +
      (ctx.productCapabilities ? `Capabilities: ${ctx.productCapabilities}\n` : '') +
      (ctx.productUseCases ? `Common use cases: ${ctx.productUseCases}\n` : '') +
      (ctx.productTechnicalSpecs ? `Technical specs: ${ctx.productTechnicalSpecs}\n` : '') +
      `Sold by: ${ctx.sellerCompany} — ${ctx.sellerSummary}\n\n` +
      `PERSON\n` +
      `Name: ${bundle.identity.resolved_name}\n` +
      `Institution: ${bundle.identity.institution}\n` +
      `Department: ${bundle.identity.department ?? 'unknown'}\n` +
      `Identity confidence: ${bundle.identity.confidence}\n\n` +
      `RECENT PUBLICATIONS\n${pubLines || '(none found)'}\n\n` +
      `ACTIVE PROJECT SIGNALS\n${projectLines || '(none found)'}\n\n` +
      `Think about who ACTUALLY buys this product, then assess this person's fit.`,
  });

  s.done({ overall: result.overall, verdict: result.verdict });
  return result;
}