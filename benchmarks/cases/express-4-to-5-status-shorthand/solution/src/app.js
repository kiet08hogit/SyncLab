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
      return res.status(404).send('Item not found');
    }
    res.json(item);
  });

  app.post('/items', (req, res) => {
    const { title } = req.body || {};
    if (typeof title !== 'string' || title.trim() === '') {
      return res.status(400).json({ error: 'title is required' });
    }
    const item = { id: nextId++, title: title.trim() };
    items.set(item.id, item);
    res.status(201).json(item);
  });

  return app;
}

module.exports = { createApp };
