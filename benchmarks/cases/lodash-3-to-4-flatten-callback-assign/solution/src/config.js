const _ = require('lodash');

function withDefaults(userConfig, defaults) {
  return _.assignWith({}, defaults, userConfig, function (current, incoming) {
    return incoming === undefined || incoming === null ? current : incoming;
  });
}

module.exports = { withDefaults };
