const uuid = require('uuid');

function createSession(userId) {
  return { id: uuid(), userId };
}

module.exports = { createSession };
