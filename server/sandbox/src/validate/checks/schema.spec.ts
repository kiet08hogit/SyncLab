import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { scanRequestObjects } from '../../analysis/api-usage.js';
import { check, findSchemaMismatches, type OpenaiSchema } from './schema.js';

const OPERATIONS: OpenaiSchema['operations'] = {
  'POST /v1/chat/completions': {
    params: ['messages', 'model', 'temperature', 'max_completion_tokens'],
    required: ['messages', 'model'],
  },
  'POST /v1/threads/{thread_id}/messages': {
    params: ['content', 'role', 'thread_id'],
    required: ['content', 'role', 'thread_id'],
  },
  'POST /v1/agents/sessions': {
    params: ['agent', 'input'],
    required: ['agent'],
  },
  'GET /v1/models/{model}': {
    params: ['model'],
    required: ['model'],
  },
};

/** Static paths and the templates a literal id must not be allowed to steal. */
const TEMPLATED: OpenaiSchema['operations'] = {
  ...OPERATIONS,
  'POST /v1/agents/{agent_id}': {
    params: ['agent_id', 'name'],
    required: ['agent_id', 'name'],
  },
  'POST /v1/agents/sessions/{session_id}': {
    params: ['agent', 'session_id'],
    required: ['agent', 'session_id'],
  },
  'POST /v1/threads/runs': {
    params: ['assistant_id'],
    required: ['assistant_id'],
  },
  'POST /v1/threads/{thread_id}': {
    params: ['metadata', 'thread_id'],
    required: ['metadata', 'thread_id'],
  },
  'POST /v1/threads/{thread_id}/runs': {
    params: ['assistant_id', 'thread_id'],
    required: ['assistant_id', 'thread_id'],
  },
  'POST /v1/responses/{response_id}/cancel': {
    params: ['response_id'],
    required: ['response_id'],
  },
  'POST /v1/organization/certificates/activate': {
    params: ['certificate_id'],
    required: [],
  },
  'POST /v1/organization/certificates/{certificate_id}': {
    params: ['certificate_id', 'name'],
    required: ['certificate_id', 'name'],
  },
  'GET /v1/videos/{video_id}/content': {
    params: ['variant', 'video_id'],
    required: ['variant', 'video_id'],
  },
  'GET /v1/videos/characters/{character_id}': {
    params: ['character_id', 'name'],
    required: ['character_id', 'name'],
  },
  'PUT /v1/chat/completions': {
    params: ['messages', 'model', 'temperature', 'max_completion_tokens'],
    required: ['messages', 'model'],
  },
  'PATCH /v1/chat/completions': {
    params: ['messages', 'model', 'temperature', 'max_completion_tokens'],
    required: ['messages', 'model'],
  },
};

function mismatches(
  code: string,
  files = ['src/chat.ts'],
  operations: OpenaiSchema['operations'] = OPERATIONS,
): string[] {
  const contents = ["import OpenAI from 'openai';", 'const client = new OpenAI();', code].join('\n');
  return reported(contents, files, operations);
}

function reported(
  contents: string,
  files = ['src/chat.ts'],
  operations: OpenaiSchema['operations'] = OPERATIONS,
): string[] {
  return findSchemaMismatches(scanRequestObjects([{ path: 'src/chat.ts', contents }]), {
    files,
    operations,
  });
}

