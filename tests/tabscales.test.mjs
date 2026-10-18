import assert from 'node:assert/strict';
import test from 'node:test';

import { recommendScales } from '../js/tabscales.js';

const cMajorAndAMinor = [
  { root: 0, quality: 'maj' },
  { root: 9, quality: 'min' },
  { root: 5, quality: 'maj' },
  { root: 7, quality: 'maj' },
];

const equivalentScales = [
  { name: 'C Major', 'Root Note': 'C', Intervals: '2,4,5,7,9,11', isDefault: true },
  { name: 'A Minor', 'Root Note': 'A', Intervals: '2,3,5,7,8,10', isDefault: true },
  { name: 'C Phrygian', 'Root Note': 'C', Intervals: '1,3,5,7,8,10', isDefault: true },
  { name: 'C Saved Scale', 'Root Note': 'C', Intervals: '1,3,5,6,8,10', isDefault: false },
];

test('scale recommendations rank chord-fitting families by selected mood', () => {
  const happy = recommendScales(cMajorAndAMinor, equivalentScales, 'mood:happy');
  const sad = recommendScales(cMajorAndAMinor, equivalentScales, 'mood:sad');
  const pop = recommendScales(cMajorAndAMinor, equivalentScales, 'genre:pop');

  assert.equal(happy[0].name, 'C Major');
  assert.equal(sad[0].name, 'A Minor');
  assert.equal(pop[0].name, 'C Major');
  assert.equal(happy[0].fit, 100);
  assert.equal(sad[0].fit, 100);
  const majorFit = happy.find((scale) => scale.name === 'C Major').fit;
  const phrygianFit = happy.find((scale) => scale.name === 'C Phrygian').fit;
  assert.ok(majorFit > phrygianFit);
  assert.ok(happy.every((scale) => scale.isDefault));
});

test('scale recommendations handle unsupported styles and missing chords', () => {
  assert.deepEqual(recommendScales([], equivalentScales, 'mood:happy'), []);
  assert.deepEqual(recommendScales(cMajorAndAMinor, equivalentScales, 'unknown'), []);
  assert.deepEqual(recommendScales(cMajorAndAMinor, [], 'mood:happy'), []);
  assert.deepEqual(recommendScales(cMajorAndAMinor, undefined, 'mood:happy'), []);
  assert.deepEqual(recommendScales(undefined, equivalentScales, 'mood:happy'), []);
});
