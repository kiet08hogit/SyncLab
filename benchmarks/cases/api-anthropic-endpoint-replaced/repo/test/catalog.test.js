import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startProvider, userText } from './provider.js';

const provider = await startProvider({
  reply: (request) => {
    const text = userText(request);
    if (text.includes('sentiment')) return text.includes('broke') ? 'Negative' : 'maybe';
    return 'Kitchen, Steel, kitchen, Kettle';
  },
});
process.env.ANTHROPIC_BASE_URL = provider.url;
process.env.ANTHROPIC_API_KEY = 'test-key';
const { classifySentiment } = await import('../src/classify.js');
const { suggestTags } = await import('../src/tags.js');

after(() => provider.close());

test('labels a review and rejects an answer that is not a label', async () => {
  assert.equal(await classifySentiment('It broke after a week.'), 'negative');
  assert.equal(await classifySentiment('It arrived.'), null);
  assert.match(userText(provider.requests.at(-1)), /<review>It arrived\.<\/review>/);
});

test('suggests unique lowercase tags up to the limit', async () => {
  assert.deepEqual(await suggestTags('A steel kettle.', 2), ['kitchen', 'steel']);
  assert.match(userText(provider.requests.at(-1)), /up to 2 short tags/);
  assert.match(userText(provider.requests.at(-1)), /A steel kettle\./);
});
