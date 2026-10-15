const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { userNames } = require('../src/users.js');

describe('userNames', () => {
  it('returns the name of each user', () => {
    assert.deepEqual(
      userNames([
        { name: 'Ada', id: 1 },
        { name: 'Grace', id: 2 },
      ]),
      ['Ada', 'Grace'],
    );
  });
});
