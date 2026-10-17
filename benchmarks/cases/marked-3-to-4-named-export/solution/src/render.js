const { marked } = require('marked');

function renderComment(body) {
  return marked(body.trim());
}

function renderInline(text) {
  return marked.parseInline(text);
}

module.exports = { renderComment, renderInline };
