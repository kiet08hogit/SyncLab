import { client, textOf } from './client.js';

const SEVERITIES = ['blocker', 'major', 'minor', 'nit'];

/**
 * Reviews a diff for the pull request bot. Reviews run in the request path of
 * the webhook, so they ask for the fastest output the model offers.
 */
export async function reviewDiff(diff) {
  const message = await client.beta.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 2000,
    system: `Review the diff. Answer one finding per line as "<severity>: <comment>", severity one of ${SEVERITIES.join(', ')}.`,
    messages: [{ role: 'user', content: diff }],
  });

  return textOf(message)
    .split('\n')
    .map((line) => line.match(/^(\w+):\s*(.+)$/))
    .filter((match) => match && SEVERITIES.includes(match[1]))
    .map(([, severity, comment]) => ({ severity, comment }));
}
