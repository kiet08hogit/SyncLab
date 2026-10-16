const express = require('express');

function createApp() {
  const app = express();
  const items = new Map();
  let nextId = 1;

  app.use(express.json());

  app.get('/items', (req, res) => {
    res.json([...items.values()]);
  });

  app.get('/items/:id', (req, res) => {
    const item = items.get(Number(req.params.id));
    if (!item) {
      return res.send(404, 'Item not found');
    }
    res.json(item);
  });

  app.post('/items', (req, res) => {
    const { title } = req.body || {};
    if (typeof title !== 'string' || title.trim() === '') {
      return res.json(400, { error: 'title is required' });
    }
    const item = { id: nextId++, title: title.trim() };
    items.set(item.id, item);
    res.json(201, item);
  });

  return app;
}

module.exports = { createApp };
