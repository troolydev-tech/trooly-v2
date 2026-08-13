import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { z } from 'zod';
import { config } from './config.js';
import { log } from './lib/log.js';
import { RunRequest } from './schemas.js';
import { runBatch } from './pipeline/run.js';
import { analyzeCompany } from './pipeline/companyExtractor.js';

const app = new Hono();

// Basic CORS so the frontend can talk to us
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');
  if (c.req.method === 'OPTIONS') return new Response(null, { status: 204 });
  await next();
});

app.get('/health', (c) => c.json({ ok: true }));

/**
 * Run a campaign: research + score + write for each prospect in the batch.
 * Runs in the background; responds immediately.
 */
app.post('/run', async (c) => {
  const parsed = RunRequest.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }
  const { campaign_id, prospects } = parsed.data;

  void runBatch(prospects, campaign_id)
    .then((results) => {
      const cost = results.reduce((s, r) => s + r.cost_usd, 0);
      log('info', 'batch.complete', {
        campaign_id,
        total: results.length,
        emailed: results.filter((r) => r.status === 'emailed').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
        failed: results.filter((r) => r.status === 'failed').length,
        cost_usd: cost.toFixed(4),
      });
    })
    .catch((e) => log('error', 'batch.crashed', { campaign_id, error: String(e) }));

  return c.json({ accepted: prospects.length, campaign_id });
});

/**
 * Analyze a company: scrape their website + read uploaded files,
 * return structured company summary + products list. DOES NOT save to database —
 * the frontend shows the result for review, then calls Supabase to save if approved.
 */
const AnalyzeRequest = z.object({
  company_name: z.string().min(2),
  website: z.string().url(),
  uploaded_files: z.array(z.object({
    filename: z.string(),
    text: z.string(),
  })).optional(),
});

app.post('/analyze-company', async (c) => {
  const parsed = AnalyzeRequest.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }

  try {
    const result = await analyzeCompany(parsed.data);
    return c.json({
      company_summary: result.analysis.company_summary,
      products: result.analysis.products,
      sources_used: result.sources,
      cost_usd: result.cost_usd,
    });
  } catch (err) {
    log('error', 'analyze_company.failed', { error: String(err) });
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

serve({ fetch: app.fetch, port: config.port });
log('info', 'server.started', { port: config.port });