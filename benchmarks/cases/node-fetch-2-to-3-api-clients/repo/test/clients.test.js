const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { getUser } = require('../src/api.js');
const { fetchWithRetry } = require('../src/retry.js');
const { webhookSender } = require('../src/webhooks.js');
const { isHealthy } = require('../src/status.js');
const { jsonHeaders } = require('../src/headers.js');
const { clientReadme } = require('../src/docs.js');

let server;
let baseUrl;
let flakyCalls = 0;
const received = [];

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (req.url === '/users/1') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 1, name: 'Ada', auth: req.headers.authorization }));
      } else if (req.url === '/flaky') {
        flakyCalls += 1;
        res.writeHead(flakyCalls < 3 ? 503 : 200);
        res.end('done');
      } else if (req.url === '/hooks' && req.method === 'POST') {
        received.push(JSON.parse(body));
        res.writeHead(202);
        res.end();
      } else if (req.url === '/health') {
        res.writeHead(200);
        res.end('ok');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

describe('api clients', () => {
  it('loads a user with auth headers', async () => {
    assert.deepEqual(await getUser(baseUrl, 1, 'abc'), { id: 1, name: 'Ada', auth: 'Bearer abc' });
    assert.equal(await getUser(baseUrl, 2), null);
  });

  it('retries server errors', async () => {
    const response = await fetchWithRetry(`${baseUrl}/flaky`);
    assert.equal(response.status, 200);
    assert.equal(flakyCalls, 3);
  });

  it('posts webhook events', async () => {
    const sender = webhookSender(`${baseUrl}/hooks`);
    assert.equal(await sender.send('order.paid', { id: 9 }), 202);
    assert.deepEqual(received, [{ event: 'order.paid', payload: { id: 9 } }]);
  });

  it('checks health', async () => {
    assert.equal(await isHealthy(baseUrl), true);
  });

  it('builds json headers', () => {
    assert.equal(jsonHeaders('t').get('authorization'), 'Bearer t');
    assert.equal(jsonHeaders().has('authorization'), false);
  });

  it('describes the clients', () => {
    assert.match(clientReadme(), /retry on 5xx/);
  });
});
