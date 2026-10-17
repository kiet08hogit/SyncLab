const _ = require('lodash');

function serialize(settings) {
  return _.toPairs(settings)
    .map(function (pair) {
      return pair[0] + '=' + pair[1];
    })
    .join(';');
}

function deserialize(text) {
  const pairs = text.split(';').map(function (chunk) {
    return chunk.split('=');
  });
  return _.fromPairs(pairs);
}

module.exports = { serialize, deserialize };
