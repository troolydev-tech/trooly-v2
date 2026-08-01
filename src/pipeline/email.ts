import { MODELS } from '../config.js';
import { structured, type CostMeter } from '../lib/claude.js';
import { step } from '../lib/log.js';
import {
  GeneratedEmail, QualityVerdict,
  type RelevanceScore, type ResearchBundle,
} from '../schemas.js';
import type { CampaignContext } from './context.js';

const LENGTH_INSTRUCTIONS = {
  concise:  'Write 3-4 sentences total. One observation, one product line, one ask. Nothing else.',
  standard: 'Write 2 short paragraphs. First paragraph: what you noticed about their work and why you are reaching out. Second paragraph: one clear ask.',
  detailed: 'Write 3 paragraphs. First: what you found about their work. Second: how the product specifically applies. Third: a clear next step.',
};

const TONE_INSTRUCTIONS = {
  formal:    'Use respectful, professional language. Address them as Dr. [Last Name]. Keep distance appropriate for a first contact with a senior academic.',
  technical: 'Use technically precise language. You can reference specific methods, materials, or processes by name. Avoid business jargon.',
  warm:      'Write like one professional writing to another they respect. Collegial but not familiar. Genuine interest, not sales enthusiasm.',
  direct:    'Get to the point immediately. No preamble. State what you noticed, what you offer, what you want. Busy people appreciate this.',
  friendly:  'Approachable and human. Not stiff. Write the way a knowledgeable colleague would reach out, not a sales rep.',
  casual:    'Relaxed tone. Short sentences. First name if appropriate. Still professional but no formality.',
};

const BASE_RULES = [
  'Never open with "I hope this finds you well", "I came across your profile", or any filler phrase.',
  'Never compliment their institution, reputation, or the prestige of their work.',
  'Reference at most one specific piece of their work — and frame it as something you found, not something you fully understand.',
  'Use hedging language: "if this is still an active area", "in case it is useful", "you may already have this covered". This signals you have done homework but are not presuming to know their full situation.',
  'Never claim to know everything about their research. You found one signal. Acknowledge that implicitly.',
  'State plainly what the product does. No superlatives.',
  'One ask at the end. A short call or a reply. Not a hard pitch.',
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
      return `- ${p.title} ${recencyNote}`;
    })
    .join('\n');

  const projects = bundle.live_projects
    .map((p) => {
      const note = p.dated ? `(${p.dated})` : '(date unknown)';
      return `- [${p.signal_type}] ${p.description} ${note}`;
    })
    .join('\n');

  const email = await structured({
    model: MODELS.writer,
    schemaName: 'submit_email',
    schemaDescription: 'A cold outreach email plus every factual claim it makes.',
    schema: GeneratedEmail,
    maxTokens: 2000,
    meter,
    system:
      'You write cold outreach emails from one professional to another.\n\n' +
      'LENGTH INSTRUCTION\n' + LENGTH_INSTRUCTIONS[ctx.emailLength] + '\n\n' +
      'TONE INSTRUCTION\n' + TONE_INSTRUCTIONS[ctx.emailTone] + '\n\n' +
      'RULES (all must be followed)\n' +
      BASE_RULES.map((r) => `- ${r}`).join('\n') +
      '\n\nHUMILITY PRINCIPLE\n' +
      'You found one signal about this person. You do not know their full research agenda, their current priorities, or whether they already have this capability. ' +
      'The email should reflect that: confident enough to reach out, humble enough not to presume. ' +
      'Phrases like "if this is still active", "in case it helps", "you may already have this covered" achieve this naturally.\n\n' +
      'RECENCY AWARENESS\n' +
      'If the evidence is more than 3 years old, acknowledge the uncertainty. Do not present old work as current without hedging. ' +
      'If the most recent signal is within 1 year, you can reference it more directly.\n\n' +
      'In claims_made, list every factual assertion the body makes about the recipient or their work.',
    prompt:
      `SENDER\n${ctx.senderName}, ${ctx.senderTitle} at ${ctx.sellerCompany}\n\n` +
      `PRODUCT\n${ctx.productName}: ${ctx.productDescription}\nCapabilities: ${ctx.productCapabilities}\n\n` +
      `RECIPIENT\n${bundle.identity.resolved_name}, ${bundle.identity.institution}\n` +
      `Department: ${bundle.identity.department ?? 'unknown'}\n` +
      `Research focus: ${scored.hook || 'see publications below'}\n\n` +
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
    model: MODELS.cheap,
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