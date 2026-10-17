import produce from 'immer';

export const emptyCart = Object.freeze({ lines: [], coupon: null });

export function addItem(cart, sku, quantity = 1) {
  return produce(cart, (draft) => {
    const line = draft.lines.find((entry) => entry.sku === sku);
    if (line) line.quantity += quantity;
    else draft.lines.push({ sku, quantity });
  });
}

export function removeItem(cart, sku) {
  return produce(cart, (draft) => {
    draft.lines = draft.lines.filter((entry) => entry.sku !== sku);
  });
}

export function applyCoupon(cart, code) {
  return produce(cart, (draft) => {
    draft.coupon = code.toUpperCase();
  });
}
