import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startProvider } from './provider.js';

const RETIRED = 'gpt-4.5-preview';

const provider = await startProvider({
  reply: () => JSON.stringify({ title: 'Paramètres' }),
  reject: ({ body }) =>
    body.model === RETIRED
      ? {
          status: 404,
          error: {
            message: `The model \`${RETIRED}\` does not exist or you do not have access to it.`,
            type: 'invalid_request_error',
            param: null,
            code: 'model_not_found',
          },
        }
      : undefined,
});
process.env.OPENAI_BASE_URL = provider.url;
process.env.OPENAI_API_KEY = 'test-key';
const { translate } = await import('../src/translate.js');

after(() => provider.close());

test('the API accepts the translation request after GPT-4.5 preview is removed', async () => {
  assert.deepEqual(await translate({ title: 'Settings' }, 'French'), { title: 'Paramètres' });
});
