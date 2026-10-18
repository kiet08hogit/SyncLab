import {
  configuration,
  resolveAppRole,
  resolveLlmProvider,
  roleIncludesGateway,
  roleIncludesWorker,
} from './configuration';

describe('resolveAppRole', () => {
  it('defaults to all so a single process still runs gateway and worker', () => {
    expect(resolveAppRole(undefined)).toBe('all');
    expect(resolveAppRole('nope')).toBe('all');
  });

  it('accepts the split roles used to scale workers independently', () => {
    expect(resolveAppRole('gateway')).toBe('gateway');
    expect(resolveAppRole('worker')).toBe('worker');
    expect(roleIncludesGateway('gateway')).toBe(true);
    expect(roleIncludesWorker('gateway')).toBe(false);
    expect(roleIncludesGateway('worker')).toBe(false);
    expect(roleIncludesWorker('worker')).toBe(true);
  });
});

describe('resolveLlmProvider', () => {
  it('defaults to gemini when the provider is not set', () => {
    expect(resolveLlmProvider(undefined)).toBe('gemini');
    expect(resolveLlmProvider('')).toBe('gemini');
  });

  it('accepts each supported provider', () => {
    expect(resolveLlmProvider('gemini')).toBe('gemini');
    expect(resolveLlmProvider('anthropic')).toBe('anthropic');
  });

  it('refuses a provider it does not know rather than falling back to gemini', () => {
    expect(() => resolveLlmProvider('Gemini')).toThrow(
      'LLM_PROVIDER must be one of gemini, anthropic, got "Gemini".',
    );
    expect(() => resolveLlmProvider('gemeni')).toThrow(/must be one of gemini, anthropic/);
  });

  it('refuses ollama, which is no longer supported', () => {
    expect(() => resolveLlmProvider('ollama')).toThrow(
      /must be one of gemini, anthropic, got "ollama"/,
    );
  });
});

describe('configuration llm', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it("reads the key from the selected provider's own variable", () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.GEMINI_API_KEY = 'AIza-test';
    delete process.env.LLM_MODEL;

    expect(configuration().llm).toMatchObject({
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-opus-5-5',
    });
  });

  it('uses gemini with its own key and default model when no provider is set', () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.GEMINI_API_KEY = 'AIza-test';

    expect(configuration().llm).toMatchObject({
      provider: 'gemini',
      apiKey: 'AIza-test',
      model: 'gemini-3.1-pro-preview',
    });
  });
});

describe('configuration monitorAdminLogins', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('reads a comma-separated list, trimmed and lowercased', () => {
    process.env.MONITOR_ADMIN_LOGINS = ' Octo-Admin , ,kun ';

    expect(configuration().monitorAdminLogins).toEqual(['octo-admin', 'kun']);
  });

  it('makes no user an admin when unset', () => {
    delete process.env.MONITOR_ADMIN_LOGINS;

    expect(configuration().monitorAdminLogins).toEqual([]);
  });
});
