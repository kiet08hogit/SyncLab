import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startProvider } from './provider.js';

const RETIRED = 'claude-3-5-haiku-20241022';

const provider = await startProvider({
  reply: () => 'A short summary.',
  reject: ({ body }) =>
    body.model === RETIRED ? { status: 404, error: { type: 'not_found_error', message: `model: ${RETIRED}` } } : undefined,
});
process.env.ANTHROPIC_BASE_URL = provider.url;
process.env.ANTHROPIC_API_KEY = 'test-key';
const { summarize } = await import('../src/summarize.js');

after(() => provider.close());

test('the API accepts the summary request after Claude Haiku 3.5 is retired', async () => {
  assert.equal(await summarize('Login page times out.'), 'A short summary.');
  assert.ok(provider.requests.every((request) => request.body.model !== RETIRED));
});
