const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { signupErrors } = require('../src/signup.js');

describe('signupErrors', () => {
  it('returns no errors for a valid form', () => {
    assert.deepEqual(signupErrors({ name: 'Ada', age: 36 }), {});
  });

  it('keys each error by the field path', () => {
    assert.deepEqual(signupErrors({ name: 1, age: 9 }), { '/name': 'type', '/age': 'minimum' });
  });
});
