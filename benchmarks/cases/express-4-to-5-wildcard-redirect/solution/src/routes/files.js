const express = require('express');

function filesRouter(storage) {
  const router = express.Router();

  router.get('/files/*filepath', (req, res) => {
    const key = req.params.filepath.join('/');
    if (!storage.has(key)) {
      return res.status(404).json({ error: `no such file: ${key}` });
    }
    res.type('text/plain').send(storage.get(key));
  });

  return router;
}

module.exports = { filesRouter };
