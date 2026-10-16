const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { allPermissions } = require('../src/permissions.js');
const { buildFilter } = require('../src/filters.js');
const { withDefaults } = require('../src/config.js');
const { menuLabels, menuOptions } = require('../src/menu.js');

describe('admin', () => {
  it('collects every permission from nested roles', () => {
    const tree = ['read', ['write', ['delete', ['read']]], ['export']];
    assert.deepEqual(allPermissions(tree), ['delete', 'export', 'read', 'write']);
  });

  it('builds a filter from mixed criteria', () => {
    const users = [
      { name: 'ana', active: true, age: 31 },
      { name: 'bo', active: false, age: 45 },
      { name: 'cy', active: true, age: 17 },
    ];
    const adults = buildFilter([{ active: true }, function (u) { return u.age >= 18; }]);
    assert.deepEqual(users.filter(adults).map((u) => u.name), ['ana']);
    const named = buildFilter(['name']);
    assert.equal(users.filter(named).length, 3);
  });

  it('keeps defaults for missing user settings', () => {
    const defaults = { pageSize: 25, locale: 'en', theme: 'light' };
    assert.deepEqual(withDefaults({ pageSize: null, locale: 'fr', theme: undefined }, defaults), {
      pageSize: 25,
      locale: 'fr',
      theme: 'light',
    });
  });

  it('keeps the menu helpers working', () => {
    assert.deepEqual(menuLabels([{ title: 'File', items: ['Open', ['Recent', ['a.txt']]] }]), [
      'File',
      'Open',
      'Recent',
      'a.txt',
    ]);
    assert.deepEqual(menuOptions({ theme: 'dark' }), { collapsed: false, theme: 'dark' });
  });
});
