import { db } from '../lib/supabase.js';
import { log } from '../lib/log.js';
import { loadCampaignContext, type CampaignContext } from './context.js';
import { research } from './research.js';
import { score } from './score.js';
import { writeEmail, qualityGate } from './email.js';
import { CostMeter } from '../lib/claude.js';
import type { ProspectInput } from '../schemas.js';

// ─── Persistence ──────────────────────────────────────────────────────────

async function persistResult(
  prospect: ProspectInput,
  ctx: CampaignContext,
  bundle: unknown,
  scored: { overall: number; reasoning: string; hook: string },
  email: { subject: string; body: string } | null,
  result: RunResult,
) {
  // Update prospect identity + research fields on `prospects`
  const { error: pErr } = await db
    .from('prospects')
    .update({
      intelligence: bundle,
      intelligence_sourced: bundle,
      last_researched_at: new Date().toISOString(),
    })
    .eq('id', prospect.prospect_id);

  if (pErr) log('error', 'db.prospect_update_failed', { error: pErr.message });

  // Update campaign-specific status/score/hook on `campaign_prospects`
  const { error: cpErr } = await db
    .from('campaign_prospects')
    .update({
      status: result.status,
      relevance_score: scored.overall,
      hook: scored.hook,
    })
    .eq('campaign_id', ctx.campaignId)
    .eq('prospect_id', prospect.prospect_id);

  if (cpErr) log('error', 'db.campaign_prospect_update_failed', { error: cpErr.message });

  // If we generated an email, save it
  if (email) {
    const { error: eErr } = await db.from('generated_emails').insert({
      prospect_id: prospect.prospect_id,
      campaign_id: ctx.campaignId,
      subject: email.subject,
      body: email.body,
      cost_usd: result.cost_usd,
    });
    if (eErr) log('error', 'db.email_insert_failed', { error: eErr.message });
  }
}

// ─── Per-prospect pipeline ────────────────────────────────────────────────

export type RunResult = {
  prospect_id: string;
  status: 'emailed' | 'skipped' | 'failed';
  score: number | null;
  cost_usd: number;
  ms: number;
  error?: string;
};

async function runProspect(
  prospect: ProspectInput,
  ctx: CampaignContext,
): Promise<RunResult> {
  const started = Date.now();
  const meter = new CostMeter();

  try {
    const bundle = await research(prospect, meter);
    const scored = await score(ctx, bundle, meter);

    // Not worth emailing — persist and stop here
    if (scored.overall < 5 || scored.verdict === 'skip') {
      const result: RunResult = {
        prospect_id: prospect.prospect_id,
        status: 'skipped',
        score: scored.overall,
        cost_usd: meter.totalUsd,
        ms: Date.now() - started,
      };
      await persistResult(prospect, ctx, bundle, scored, null, result);
      log('info', 'prospect.skipped', { id: prospect.prospect_id, score: scored.overall });
      return result;
    }

    // Write + quality-gate the email
    const draft = await writeEmail(ctx, bundle, scored, meter);
    const gate = await qualityGate(ctx, draft, bundle, meter);
    const subject = gate.rewritten_subject ?? draft.subject;
    const body = gate.rewritten_body ?? draft.body;

    const result: RunResult = {
      prospect_id: prospect.prospect_id,
      status: 'emailed',
      score: scored.overall,
      cost_usd: meter.totalUsd,
      ms: Date.now() - started,
    };

    await persistResult(
      prospect,
      ctx,
      bundle,
      scored,
      { subject: subject ?? '', body: body ?? '' },
      result,
    );

    log('info', 'prospect.emailed', {
      id: prospect.prospect_id,
      score: scored.overall,
      cost: meter.totalUsd.toFixed(4),
    });
    return result;
  } catch (err) {
    const result: RunResult = {
      prospect_id: prospect.prospect_id,
      status: 'failed',
      score: null,
      cost_usd: meter.totalUsd,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
    log('error', 'prospect.failed', { id: prospect.prospect_id, error: result.error });
    return result;
  }
}

// ─── Batch runner ─────────────────────────────────────────────────────────

export async function runBatch(
  prospects: ProspectInput[],
  campaignId: string,
  concurrency = 8,
): Promise<RunResult[]> {
  // Ensure prospect rows exist in `prospects`, and linking rows exist in `campaign_prospects`
  try {
    const toUpsertProspects = prospects.map((p) => ({
      id: p.prospect_id,
      name: p.name,
      institution: p.institution,
      department: p.department ?? null,
      email: p.email ?? null,
    }));

    const { error: upsertErr } = await db.from('prospects').upsert(toUpsertProspects);
    if (upsertErr) log('error', 'db.prospect_upsert_failed', { error: upsertErr.message });

    const toUpsertCampaignProspects = prospects.map((p) => ({
      campaign_id: campaignId,
      prospect_id: p.prospect_id,
      status: 'queued',
    }));

    const { error: cpUpsertErr } = await db
      .from('campaign_prospects')
      .upsert(toUpsertCampaignProspects, { onConflict: 'campaign_id,prospect_id' });
    if (cpUpsertErr) log('error', 'db.campaign_prospect_upsert_failed', { error: cpUpsertErr.message });
  } catch (e) {
    log('error', 'db.prospect_upsert_exception', { error: String(e) });
  }

  const ctx = await loadCampaignContext(campaignId);
  const results: RunResult[] = [];
  const queue = [...prospects];

  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      while (queue.length) {
        const next = queue.shift();
        if (!next) break;
        results.push(await runProspect(next, ctx));
      }
    },
  );

  await Promise.all(workers);
  return results;
}