const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app.js');

const files = {
  'reports/2024/q1.csv': 'region,total\nnorth,12\n',
  'shared/logo.svg': '<svg/>',
};

describe('file server', () => {
  let server;
  let base;

  before(async () => {
    server = createApp(files).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it('serves nested files', async () => {
    const res = await fetch(`${base}/files/reports/2024/q1.csv`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'region,total\nnorth,12\n');
  });

  it('reports a missing nested file with its path', async () => {
    const res = await fetch(`${base}/files/reports/2023/q4.csv`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'no such file: reports/2023/q4.csv' });
  });

  it('permanently redirects legacy download links', async () => {
    const res = await fetch(`${base}/download/logo.svg`, { redirect: 'manual' });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), '/files/shared/logo.svg');
  });

  it('follows a legacy download link to the file', async () => {
    const res = await fetch(`${base}/download/logo.svg`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '<svg/>');
  });

  it('sends anonymous visitors to the login page', async () => {
    const res = await fetch(`${base}/account`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login');
  });

  it('serves the static guide', async () => {
    const res = await fetch(`${base}/guide`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /^Getting started/);
  });
});
