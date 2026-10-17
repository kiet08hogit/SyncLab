const { v4: uuidv4 } = require('uuid');

function createSession(userId) {
  return { id: uuidv4(), userId };
}

module.exports = { createSession };
