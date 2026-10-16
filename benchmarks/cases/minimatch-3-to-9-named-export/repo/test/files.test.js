const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { selectFiles } = require('../src/select.js');
const { createIgnore } = require('../src/ignore.js');

const files = ['src/index.js', 'src/util/math.js', 'README.md', '.github/ci.yml', 'docs/guide.md'];

describe('file selection', () => {
  it('selects files matching any pattern', () => {
    assert.deepEqual(selectFiles(files, ['src/**/*.js', '**/*.yml']), [
      'src/index.js',
      'src/util/math.js',
      '.github/ci.yml',
    ]);
  });

  it('returns nothing when no pattern matches', () => {
    assert.deepEqual(selectFiles(files, ['*.ts']), []);
  });

  it('ignores files matching the ignore list', () => {
    const ignored = createIgnore(['docs/**', '*.md']);
    assert.deepEqual(files.filter((file) => !ignored(file)), ['src/index.js', 'src/util/math.js', '.github/ci.yml']);
  });
});
