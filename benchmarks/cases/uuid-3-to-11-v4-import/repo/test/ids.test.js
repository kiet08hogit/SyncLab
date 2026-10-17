const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { newOrderId } = require('../src/ids.js');
const { createSession } = require('../src/sessions.js');
const { idFormatNote } = require('../src/readme-note.js');

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('ids', () => {
  it('prefixes order ids', () => {
    const id = newOrderId();
    assert.ok(id.startsWith('ord_'));
    assert.match(id.slice(4), V4);
    assert.notEqual(newOrderId(), id);
  });

  it('creates sessions with a v4 id', () => {
    const session = createSession(7);
    assert.equal(session.userId, 7);
    assert.match(session.id, V4);
  });

  it('describes the id format', () => {
    assert.match(idFormatNote(), /uuid v4/);
  });
});
