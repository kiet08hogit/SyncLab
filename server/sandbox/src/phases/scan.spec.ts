import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { scan } from './scan.js';
import type { ApiUsage } from '../analysis/api-usage.js';

describe('scan', () => {
  let workspace: string;
  let previousWorkspace: string | undefined;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-scan-'));
    previousWorkspace = process.env.SANDBOX_WORKSPACE;
    process.env.SANDBOX_WORKSPACE = workspace;
  });

  afterEach(async () => {
    if (previousWorkspace === undefined) {
      delete process.env.SANDBOX_WORKSPACE;
    } else {
      process.env.SANDBOX_WORKSPACE = previousWorkspace;
    }
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function write(relativePath: string, contents: string): Promise<void> {
    const target = path.join(workspace, 'repo', relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }

  it('reports the API calls in the clone and leaves dependencies and bundles out', async () => {
    const client = [
      "import OpenAI from 'openai';",
      'const client = new OpenAI();',
      "export const ask = () => client.responses.create({ model: 'gpt-5', input: 'hi' });",
    ].join('\n');
    await write('src/ask.ts', client);
    await write('node_modules/openai/index.js', client);
    await write('public/bundle.js', `${client}\n${'// padding\n'.repeat(100_000)}`);

    const result = await scan();
    const usages = result.data?.usages as ApiUsage[];

    assert.equal(result.ok, true);
    assert.deepEqual(
      usages.map(({ file, line, operation, modelIds }) => ({ file, line, operation, modelIds })),
      [{ file: 'src/ask.ts', line: 3, operation: 'POST /v1/responses', modelIds: ['gpt-5'] }],
    );
    assert.deepEqual(result.data?.skipped, ['public/bundle.js']);
    assert.match(result.steps[0].output, /src\/ask\.ts:3 openai responses\.create -> POST \/v1\/responses/);
  });
});
