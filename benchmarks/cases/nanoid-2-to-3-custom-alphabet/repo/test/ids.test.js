const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { inviteCode, INVITE_ALPHABET } = require('../src/invites.js');
const { traceHeaders } = require('../src/trace.js');

describe('invite codes', () => {
  it('formats codes as two groups of four', () => {
    const code = inviteCode();
    assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    for (const char of code.replace('-', '')) {
      assert.ok(INVITE_ALPHABET.includes(char), `unexpected character ${char}`);
    }
  });

  it('produces distinct codes', () => {
    const codes = new Set(Array.from({ length: 100 }, inviteCode));
    assert.equal(codes.size, 100);
  });
});

describe('trace headers', () => {
  it('adds a trace id', () => {
    const headers = traceHeaders({ accept: 'application/json' });
    assert.equal(headers.accept, 'application/json');
    assert.match(headers['x-trace-id'], /^[A-Za-z0-9_-]{12}$/);
  });

  it('keeps an existing trace id', () => {
    assert.equal(traceHeaders({ 'x-trace-id': 'abc' })['x-trace-id'], 'abc');
  });
});
