import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}. Copy .env.example to .env and fill it in.`);
  return v;
}

export const config = {
  anthropicKey: required('ANTHROPIC_API_KEY'),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceKey: required('SUPABASE_SERVICE_KEY'),
  openAlexMailto: process.env.OPENALEX_MAILTO ?? '',
  serperKey: process.env.SERPAPI_KEY ?? '',
  port: Number(process.env.PORT ?? 3000),
};

export const MODELS = {
  extractor: 'claude-haiku-4-5-20251001',  // fast structured extraction
  scorer: 'claude-sonnet-5',                // judgment
  writer: 'claude-sonnet-5',                // email writing
  gate: 'claude-sonnet-5',                  // quality gate
} as const;

/** USD per million tokens. Used for per-prospect cost logging. */
export const PRICING: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'claude-sonnet-5': { in: 2, out: 10 },
};
