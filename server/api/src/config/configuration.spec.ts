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
  it('defaults to ollama when the provider is not set', () => {
    expect(resolveLlmProvider(undefined)).toBe('ollama');
    expect(resolveLlmProvider('')).toBe('ollama');
  });

  it('accepts each supported provider', () => {
    expect(resolveLlmProvider('ollama')).toBe('ollama');
    expect(resolveLlmProvider('gemini')).toBe('gemini');
    expect(resolveLlmProvider('anthropic')).toBe('anthropic');
  });

  it('refuses a provider it does not know rather than falling back to ollama', () => {
    expect(() => resolveLlmProvider('Gemini')).toThrow(
      'LLM_PROVIDER must be one of ollama, gemini, anthropic, got "Gemini".',
    );
    expect(() => resolveLlmProvider('gemeni')).toThrow(/must be one of ollama, gemini, anthropic/);
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

  it('gives a local Ollama no key even when hosted keys are set', () => {
    process.env.LLM_PROVIDER = 'ollama';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

    expect(configuration().llm.apiKey).toBe('');
  });
});
