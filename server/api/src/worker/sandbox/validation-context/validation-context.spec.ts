import { buildValidationContext } from './index';

const RETIRED_SONNET = {
  provider: 'anthropic',
  kind: 'model_retired',
  operation: null,
  field: 'claude-3-sonnet-20240229',
};

describe('buildValidationContext', () => {
  it('is an empty object when no check has anything to compare', () => {
    expect(
      buildValidationContext(
        { kind: 'dependency', dependencyName: 'lodash', targetVersion: '4.17.21' },
        { removedChanges: [] },
      ),
    ).toBe('{}');
  });

  it('asks the re-scan to see the migrated change gone and nothing removed newly used', () => {
    const context = buildValidationContext(
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

  it('still keeps a dependency migration from newly using anything removed', () => {
    const context = buildValidationContext(
      { kind: 'dependency', dependencyName: 'lodash', targetVersion: '4.17.21' },
      { removedChanges: [RETIRED_SONNET] },
    );

    expect(JSON.parse(context)).toEqual({ rescan: { target: null, removed: [RETIRED_SONNET] } });
  });
});
