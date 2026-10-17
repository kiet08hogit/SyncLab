const uuidv4 = require('uuid/v4');

function newOrderId() {
  return `ord_${uuidv4()}`;
}

module.exports = { newOrderId };
