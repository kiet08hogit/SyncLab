const uuidv4 = require('uuid/v4');

function newId() {
  return uuidv4();
}

module.exports = { newId };
