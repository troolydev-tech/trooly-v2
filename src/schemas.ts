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
});
export type Publication = z.infer<typeof Publication>;

export const ResearchBundle = z.object({
  identity: z.object({
    resolved_name: z.string(),
    institution: z.string(),
    department: z.string().nullable(),
    profile_url: z.string().nullable(),
    confidence: z.enum(['high', 'medium', 'low', 'none']),
  }),
  publications: z.array(Publication),
  live_projects: z.array(
    z.object({
      description: z.string(),
      evidence_url: z.string().nullable(),
      signal_type: z.enum(['recruitment_ad', 'grant', 'tender', 'news', 'thesis']),
      dated: z.string().nullable(),
    }),
  ),
  sources_used: z.array(z.string()),
});
export type ResearchBundle = z.infer<typeof ResearchBundle>;

// ---------- Scoring ----------

export const RelevanceScore = z.object({
  problem_match: z.number().min(0).max(10),
  capability_gap: z.number().min(0).max(10),
  active_work: z.number().min(0).max(10),
  recency: z.number().min(0).max(10),
  overall: z.number().min(0).max(10),
  verdict: z.enum(['strong', 'moderate', 'weak', 'skip']),
  reasoning: z.string().max(600),
  /** The single specific fact the email should be built on. Empty if there isn't one. */
  hook: z.string().max(400),
  /** Facts the model could NOT verify from the research bundle. Must never appear in the email. */
  unverified_claims: z.array(z.string()),
});
export type RelevanceScore = z.infer<typeof RelevanceScore>;

// ---------- Email ----------

export const GeneratedEmail = z.object({
  subject: z.string().min(5).max(90).refine((s) => s.toLowerCase() !== 'null', {
    message: 'subject cannot be the literal string "null"',
  }),
  body: z.string().min(30).refine((s) => s.toLowerCase() !== 'null', {
    message: 'body cannot be the literal string "null"',
  }),
  /** Every factual claim in the body, so the quality gate can check each one. */
  claims_made: z.array(z.string()),
});

export type GeneratedEmail = z.infer<typeof GeneratedEmail>;

export const QualityVerdict = z.object({
  passed: z.boolean(),
  violations: z.array(z.string()),
  rewritten_subject: z.string().nullable(),
  rewritten_body: z.string().nullable(),
});
export type QualityVerdict = z.infer<typeof QualityVerdict>;
