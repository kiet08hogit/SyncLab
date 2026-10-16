const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { filledFields, withoutInternal } = require('../src/profile.js');
const { membersByTeam } = require('../src/teams.js');
const { sameContact } = require('../src/compare.js');
const { publicCard, withoutSecrets } = require('../src/public.js');

describe('directory', () => {
  it('keeps only filled profile fields', () => {
    assert.deepEqual(filledFields({ name: 'Ana', phone: '', title: null, city: 'Oslo', age: 0 }), {
      name: 'Ana',
      city: 'Oslo',
      age: 0,
    });
  });

  it('drops internal fields', () => {
    assert.deepEqual(withoutInternal({ _id: 9, _rev: 'x', name: 'Ana' }), { name: 'Ana' });
  });

  it('groups members by team', () => {
    assert.deepEqual(membersByTeam({ ana: 'core', bo: 'web', cy: 'core' }), {
      core: ['ana', 'cy'],
      web: ['bo'],
    });
  });

  it('compares contacts ignoring case and spacing', () => {
    assert.equal(sameContact({ email: 'Ana@Example.com ' }, { email: 'ana@example.com' }), true);
    assert.equal(sameContact({ email: 'ana@example.com' }, { email: 'bo@example.com' }), false);
  });

  it('keeps the public helpers working', () => {
    const profile = { name: 'Ana', title: 'Lead', password: 'pw', token: 't' };
    assert.deepEqual(publicCard(profile), { name: 'Ana', title: 'Lead' });
    assert.deepEqual(withoutSecrets(profile), { name: 'Ana', title: 'Lead' });
  });
});
