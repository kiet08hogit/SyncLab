function getUser(store) {
  return (req, res) => {
    const user = store.get(req.param('id'));
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json(user);
  };
}

function deleteUser(store) {
  return (req, res) => {
    const removed = store.remove(req.param('id'));
    res.status(removed ? 204 : 404).end();
  };
}

module.exports = { getUser, deleteUser };
