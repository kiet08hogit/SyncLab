import { Anthropic } from '@anthropic-ai/sdk';

const client = new Anthropic();

/** Suggests up to `limit` lowercase tags for a product listing. */
export async function suggestTags(listing, limit = 5) {
  const prompt = [
    `${Anthropic.HUMAN_PROMPT} Suggest up to ${limit} short tags for this listing, comma separated.`,
    '',
    listing,
    Anthropic.AI_PROMPT,
  ].join('\n');

  const { completion } = await client.completions.create({
    model: 'claude-2.1',
    max_tokens_to_sample: 60,
    prompt,
  });

  return [...new Set(completion.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, limit);
}
