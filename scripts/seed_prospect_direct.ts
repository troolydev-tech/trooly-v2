import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

function loadEnvFile(filePath: string) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const env: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    env[key] = val;
  }
  return env;
}

async function main() {
  const envPath = path.resolve(process.cwd(), '.env.example');
  if (!fs.existsSync(envPath)) {
    console.error('.env.example not found');
    process.exit(1);
  }

  const env = loadEnvFile(envPath);
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    console.error('Supabase URL or key missing in .env.example');
    process.exit(1);
  }

  const supa = createClient(url, key, { auth: { persistSession: false } });

  const record = {
    id: 'direct-seed-1',
    campaign_id: 'frontend-test',
    name: 'Direct Seed',
    institution: 'Example Institute',
    department: 'Engineering',
    email: 'direct-seed@example.com',
    lead_status: 'queued',
  } as Record<string, unknown>;

  const { data, error } = await supa.from('prospects').insert(record).select();
  if (error) {
    console.error('Insert failed:', error.message || error);
    process.exit(1);
  }

  console.log('Inserted:', data);
  process.exit(0);
}

main();
