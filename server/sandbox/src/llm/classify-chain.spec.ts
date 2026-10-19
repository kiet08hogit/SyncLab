import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import type { LlmConfig } from '../config.js';
import { isRetryableModelError } from './errors.js';
import {
  buildUserPrompt,
  createClassifyChain,
  parseJsonReply,
  validateChanges,
  type ClassifyInput,
} from './classify-chain.js';

const EVIDENCE =
  '**api:** beta user profiles: add external_user_onboarded_at, remove relationship in favor of access_type';

const CHANGE = {
  kind: 'param_renamed',
  operation: null,
  field: 'relationship',
  replacement: 'access_type',
  effectiveAt: null,
  evidence: EVIDENCE,
};

const INPUT: ClassifyInput = {
  provider: 'anthropic',
  sourceKind: 'sdk_changelog',
  url: 'https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/CHANGELOG.md',
  text: `## 0.123.0 (2026-09-01)\n## Features\n* ${EVIDENCE}`,
};

describe('validateChanges', () => {
  it('keeps well-formed items', () => {
    assert.deepEqual(validateChanges({ changes: [CHANGE] }), { changes: [CHANGE], dropped: 0 });
  });

  it('drops malformed items and keeps the rest', () => {
    const outcome = validateChanges({
      changes: [
        CHANGE,
        { ...CHANGE, kind: 'param_added' },
        { ...CHANGE, evidence: '   ' },
        { ...CHANGE, evidence: undefined },
        { ...CHANGE, field: 'x'.repeat(256) },
        { ...CHANGE, field: 42 },
        'param_removed',
        null,
      ],
    });

    assert.deepEqual(outcome, { changes: [CHANGE], dropped: 7 });
  });

  it('reads blanks and missing keys as null, trims, and drops an unusable date but not the change', () => {
    const outcome = validateChanges({
      changes: [
        {
          kind: 'model_retired',
          field: '  claude-3-haiku-20240307 ',
          replacement: '',
          effectiveAt: 'early 2027',
          evidence: `  ${EVIDENCE}  `,
        },
      ],
    });

    assert.deepEqual(outcome.changes, [
      {
        kind: 'model_retired',
        operation: null,
        field: 'claude-3-haiku-20240307',
        replacement: null,
        effectiveAt: null,
        evidence: EVIDENCE,
      },
    ]);
  });

  it('refuses a reply without a changes list', () => {
    assert.throws(() => validateChanges({ items: [] }), /no "changes" list/);
    assert.throws(() => validateChanges(null), /no "changes" list/);
  });
});

describe('parseJsonReply', () => {
  it('reads a bare object, a fenced one, and one with prose around it', () => {
    const json = JSON.stringify({ changes: [CHANGE] });

    for (const reply of [json, `\`\`\`json\n${json}\n\`\`\``, `Here you go:\n${json}\nDone.`]) {
      assert.deepEqual(parseJsonReply(reply), { changes: [CHANGE] });
    }
  });

  it('fails permanently on a reply that is not JSON', () => {
    assert.throws(() => parseJsonReply('No breaking changes.'), /did not contain a JSON object/);
    assert.throws(() => parseJsonReply('{"changes": [}'), /not valid JSON/);
    assert.equal(isRetryableModelError(captured(() => parseJsonReply('{'))), false);
  });
});

function captured(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe('buildUserPrompt', () => {
  it('carries the text, the provider and the source', () => {
    const prompt = buildUserPrompt(INPUT);

    assert.ok(prompt.includes(`<text>\n${INPUT.text}\n</text>`));
    assert.match(prompt, /Provider: anthropic/);
    assert.match(prompt, /SDK changelog at https:\/\/raw\.githubusercontent\.com/);
  });
});

function llm(provider: LlmConfig['provider']): LlmConfig {
  return {
    provider,
    model: 'claude-opus-5-5',
    attempt: 1,
    maxAttempts: 1,
    maxFiles: 20,
    maxFileBytes: 60_000,
  };
}

function stubAnthropic(t: TestContext, reply: string, stopReason = 'end_turn') {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  t.after(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  const requests: Array<Record<string, unknown>> = [];
  const message = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text: reply }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };

  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: { body: string }) => {
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify(message), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  return requests;
}

describe('the Anthropic classify chain', () => {
  it('uses structured output and validates the answer', async (t) => {
    const requests = stubAnthropic(t, JSON.stringify({ changes: [CHANGE] }));

    const outcome = await createClassifyChain(llm('anthropic'))(INPUT);

    assert.deepEqual(outcome, { changes: [CHANGE], dropped: 0 });
    const format = (requests[0].output_config as { format: { type: string; schema: object } }).format;
    assert.equal(format.type, 'json_schema');
    assert.match(JSON.stringify(format.schema), /param_now_required/);
    assert.equal(requests[0].model, 'claude-opus-5-5');
    assert.equal(requests[0].max_tokens, 4_096);
    assert.match(String(requests[0].system), /List only breaking changes/);
    const [user] = requests[0].messages as Array<{ content: string }>;
    assert.ok(user.content.includes(INPUT.text));
  });

  it('fails permanently when the model declines', async (t) => {
    stubAnthropic(t, '', 'refusal');

    const error = await createClassifyChain(llm('anthropic'))(INPUT).then(
      () => assert.fail('expected the refusal to fail the call'),
      (reason: unknown) => reason,
    );

    assert.match(String(error), /declined to classify/);
    assert.equal(isRetryableModelError(error), false);
  });
});
