import { collectImpacts, matchUsage, type MatchChange, type MatchUsage } from './match';

const usage = (overrides: Partial<MatchUsage> = {}): MatchUsage => ({
  file: 'src/chat.ts',
  operation: 'POST /v1/chat/completions',
  params: ['model', 'messages'],
  modelIds: ['gpt-4o'],
  dynamic: false,
  ...overrides,
});

const change = (overrides: Partial<MatchChange> = {}): MatchChange => ({
  kind: 'model_retired',
  operation: null,
  field: 'gpt-4o',
  ...overrides,
});

describe('matchUsage', () => {
  it('confirms a literal model and treats a dynamic model as possible', () => {
    expect(matchUsage(change(), usage())).toBe('confirmed');
    expect(matchUsage(change(), usage({ modelIds: [], dynamic: true }))).toBe('possible');
    expect(matchUsage(change(), usage({ modelIds: ['gpt-4.1'] }))).toBeNull();
  });

  it('does not confirm a model when the usage is a different operation', () => {
    expect(
      matchUsage(
        change({ operation: 'POST /v1/responses' }),
        usage({ operation: 'POST /v1/chat/completions' }),
      ),
    ).toBeNull();
  });

  it('confirms an endpoint removal, including a bare path and a different path parameter name', () => {
    expect(
      matchUsage(
        change({ kind: 'endpoint_removed', operation: 'POST /v1/edits', field: null }),
        usage({ operation: 'POST /v1/edits' }),
      ),
    ).toBe('confirmed');
    expect(
      matchUsage(
        change({ kind: 'endpoint_removed', operation: '/v1/edits', field: null }),
        usage({ operation: 'DELETE /v1/edits' }),
      ),
    ).toBe('confirmed');
    expect(
      matchUsage(
        change({ kind: 'endpoint_removed', operation: 'GET /v1/files/{file_id}', field: null }),
        usage({ operation: 'GET /v1/files/{param}' }),
      ),
    ).toBe('confirmed');
    expect(
      matchUsage(
        change({ kind: 'endpoint_removed', operation: 'POST /v1/edits', field: null }),
        usage({ operation: null, dynamic: true }),
      ),
    ).toBe('possible');
  });

  it('confirms a removed parameter only on the same operation, and a parameter with no operation stays possible', () => {
    const removed = change({
      kind: 'param_removed',
      operation: 'POST /v1/chat/completions',
      field: 'functions',
    });
    expect(matchUsage(removed, usage({ params: ['functions', 'model'] }))).toBe('confirmed');
    expect(matchUsage(removed, usage())).toBeNull();
    expect(matchUsage(removed, usage({ dynamic: true }))).toBe('possible');
    expect(matchUsage({ ...removed, operation: null }, usage({ params: ['functions'] }))).toBe(
      'possible',
    );
  });

  it('confirms a newly required parameter when the call does not send it', () => {
    const required = change({
      kind: 'param_now_required',
      operation: 'POST /v1/chat/completions',
      field: 'max_tokens',
    });
    expect(matchUsage(required, usage())).toBe('confirmed');
    expect(matchUsage(required, usage({ params: ['model', 'messages', 'max_tokens'] }))).toBeNull();
    expect(matchUsage(required, usage({ dynamic: true }))).toBe('possible');
    expect(matchUsage({ ...required, operation: null }, usage())).toBeNull();
    expect(matchUsage(required, usage({ operation: 'POST /v1/responses' }))).toBeNull();
  });

  it('matches a parameter name without regard to case', () => {
    const operation = 'POST /v1/chat/completions';
    const sent = usage({ operation, params: ['OpenAI-Beta', 'Max_Tokens'] });
    expect(
      matchUsage(change({ kind: 'param_now_required', operation, field: 'openai-beta' }), sent),
    ).toBeNull();
    expect(
      matchUsage(change({ kind: 'param_now_required', operation, field: 'max_tokens' }), sent),
    ).toBeNull();
    expect(
      matchUsage(
        change({ kind: 'param_now_required', operation, field: 'Idempotency-Key' }),
        usage({ operation, params: ['model'] }),
      ),
    ).toBe('confirmed');
    expect(
      matchUsage(
        change({ kind: 'param_removed', operation, field: 'Idempotency-Key' }),
        usage({ operation, params: ['idempotency-key'] }),
      ),
    ).toBe('confirmed');
    expect(
      matchUsage(
        change({ kind: 'param_renamed', operation, field: 'openai-beta' }),
        usage({ operation, params: ['model'] }),
      ),
    ).toBeNull();
    expect(
      matchUsage(
        change({ kind: 'enum_value_removed', operation, field: 'openai-beta=assistants=v2' }),
        sent,
      ),
    ).toBe('possible');
  });

  it('records a removed enum value as possible, because the usage stores the parameter and not the value', () => {
    const removed = change({
      kind: 'enum_value_removed',
      operation: 'GET /v1/a',
      field: 'order=asc',
    });
    expect(matchUsage(removed, usage({ operation: 'GET /v1/a', params: ['order'] }))).toBe(
      'possible',
    );
    expect(matchUsage(removed, usage({ operation: 'GET /v1/a', params: ['limit'] }))).toBeNull();
  });

  it('confirms a behavior change for every call of that operation', () => {
    const behavior = change({
      kind: 'behavior_changed',
      operation: 'POST /v1/chat/completions',
      field: null,
    });
    expect(matchUsage(behavior, usage({ modelIds: [], params: [] }))).toBe('confirmed');
    expect(matchUsage(behavior, usage({ operation: 'POST /v1/responses' }))).toBeNull();
    expect(matchUsage(behavior, usage({ operation: null, dynamic: true }))).toBe('possible');
    expect(matchUsage(behavior, usage({ operation: null }))).toBeNull();
  });

  it('matches a behavior change with no operation to nothing', () => {
    const behavior = change({ kind: 'behavior_changed', operation: null, field: 'model' });
    expect(matchUsage(behavior, usage())).toBeNull();
    expect(matchUsage(behavior, usage({ modelIds: ['model'], params: ['model'] }))).toBeNull();
    expect(
      matchUsage(change({ kind: 'behavior_changed', operation: null, field: 'gpt-4o' }), usage()),
    ).toBeNull();
    expect(matchUsage(behavior, usage({ dynamic: true, modelIds: [], params: [] }))).toBeNull();
    expect(
      matchUsage(behavior, usage({ operation: null, dynamic: true, modelIds: ['model'] })),
    ).toBeNull();
  });

  it('ignores a kind it does not know', () => {
    expect(matchUsage(change({ kind: 'param_added' }), usage())).toBeNull();
  });
});

