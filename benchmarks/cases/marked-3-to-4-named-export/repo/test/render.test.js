const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { renderComment, renderInline } = require('../src/render.js');

describe('render', () => {
  it('renders a comment paragraph with emphasis and a link', () => {
    assert.equal(
      renderComment('  Read **the docs** at [the site](https://example.com).  '),
      '<p>Read <strong>the docs</strong> at <a href="https://example.com">the site</a>.</p>\n',
    );
  });

  it('renders a list', () => {
    assert.equal(renderComment('- one\n- two'), '<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n');
  });

  it('renders inline text without a paragraph', () => {
    assert.equal(renderInline('use `npm test` _now_'), 'use <code>npm test</code> <em>now</em>');
  });
});
