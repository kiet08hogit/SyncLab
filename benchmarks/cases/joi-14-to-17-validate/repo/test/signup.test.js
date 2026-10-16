const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseSignup } = require('../src/signup.js');

describe('parseSignup', () => {
  it('accepts a valid signup and applies defaults', () => {
    assert.deepEqual(parseSignup({ email: 'ada@example.com', password: 'correct-horse', referrer: 'ad' }), {
      ok: true,
      value: { email: 'ada@example.com', password: 'correct-horse', newsletter: false },
    });
  });

  it('reports the invalid field', () => {
    assert.deepEqual(parseSignup({ email: 'not-an-email', password: 'correct-horse' }), {
      ok: false,
      field: 'email',
    });
  });

  it('reports a short password', () => {
    assert.deepEqual(parseSignup({ email: 'ada@example.com', password: 'short' }), {
      ok: false,
      field: 'password',
    });
  });
});
