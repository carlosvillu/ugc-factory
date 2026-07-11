// Sonda del verifier: expone el error que el catch de brief-synthesizer.ts se TRAGA (status
// 'parse_error' sin mensaje). Llama a la API real con exactamente los mismos parámetros.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { ProductBriefSchema } from '../../../packages/core/src/contracts/index';
import { BRIEF_SYNTHESIZER_SYSTEM_PROMPT } from '../../../packages/core/prompts/brief-synthesizer';

async function main() {
  const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const ct = await c.messages.countTokens({
    model: 'claude-sonnet-5',
    system: [{ type: 'text', text: BRIEF_SYNTHESIZER_SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: 'x' }],
  });
  console.log('SYSTEM PROMPT TOKENS (claude-sonnet-5):', ct.input_tokens);

  try {
    const r = await c.messages.parse({
      model: 'claude-sonnet-5',
      max_tokens: 12000,
      thinking: { type: 'disabled' },
      system: [
        {
          type: 'text',
          text: BRIEF_SYNTHESIZER_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content:
            'PLATFORM: shopify\n\nPAGE CONTENT: # Cafetera 15 bar\nPrecio 129 EUR. Calienta en 25 segundos.\n\nTARGET LANGUAGE: es',
        },
      ],
      output_config: { format: zodOutputFormat(ProductBriefSchema) },
    });
    console.log('OK usage:', JSON.stringify(r.usage));
    console.log('parsed_output null?', r.parsed_output === null);
  } catch (e: unknown) {
    const err = e as { constructor: { name: string }; status?: number; message?: string };
    console.log('THROWN:', err.constructor.name, 'status=', err.status);
    console.log('MESSAGE:', err.message?.slice(0, 3000));
  }
  process.exit(0);
}
void main();