describe('findSchemaMismatches', () => {
  it('passes a request that matches the new spec', () => {
    assert.deepEqual(
      mismatches("client.chat.completions.create({ model: 'gpt-5', messages: [], temperature: 0 });"),
      [],
    );
  });

  it('fails a key the new spec does not accept, such as a removed parameter', () => {
    assert.deepEqual(
      mismatches("client.chat.completions.create({ model: 'gpt-5', messages: [], max_tokens: 10 });"),
      [
        'src/chat.ts:3 POST /v1/chat/completions: sends max_tokens, which the new spec does not accept',
      ],
    );
  });

  it('fails a request that leaves out a required field', () => {
    assert.deepEqual(mismatches("client.chat.completions.create({ model: 'gpt-5' });"), [
      'src/chat.ts:3 POST /v1/chat/completions: leaves out messages, which the new spec requires',
    ]);
  });

  it('reports both problems of one request on one line', () => {
    assert.deepEqual(mismatches("client.chat.completions.create({ model: 'gpt-5', prompt: 'hi' });"), [
      'src/chat.ts:3 POST /v1/chat/completions: sends prompt, which the new spec does not accept; leaves out messages, which the new spec requires',
    ]);
  });

  it('reads a request bound once as a const', () => {
    assert.deepEqual(
      mismatches("const request = { model: 'gpt-5', stop: ['\\n'] };\nclient.chat.completions.create(request);"),
      [
        'src/chat.ts:4 POST /v1/chat/completions: sends stop, which the new spec does not accept; leaves out messages, which the new spec requires',
      ],
    );
  });

  it('still rejects a written key next to a spread, but lets the spread carry required fields', () => {
    assert.deepEqual(
      mismatches("client.chat.completions.create({ ...defaults, logprobs: true });"),
      ['src/chat.ts:3 POST /v1/chat/completions: sends logprobs, which the new spec does not accept'],
    );
  });

  it('lets fields added to a const request after it is declared carry required fields', () => {
    assert.deepEqual(
      mismatches(
        "const body = { model: 'gpt-5' };\nbody.messages = history;\nclient.chat.completions.create(body);",
      ),
      [],
    );
    assert.deepEqual(
      mismatches(
        "const body = { model: 'gpt-5', stop: ['\\n'] };\nObject.assign(body, extra);\nclient.chat.completions.create(body);",
      ),
      ['src/chat.ts:5 POST /v1/chat/completions: sends stop, which the new spec does not accept'],
    );
    assert.deepEqual(
      mismatches(
        "const body = { agent: 'a' };\nbody['input'] = 'x';\nfetch('https://api.openai.com/v1/agents/sessions', { method: 'POST', body: JSON.stringify(body) });",
      ),
      [],
    );
  });

  it('lets fields added through a type wrapper carry required fields', () => {
    assert.deepEqual(
      mismatches(
        "const body = { model: 'gpt-5' };\n(body as ChatRequest).messages = history;\nclient.chat.completions.create(body);",
      ),
      [],
    );
    assert.deepEqual(
      mismatches("const body = { model: 'gpt-5' };\nbody!.messages = history;\nclient.chat.completions.create(body);"),
      [],
    );
    assert.deepEqual(
      mismatches(
        "const body = { model: 'gpt-5' };\n(body satisfies object).messages = history;\nclient.chat.completions.create(body);",
      ),
      [],
    );
    assert.deepEqual(
      mismatches(
        "const body = { model: 'gpt-5', stop: ['\\n'] };\nObject.assign(body as ChatRequest, { messages });\nclient.chat.completions.create(body);",
      ),
      ['src/chat.ts:5 POST /v1/chat/completions: sends stop, which the new spec does not accept'],
    );
    assert.deepEqual(
      mismatches(
        "const body = { model: 'gpt-5', stop: ['\\n'] };\nObject.assign(body!, { messages });\nclient.chat.completions.create(body);",
      ),
      ['src/chat.ts:5 POST /v1/chat/completions: sends stop, which the new spec does not accept'],
    );
    assert.deepEqual(
      mismatches(
        "const body = { model: 'gpt-5', stop: ['\\n'] };\nObject.assign(body satisfies object, extra);\nclient.chat.completions.create(body);",
      ),
      ['src/chat.ts:5 POST /v1/chat/completions: sends stop, which the new spec does not accept'],
    );
    assert.deepEqual(mismatches("const body = { model: 'gpt-5' };\nclient.chat.completions.create(body as ChatRequest);"), [
      'src/chat.ts:4 POST /v1/chat/completions: leaves out messages, which the new spec requires',
    ]);
  });

  it('checks the object after a positional path parameter, which is not required in it', () => {
    assert.deepEqual(
      mismatches("client.beta.threads.messages.create(threadId, { role: 'user', content: 'hi' });"),
      [],
    );
    assert.deepEqual(mismatches("client.beta.threads.messages.create(threadId, { role: 'user' });"), [
      'src/chat.ts:3 POST /v1/threads/{thread_id}/messages: leaves out content, which the new spec requires',
    ]);
  });

  it('does not mistake the per-request options of a method without a request object for one', () => {
    assert.deepEqual(mismatches("client.models.retrieve('gpt-4o', { timeout: 5000 });"), []);
    assert.deepEqual(mismatches("client.models.retrieve('gpt-4o', { timeout: 5000, verbose: true });"), [
      'src/chat.ts:3 GET /v1/models/{model}: sends timeout, verbose, which the new spec does not accept',
    ]);
  });

  it('checks the body of a raw HTTP call', () => {
    assert.deepEqual(
      mismatches(
        "fetch('https://api.openai.com/v1/agents/sessions', { method: 'POST', body: JSON.stringify({ agent: 'a', spend_control: {} }) });",
      ),
      ['src/chat.ts:3 POST /v1/agents/sessions: sends spend_control, which the new spec does not accept'],
    );
  });

  it('fails a request to an operation the new spec no longer has', () => {
    assert.deepEqual(mismatches("client.embeddings.create({ model: 'e', input: 'x' });"), [
      'src/chat.ts:3 POST /v1/embeddings: the new spec has no such operation',
    ]);
  });

  it('checks a raw URL that fills one spec template with a literal id', () => {
    const contents = [
      "import axios from 'axios';",
      "fetch('https://api.openai.com/v1/threads/thread_abc/messages', { method: 'POST', body: JSON.stringify({ role: 'user', content: 'hi' }) });",
      "axios.post('https://api.openai.com/v1/threads/thread_abc/messages', { role: 'user', content: 'hi', extra: true });",
      "fetch('https://api.openai.com/v1/agents/sessions/sess_123', { method: 'POST', body: JSON.stringify({ agent: 'a' }) });",
      "fetch('https://api.openai.com/v1/agents/agent_123', { method: 'POST', body: JSON.stringify({ name: 'x' }) });",
      "fetch('https://api.openai.com/v1/threads/thread_abc/runs', { method: 'POST', body: JSON.stringify({ assistant_id: 'asst' }) });",
      "axios.post('https://api.openai.com/v1/responses/resp_123/cancel', {});",
      "fetch('https://api.openai.com/v1/threads/thread_abc/messages', { method: 'POST', body: JSON.stringify({ role: 'user' }) });",
    ].join('\n');
    assert.deepEqual(reported(contents, ['src/chat.ts'], TEMPLATED), [
      'src/chat.ts:3 POST /v1/threads/thread_abc/messages: sends extra, which the new spec does not accept',
      'src/chat.ts:8 POST /v1/threads/thread_abc/messages: leaves out content, which the new spec requires',
    ]);
  });

  it('keeps a static operation ahead of a template with the same shape', () => {
    assert.deepEqual(
      mismatches(
        [
          "fetch('https://api.openai.com/v1/agents/sessions', { method: 'POST', body: JSON.stringify({ agent: 'a' }) });",
          "fetch('https://api.openai.com/v1/threads/runs', { method: 'POST', body: JSON.stringify({ assistant_id: 'asst' }) });",
          "fetch('https://api.openai.com/v1/organization/certificates/activate', { method: 'POST', body: JSON.stringify({ certificate_id: 'c' }) });",
        ].join('\n'),
        ['src/chat.ts'],
        TEMPLATED,
      ),
      [],
    );
  });

  it('does not choose between several templates that fit one raw URL', () => {
    assert.deepEqual(
      mismatches(
        [
          "fetch('https://api.openai.com/v1/videos/characters/content', { method: 'GET', body: JSON.stringify({ name: 'hero' }) });",
          "fetch('https://api.openai.com/v1/videos/vid_123/content', { method: 'GET', body: JSON.stringify({}) });",
        ].join('\n'),
        ['src/chat.ts'],
        TEMPLATED,
      ),
      [
        'src/chat.ts:3 GET /v1/videos/characters/content: the new spec has no such operation',
        'src/chat.ts:4 GET /v1/videos/vid_123/content: leaves out variant, which the new spec requires',
      ],
    );
  });

  it('checks an axios body wrapped in JSON.stringify', () => {
    const contents = [
      "import axios from 'axios';",
      "axios.post('https://api.openai.com/v1/chat/completions', JSON.stringify({ model: 'gpt-5', messages: [] }));",
      "axios.post('https://api.openai.com/v1/chat/completions', JSON.stringify({ model: 'gpt-5', messages: [], max_tokens: 1 }));",
      "axios.put('https://api.openai.com/v1/chat/completions', JSON.stringify({ model: 'gpt-5', messages: [], max_tokens: 1 }));",
      "axios.patch('https://api.openai.com/v1/chat/completions', JSON.stringify({ model: 'gpt-5', messages: [], max_tokens: 1 }));",
      "axios({ url: 'https://api.openai.com/v1/chat/completions', method: 'post', data: JSON.stringify({ model: 'gpt-5', messages: [], max_tokens: 1 }) });",
      "axios('https://api.openai.com/v1/chat/completions', { method: 'POST', data: JSON.stringify({ model: 'gpt-5', messages: [], max_tokens: 1 }) });",
      "axios.request({ url: 'https://api.openai.com/v1/chat/completions', method: 'post', data: JSON.stringify({ model: 'gpt-5', messages: [], max_tokens: 1 }) });",
    ].join('\n');
    assert.deepEqual(reported(contents, ['src/chat.ts'], TEMPLATED), [
      'src/chat.ts:3 POST /v1/chat/completions: sends max_tokens, which the new spec does not accept',
      'src/chat.ts:4 PUT /v1/chat/completions: sends max_tokens, which the new spec does not accept',
      'src/chat.ts:5 PATCH /v1/chat/completions: sends max_tokens, which the new spec does not accept',
      'src/chat.ts:6 POST /v1/chat/completions: sends max_tokens, which the new spec does not accept',
      'src/chat.ts:7 POST /v1/chat/completions: sends max_tokens, which the new spec does not accept',
      'src/chat.ts:8 POST /v1/chat/completions: sends max_tokens, which the new spec does not accept',
    ]);
  });

  it('leaves a raw URL whose runtime part matches no operation unchecked', () => {
    assert.deepEqual(
      mismatches(
        "fetch(`https://api.openai.com/v1/${endpoint}`, { method: 'POST', body: JSON.stringify({ model, input }) });\n" +
          "fetch(`https://api.openai.com/${version}/chat/completions`, { method: 'POST', body: JSON.stringify({ model }) });",
      ),
      [],
    );
    assert.deepEqual(
      mismatches(
        "fetch(`https://api.openai.com/v1/threads/${id}/messages`, { method: 'POST', body: JSON.stringify({ role: 'user' }) });",
      ),
      ['src/chat.ts:3 POST /v1/threads/{param}/messages: leaves out content, which the new spec requires'],
    );
  });

  it('ignores files the migration did not rewrite and requests that are not literals', () => {
    assert.deepEqual(mismatches("client.chat.completions.create({ model: 'gpt-5' });", ['src/other.ts']), []);
    assert.deepEqual(mismatches('client.chat.completions.create(buildRequest());'), []);
  });

  it('ignores Anthropic requests', () => {
    const contents = [
      "import Anthropic from '@anthropic-ai/sdk';",
      'const client = new Anthropic();',
      "client.messages.create({ model: 'claude-haiku-4-5' });",
    ].join('\n');
    assert.deepEqual(reported(contents), []);
  });
});

