import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, type TestContext } from 'node:test';
import { refactor } from './refactor.js';

const CHANGE = {
  provider: 'anthropic',
  kind: 'model_retired',
  operation: 'POST /v1/messages',
  field: 'claude-3-opus-20240229',
  replacement: 'claude-opus-4-1',
  effectiveAt: '2026-01-05',
  evidence: 'Claude 3 Opus is retired on January 5, 2026.',
  sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/model-deprecations',
};

const CHAT = "import Anthropic from '@anthropic-ai/sdk';\nexport const model = 'claude-3-opus-20240229';\n";
const MIGRATED = "import Anthropic from '@anthropic-ai/sdk';\nexport const model = 'claude-opus-4-1';\n";

function restoreEnv(saved: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(process.env)) {
    if (!(name in saved)) {
      delete process.env[name];
    }
  }
  Object.assign(process.env, saved);
}

/** Answers every Messages API call with `reply` and records the user prompts. */
function stubAnthropic(t: TestContext, reply: (prompt: string) => string): string[] {
  const prompts: string[] = [];

  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: { body: string }) => {
    const prompt = (JSON.parse(init.body) as { messages: Array<{ content: string }> }).messages[0].content;
    prompts.push(prompt);
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
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply(prompt) } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null, stop_details: null },
        usage: { output_tokens: 1 },
      },
      { type: 'message_stop' },
    ];
    const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });

  return prompts;
}

function promptedFiles(prompts: string[]): string[] {
  return prompts.map((prompt) => /^File: (.+)$/m.exec(prompt)?.[1] ?? '?');
}

describe('refactor phase for an API change', () => {
  let savedEnv: NodeJS.ProcessEnv;
  let workspace: string;
  let repoDir: string;

  beforeEach(async () => {
    savedEnv = { ...process.env };
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-refactor-'));
    repoDir = path.join(workspace, 'repo');
    await fs.mkdir(path.join(repoDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(repoDir, 'src', 'chat.ts'), CHAT);
    // Imports the SDK too, but the impact did not record it.
    await fs.writeFile(path.join(repoDir, 'src', 'other.ts'), "import Anthropic from '@anthropic-ai/sdk';\n");

    Object.assign(process.env, {
      SANDBOX_WORKSPACE: workspace,
      REPO_URL: 'https://github.com/acme/app.git',
      REPO_FULL_NAME: 'acme/app',
      BRANCH_NAME: 'synclab/api-anthropic-1b2c',
      MIGRATION_KIND: 'api_change',
      API_CHANGE: JSON.stringify(CHANGE),
      TARGET_FILES: JSON.stringify(['src/chat.ts']),
      LLM_PROVIDER: 'anthropic',
      LLM_MODEL: 'claude-opus-5-5',
      ANTHROPIC_API_KEY: 'test-key',
    });
    delete process.env.DEPENDENCY_NAME;
    delete process.env.TARGET_VERSION;
  });

  afterEach(async () => {
    restoreEnv(savedEnv);
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('sends only the impacted files, with the brief in place of release notes', async (t) => {
    const prompts = stubAnthropic(t, () => 'Nothing to change.');

    const result = await refactor();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.deepEqual(promptedFiles(prompts), ['src/chat.ts']);
    assert.match(prompts[0], /^Breaking change in the anthropic API: model_retired$/m);
    assert.match(prompts[0], /^Affected parameter or model: claude-3-opus-20240229$/m);
    assert.match(prompts[0], /^Replacement: claude-opus-4-1$/m);
    assert.match(prompts[0], /^Effective: 2026-01-05$/m);
    assert.match(prompts[0], /Quoted from https:\/\/docs\.anthropic\.com\/\S+:\nClaude 3 Opus is retired/);
    assert.doesNotMatch(prompts[0], /Dependency:|Target version:|Release notes/);
  });

  it('writes the rewritten file and reports it as changed', async (t) => {
    stubAnthropic(t, () => `Switched to the replacement model.\n\`\`\`ts\n${MIGRATED}\`\`\``);

    const result = await refactor();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.deepEqual(result.data, { changedFiles: ['src/chat.ts'] });
    assert.equal(await fs.readFile(path.join(repoDir, 'src', 'chat.ts'), 'utf8'), MIGRATED);
  });

  it('keeps the release notes after the brief and leaves the dependency lines out', async (t) => {
    process.env.DEPENDENCY_NAME = '@anthropic-ai/sdk';
    process.env.TARGET_VERSION = '0.60.0';
    const stateDir = path.join(workspace, 'state');
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      path.join(stateDir, 'breaking-changes.md'),
      'Dropped claude-3-opus-20240229 from the messages API.\n',
    );
    const prompts = stubAnthropic(t, () => 'Nothing to change.');

    const result = await refactor();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.match(
      prompts[0],
      /Quoted from https:\/\/docs\.anthropic\.com\/en\/docs\/about-claude\/model-deprecations:\nClaude 3 Opus is retired on January 5, 2026\.\n\nRelease notes for the target version:\nDropped claude-3-opus-20240229 from the messages API\./,
    );
    assert.doesNotMatch(prompts[0], /Dependency:|Target version:/);
  });

  it('never follows a link or leaves the checkout, and sends nothing when no file is left', async (t) => {
    const outside = path.join(workspace, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'secret.ts'), 'export const key = "secret";\n');
    await fs.symlink(path.join(outside, 'secret.ts'), path.join(repoDir, 'src', 'linked.ts'));
    await fs.symlink(outside, path.join(repoDir, 'lib'));
    await fs.mkdir(path.join(repoDir, 'src', 'dir.ts'));
    process.env.TARGET_FILES = JSON.stringify(['src/linked.ts', 'lib/secret.ts', 'src/missing.ts', 'src/dir.ts']);
    const prompts = stubAnthropic(t, () => 'Nothing to change.');

    const result = await refactor();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.equal(prompts.length, 0);
    assert.deepEqual(result.data, { changedFiles: [] });
    assert.equal(
      result.steps[0].output,
      [
        'None of the impacted files could be sent, so nothing was sent to the model.',
        'Skipped src/linked.ts (not a regular file inside the repository)',
        'Skipped lib/secret.ts (not a regular file inside the repository)',
        'Skipped src/missing.ts (not a regular file inside the repository)',
        'Skipped src/dir.ts (not a regular file inside the repository)',
      ].join('\n'),
    );
    assert.equal(await fs.readFile(path.join(outside, 'secret.ts'), 'utf8'), 'export const key = "secret";\n');
  });

  it('applies the file size and count limits to impacted files', async (t) => {
    await fs.writeFile(path.join(repoDir, 'src', 'big.ts'), `// ${'x'.repeat(200)}\n`);
    await fs.writeFile(path.join(repoDir, 'src', 'b.ts'), CHAT);
    await fs.writeFile(path.join(repoDir, 'src', 'c.ts'), CHAT);
    process.env.TARGET_FILES = JSON.stringify(['src/big.ts', 'src/chat.ts', 'src/b.ts', 'src/c.ts']);
    process.env.LLM_MAX_FILE_BYTES = '150';
    process.env.LLM_MAX_FILES = '2';
    const prompts = stubAnthropic(t, () => 'Nothing to change.');

    const result = await refactor();

    assert.deepEqual(promptedFiles(prompts), ['src/chat.ts', 'src/b.ts']);
    assert.match(result.steps[0].output, /Skipped src\/big\.ts \(over the 150 byte limit\)/);
    assert.match(result.steps[0].output, /Skipped src\/c\.ts \(over the 2 file limit\)/);
  });
});
