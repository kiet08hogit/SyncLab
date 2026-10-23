import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startProvider, userText } from './provider.js';

const provider = await startProvider({
  reply: (request) => {
    const text = userText(request);
    if (text.startsWith('Define')) return ' A workspace is a shared folder for a team. ';
    const strings = JSON.parse(text);
    return JSON.stringify({ greeting: `Hallo {name}`, ...(strings.farewell ? { farewell: 42 } : {}) });
  },
});
process.env.OPENAI_BASE_URL = provider.url;
process.env.OPENAI_API_KEY = 'test-key';
const { translate } = await import('../src/translate.js');
const { define } = await import('../src/glossary.js');

after(() => provider.close());

test('translates the values and asks for JSON in the target language', async () => {
  assert.deepEqual(await translate({ greeting: 'Hello {name}' }, 'German'), { greeting: 'Hallo {name}' });
  const { body } = provider.requests.at(-1);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.match(body.messages[0].content, /into German/);
});

test('keeps the source string when a translation is missing or not a string', async () => {
  assert.deepEqual(await translate({ greeting: 'Hello {name}', farewell: 'Bye' }, 'German'), {
    greeting: 'Hallo {name}',
    farewell: 'Bye',
  });
});

test('defines a glossary term', async () => {
  assert.equal(await define('workspace'), 'A workspace is a shared folder for a team.');
});
