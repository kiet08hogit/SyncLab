const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app.js');

describe('items api', () => {
  let server;
  let base;

  before(async () => {
    server = createApp().listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  const post = (body) =>
    fetch(`${base}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('creates an item', async () => {
    const res = await post({ title: '  Buy milk ' });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { id: 1, title: 'Buy milk' });
  });

  it('rejects an item without a title', async () => {
    const res = await post({});
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'title is required' });
  });

  it('returns an existing item', async () => {
    const res = await fetch(`${base}/items/1`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: 1, title: 'Buy milk' });
  });

  it('reports a missing item', async () => {
    const res = await fetch(`${base}/items/99`);
    assert.equal(res.status, 404);
    assert.equal(await res.text(), 'Item not found');
  });

  it('lists items', async () => {
    const res = await fetch(`${base}/items`);
    assert.deepEqual(await res.json(), [{ id: 1, title: 'Buy milk' }]);
  });
});
