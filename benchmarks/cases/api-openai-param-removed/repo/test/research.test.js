import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startProvider } from './provider.js';

const provider = await startProvider();
process.env.OPENAI_BASE_URL = provider.url;
process.env.OPENAI_API_KEY = 'test-key';
const { startResearch } = await import('../src/research.js');
const { moveSession } = await import('../src/sessions.js');

after(() => provider.close());

test('starts a session for the research agent with the trimmed question and ticket', async () => {
  const started = await startResearch('  Why do exports time out?  ', { ticket: 'SUP-42' });
  assert.deepEqual(started, { sessionId: 'sess_1', agentId: 'agent_research' });
  const { path, body } = provider.requests.at(-1);
  assert.equal(path, '/v1/agents/sessions');
  assert.equal(body.input, 'Why do exports time out?');
  assert.deepEqual(body.metadata, { ticket: 'SUP-42' });
});

test('refuses an empty question without calling the API', async () => {
  const before = provider.requests.length;
  await assert.rejects(startResearch('   '), /question is required/);
  assert.equal(provider.requests.length, before);
});

test('moves a session to another ticket', async () => {
  assert.equal(await moveSession('sess_9', 'SUP-7'), 'SUP-7');
  assert.equal(provider.requests.at(-1).path, '/v1/agents/sessions/sess_9');
});
