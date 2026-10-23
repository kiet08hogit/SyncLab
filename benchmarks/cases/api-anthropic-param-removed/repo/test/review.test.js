import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startProvider, userText } from './provider.js';

const provider = await startProvider({
  reply: (request) =>
    userText(request).startsWith('Explain')
      ? 'The loop reads past the end of the array.'
      : 'major: off-by-one in the loop bound\nsummary: looks fine otherwise\nnit: rename i to index',
});
process.env.ANTHROPIC_BASE_URL = provider.url;
process.env.ANTHROPIC_API_KEY = 'test-key';
const { reviewDiff } = await import('../src/review.js');
const { explainFinding } = await import('../src/explain.js');

after(() => provider.close());

test('parses one finding per line and drops lines without a known severity', async () => {
  assert.deepEqual(await reviewDiff('- for (i = 0; i <= n; i++)'), [
    { severity: 'major', comment: 'off-by-one in the loop bound' },
    { severity: 'nit', comment: 'rename i to index' },
  ]);
  assert.equal(provider.requests.at(-1).body.messages[0].content, '- for (i = 0; i <= n; i++)');
});

test('explains a finding', async () => {
  const text = await explainFinding({ severity: 'major', comment: 'off-by-one in the loop bound' });
  assert.equal(text, 'The loop reads past the end of the array.');
});
