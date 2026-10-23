import { client, textOf } from './client.js';

/** Explains a finding in plain words when a reviewer asks for more detail. */
export async function explainFinding(finding) {
  const message = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 800,
    messages: [{ role: 'user', content: `Explain this review finding to the author: ${finding.comment}` }],
  });
  return textOf(message);
}
