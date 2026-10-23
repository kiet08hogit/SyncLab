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
};

function mismatches(code: string, files = ['src/chat.ts']): string[] {
  const contents = ["import OpenAI from 'openai';", 'const client = new OpenAI();', code].join('\n');
  return findSchemaMismatches(scanRequestObjects([{ path: 'src/chat.ts', contents }]), {
    files,
    operations: OPERATIONS,
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

  it('checks the object after a positional path parameter, which is not required in it', () => {
    assert.deepEqual(
      mismatches("client.beta.threads.messages.create(threadId, { role: 'user', content: 'hi' });"),
      [],
    );
    assert.deepEqual(mismatches("client.beta.threads.messages.create(threadId, { role: 'user' });"), [
      'src/chat.ts:3 POST /v1/threads/{thread_id}/messages: leaves out content, which the new spec requires',
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
    assert.deepEqual(
      findSchemaMismatches(scanRequestObjects([{ path: 'src/chat.ts', contents }]), {
        files: ['src/chat.ts'],
        operations: OPERATIONS,
      }),
      [],
    );
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
