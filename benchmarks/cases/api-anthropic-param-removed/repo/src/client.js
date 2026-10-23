import Anthropic from '@anthropic-ai/sdk';

export const client = new Anthropic({ maxRetries: 0 });

export function textOf(message) {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}
