const express = require('express');

function legacyRouter() {
  const router = express.Router();

  router.get('/download/:name', (req, res) => {
    res.redirect(`/files/shared/${encodeURIComponent(req.params.name)}`, 301);
  });

  router.get('/account', (req, res) => {
    if (!req.headers.authorization) {
      return res.redirect(302, '/login');
    }
    res.json({ ok: true });
  });

  return router;
}

module.exports = { legacyRouter };
