import { Anthropic } from '@anthropic-ai/sdk';

const client = new Anthropic();

/** Suggests up to `limit` lowercase tags for a product listing. */
export async function suggestTags(listing, limit = 5) {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 60,
    messages: [
      {
        role: 'user',
        content: `Suggest up to ${limit} short tags for this listing, comma separated.\n\n${listing}`,
      },
    ],
  });

  const completion = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return [...new Set(completion.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, limit);
}
