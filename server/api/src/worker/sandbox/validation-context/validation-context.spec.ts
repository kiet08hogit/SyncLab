import { buildValidationContext } from './index';

describe('buildValidationContext', () => {
  it('is an empty object until a check contributes its own keys', () => {
    expect(
      buildValidationContext({
        kind: 'dependency',
        dependencyName: 'lodash',
        targetVersion: '4.17.21',
      }),
    ).toBe('{}');
  });
});
