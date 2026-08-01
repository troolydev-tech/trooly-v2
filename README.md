# Trooly Engine

The research → scoring → email pipeline, as code. Replaces the n8n Prospect Researcher.

## Why this exists

n8n was costing you time in ways that don't show up as features: workflow JSON you can't
diff, no way to test a prompt change without running it live, and a class of bugs
(bare objects vs arrays, metadata contamination, lost IDs) that only exist because of
the orchestrator.

The thing that actually matters here is `npm run eval`. Change a prompt, run it, and
find out in ninety seconds whether emails got better across every test case. That is
the capability n8n cannot give you, and it's what lets the product improve weekly
instead of plateauing.

## Get it running

```bash
npm install
cp .env.example .env      # fill in your keys
npm run prospect -- --name "Some Person" --institution "Some Institution" --campaign <uuid> --dry
```

`--dry` skips writing to Supabase. Drop it once the output looks right.

Then the server:

```bash
npm run dev               # POST /run with { campaign_id, prospects: [...] }
```

## Structure

```
src/
  config.ts          model choices + pricing, all in one place
  schemas.ts         every LLM response is validated against these
  lib/claude.ts      structured() — forces Claude to fill a schema, retries on failure
  lib/supabase.ts    service-role client (bypasses RLS — server only)
  sources/
    openalex.ts      publications. free, structured, no hallucination risk
    directory.ts     VIDWAN/IRINS scrape adapter — add institute hosts here
    liveSignals.ts   recruitment ads + tenders = "funded and active right now"
    scrape.ts        Jina.ai reader
  pipeline/
    context.ts       what the seller sells (once per campaign, not per prospect)
    research.ts      assemble the evidence
    score.ts         Haiku. four dimensions. gates everything downstream
    email.ts         Sonnet writes, Haiku checks
    run.ts           one prospect end to end + bounded-concurrency batch
  cli.ts             run one prospect from the terminal
  server.ts          Hono endpoint, same payload shape as your n8n webhook
evals/
  fixtures.json      your test cases — fill these in with real prospects
  run.ts             npm run eval
```

## Design decisions worth knowing

**Structured outputs everywhere.** Nothing parses text. Claude is handed a JSON schema
and forced to fill it. This is why there's no Text Parser and no regex, and why the
separate Hallucination Guard mostly isn't needed — the extraction step is told, at the
schema level, that it may only return what's in the source text.

**Sources that return facts, not prose.** OpenAlex gives you real publications with real
dates. Perplexity gives you a paragraph that might be true. Five Perplexity calls
collapse into one OpenAlex call plus one Haiku extraction, which is cheaper, faster,
and more accurate.

**Every source may fail.** Nothing throws the run away because one lookup 404'd.
The bundle records `sources_used` so a weak email is explainable after the fact.

**Cost is measured, not estimated.** `CostMeter` totals every call. You'll know your
real per-prospect cost within an hour of running this.

**Industry-agnostic by construction.** No prompt in here names a field, a product
category, or an industry. Read `score.ts` and `email.ts` — they reason about what the
product does versus what the person works on, nothing more.

## What's stubbed, and honestly so

- `sources/directory.ts` — `IRINS_HOSTS` is empty. Add the institute subdomains your
  customers actually target. Everything else works around it.
- `sources/liveSignals.ts` — needs a Serper.dev key. Without one it returns nothing and
  the pipeline degrades to publications only.
- `pipeline/context.ts` — column names must match your Supabase schema. Verify these
  once; mismatches here have been your most common silent failure.

## Migration path

Don't rewrite everything at once. Point your existing n8n workflow at `POST /run` as a
single HTTP node and let n8n keep doing the webhook. When n8n is doing nothing but
forwarding a request, delete it.
