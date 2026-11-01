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

  it('reads the bracketed release rather than an older version in its compare URL', () => {
    expect(
      requiredSdk({
        provider: 'anthropic',
        sourceKind: 'sdk_changelog',
        section:
          'Changelog / [1.3.0](https://github.com/anthropics/anthropic-sdk-typescript/compare/sdk-v1.2.0...sdk-v1.3.0) (2026-10-23) / Features',
      }),
    ).toEqual({
      name: '@anthropic-ai/sdk',
      version: '1.3.0',
    });
    expect(
      requiredSdk({
        provider: 'openai',
        sourceKind: 'sdk_changelog',
        section:
          'Changelog / [7.47.0](https://github.com/openai/openai-node/compare/v7.46.0...v7.47.0) (2026-10-31) / Features',
      }),
    ).toEqual({
      name: 'openai',
      version: '7.47.0',
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
