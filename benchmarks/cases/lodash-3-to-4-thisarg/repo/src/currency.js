const _ = require('lodash');

function Converter(rates) {
  this.rates = rates;
}

Converter.prototype.toUsd = function (amounts) {
  return _.map(amounts, function (entry) {
    return Math.round(entry.value * this.rates[entry.currency] * 100) / 100;
  }, this);
};

Converter.prototype.totalUsd = function (amounts) {
  return _.reduce(amounts, function (sum, entry) {
    return sum + entry.value * this.rates[entry.currency];
  }, 0, this);
};

module.exports = { Converter };
