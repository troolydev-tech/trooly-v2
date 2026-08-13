import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { config, PRICING } from '../config.js';

const client = new Anthropic({ apiKey: config.anthropicKey });

export type Usage = { model: string; inputTokens: number; outputTokens: number; costUsd: number };

/** Accumulates every call in a run so you know the true cost per prospect. */
export class CostMeter {
  calls: Usage[] = [];
  add(u: Usage) { this.calls.push(u); }
  get totalUsd() { return this.calls.reduce((s, c) => s + c.costUsd, 0); }
  get breakdown() {
    return this.calls.reduce<Record<string, number>>((acc, c) => {
      acc[c.model] = (acc[c.model] ?? 0) + c.costUsd;
      return acc;
    }, {});
  }
}

function priceOf(model: string, inTok: number, outTok: number): number {
  const p = PRICING[model] ?? { in: 0, out: 0 };
  return (inTok / 1_000_000) * p.in + (outTok / 1_000_000) * p.out;
}

/**
 * Ask Claude for data shaped like a Zod schema, and get back a validated object.
 *
 * This uses tool-calling rather than "please reply in JSON". The model is forced to
 * fill in the schema, so there is nothing to parse and nothing to regex. If validation
 * still fails, we retry with the error fed back in.
 */
export async function structured<T extends z.ZodTypeAny>(opts: {
  model: string;
  system: string;
  prompt: string;
  schema: T;
  schemaName: string;
  schemaDescription: string;
  maxTokens?: number;
  meter?: CostMeter;
  retries?: number;
}): Promise<z.infer<T>> {
  const {
    model, system, prompt, schema, schemaName, schemaDescription,
    maxTokens = 4000, meter, retries = 2,
  } = opts;

  const jsonSchema = zodToJsonSchema(schema, { target: 'openApi3' }) as Record<string, unknown>;
  let lastError = '';

  for (let attempt = 0; attempt <= retries; attempt++) {
    const userContent = attempt === 0
      ? prompt
      : `${prompt}\n\nYour previous response failed validation with this error:\n${lastError}\nFix it and submit again.`;

    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
    
      system,
      messages: [{ role: 'user', content: userContent }],
      tools: [{
        name: schemaName,
        description: schemaDescription,
        input_schema: jsonSchema as Anthropic.Tool['input_schema'],
      }],
      tool_choice: { type: 'tool', name: schemaName },
    });

    meter?.add({
      model,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      costUsd: priceOf(model, res.usage.input_tokens, res.usage.output_tokens),
    });

    const block = res.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      lastError = 'No tool_use block returned.';
      continue;
    }

    const parsed = schema.safeParse(block.input);
    if (parsed.success) return parsed.data;

    lastError = JSON.stringify(parsed.error.issues, null, 2);
  }

  throw new Error(`structured(${schemaName}) failed after ${retries + 1} attempts. Last error:\n${lastError}`);
}
