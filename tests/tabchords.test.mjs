import assert from 'node:assert/strict';
import test from 'node:test';

import { detectChord, inversionVoicings } from '../js/tabchords.js';
import { STANDARD_TUNING } from '../js/tuning.js';

test('detectChord finds C major from C E G', () => {
  const w = new Map([[0, 2], [4, 1], [7, 1]]);
  assert.equal(detectChord(w, 0).name, 'C');
});

test('inversionVoicings climb the neck within 12 frets with five distinct colours', () => {
  const vs = inversionVoicings(0, 'maj', STANDARD_TUNING, 5);
  assert.equal(vs.length, 5);
  const tones = [0, 4, 7];
  let prev = -1;
  vs.forEach((v, i) => {
    assert.equal(v.color.name, ['light green', 'light orange', 'white', 'purple', 'scarlet'][i]);
    const sounding = v.notes.map((n) => (STANDARD_TUNING[n.string - 1] + n.fret) % 12);
    assert.equal(new Set(sounding).size, 3);
    assert.ok(sounding.every((pc) => tones.includes(pc)));
    assert.ok(v.notes.every((n) => n.fret <= 12));
    const low = v.notes.reduce((a, b) => (b.string > a.string ? b : a));
    assert.equal((STANDARD_TUNING[low.string - 1] + low.fret) % 12, tones[v.inversion]);
    const fretted = v.notes.filter((n) => n.fret > 0).map((n) => n.fret);
    const min = fretted.length ? Math.min(...fretted) : 0;
    assert.ok(min > prev);
    prev = min;
  });
  assert.ok(new Set(vs.map((v) => v.inversion)).size >= 3);
  assert.ok(new Set(vs.map((v) => v.bass)).size >= 3);
});

test('seventh chords use all four chord tones', () => {
  const vs = inversionVoicings(7, '7', STANDARD_TUNING, 5);
  assert.ok(vs.length >= 3);
  for (const v of vs) {
    const pcs = new Set(v.notes.map((n) => (STANDARD_TUNING[n.string - 1] + n.fret) % 12));
    assert.deepEqual([...pcs].sort((a, b) => a - b), [2, 5, 7, 11]);
  }
});

test('sus2 variants are full three-note groupings and overlaps are flagged shared', () => {
  const vs = inversionVoicings(9, 'sus2', STANDARD_TUNING, 5);
  assert.ok(vs.length >= 4);
  const seen = new Map();
  for (const v of vs) {
    assert.equal(v.notes.length, 3);
    for (const n of v.notes) seen.set(`${n.string}:${n.fret}`, (seen.get(`${n.string}:${n.fret}`) ?? 0) + 1);
  }
  for (const v of vs) for (const n of v.notes) assert.equal(n.shared, seen.get(`${n.string}:${n.fret}`) > 1);
});
