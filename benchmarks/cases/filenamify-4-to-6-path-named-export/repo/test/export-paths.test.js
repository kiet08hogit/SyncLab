import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reportFileName, attachmentPath } from '../src/export-paths.js';

describe('export paths', () => {
  it('builds a safe report file name', () => {
    assert.equal(reportFileName('Q3: revenue/costs'), 'Q3- revenue-costs.pdf');
    assert.equal(reportFileName('draft?notes', 'txt'), 'draft-notes.txt');
  });

  it('sanitizes only the file name of an attachment path', () => {
    assert.equal(attachmentPath('/data/uploads', 'invoice<1>.png'), '/data/uploads/invoice_1_.png');
  });
});
