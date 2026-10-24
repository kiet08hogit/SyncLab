import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startProvider } from './provider.js';

const provider = await startProvider({
  reply: () => 'minor: missing newline at end of file',
  reject: ({ body }) =>
    body.model === 'claude-opus-4-7' && body.speed === 'fast'
      ? {
          status: 400,
          error: { type: 'invalid_request_error', message: 'speed: fast mode is not available for claude-opus-4-7' },
        }
      : undefined,
});
process.env.ANTHROPIC_BASE_URL = provider.url;
process.env.ANTHROPIC_API_KEY = 'test-key';
const { reviewDiff } = await import('../src/review.js');

after(() => provider.close());

test('the API accepts the review request after fast mode is removed for Claude Opus 4.7', async () => {
  assert.deepEqual(await reviewDiff('+ const x = 1'), [{ severity: 'minor', comment: 'missing newline at end of file' }]);
});
