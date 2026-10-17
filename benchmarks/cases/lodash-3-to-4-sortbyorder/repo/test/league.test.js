const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { standings } = require('../src/leaderboard.js');
const { topScorers } = require('../src/scorers.js');
const { alphabetical } = require('../src/roster.js');

const teams = [
  { name: 'Rovers', points: 10, goalDiff: 3 },
  { name: 'Athletic', points: 12, goalDiff: 1 },
  { name: 'United', points: 10, goalDiff: 5 },
  { name: 'City', points: 10, goalDiff: 3 },
];

const players = [
  { name: 'Lee', goals: 7, minutes: 900 },
  { name: 'Diaz', goals: 9, minutes: 1000 },
  { name: 'Okafor', goals: 7, minutes: 700 },
  { name: 'Berg', goals: 3, minutes: 400 },
];

describe('league', () => {
  it('ranks teams by points, goal difference, then name', () => {
    assert.deepEqual(standings(teams).map((t) => t.name), ['Athletic', 'United', 'City', 'Rovers']);
  });

  it('lists top scorers, fewer minutes first on ties', () => {
    assert.deepEqual(topScorers(players, 3).map((p) => p.name), ['Diaz', 'Okafor', 'Lee']);
  });

  it('sorts the roster by name', () => {
    assert.deepEqual(alphabetical(players).map((p) => p.name), ['Berg', 'Diaz', 'Lee', 'Okafor']);
  });
});
