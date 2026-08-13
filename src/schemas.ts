import { z } from 'zod';

/**
 * Every LLM response in this system is validated against one of these.
 * If a response doesn't match, we retry rather than letting bad data flow downstream.
 * This is what replaces the regex text-parsing and the "did it come back as an array" bugs.
 */

// ---------- Input ----------

export const ProspectInput = z.object({
  prospect_id: z.string(),
  campaign_id: z.string(),
  name: z.string().min(2),
  institution: z.string().min(2),
  department: z.string().optional(),
  email: z.string().email().optional(),
});
export type ProspectInput = z.infer<typeof ProspectInput>;

export const RunRequest = z.object({
  campaign_id: z.string(),
  prospects: z.array(ProspectInput).min(1).max(500),
});

// ---------- Research ----------
export const Publication = z.object({
  title: z.string(),
  year: z.number().int().nullable(),
  venue: z.string().nullable(),
  abstract: z.string().nullable(),
  url: z.string().nullable(),
  /** Where this publication was found. Every publication must trace to a source. */
  source_url: z.string(),
  source_quote: z.string().min(5),
});
export type Publication = z.infer<typeof Publication>;

export const LiveProject = z.object({
  description: z.string(),
  signal_type: z.enum(['recruitment_ad', 'grant', 'tender', 'news', 'thesis']),
  dated: z.string().nullable(),
  /** Every project must trace back to a source URL and a verbatim quote. */
  source_url: z.string(),
  source_quote: z.string().min(5),
});
export type LiveProject = z.infer<typeof LiveProject>;

export const ResearchBundle = z.object({
  identity: z.object({
    resolved_name: z.string(),
    institution: z.string(),
    department: z.string().nullable(),
    profile_url: z.string().nullable(),
    confidence: z.enum(['high', 'medium', 'low', 'none']),
  }),
  /** Research focus is sourced — every summary must have a supporting quote. */
  research_focus: z.object({
    value: z.string(),
    source_url: z.string(),
    source_quote: z.string().min(5),
  }).nullable(),
  publications: z.array(Publication),
  live_projects: z.array(LiveProject),
  sources_used: z.array(z.string()),
});
export type ResearchBundle = z.infer<typeof ResearchBundle>;
;

// ---------- Scoring ----------

export const RelevanceScore = z.object({
  problem_match: z.number().min(0).max(10),
  capability_gap: z.number().min(0).max(10),
  active_work: z.number().min(0).max(10),
  recency: z.number().min(0).max(10),
  overall: z.number().min(0).max(10),
  verdict: z.enum(['strong', 'moderate', 'weak', 'skip']),
  reasoning: z.string().max(1000),
  /** The single specific fact the email should be built on. Empty if there isn't one. */
  hook: z.string().max(400),
  /** Facts the model could NOT verify from the research bundle. Must never appear in the email. */
  unverified_claims: z.array(z.string()),
});
export type RelevanceScore = z.infer<typeof RelevanceScore>;

// ---------- Email ----------

export const GeneratedEmail = z.object({
  subject: z.string().min(5).max(90).refine(
    (s) => s.trim().toLowerCase() !== 'null' && s.trim().length > 4,
    { message: 'subject cannot be "null" or empty' }
  ),
  body: z.string().min(30).refine(
    (s) => s.trim().toLowerCase() !== 'null' && s.trim().length > 29,
    { message: 'body cannot be "null" or empty' }
  ),
  /** Every factual claim in the body, so the quality gate can check each one. */
  claims_made: z.array(z.string()),
});
export type GeneratedEmail = z.infer<typeof GeneratedEmail>;

export const QualityVerdict = z.object({
  passed: z.boolean(),
  violations: z.array(z.string()),
  rewritten_subject: z.string().nullable().transform(
    (s) => (s && s.trim().length >= 5 && s.trim().toLowerCase() !== 'null' ? s : null)
  ),
  rewritten_body: z.string().nullable().transform(
    (s) => (s && s.trim().length >= 30 && s.trim().toLowerCase() !== 'null' ? s : null)
  ),
});
export type QualityVerdict = z.infer<typeof QualityVerdict>;