import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startProvider, userText } from './provider.js';

const provider = await startProvider({
  reply: (request) => (userText(request).includes('sentiment') ? 'positive' : 'travel, mug'),
  reject: ({ path }) =>
    path === '/v1/complete'
      ? { status: 404, error: { type: 'not_found_error', message: 'The Text Completions API is retired. Use /v1/messages.' } }
      : undefined,
});
process.env.ANTHROPIC_BASE_URL = provider.url;
process.env.ANTHROPIC_API_KEY = 'test-key';
const { classifySentiment } = await import('../src/classify.js');
const { suggestTags } = await import('../src/tags.js');

after(() => provider.close());

test('both modules work once the Text Completions API is retired', async () => {
  assert.equal(await classifySentiment('Love it.'), 'positive');
  assert.deepEqual(await suggestTags('A travel mug.'), ['travel', 'mug']);
  assert.ok(provider.requests.every((request) => request.path === '/v1/messages'));
});
