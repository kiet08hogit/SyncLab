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

function anthropicConfig(): SandboxConfig {
  return {
    workspace: '/workspace',
    repoDir: '/workspace/repo',
    stateDir: '/workspace/state',
    repoUrl: 'https://example.invalid/repo.git',
    repoFullName: 'synclab/example',
    migration: { kind: 'dependency', dependency: { name: 'lodash', version: '4.17.21' } },
    branchName: 'synclab/lodash',
    githubApiUrl: 'https://api.github.com',
    llm: {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      attempt: 1,
      maxAttempts: 1,
      maxFiles: 20,
      maxFileBytes: 60_000,
    },
  };
}

function request(contents: string, relativePath = 'src/users.js') {
  return {
    relativePath,
    contents,
    usage: { importedNames: ['_'], usageLines: [3] },
  };
}

/** Answers the Messages API as a server-sent event stream and records the request bodies. */
function stubAnthropic(
  t: TestContext,
  reply: string,
  stopReason: string,
  stopDetails: { type: 'refusal'; category: string | null } | null = null,
) {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  t.after(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  const requests: Array<Record<string, unknown>> = [];
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null, stop_details: stopDetails },
      usage: { output_tokens: 1 },
    },
    { type: 'message_stop' },
  ];
  const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');

  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: { body: string }) => {
    requests.push(JSON.parse(init.body));
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });

  return requests;
}

describe('the Anthropic refactor chain', () => {
  it('returns the rewritten file from a fenced reply', async (t) => {
    const requests = stubAnthropic(
      t,
      `Replaced _.pluck with _.map.\n\`\`\`js\n${MIGRATED}\`\`\``,
      'end_turn',
    );

    const outcome = await createRefactorChain(anthropicConfig())(request(ORIGINAL));

    assert.deepEqual(outcome, {
      changed: true,
      contents: MIGRATED,
      reason: 'Replaced _.pluck with _.map.',
    });
    assert.equal(requests[0].model, 'claude-opus-5-5');
    assert.equal(requests[0].stream, true);
    assert.equal(requests[0].fallbacks, 'default');
    const prompt = (requests[0].messages as Array<{ content: string }>)[0].content;
    assert.match(prompt, /^Dependency: lodash\n\nTarget version: 4\.17\.21$/m);
  });

  it('hands a validation failure back to the model on a retry', async (t) => {
    const requests = stubAnthropic(t, 'Nothing to change.\n', 'end_turn');

    await createRefactorChain(anthropicConfig())({
      ...request(ORIGINAL),
      previousValidation: 'rescan: still sends claude-3-opus-20240229',
    });

    const prompt = (requests[0].messages as Array<{ content: string }>)[0].content;
    assert.match(prompt, /rejected by validation/);
    assert.match(prompt, /rescan: still sends claude-3-opus-20240229/);
  });

  it('refuses a reply that reached max_tokens', async (t) => {
    stubAnthropic(t, `Updated.\n\`\`\`js\n${MIGRATED}\`\`\``, 'max_tokens');

    const error = await createRefactorChain(anthropicConfig())(request(ORIGINAL)).then(
      () => assert.fail('expected the reply to be refused'),
      (reason: unknown) => reason,
    );

    assert.match(String(error), /reached its output limit/);
    assert.equal(isRetryableModelError(error), false);
  });

  it('fails permanently when the model declines', async (t) => {
    stubAnthropic(t, '', 'refusal', { type: 'refusal', category: 'cyber' });

    const error = await createRefactorChain(anthropicConfig())(request(ORIGINAL)).then(
      () => assert.fail('expected the refusal to fail the file'),
      (reason: unknown) => reason,
    );

    assert.match(String(error), /declined to rewrite the file \(cyber\)/);
    assert.equal(isRetryableModelError(error), false);
  });
});
