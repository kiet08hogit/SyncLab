import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findDependency, normalizeVersion } from './upgrade.js';

describe('normalizeVersion', () => {
  it('strips a leading v from a release tag', () => {
    assert.equal(normalizeVersion('v1.2.3'), '1.2.3');
  });

  it('leaves a bare version unchanged', () => {
    assert.equal(normalizeVersion('1.2.3'), '1.2.3');
  });

  it('only strips a single leading v', () => {
    assert.equal(normalizeVersion('v1.0.0-dev'), '1.0.0-dev');
    assert.equal(normalizeVersion('1.0.0-v2'), '1.0.0-v2');
  });
});

describe('findDependency', () => {
  it('finds a dependency in each section', () => {
    assert.deepEqual(findDependency({ dependencies: { lodash: '^3.10.1' } }, 'lodash'), {
      section: 'dependencies',
      exact: false,
    });
    assert.deepEqual(findDependency({ devDependencies: { jest: '~29.0.0' } }, 'jest'), {
      section: 'devDependencies',
      exact: false,
    });
    assert.deepEqual(findDependency({ optionalDependencies: { fsevents: '^2.0.0' } }, 'fsevents'), {
      section: 'optionalDependencies',
      exact: false,
    });
    assert.deepEqual(findDependency({ peerDependencies: { react: '>=18' } }, 'react'), {
      section: 'peerDependencies',
      exact: false,
    });
  });

  it('prefers dependencies, then devDependencies, then optionalDependencies, then peerDependencies', () => {
    const all = {
      peerDependencies: { a: '>=1' },
      optionalDependencies: { a: '^1.0.0' },
      devDependencies: { a: '~1.0.0' },
      dependencies: { a: '1.0.0' },
    };
    assert.equal(findDependency(all, 'a')?.section, 'dependencies');
    assert.equal(findDependency({ ...all, dependencies: {} }, 'a')?.section, 'devDependencies');
    assert.equal(
      findDependency({ peerDependencies: all.peerDependencies, optionalDependencies: all.optionalDependencies }, 'a')
        ?.section,
      'optionalDependencies',
    );
  });

  it('detects an exact pin, including prerelease and build metadata', () => {
    for (const spec of ['3.10.1', '1.0.0-beta.1', '1.0.0+build.5']) {
      assert.equal(findDependency({ dependencies: { a: spec } }, 'a')?.exact, true, spec);
    }
  });

  it('treats ranges, tags and non-registry specs as not exact', () => {
    for (const spec of ['^3.10.1', '~3.10.1', '>=1.0.0', '1.x', '1.0', '*', 'latest', 'v1.0.0', '=1.0.0', '1.0.0 - 2.0.0', 'github:a/b', 'file:../a', 'npm:b@1.0.0', '']) {
      assert.equal(findDependency({ dependencies: { a: spec } }, 'a')?.exact, false, JSON.stringify(spec));
    }
  });

  it('returns undefined for a package that is not a direct dependency', () => {
    assert.equal(findDependency({ dependencies: { express: '^4.0.0' } }, 'lodash'), undefined);
    assert.equal(findDependency({}, 'lodash'), undefined);
  });

  it('does not match inherited object properties', () => {
    assert.equal(findDependency({ dependencies: {} }, 'toString'), undefined);
    assert.equal(findDependency({ dependencies: {} }, 'constructor'), undefined);
  });
});

