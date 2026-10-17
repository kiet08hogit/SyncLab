function searchUsers(store) {
  return (req, res) => {
    const term = req.query.q || '';
    const limit = Number(req.query.limit) || 10;
    res.json(store.findByName(term).slice(0, limit));
  };
}

module.exports = { searchUsers };
