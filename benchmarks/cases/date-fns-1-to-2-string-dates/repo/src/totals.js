function sumAmounts(invoices) {
  return invoices.reduce((total, invoice) => total + invoice.amount, 0);
}

module.exports = { sumAmounts };
