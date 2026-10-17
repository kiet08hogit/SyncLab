const _ = require('lodash');

function serialize(settings) {
  return _.pairs(settings)
    .map(function (pair) {
      return pair[0] + '=' + pair[1];
    })
    .join(';');
}

function deserialize(text) {
  const pairs = text.split(';').map(function (chunk) {
    return chunk.split('=');
  });
  return _.zipObject(pairs);
}

module.exports = { serialize, deserialize };
