const _ = require('lodash');

function menuLabels(sections) {
  return _.flattenDeep(sections.map(function (section) {
    return [section.title, section.items];
  }));
}

function menuOptions(options) {
  return _.assign({ collapsed: false, theme: 'light' }, options);
}

module.exports = { menuLabels, menuOptions };
