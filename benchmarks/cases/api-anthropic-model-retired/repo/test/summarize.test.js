import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startProvider, userText } from './provider.js';

const provider = await startProvider({
  reply: (request) => `Customer reports: ${userText(request)}`,
});
process.env.ANTHROPIC_BASE_URL = provider.url;
process.env.ANTHROPIC_API_KEY = 'test-key';
const { summarize } = await import('../src/summarize.js');

after(() => provider.close());

test('returns the model summary of the trimmed ticket', async () => {
  assert.equal(await summarize('  Login page times out.  '), 'Customer reports: Login page times out.');
});

test('caps the summary at maxWords and says so in the system prompt', async () => {
  const summary = await summarize('one two three four five six', { maxWords: 4 });
  assert.equal(summary, 'Customer reports: one two...');
  assert.match(provider.requests.at(-1).body.system, /at most 4 words/);
});