describe('schema check', () => {
  let workspace: string;
  let previousWorkspace: string | undefined;
  let previousContext: string | undefined;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-schema-'));
    previousWorkspace = process.env.SANDBOX_WORKSPACE;
    previousContext = process.env.VALIDATE_CONTEXT;
    process.env.SANDBOX_WORKSPACE = workspace;
    await fs.mkdir(path.join(workspace, 'repo', 'src'), { recursive: true });
    await fs.writeFile(
      path.join(workspace, 'repo', 'src', 'client.ts'),
      "import OpenAI from 'openai';\nexport const client = new OpenAI();\n",
    );
    await fs.writeFile(
      path.join(workspace, 'repo', 'src', 'chat.ts'),
      "import { client } from './client';\nclient.chat.completions.create({ model: 'gpt-5', max_tokens: 5 });\n",
    );
  });

  afterEach(async () => {
    for (const [name, value] of [
      ['SANDBOX_WORKSPACE', previousWorkspace],
      ['VALIDATE_CONTEXT', previousContext],
    ] as const) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('has nothing to reject without a spec in the context', async () => {
    delete process.env.VALIDATE_CONTEXT;
    assert.equal(await check.run(), undefined);
  });

  it('rejects a request in the migrated checkout, following a client imported from another file', async () => {
    process.env.VALIDATE_CONTEXT = JSON.stringify({
      openaiSchema: { files: ['src/chat.ts'], operations: OPERATIONS },
    });
    assert.equal(
      await check.run(),
      'src/chat.ts:2 POST /v1/chat/completions: sends max_tokens, which the new spec does not accept; leaves out messages, which the new spec requires',
    );
  });
});
