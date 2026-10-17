const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requestId, tenantId } = require('../src/ids.js');

describe('ids', () => {
  it('creates random version 4 request ids', () => {
    const a = requestId();
    const b = requestId();
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(a, b);
  });

  it('derives stable tenant ids from the domain', () => {
    assert.equal(tenantId('Example.com'), tenantId('example.com'));
    assert.equal(tenantId('example.com'), 'a5cf6e8e-4cfa-5f31-a804-6de6d1245e26');
  });
});
