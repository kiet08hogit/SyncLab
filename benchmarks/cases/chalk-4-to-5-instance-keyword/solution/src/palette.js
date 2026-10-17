const { Chalk } = require('chalk');

const colors = new Chalk({ level: 1 });

const palette = {
  ok: colors.green,
  warn: colors.hex('#FFA500'),
  fail: colors.bold.red,
  muted: colors.gray,
};

module.exports = { palette };
