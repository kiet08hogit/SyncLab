import { requiredSdk } from './required-sdk';

describe('requiredSdk', () => {
  it('reads an Anthropic SDK release heading', () => {
    expect(
      requiredSdk({
        provider: 'anthropic',
        sourceKind: 'sdk_changelog',
        section: 'Changelog / 0.123.0 (2026-09-01) / Features',
      }),
    ).toEqual({
      name: '@anthropic-ai/sdk',
      version: '0.123.0',
    });
  });

  it('reads a prefixed OpenAI prerelease heading', () => {
    expect(
      requiredSdk({
        provider: 'openai',
        sourceKind: 'sdk_changelog',
        section: 'v6.4.0-beta.2 / Breaking changes',
      }),
    ).toEqual({
      name: 'openai',
      version: '6.4.0-beta.2',
    });
  });

  it('does not guess a version from a provider API release note or an unversioned section', () => {
    expect(
      requiredSdk({
        provider: 'anthropic',
        sourceKind: 'release_notes',
        section: '2026-09-01 / 0.123.0',
      }),
    ).toBeUndefined();
    expect(
      requiredSdk({
        provider: 'openai',
        sourceKind: 'sdk_changelog',
        section: 'Changelog / Features',
      }),
    ).toBeUndefined();
  });
});
