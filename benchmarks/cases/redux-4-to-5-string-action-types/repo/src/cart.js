const { createStore } = require('redux');
const { ADD_ITEM, REMOVE_ITEM, CLEAR } = require('./actions.js');

const initialState = { items: {} };

function cartReducer(state = initialState, action) {
  switch (action.type) {
    case ADD_ITEM: {
      const { sku, price, quantity } = action.payload;
      const existing = state.items[sku];
      return {
        items: {
          ...state.items,
          [sku]: { price, quantity: (existing ? existing.quantity : 0) + quantity },
        },
      };
    }
    case REMOVE_ITEM: {
      const items = { ...state.items };
      delete items[action.payload.sku];
      return { items };
    }
    case CLEAR:
      return initialState;
    default:
      return state;
  }
}

function createCart() {
  return createStore(cartReducer);
}

function cartTotal(state) {
  return Object.values(state.items).reduce((sum, item) => sum + item.price * item.quantity, 0);
}

module.exports = { createCart, cartTotal };
