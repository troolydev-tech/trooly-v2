/**
 * The reason this rewrite is worth doing.
 *
 * Change a prompt, run `npm run eval`, and find out in ninety seconds whether emails
 * got better or worse across every case at once. Without this you are changing prompts
 * on vibes and hoping.
 *
 * Add a case every time you see output you dislike. The suite becomes your spec.
 */
import fixtures from './fixtures.json' with { type: 'json' };
import { loadCampaignContext } from '../src/pipeline/context.js';
import { runProspect } from '../src/pipeline/run.js';

type Expect = { min_score?: number; max_score?: number; must_not_contain?: string[] };
type Case = { id: string; name: string; institution: string; expect: Expect };

const ctx = await loadCampaignContext(fixtures.campaign_id);
let passed = 0;
let totalCost = 0;

for (const c of fixtures.cases as Case[]) {
  const res = await runProspect(
    {
      prospect_id: `eval-${c.id}`,
      campaign_id: fixtures.campaign_id,
      name: c.name,
      institution: c.institution,
    },
    ctx,
    { persist: false },
  );

  totalCost += res.cost_usd;
  const failures: string[] = [];
  const s = res.overall_score ?? 0;

  if (c.expect.min_score !== undefined && s < c.expect.min_score) {
    failures.push(`score ${s} below expected ${c.expect.min_score}`);
  }
  if (c.expect.max_score !== undefined && s > c.expect.max_score) {
    failures.push(`score ${s} above expected max ${c.expect.max_score}`);
  }
  for (const banned of c.expect.must_not_contain ?? []) {
    const hay = `${res.subject ?? ''} ${res.body ?? ''}`.toLowerCase();
    if (hay.includes(banned.toLowerCase())) failures.push(`contains banned phrase: "${banned}"`);
  }

  if (failures.length === 0) {
    passed++;
    console.log(`PASS  ${c.id}  score=${s}  $${res.cost_usd.toFixed(4)}`);
  } else {
    console.log(`FAIL  ${c.id}  score=${s}`);
    for (const f of failures) console.log(`      ${f}`);
    if (res.body) console.log(`      --- body ---\n${res.body.split('\n').map((l) => '      ' + l).join('\n')}`);
  }
}

const total = (fixtures.cases as Case[]).length;
console.log(`\n${passed}/${total} passed   total cost $${totalCost.toFixed(4)}`);
process.exit(passed === total ? 0 : 1);
