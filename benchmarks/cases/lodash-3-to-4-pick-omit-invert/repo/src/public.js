const _ = require('lodash');

function publicCard(profile) {
  return _.pick(profile, ['name', 'title']);
}

function withoutSecrets(profile) {
  return _.omit(profile, ['password', 'token']);
}

module.exports = { publicCard, withoutSecrets };
