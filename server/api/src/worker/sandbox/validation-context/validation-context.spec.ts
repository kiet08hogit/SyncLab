import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { extractSurface } from '../../../monitor/openapi-spec';
import type { SandboxApiChange } from '../sandbox.types';
import { buildValidationContext } from './index';

const RETIRED_SONNET = {
  provider: 'anthropic',
  kind: 'model_retired',
  operation: null,
  field: 'claude-3-sonnet-20240229',
};

/** OpenAI's spec at commit 6ca9cb2b, which removed spend_control from the session bodies. */
const NEW_SPEC = extractSurface(
  JSON.parse(
    gunzipSync(
      readFileSync(join(__dirname, '../../../monitor/fixtures/openai-openapi-6ca9cb2b.json.gz')),
    ).toString('utf8'),
  ),
);

const CHANGE: SandboxApiChange = {
  provider: 'openai',
  kind: 'param_removed',
  operation: 'POST /v1/agents/sessions',
  field: 'spend_control',
  replacement: null,
  effectiveAt: null,
  evidence: 'POST /v1/agents/sessions | param spend_control',
  sourceUrl: 'https://example.com/openapi.json',
};

const SESSION_TARGET = {
  provider: 'openai',
  kind: 'param_removed',
  operation: 'POST /v1/agents/sessions',
  field: 'spend_control',
};

function prismaWith(content: string | null) {
  return {
    apiSourceSnapshot: {
      findFirst: jest.fn().mockResolvedValue(content === null ? null : { content }),
    },
  };
}

describe('buildValidationContext', () => {
  it('is an empty object for a dependency job', async () => {
    const prisma = prismaWith(NEW_SPEC);
    expect(
      await buildValidationContext(
        prisma as never,
        { kind: 'dependency', dependencyName: 'lodash', targetVersion: '4.17.21' },
        { removedChanges: [] },
      ),
    ).toBe('{}');
    expect(prisma.apiSourceSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it('gives no schema for an Anthropic change', async () => {
    const prisma = prismaWith(NEW_SPEC);
    const context = await buildValidationContext(
      prisma as never,
      {
        kind: 'api_change',
        change: { ...CHANGE, provider: 'anthropic' },
        files: ['src/chat.ts'],
      },
      { removedChanges: [] },
    );

    expect(prisma.apiSourceSnapshot.findFirst).not.toHaveBeenCalled();
    expect(JSON.parse(context)).toEqual({
      rescan: {
        target: { ...SESSION_TARGET, provider: 'anthropic' },
        removed: [],
      },
    });
  });

  it('gives the request schemas of the newest OpenAI spec and the migrated files', async () => {
    const prisma = prismaWith(NEW_SPEC);
    const context = await buildValidationContext(
      prisma as never,
      {
        kind: 'api_change',
        change: CHANGE,
        files: ['src/agents.ts'],
      },
      { removedChanges: [] },
    );

    expect(prisma.apiSourceSnapshot.findFirst).toHaveBeenCalledWith({
      where: { source: { kind: 'spec', provider: { slug: 'openai' } } },
      orderBy: { fetchedAt: 'desc' },
      select: { content: true },
    });
    const parsed = JSON.parse(context) as {
      rescan: { target: typeof SESSION_TARGET; removed: unknown[] };
      openaiSchema: {
        files: string[];
        operations: Record<string, { params: string[]; required: string[] }>;
      };
    };
    expect(parsed.rescan).toEqual({ target: SESSION_TARGET, removed: [] });
    expect(parsed.openaiSchema.files).toEqual(['src/agents.ts']);
    const sessions = parsed.openaiSchema.operations['POST /v1/agents/sessions'];
    expect(sessions.required).toContain('environment');
    expect(sessions.params).not.toContain('spend_control');
    expect(parsed.openaiSchema.operations['POST /v1/chat/completions'].required.sort()).toEqual([
      'messages',
      'model',
    ]);
    // A single environment string is capped at 128 KiB by Linux.
    expect(context.length).toBeLessThan(64 * 1024);
  });

  it('has nothing to check before the monitor has read the OpenAI spec', async () => {
    const prisma = prismaWith(null);
    const context = await buildValidationContext(
      prisma as never,
      {
        kind: 'api_change',
        change: CHANGE,
        files: ['src/agents.ts'],
      },
      { removedChanges: [] },
    );

    expect(prisma.apiSourceSnapshot.findFirst).toHaveBeenCalled();
    expect(JSON.parse(context)).toEqual({
      rescan: { target: SESSION_TARGET, removed: [] },
    });
  });

  it('asks the re-scan to see the migrated change gone and nothing removed newly used', async () => {
    const prisma = prismaWith(NEW_SPEC);
    const context = await buildValidationContext(
      prisma as never,
      {
        kind: 'api_change',
        change: {
          provider: 'anthropic',
          kind: 'model_retired',
          operation: 'POST /v1/messages',
          field: 'claude-3-opus-20240229',
          replacement: 'claude-opus-4-1',
          effectiveAt: '2026-01-05',
          evidence: 'Claude 3 Opus is retired on January 5, 2026.',
          sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/model-deprecations',
        },
        files: ['src/chat.ts'],
      },
      { removedChanges: [RETIRED_SONNET] },
    );

    expect(prisma.apiSourceSnapshot.findFirst).not.toHaveBeenCalled();
    expect(JSON.parse(context)).toEqual({
      rescan: {
        target: {
          provider: 'anthropic',
          kind: 'model_retired',
          operation: 'POST /v1/messages',
          field: 'claude-3-opus-20240229',
        },
        removed: [RETIRED_SONNET],
      },
    });
  });

  it('still keeps a dependency migration from newly using anything removed', async () => {
    const prisma = prismaWith(NEW_SPEC);
    const context = await buildValidationContext(
      prisma as never,
      { kind: 'dependency', dependencyName: 'lodash', targetVersion: '4.17.21' },
      { removedChanges: [RETIRED_SONNET] },
    );

    expect(prisma.apiSourceSnapshot.findFirst).not.toHaveBeenCalled();
    expect(JSON.parse(context)).toEqual({ rescan: { target: null, removed: [RETIRED_SONNET] } });
  });
});
