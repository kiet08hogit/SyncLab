import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

/** Summarizes a support ticket in at most `maxWords` words. */
export async function summarize(ticket, { maxWords = 40 } = {}) {
  const message = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 300,
    system: `Summarize the support ticket in at most ${maxWords} words. Reply with the summary only.`,
    messages: [{ role: 'user', content: ticket.trim() }],
  });

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  const words = text.split(/\s+/);
  return words.length > maxWords ? `${words.slice(0, maxWords).join(' ')}...` : text;
}
