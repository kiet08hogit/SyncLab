const WebSocket = require('ws');

function connect(url, { timeoutMs = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const inbox = [];
    const waiting = [];

    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const text = data.toString();
      const next = waiting.shift();
      if (next) next(text);
      else inbox.push(text);
    });

    socket.once('error', reject);
    socket.once('open', () => {
      resolve({
        send: (text) => socket.send(text),
        sendBytes: (bytes) => socket.send(Buffer.from(bytes)),
        next: () =>
          inbox.length > 0
            ? Promise.resolve(inbox.shift())
            : new Promise((done, fail) => {
                const timer = setTimeout(() => fail(new Error('no message received')), timeoutMs);
                waiting.push((line) => {
                  clearTimeout(timer);
                  done(line);
                });
              }),
        close: () => socket.close(),
      });
    });
  });
}

module.exports = { connect };
