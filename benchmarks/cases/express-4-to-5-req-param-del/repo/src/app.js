const express = require('express');
const { createStore } = require('./store');
const { getUser, deleteUser } = require('./routes/users');
const { searchUsers } = require('./routes/search');

function createApp(seed) {
  const app = express();
  const store = createStore(seed);

  app.get('/users', (req, res) => res.json(store.all()));
  app.get('/search', searchUsers(store));
  app.get('/users/:id', getUser(store));
  app.del('/users/:id', deleteUser(store));

  return app;
}

module.exports = { createApp };
