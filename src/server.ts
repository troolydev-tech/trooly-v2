import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.js';
import { log } from './lib/log.js';
import { RunRequest } from './schemas.js';
import { runBatch } from './pipeline/run.js';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true }));

/**
 * Same shape your n8n webhook accepts, so the frontend does not need to change.
 * Responds immediately and processes in the background — a batch of 50 takes minutes,
 * far longer than any HTTP client will wait.
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

serve({ fetch: app.fetch, port: config.port });
log('info', 'server.started', { port: config.port });
