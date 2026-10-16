const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { userNames, activeUserNames } = require('../src/users.js');

const users = [
  { id: 1, name: 'Ada', active: true },
  { id: 2, name: 'Grace', active: false },
  { id: 3, name: 'Linus', active: true },
];

describe('users', () => {
  it('returns the name of each user', () => {
    assert.deepEqual(userNames(users), ['Ada', 'Grace', 'Linus']);
  });

  it('returns only active user names', () => {
    assert.deepEqual(activeUserNames(users), ['Ada', 'Linus']);
  });
});
