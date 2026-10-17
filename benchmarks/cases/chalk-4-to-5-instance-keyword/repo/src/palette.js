const chalk = require('chalk');

const colors = new chalk.Instance({ level: 1 });

const palette = {
  ok: colors.green,
  warn: colors.keyword('orange'),
  fail: colors.bold.red,
  muted: colors.gray,
};

module.exports = { palette };
