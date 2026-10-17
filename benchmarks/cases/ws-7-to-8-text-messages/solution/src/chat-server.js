const WebSocket = require('ws');

function startChatServer() {
  return new Promise((resolve) => {
    const wss = new WebSocket.Server({ port: 0, host: '127.0.0.1' });
    const names = new Map();

    const broadcast = (line) => {
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(line);
      }
    };

    wss.on('connection', (socket) => {
      names.set(socket, 'guest');

      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          socket.send('* only text messages are supported');
          return;
        }
        const text = data.toString().trim();
        if (text.startsWith('/nick ')) {
          const previous = names.get(socket);
          names.set(socket, text.slice(6).trim());
          broadcast(`* ${previous} is now ${names.get(socket)}`);
          return;
        }
        broadcast(`${names.get(socket)}: ${text}`);
      });

      socket.on('close', () => names.delete(socket));
    });

    wss.on('listening', () => {
      resolve({
        url: `ws://127.0.0.1:${wss.address().port}`,
        stop: () =>
          new Promise((done) => {
            for (const client of wss.clients) client.terminate();
            wss.close(done);
          }),
      });
    });
  });
}

module.exports = { startChatServer };
