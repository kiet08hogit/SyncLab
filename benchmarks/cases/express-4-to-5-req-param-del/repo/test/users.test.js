const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app.js');

const seed = [
  { id: 'u1', name: 'Ada Lovelace' },
  { id: 'u2', name: 'Grace Hopper' },
  { id: 'u3', name: 'Alan Turing' },
  { id: 'u4', name: 'Adele Goldberg' },
];

describe('users api', () => {
  let server;
  let base;

  before(async () => {
    server = createApp(seed).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it('fetches a user by id', async () => {
    const res = await fetch(`${base}/users/u2`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: 'u2', name: 'Grace Hopper' });
  });

  it('returns 404 for an unknown user', async () => {
    const res = await fetch(`${base}/users/nope`);
    assert.equal(res.status, 404);
  });

  it('searches users by name with a limit', async () => {
    const res = await fetch(`${base}/search?q=ad&limit=1`);
    assert.deepEqual(await res.json(), [{ id: 'u1', name: 'Ada Lovelace' }]);
    const all = await fetch(`${base}/search?q=ad`);
    assert.deepEqual((await all.json()).map((user) => user.id), ['u1', 'u4']);
  });

  it('deletes a user', async () => {
    const res = await fetch(`${base}/users/u3`, { method: 'DELETE' });
    assert.equal(res.status, 204);
    const again = await fetch(`${base}/users/u3`, { method: 'DELETE' });
    assert.equal(again.status, 404);
    const list = await fetch(`${base}/users`);
    assert.deepEqual((await list.json()).map((user) => user.id), ['u1', 'u2', 'u4']);
  });
});
