import {
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
  });

  it('refuses a provider it does not know rather than falling back to ollama', () => {
    expect(() => resolveLlmProvider('Gemini')).toThrow(
      'LLM_PROVIDER must be one of ollama, gemini, got "Gemini".',
    );
    expect(() => resolveLlmProvider('gemeni')).toThrow(/must be one of ollama, gemini/);
  });
});
