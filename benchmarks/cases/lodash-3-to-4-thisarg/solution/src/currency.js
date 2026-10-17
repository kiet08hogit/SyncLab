const _ = require('lodash');

function Converter(rates) {
  this.rates = rates;
}

Converter.prototype.toUsd = function (amounts) {
  return _.map(amounts, (entry) => {
    return Math.round(entry.value * this.rates[entry.currency] * 100) / 100;
  });
};

Converter.prototype.totalUsd = function (amounts) {
  return _.reduce(amounts, (sum, entry) => {
    return sum + entry.value * this.rates[entry.currency];
  }, 0);
};

module.exports = { Converter };
