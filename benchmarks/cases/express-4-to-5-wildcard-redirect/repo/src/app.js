const express = require('express');
const { filesRouter } = require('./routes/files');
const { legacyRouter } = require('./routes/legacy');
const { guide } = require('./routes/docs');

function createApp(files = {}) {
  const app = express();
  const storage = new Map(Object.entries(files));

  app.use(filesRouter(storage));
  app.use(legacyRouter());
  app.get('/guide', guide);

  return app;
}

module.exports = { createApp };
