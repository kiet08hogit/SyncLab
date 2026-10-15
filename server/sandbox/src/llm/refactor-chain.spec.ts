import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import type { SandboxConfig } from '../config.js';
import { isRetryableModelError } from './errors.js';
import { createRefactorChain, parseFencedReply } from './refactor-chain.js';

const ORIGINAL = "const _ = require('lodash');\n\nmodule.exports = _.pluck(users, 'name');\n";
const MIGRATED = "const _ = require('lodash');\n\nmodule.exports = _.map(users, 'name');\n";

describe('parseFencedReply', () => {
  it('reads the reason and the file from a fenced block', () => {
    const reply = `Replaced _.pluck with _.map.\n\n\`\`\`javascript\n${MIGRATED}\`\`\``;

    assert.deepEqual(parseFencedReply(reply, ORIGINAL), {
      changed: true,
      contents: MIGRATED,
      reason: 'Replaced _.pluck with _.map.',
    });
  });

  it('treats a reply without a block as no change', () => {
    assert.deepEqual(parseFencedReply('The file does not use any removed API.\n', ORIGINAL), {
      changed: false,
      contents: '',
      reason: 'The file does not use any removed API.',
    });
  });

  it('treats the original file echoed back as no change', () => {
    const reply = `Nothing to change.\n\`\`\`\n${ORIGINAL}\`\`\`\n`;

    assert.equal(parseFencedReply(reply, ORIGINAL).changed, false);
  });

  it('keeps a fence that appears inside the file', () => {
    const withFence = 'const doc = `\n```\nexample\n```\n`;\n';
    const reply = `Updated.\n\`\`\`ts\n${withFence}\`\`\``;

    assert.equal(parseFencedReply(reply, 'old\n').contents, withFence);
  });

  it("follows the original file's trailing newline", () => {
    const reply = `Updated.\n\`\`\`\n${MIGRATED}\`\`\``;

    assert.equal(parseFencedReply(reply, ORIGINAL.trimEnd()).contents, MIGRATED.trimEnd());
  });

  it('refuses a block that was cut off before it closed', () => {
    const reply = `Updated.\n\`\`\`js\n${MIGRATED.slice(0, 20)}`;

    assert.throws(() => parseFencedReply(reply, ORIGINAL), /never closed/);
  });
});

function ollamaConfig(numCtx: number): SandboxConfig {
  return {
    workspace: '/workspace',
    repoDir: '/workspace/repo',
    stateDir: '/workspace/state',
    repoUrl: 'https://example.invalid/repo.git',
    repoFullName: 'synclab/example',
    dependencyName: 'lodash',
    targetVersion: '4.17.21',
    branchName: 'synclab/lodash',
    githubApiUrl: 'https://api.github.com',
    llm: {
      provider: 'ollama',
      model: 'qwen2.5-coder:14b',
      baseUrl: 'http://ollama.invalid:11434',
      numCtx,
      attempt: 1,
      maxAttempts: 1,
      maxFiles: 20,
      maxFileBytes: 60_000,
    },
  };
}

/** Answers Ollama's streaming chat endpoint and records what was asked of it. */
function stubOllama(t: TestContext, reply: string, doneReason: string) {
  const requests: Array<{ options: { num_ctx: number; num_predict: number } }> = [];
  const chunks = [
    { message: { role: 'assistant', content: reply }, done: false },
    { message: { role: 'assistant', content: '' }, done: true, done_reason: doneReason },
  ].map((chunk) => JSON.stringify({ model: 'qwen2.5-coder:14b', ...chunk }));

  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: { body: string }) => {
    requests.push(JSON.parse(init.body));
    return new Response(`${chunks.join('\n')}\n`, { status: 200 });
  });

  return requests;
}

function request(contents: string) {
  return {
    relativePath: 'src/users.js',
    contents,
    usage: { importedNames: ['_'], usageLines: [3] },
  };
}

describe('the Ollama refactor chain', () => {
  const withFence =
    'const doc = `\n```\nexample\n```\n`;\nmodule.exports = _.map(users, "name");\n';
  // Cut off right after the fence inside the file, which reads like a closed block.
  const cutOff = `Updated.\n\`\`\`js\n${withFence.slice(0, withFence.lastIndexOf('```') + 3)}`;

  it('returns the rewritten file when the model finished on its own', async (t) => {
    const requests = stubOllama(
      t,
      `Replaced _.pluck with _.map.\n\`\`\`js\n${MIGRATED}\`\`\``,
      'stop',
    );

    const outcome = await createRefactorChain(ollamaConfig(32_768))(request(ORIGINAL));

    assert.deepEqual(outcome, {
      changed: true,
      contents: MIGRATED,
      reason: 'Replaced _.pluck with _.map.',
    });
    assert.equal(requests[0].options.num_ctx, 32_768);
    assert.equal(requests[0].options.num_predict, Math.ceil(ORIGINAL.length * 0.5) + 512);
  });

  it('refuses a reply that hit the output limit after a fence inside the file', async (t) => {
    stubOllama(t, cutOff, 'length');

    await assert.rejects(
      createRefactorChain(ollamaConfig(32_768))(request(ORIGINAL)),
      /reached its output limit, so the file was cut off/,
    );
  });

  it('keeps the output cap inside the room the prompt leaves', async (t) => {
    const requests = stubOllama(t, 'Nothing to change.', 'stop');
    const contents = `${ORIGINAL}${'// filler line for the context budget\n'.repeat(80)}`;
    const numCtx = 3_000;

    await createRefactorChain(ollamaConfig(numCtx))(request(contents));

    const { num_predict } = requests[0].options;
    assert.ok(num_predict < Math.ceil(contents.length * 0.5) + 512);
    assert.ok(num_predict >= Math.ceil(contents.length / 3) + 512);
    assert.ok(num_predict + Math.ceil(contents.length / 3) < numCtx);
  });

  it('fails a file that cannot fit the context window without calling the model', async (t) => {
    const requests = stubOllama(t, 'Nothing to change.', 'stop');
    const contents = `${ORIGINAL}${'// filler line for the context budget\n'.repeat(400)}`;

    const error = await createRefactorChain(ollamaConfig(8_192))(request(contents)).then(
      () => assert.fail('expected the file to be refused'),
      (reason: unknown) => reason,
    );

    assert.match(
      String(error),
      /src\/users\.js is too large to rewrite within the 8192 token context window/,
    );
    assert.equal(isRetryableModelError(error), false);
    assert.equal(requests.length, 0);
  });
});
