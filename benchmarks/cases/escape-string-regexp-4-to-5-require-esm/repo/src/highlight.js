const escapeStringRegexp = require('escape-string-regexp');

function highlight(text, term, tag = 'mark') {
  if (!term) return text;
  const pattern = new RegExp(escapeStringRegexp(term), 'gi');
  return text.replace(pattern, (match) => `<${tag}>${match}</${tag}>`);
}

function countMatches(text, term) {
  if (!term) return 0;
  const pattern = new RegExp(escapeStringRegexp(term), 'gi');
  return (text.match(pattern) || []).length;
}

module.exports = { highlight, countMatches };
