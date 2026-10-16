const { palette } = require('./palette.js');

function statusLine(check) {
  if (check.status === 'pass') return palette.ok(`PASS ${check.name}`);
  if (check.status === 'slow') return palette.warn(`SLOW ${check.name} (${check.ms}ms)`);
  return palette.fail(`FAIL ${check.name}`);
}

function summarize(checks) {
  const failed = checks.filter((check) => check.status === 'fail').length;
  const lines = checks.map(statusLine);
  lines.push(palette.muted(`${checks.length} checks, ${failed} failed`));
  return lines.join('\n');
}

module.exports = { statusLine, summarize };
