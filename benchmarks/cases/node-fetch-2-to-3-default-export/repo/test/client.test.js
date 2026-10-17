const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { getJson } = require('../src/client.js');

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, accept: req.headers.accept }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

describe('getJson', () => {
  it('returns the parsed body', async () => {
    assert.deepEqual(await getJson(`${baseUrl}/status`), { ok: true, accept: 'application/json' });
  });

  it('rejects on an error status', async () => {
    await assert.rejects(getJson(`${baseUrl}/missing`), /status 404/);
  });
});
