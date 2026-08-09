import { db } from '../src/lib/supabase.js';

async function seed() {
  const id = 'seed-p1';
  const campaignId = 'frontend-test';

  const record = {
    id,
    campaign_id: campaignId,
    name: 'Seed Lead',
    institution: 'Example University',
    department: 'Computer Science',
    email: 'seed@example.com',
    lead_status: 'queued',
  };

  const { data, error } = await db.from('prospects').insert(record).select();
  if (error) {
    console.error('Seed failed:', error.message || error);
    process.exit(1);
  }

  console.log('Inserted prospect:', data);
  process.exit(0);
}

seed();
