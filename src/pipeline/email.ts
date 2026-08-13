import { MODELS } from '../config.js';
import { structured, type CostMeter } from '../lib/claude.js';
import { step } from '../lib/log.js';
import {
  GeneratedEmail, QualityVerdict,
  type RelevanceScore, type ResearchBundle,
} from '../schemas.js';
import type { CampaignContext } from './context.js';

const LENGTH_INSTRUCTIONS = {
  short:  'Write 3 sentences total. One observation, one product line, one ask. Nothing else. Very direct.',
  medium: 'Write approximately 120 words in 2 short paragraphs. First: what you noticed and why you are reaching out. Second: one clear ask.',
  long:   'Write approximately 200 words in 3 paragraphs. First: what you found about their work. Second: how the product specifically applies. Third: a clear next step.',
};

const TONE_INSTRUCTIONS = {
  company_default: 'Use warm but professional language. Balanced between friendliness and respect. Suitable for a first contact.',
  formal:    'Use respectful, professional language. Address them as Dr. [Last Name]. Keep distance appropriate for a first contact with a senior academic.',
  technical: 'Use technically precise language. Reference specific methods, materials, or processes by name. Avoid business jargon.',
  warm:      'Write like one professional writing to another they respect. Collegial but not familiar. Genuine interest, not sales enthusiasm.',
  direct:    'Get to the point immediately. No preamble. State what you noticed, what you offer, what you want. Busy people appreciate this.',
  friendly:  'Approachable and human. Not stiff. Write the way a knowledgeable colleague would reach out, not a sales rep.',
  casual:    'Relaxed tone. Short sentences. First name if appropriate. Still professional but no formality.',
};

const CTA_INSTRUCTIONS: Record<string, string> = {
  request_a_demo:   'The ask is a short demo of the product. Frame it as low-commitment.',
  schedule_a_call:  'The ask is a 15-20 minute exploratory call. Frame it around their work, not the product.',
  visit_our_website:'The ask is to visit a specific product page for more info. Include the product page URL if provided.',
  reply_to_email:   'The ask is simply a reply — thoughts, questions, or interest. Very low-commitment.',
};

const GOAL_INSTRUCTIONS: Record<string, string> = {
  awareness:     'The goal of this email is to introduce the product as something that may be relevant to their work. Not a hard sell.',
  demo_request:  'The goal is to secure a demo booking. Be specific about what the demo would cover.',
  partnership:   'The goal is to explore a collaboration or partnership, not a straight sale. Position accordingly.',
  event_invite:  'The goal is to invite them to an event or webinar. Include event context in the copy.',
};

const BASE_RULES = [
  'Never open with "I hope this finds you well", "I came across your profile", or any filler phrase.',
  'Never compliment their institution, reputation, or the prestige of their work.',
  'Reference at most one specific piece of their work — and frame it as something you found, not something you fully understand.',
  'Use hedging language: "if this is still an active area", "in case it is useful", "you may already have this covered". This signals homework without presuming to know their full situation.',
  'Never claim to know everything about their research. You found one signal. Acknowledge that implicitly.',
  'State plainly what the product does. No superlatives.',
  'One ask at the end, matching the specified call to action.',
  'No bullet points, no em-dashes, no emojis.',
  'Do not use: leverage, synergy, cutting-edge, game-changing, revolutionary, empower, unlock, delighted, pleased.',
  'End with your name and title only. No "Best regards" followed by a paragraph.',
];

