import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

/** Answers the next turn of a conversation, given as [{ role, content }]. */
export async function reply(history) {
  const message = await client.messages.create({
    model: 'claude-3-7-sonnet-20250219',
    max_tokens: 1024,
    system: 'You are the help desk assistant for an internal wiki.',
    messages: history,
  });
  return message.content.find((block) => block.type === 'text')?.text ?? '';
}
