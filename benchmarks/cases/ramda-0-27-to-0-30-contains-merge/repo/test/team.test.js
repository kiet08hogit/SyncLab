const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isMember } = require('../src/membership.js');
const { updateProfile } = require('../src/profile.js');
const { hasLabel } = require('../src/labels.js');
const { teamNote } = require('../src/notes.js');

describe('team', () => {
  it('checks membership', () => {
    const team = { name: 'Core', memberIds: [1, 2] };
    assert.equal(isMember(team, 2), true);
    assert.equal(isMember(team, 3), false);
  });

  it('applies profile changes over the current profile', () => {
    assert.deepEqual(updateProfile({ name: 'Ada', city: 'London' }, { city: 'Paris' }), {
      name: 'Ada',
      city: 'Paris',
    });
  });

  it('checks issue labels', () => {
    assert.equal(hasLabel({ labels: ['bug'] }, 'bug'), true);
    assert.equal(hasLabel({ labels: [] }, 'bug'), false);
  });

  it('describes the team', () => {
    assert.match(teamNote({ name: 'Core' }), /^Core uses ramda/);
  });
});
