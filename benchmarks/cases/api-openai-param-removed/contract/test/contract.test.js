import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startProvider } from './provider.js';

const provider = await startProvider({
  reject: ({ path, body }) =>
    path === '/v1/agents/sessions' && 'spend_control' in body
      ? {
          status: 400,
          error: {
            message: "Unknown parameter: 'spend_control'.",
            type: 'invalid_request_error',
            param: 'spend_control',
            code: 'unknown_parameter',
          },
        }
      : undefined,
});
process.env.OPENAI_BASE_URL = provider.url;
process.env.OPENAI_API_KEY = 'test-key';
const { startResearch } = await import('../src/research.js');

after(() => provider.close());

test('the API accepts the session request after spend_control is removed', async () => {
  const started = await startResearch('Why do exports time out?', { ticket: 'SUP-42' });
  assert.equal(started.agentId, 'agent_research');
});
