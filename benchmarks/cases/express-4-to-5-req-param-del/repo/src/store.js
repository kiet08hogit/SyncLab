function createStore(seed = []) {
  const users = new Map(seed.map((user) => [user.id, { ...user }]));

  return {
    all: () => [...users.values()],
    get: (id) => users.get(id),
    remove: (id) => users.delete(id),
    findByName: (term) =>
      [...users.values()].filter((user) => user.name.toLowerCase().includes(term.toLowerCase())),
  };
}

module.exports = { createStore };
