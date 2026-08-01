import { CostMeter } from '../lib/claude.js';
import { db } from '../lib/supabase.js';
import { log } from '../lib/log.js';
import type { ProspectInput } from '../schemas.js';
import { loadCampaignContext, type CampaignContext } from './context.js';
import { research } from './research.js';
import { score } from './score.js';
import { writeEmail, qualityGate } from './email.js';

export type RunResult = {
  prospect_id: string;
  status: 'emailed' | 'skipped' | 'failed';
  overall_score: number | null;
  subject: string | null;
  body: string | null;
  reason: string | null;
  cost_usd: number;
  ms: number;
};

export async function runProspect(
  prospect: ProspectInput,
  ctx: CampaignContext,
  opts: { persist?: boolean } = {},
): Promise<RunResult> {
  const started = Date.now();
  const meter = new CostMeter();
  const persist = opts.persist ?? true;

  try {
    const bundle = await research(prospect, meter);
    const scored = await score(ctx, bundle, meter);

    if (scored.verdict === 'skip' || scored.overall < 5) {
      const result: RunResult = {
        prospect_id: prospect.prospect_id,
        status: 'skipped',
        overall_score: scored.overall,
        subject: null,
        body: null,
        reason: scored.reasoning,
        cost_usd: meter.totalUsd,
        ms: Date.now() - started,
      };
      if (persist) await persistResult(prospect, ctx, bundle, scored, null, result);
      log('info', 'prospect.skipped', { id: prospect.prospect_id, score: scored.overall });
      return result;
    }

    const draft = await writeEmail(ctx, bundle, scored, meter);
    const gate = await qualityGate(draft, bundle, meter);

    const subject = gate.rewritten_subject ?? draft.subject;
    const body = gate.rewritten_body ?? draft.body;

    const result: RunResult = {
      prospect_id: prospect.prospect_id,
      status: 'emailed',
      overall_score: scored.overall,
      subject: subject,
      body: body,
      reason: null,
      cost_usd: meter.totalUsd,
      ms: Date.now() - started,
    };

    if (persist) {
      await persistResult(
        prospect,
        ctx,
        bundle,
        scored,
        { subject: subject ?? '', body: body ?? '' },
        result,
      );
    }

    log('info', 'prospect.emailed', {
      id: prospect.prospect_id,
      score: scored.overall,
      cost: meter.totalUsd.toFixed(4),
    });

    return result;

  } catch (err) {
    log('error', 'prospect.failed', { id: prospect.prospect_id, error: String(err) });
    return {
      prospect_id: prospect.prospect_id,
      status: 'failed',
      overall_score: null,
      subject: null,
      body: null,
      reason: String(err),
      cost_usd: meter.totalUsd,
      ms: Date.now() - started,
    };
  }
}

async function persistResult(
  prospect: ProspectInput,
  ctx: CampaignContext,
  bundle: unknown,
  scored: { overall: number; reasoning: string; hook: string },
  email: { subject: string; body: string } | null,
  result: RunResult,
) {
  const { error: pErr } = await db
    .from('prospects')
    .update({
      lead_status: result.status,
      relevance_score: scored.overall,
      intelligence: bundle,
      hook: scored.hook,
      last_researched_at: new Date().toISOString(),
    })
    .eq('id', prospect.prospect_id);

  if (pErr) log('error', 'db.prospect_update_failed', { error: pErr.message });

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

export async function runBatch(
  prospects: ProspectInput[],
  campaignId: string,
  concurrency = 4,
): Promise<RunResult[]> {
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