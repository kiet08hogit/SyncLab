const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../src/cli.js');

describe('cli', () => {
  it('uses defaults when no options are given', () => {
    assert.deepEqual(parseArgs(['photos']), {
      dest: './backups',
      keep: 7,
      exclude: [],
      compress: true,
      verbose: false,
      sources: ['photos'],
    });
  });

  it('reads every option', () => {
    assert.deepEqual(
      parseArgs(['-d', '/mnt/nas', '--keep', '30', '-x', '*.tmp', '-x', 'cache/**', '--no-compress', '-v', 'docs', 'mail']),
      {
        dest: '/mnt/nas',
        keep: 30,
        exclude: ['*.tmp', 'cache/**'],
        compress: false,
        verbose: true,
        sources: ['docs', 'mail'],
      },
    );
  });
});
