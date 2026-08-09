async function persistResult(
  prospect: ProspectInput,
  ctx: CampaignContext,
  bundle: unknown,
  scored: { overall: number; reasoning: string; hook: string },
  email: { subject: string; body: string } | null,
  result: RunResult,
) {
  // Update prospect identity/research fields on `prospects`
  const { error: pErr } = await db
    .from('prospects')
    .update({
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
  // Ensure prospect rows exist in `prospects`, and linking rows exist in `campaign_prospects`.
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