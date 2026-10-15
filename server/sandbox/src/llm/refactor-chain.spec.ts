import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseFencedReply } from './refactor-chain.js';

const ORIGINAL = "const _ = require('lodash');\n\nmodule.exports = _.pluck(users, 'name');\n";
const MIGRATED = "const _ = require('lodash');\n\nmodule.exports = _.map(users, 'name');\n";

describe('parseFencedReply', () => {
  it('reads the reason and the file from a fenced block', () => {
    const reply = `Replaced _.pluck with _.map.\n\n\`\`\`javascript\n${MIGRATED}\`\`\``;

    assert.deepEqual(parseFencedReply(reply, ORIGINAL), {
      changed: true,
      contents: MIGRATED,
      reason: 'Replaced _.pluck with _.map.',
    });
  });

  it('treats a reply without a block as no change', () => {
    assert.deepEqual(parseFencedReply('The file does not use any removed API.\n', ORIGINAL), {
      changed: false,
      contents: '',
      reason: 'The file does not use any removed API.',
    });
  });

  it('treats the original file echoed back as no change', () => {
    const reply = `Nothing to change.\n\`\`\`\n${ORIGINAL}\`\`\`\n`;

    assert.equal(parseFencedReply(reply, ORIGINAL).changed, false);
  });

  it('keeps a fence that appears inside the file', () => {
    const withFence = 'const doc = `\n```\nexample\n```\n`;\n';
    const reply = `Updated.\n\`\`\`ts\n${withFence}\`\`\``;

    assert.equal(parseFencedReply(reply, 'old\n').contents, withFence);
  });

  it("follows the original file's trailing newline", () => {
    const reply = `Updated.\n\`\`\`\n${MIGRATED}\`\`\``;

    assert.equal(parseFencedReply(reply, ORIGINAL.trimEnd()).contents, MIGRATED.trimEnd());
  });

  it('refuses a block that was cut off before it closed', () => {
    const reply = `Updated.\n\`\`\`js\n${MIGRATED.slice(0, 20)}`;

    assert.throws(() => parseFencedReply(reply, ORIGINAL), /never closed/);
  });
});
