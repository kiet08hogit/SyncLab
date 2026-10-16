const express = require('express');

function filesRouter(storage) {
  const router = express.Router();

  router.get('/files/*', (req, res) => {
    const key = req.params[0];
    if (!storage.has(key)) {
      return res.status(404).json({ error: `no such file: ${key}` });
    }
    res.type('text/plain').send(storage.get(key));
  });

  return router;
}

module.exports = { filesRouter };
