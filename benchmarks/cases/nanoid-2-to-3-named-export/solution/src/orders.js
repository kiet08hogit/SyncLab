const { nanoid } = require('nanoid');

function createOrder(customerId, items) {
  return {
    id: `ord_${nanoid()}`,
    customerId,
    items,
    total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  };
}

module.exports = { createOrder };
