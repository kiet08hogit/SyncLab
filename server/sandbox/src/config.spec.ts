import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveLlmProvider } from './config.js';

describe('resolveLlmProvider', () => {
  it('defaults to ollama when the provider is not set', () => {
    assert.equal(resolveLlmProvider(undefined), 'ollama');
    assert.equal(resolveLlmProvider(''), 'ollama');
  });

  it('accepts each supported provider', () => {
    assert.equal(resolveLlmProvider('ollama'), 'ollama');
    assert.equal(resolveLlmProvider('gemini'), 'gemini');
  });

  it('refuses a provider it does not know rather than falling back to ollama', () => {
    assert.throws(() => resolveLlmProvider('Gemini'), {
      message: 'LLM_PROVIDER must be one of ollama, gemini, got "Gemini".',
    });
    assert.throws(() => resolveLlmProvider('gemeni'), /must be one of ollama, gemini/);
  });
});
