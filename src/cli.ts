import { loadCampaignContext } from './pipeline/context.js';
import { runProspect } from './pipeline/run.js';
import { ProspectInput } from './schemas.js';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const name = arg('name');
const institution = arg('institution');
const campaign = arg('campaign');
const dry = process.argv.includes('--dry');

if (!name || !institution || !campaign) {
  console.error('Usage: npm run prospect -- --name "..." --institution "..." --campaign <uuid> [--dry]');
  process.exit(1);
}

const prospect = ProspectInput.parse({
  prospect_id: arg('id') ?? 'cli-test',
  campaign_id: campaign,
  name,
  institution,
  department: arg('department'),
});

const ctx = await loadCampaignContext(campaign);
const result = await runProspect(prospect, ctx, { persist: !dry });

console.log('\n' + '='.repeat(60));
console.log(`STATUS  ${result.status}   SCORE ${result.overall_score ?? '-'}`);
console.log(`COST    $${result.cost_usd.toFixed(4)}   TIME ${(result.ms / 1000).toFixed(1)}s`);
console.log('='.repeat(60));
console.log('RAW:', JSON.stringify(result, null, 2));
if (result.status === 'emailed') {
  console.log(`\nSUBJECT: ${result.subject ?? '(none)'}\n\n${result.body ?? '(none)'}\n`);
} else {
  console.log(`\nREASON: ${result.reason}\n`);
}