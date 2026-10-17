function searchUsers(store) {
  return (req, res) => {
    const term = req.param('q') || '';
    const limit = Number(req.param('limit')) || 10;
    res.json(store.findByName(term).slice(0, limit));
  };
}

module.exports = { searchUsers };
