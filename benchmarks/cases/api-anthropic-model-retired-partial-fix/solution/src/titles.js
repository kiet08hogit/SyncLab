import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const MAX_TITLE = 48;

/** Names a conversation from its first question, for the sidebar. */
export async function titleFor(question) {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 30,
    messages: [{ role: 'user', content: `Write a title of at most six words for this question: ${question}` }],
  });
  const title = (message.content.find((block) => block.type === 'text')?.text ?? '').replace(/^["']|["']$/g, '').trim();
  return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title || 'New conversation';
}
