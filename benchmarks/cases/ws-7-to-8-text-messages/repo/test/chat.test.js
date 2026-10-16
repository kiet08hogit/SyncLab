const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startChatServer } = require('../src/chat-server.js');
const { connect } = require('../src/chat-client.js');

describe('chat', () => {
  let server;
  let ada;
  let grace;

  before(async () => {
    server = await startChatServer();
    ada = await connect(server.url);
    grace = await connect(server.url);
  });

  after(async () => {
    ada.close();
    grace.close();
    await server.stop();
  });

  it('broadcasts text messages to everyone', async () => {
    ada.send('  hello there ');
    assert.equal(await ada.next(), 'guest: hello there');
    assert.equal(await grace.next(), 'guest: hello there');
  });

  it('renames a user', async () => {
    ada.send('/nick Ada');
    assert.equal(await ada.next(), '* guest is now Ada');
    assert.equal(await grace.next(), '* guest is now Ada');
    grace.send('hi Ada');
    assert.equal(await ada.next(), 'guest: hi Ada');
    assert.equal(await grace.next(), 'guest: hi Ada');
  });

  it('rejects binary frames from the sender only', async () => {
    ada.sendBytes([1, 2, 3]);
    assert.equal(await ada.next(), '* only text messages are supported');
    ada.send('still here');
    assert.equal(await grace.next(), 'Ada: still here');
    assert.equal(await ada.next(), 'Ada: still here');
  });
});
