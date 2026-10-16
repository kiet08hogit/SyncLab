const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readSession, sessionCookie } = require('../src/session.js');

describe('session cookies', () => {
  it('reads the session id and theme', () => {
    assert.deepEqual(readSession('theme=dark; sid=abc123'), { id: 'abc123', theme: 'dark' });
  });

  it('defaults the theme', () => {
    assert.deepEqual(readSession('sid=xyz'), { id: 'xyz', theme: 'light' });
  });

  it('returns null without a session cookie', () => {
    assert.equal(readSession('theme=dark'), null);
    assert.equal(readSession(undefined), null);
  });

  it('serializes the session cookie', () => {
    assert.equal(sessionCookie('abc123', 3600), 'sid=abc123; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax');
  });
});
