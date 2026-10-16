const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { statusLine, summarize } = require('../src/summary.js');

const strip = (text) => text.replace(/\u001b\[[0-9;]*m/g, '');

describe('summary', () => {
  it('colors passing checks green', () => {
    assert.equal(statusLine({ name: 'lint', status: 'pass' }), '\u001b[32mPASS lint\u001b[39m');
  });

  it('colors failures bold red', () => {
    assert.equal(statusLine({ name: 'e2e', status: 'fail' }), '\u001b[1m\u001b[31mFAIL e2e\u001b[39m\u001b[22m');
  });

  it('highlights slow checks', () => {
    const line = statusLine({ name: 'build', status: 'slow', ms: 950 });
    assert.equal(strip(line), 'SLOW build (950ms)');
    assert.notEqual(line, strip(line));
  });

  it('summarizes all checks', () => {
    const output = summarize([
      { name: 'lint', status: 'pass' },
      { name: 'build', status: 'slow', ms: 950 },
      { name: 'e2e', status: 'fail' },
    ]);
    assert.equal(strip(output), 'PASS lint\nSLOW build (950ms)\nFAIL e2e\n3 checks, 1 failed');
    assert.ok(output.endsWith('\u001b[90m3 checks, 1 failed\u001b[39m'));
  });
});
