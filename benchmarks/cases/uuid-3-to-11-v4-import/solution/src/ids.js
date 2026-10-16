const { v4: uuidv4 } = require('uuid');

function newOrderId() {
  return `ord_${uuidv4()}`;
}

module.exports = { newOrderId };
