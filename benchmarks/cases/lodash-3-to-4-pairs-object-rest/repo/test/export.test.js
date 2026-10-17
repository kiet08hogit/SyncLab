const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv } = require('../src/csv.js');
const { serialize, deserialize } = require('../src/settings.js');
const { columnWidths } = require('../src/columns.js');

describe('export', () => {
  it('parses csv rows into records', () => {
    const text = 'order,customer,total\n1001,Ana,25.00\n1002,Bjorn,7.50\n';
    assert.deepEqual(parseCsv(text), [
      { order: '1001', customer: 'Ana', total: '25.00' },
      { order: '1002', customer: 'Bjorn', total: '7.50' },
    ]);
  });

  it('serializes settings', () => {
    assert.equal(serialize({ delimiter: ',', header: true }), 'delimiter=,;header=true');
  });

  it('deserializes settings', () => {
    assert.deepEqual(deserialize('delimiter=,;header=true'), { delimiter: ',', header: 'true' });
  });

  it('computes column widths', () => {
    const records = [
      { id: 1, customer: 'Ana' },
      { id: 12345, customer: 'Bo' },
    ];
    assert.deepEqual(columnWidths(records), [5, 8]);
  });
});