describe('collectImpacts', () => {
  const retired = {
    id: 'change-1',
    providerId: 'openai',
    kind: 'model_retired',
    operation: null,
    field: 'gpt-4o',
  };

  it('keeps the literal file, drops a mention that is not a matching usage, and lets one literal hit confirm the repository', () => {
    const impacts = collectImpacts(
      [retired],
      [
        {
          repositoryId: 'repo-1',
          usages: [
            { ...usage(), providerId: 'openai', file: 'src/real.ts' },
            {
              ...usage(),
              providerId: 'openai',
              file: 'src/config.ts',
              modelIds: [],
              dynamic: true,
            },
            { ...usage(), providerId: 'anthropic', file: 'src/other.ts' },
            { ...usage(), providerId: 'openai', file: 'README.md', modelIds: ['gpt-4.1'] },
          ],
        },
      ],
    );

    expect(impacts).toEqual([
      {
        breakingChangeId: 'change-1',
        repositoryId: 'repo-1',
        confidence: 'confirmed',
        files: ['src/config.ts', 'src/real.ts'],
      },
    ]);
  });

  it('records a repository as possible when every hit is dynamic', () => {
    const impacts = collectImpacts(
      [retired],
      [
        {
          repositoryId: 'repo-2',
          usages: [{ ...usage(), providerId: 'openai', modelIds: [], dynamic: true }],
        },
      ],
    );

    expect(impacts).toEqual([
      {
        breakingChangeId: 'change-1',
        repositoryId: 'repo-2',
        confidence: 'possible',
        files: ['src/chat.ts'],
      },
    ]);
  });
});
