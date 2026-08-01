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

/**
 * Model choices live in ONE place so you can swap them without hunting through prompts.
 * Haiku  = filtering, extraction, scoring, validation. Cheap and fast.
 * Sonnet = the final email. This is the only place quality is worth paying for.
 */
export const MODELS = {
  cheap: 'claude-haiku-4-5-20251001',
  writer: 'claude-sonnet-5',
} as const;

/** USD per million tokens. Used for per-prospect cost logging. */
export const PRICING: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'claude-sonnet-5': { in: 2, out: 10 },
};
