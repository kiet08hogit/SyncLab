import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, type TestContext } from 'node:test';
import { classify, readClassifyInput } from './classify.js';

const INPUT = {
  provider: 'openai',
  sourceKind: 'release_notes',
  url: 'https://developers.openai.com/api/docs/changelog',
  text: '## Oct 1\nThe `functions` parameter of POST /v1/chat/completions has been removed.',
};

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function stubAnthropic(t: TestContext, reply: string) {
  const bodies: string[] = [];
  const message = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text: reply }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };

  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: { body: string }) => {
    bodies.push(init.body);
    return new Response(JSON.stringify(message), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return bodies;
}

describe('readClassifyInput', () => {
  it('decodes the base64 JSON input', () => {
    assert.deepEqual(readClassifyInput(encode(INPUT)), INPUT);
  });

  it('refuses a missing, undecodable or incomplete input', () => {
    assert.throws(() => readClassifyInput(undefined), /Missing required environment variable CLASSIFY_INPUT/);
    assert.throws(() => readClassifyInput('not base64 json'), /not base64-encoded JSON/);
    assert.throws(() => readClassifyInput(encode({ ...INPUT, provider: 'gemini' })), /needs a provider/);
    assert.throws(() => readClassifyInput(encode({ ...INPUT, text: 1 })), /needs a provider/);
    assert.throws(() => readClassifyInput(encode(null)), /needs a provider/);
  });
});

describe('classify', () => {
  let saved: NodeJS.ProcessEnv;

  beforeEach(() => {
    saved = { ...process.env };
    Object.assign(process.env, {
      CLASSIFY_INPUT: encode(INPUT),
      LLM_PROVIDER: 'anthropic',
      LLM_MODEL: 'claude-opus-5-5',
      ANTHROPIC_API_KEY: 'test-key',
    });
  });

  afterEach(() => {
    for (const name of Object.keys(process.env)) {
      if (!(name in saved)) delete process.env[name];
    }
    Object.assign(process.env, saved);
  });

  it('reports the validated changes in the result', async (t) => {
    const change = {
      kind: 'param_removed',
      operation: 'POST /v1/chat/completions',
      field: 'functions',
      replacement: null,
      effectiveAt: null,
      evidence: 'The `functions` parameter of POST /v1/chat/completions has been removed.',
    };
    const bodies = stubAnthropic(t, JSON.stringify({ changes: [change, { kind: 'param_removed' }] }));

    const result = await classify();

    assert.equal(result.phase, 'classify');
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { changes: [change], dropped: 1 });
    assert.match(result.steps[0].output, /Found 1 breaking change/);
    assert.match(result.steps[0].output, /Dropped 1 malformed item/);
    assert.ok(bodies[0].includes('has been removed.'));
  });

  it('fails the phase, marked retryable, when the model is unreachable', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    });

    const result = await classify();

    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /^model call failed/);
    assert.deepEqual(result.data, { retryable: true });
  });
});
