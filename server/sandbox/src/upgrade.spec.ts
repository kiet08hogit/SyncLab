import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeVersion, upgradeArgs } from './upgrade.js';

describe('normalizeVersion', () => {
  it('strips a leading v from a release tag', () => {
    assert.equal(normalizeVersion('v1.2.3'), '1.2.3');
  });

  it('leaves a bare version unchanged', () => {
    assert.equal(normalizeVersion('1.2.3'), '1.2.3');
  });
});

describe('upgradeArgs', () => {
  it('keeps a ranged runtime dependency in dependencies', () => {
    const args = upgradeArgs({ dependencies: { lodash: '^3.10.1' } }, 'lodash', 'v4.17.21');

    assert.deepEqual(args, [
      'install',
      'lodash@4.17.21',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ]);
  });

  it('keeps a devDependency in devDependencies', () => {
    const args = upgradeArgs({ devDependencies: { jest: '~29.0.0' } }, 'jest', '30.0.0');

    assert.ok(args?.includes('--save-dev'));
  });

  it('keeps optional and peer dependencies in their sections', () => {
    assert.ok(
      upgradeArgs({ optionalDependencies: { fsevents: '^2.0.0' } }, 'fsevents', '2.3.3')?.includes(
        '--save-optional',
      ),
    );
    assert.ok(
      upgradeArgs({ peerDependencies: { react: '>=18' } }, 'react', '19.0.0')?.includes(
        '--save-peer',
      ),
    );
  });

  it('keeps an exact pin exact', () => {
    const args = upgradeArgs({ dependencies: { lodash: '3.10.1' } }, 'lodash', '4.17.21');

    assert.ok(args?.includes('--save-exact'));
  });

  it('does not pin a ranged dependency', () => {
    const args = upgradeArgs({ dependencies: { lodash: '^3.10.1' } }, 'lodash', '4.17.21');

    assert.ok(!args?.includes('--save-exact'));
  });

  it('refuses a package that is not a direct dependency', () => {
    assert.equal(upgradeArgs({ dependencies: { express: '^4.0.0' } }, 'lodash', '4.17.21'), undefined);
    assert.equal(upgradeArgs({}, 'lodash', '4.17.21'), undefined);
  });

  it('never runs install scripts', () => {
    for (const packageJson of [
      { dependencies: { a: '1.0.0' } },
      { devDependencies: { a: '^1.0.0' } },
    ]) {
      assert.ok(upgradeArgs(packageJson, 'a', '2.0.0')?.includes('--ignore-scripts'));
    }
  });
});
