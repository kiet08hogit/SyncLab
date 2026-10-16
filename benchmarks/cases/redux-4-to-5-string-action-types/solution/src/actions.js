const ADD_ITEM = 'cart/addItem';
const REMOVE_ITEM = 'cart/removeItem';
const CLEAR = 'cart/clear';

const addItem = (sku, price, quantity = 1) => ({ type: ADD_ITEM, payload: { sku, price, quantity } });
const removeItem = (sku) => ({ type: REMOVE_ITEM, payload: { sku } });
const clear = () => ({ type: CLEAR });

module.exports = { ADD_ITEM, REMOVE_ITEM, CLEAR, addItem, removeItem, clear };