export async function writeEmail(
  ctx: CampaignContext,
  bundle: ResearchBundle,
  scored: RelevanceScore,
  meter: CostMeter,
): Promise<GeneratedEmail> {
  const s = step('email');

  const currentYear = new Date().getFullYear();

  const evidence = bundle.publications
    .map((p) => {
      const age = p.year ? currentYear - p.year : 99;
      const recencyNote = age === 0 ? '(this year)' : age <= 2 ? `(${age} year${age > 1 ? 's' : ''} ago)` : `(${p.year ?? 'year unknown'} — may be dated)`;
      return `- ${p.title} ${recencyNote}\n  SOURCE: ${p.source_url}\n  QUOTE: "${p.source_quote}"`;
    })
    .join('\n');

  const projects = bundle.live_projects
    .map((p) => `- [${p.signal_type}${p.dated ? ` ${p.dated}` : ''}] ${p.description}\n  SOURCE: ${p.source_url}\n  QUOTE: "${p.source_quote}"`)
    .join('\n');

  const productBlock =
    `PRODUCT\nName: ${ctx.productName}\n` +
    `What it is: ${ctx.productDescription}\n` +
    (ctx.productCapabilities ? `Capabilities: ${ctx.productCapabilities}\n` : '') +
    (ctx.productUseCases ? `Common use cases: ${ctx.productUseCases}\n` : '') +
    (ctx.productTechnicalSpecs ? `Technical specs: ${ctx.productTechnicalSpecs}\n` : '') +
    `Sold by: ${ctx.sellerCompany}\n`;

  const email = await structured({
    model: MODELS.writer,
    schemaName: 'submit_email',
    schemaDescription: 'A cold outreach email plus every factual claim it makes.',
    schema: GeneratedEmail,
    maxTokens: 2000,
    meter,
    system:
      'You write cold outreach emails from one professional to another.\n\n' +
      'LENGTH\n' + LENGTH_INSTRUCTIONS[ctx.emailLength] + '\n\n' +
      'TONE\n' + TONE_INSTRUCTIONS[ctx.emailTone] + '\n\n' +
      'CAMPAIGN GOAL\n' + (GOAL_INSTRUCTIONS[ctx.campaignGoal] ?? '') + '\n\n' +
      'CALL TO ACTION\n' + (CTA_INSTRUCTIONS[ctx.callToAction] ?? '') + '\n\n' +
      (ctx.additionalInstructions
        ? 'ADDITIONAL INSTRUCTIONS FROM SELLER\n' + ctx.additionalInstructions + '\n\n'
        : '') +
      'RULES (all must be followed)\n' +
      BASE_RULES.map((r) => `- ${r}`).join('\n') +
      '\n\nHUMILITY PRINCIPLE\n' +
      'You found one signal about this person. You do not know their full research agenda, ' +
      'their current priorities, or whether they already have this capability. ' +
      'The email should reflect that: confident enough to reach out, humble enough not to presume.\n\n' +
      'RECENCY AWARENESS\n' +
      'If the evidence is more than 3 years old, acknowledge the uncertainty. Do not present old work ' +
      'as current without hedging. If the most recent signal is within 1 year, you can reference it more directly.\n\n' +
      'In claims_made, list every factual assertion the body makes about the recipient or their work.',
    prompt:
      `SENDER\n${ctx.senderName}, ${ctx.senderTitle} at ${ctx.sellerCompany}\n\n` +
      productBlock + '\n' +
      `RECIPIENT\n${bundle.identity.resolved_name}, ${bundle.identity.institution}\n` +
      `Department: ${bundle.identity.department ?? 'unknown'}\n` +
      `Research focus (top hook): ${scored.hook || 'see publications below'}\n\n` +
      `PUBLICATIONS FOUND (with recency)\n${evidence || '(none found)'}\n\n` +
      `ACTIVE PROJECT SIGNALS\n${projects || '(none found)'}\n\n` +
      `DO NOT use these — could not be verified: ${scored.unverified_claims.join('; ') || 'none'}\n\n` +
      `Write the email.`,
  });

  s.done({ subjectLen: email.subject.length, claims: email.claims_made.length });
  return email;
}

const QUALITY_RULES = [
  ...BASE_RULES,
  'Email must not reference research older than 5 years as if it is current work.',
  'Email must not claim certainty about the recipient\'s current research agenda.',
  'Email must contain at least one hedging phrase acknowledging uncertainty.',
];

export async function qualityGate(
  email: GeneratedEmail,
  bundle: ResearchBundle,
  meter: CostMeter,
): Promise<QualityVerdict> {
  const s = step('quality_gate');

  const evidence = JSON.stringify({
    publications: bundle.publications.slice(0, 6).map((p) => ({ t: p.title, y: p.year })),
    projects: bundle.live_projects.map((p) => p.description),
    department: bundle.identity.department,
  });

  const verdict = await structured({
    model: MODELS.gate,
    schemaName: 'submit_quality_verdict',
    schemaDescription: 'Whether the email passes all rules, and a corrected version if it does not.',
    schema: QualityVerdict,
    maxTokens: 2000,
    meter,
    system:
      'You check cold emails against a rulebook and against the evidence they were built on.\n\n' +
      'RULES\n' + QUALITY_RULES.map((r) => `- ${r}`).join('\n') +
      '\n\nIf there are violations, rewrite the email fixing every violation while keeping the specific detail that makes it personal. ' +
      'If there are none, set passed true and leave rewritten fields null.',
    prompt:
      `EVIDENCE\n${evidence}\n\n` +
      `CLAIMS THE EMAIL MAKES\n${email.claims_made.join('\n')}\n\n` +
      `SUBJECT\n${email.subject}\n\n` +
      `BODY\n${email.body}`,
  });

  s.done({ passed: verdict.passed, violations: verdict.violations.length });
  return verdict;
}