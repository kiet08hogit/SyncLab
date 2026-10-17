const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../src/router.js');
const { profileLink, fileLink } = require('../src/links.js');

describe('router', () => {
  const router = createRouter();
  router.add('GET', '/users/:user', (params) => ({ page: 'profile', ...params }));
  router.add('GET', '/projects/:project/files/:name', (params) => ({ page: 'file', ...params }));
  router.add('GET', '/search/:term?', (params) => ({ page: 'search', ...params }));

  it('matches named parameters', () => {
    assert.deepEqual(router.handle('GET', '/users/ada?tab=posts'), { page: 'profile', user: 'ada' });
    assert.deepEqual(router.handle('GET', '/projects/apollo/files/plan%20v2.md'), {
      page: 'file',
      project: 'apollo',
      name: 'plan v2.md',
    });
  });

  it('supports optional parameters', () => {
    assert.deepEqual(router.handle('GET', '/search'), { page: 'search' });
    assert.deepEqual(router.handle('GET', '/search/maps'), { page: 'search', term: 'maps' });
  });

  it('returns null for unknown routes and methods', () => {
    assert.equal(router.handle('GET', '/teams/1'), null);
    assert.equal(router.handle('POST', '/users/ada'), null);
  });
});

describe('links', () => {
  it('builds links from parameters', () => {
    assert.equal(profileLink('ada'), '/users/ada');
  });

  it('encodes unsafe characters in parameters', () => {
    assert.equal(fileLink('apollo', 'plan v2/final.md'), '/projects/apollo/files/plan%20v2%2Ffinal.md');
  });
});
