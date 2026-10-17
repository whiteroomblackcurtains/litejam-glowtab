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

test('every chord type yields valid voicings for 3, 4 and 5 notes', async () => {
  const { CHORD_TYPES, pickTones } = await import('../js/tabchords.js');
  assert.deepEqual(
    CHORD_TYPES.map((t) => t.id),
    [
      'Major', 'Minor', '7', '5', 'dim', 'dim7', 'aug', 'sus2', 'sus4', 'maj7', 'm7',
      '7sus4', 'maj9', 'maj11', 'maj13', 'maj9#11', 'maj13#11', 'add9', '6add9',
      'maj7b5', 'maj7#5', 'm6', 'm9', 'm11', 'm13', 'madd9', 'm6add9', 'mmaj7',
      'mmaj9', 'm7b5', 'm7#5', '6', '9', '11', '13', '7b5', '7#5', '7b9', '7#9',
      '7(b5,b9)', '7(b5,#9)', '7(#5,b9)', '7(#5,#9)', '9b5', '9#5', '13#11',
      '13b9', '11b9', 'sus2sus4', '-5',
    ],
  );
  for (const t of CHORD_TYPES) {
    for (const notes of [3, 4, 5]) {
      const vs = inversionVoicings(0, t.intervals, STANDARD_TUNING, 5, { notes });
      assert.ok(vs.length > 0, `${t.id} with ${notes} notes has no voicings`);
      const want = new Set(pickTones(t.intervals, notes).map((d) => d % 12));
      for (const v of vs) {
        const pcs = new Set(v.notes.map((n) => (STANDARD_TUNING[n.string - 1] + n.fret) % 12));
        assert.ok([...want].every((pc) => pcs.has(pc)), `${t.id}/${notes} misses a tone`);
        assert.ok([...pcs].every((pc) => want.has(pc)), `${t.id}/${notes} has a stray tone`);
      }
    }
  }
});

test('pickTones keeps selected extensions and drops the fifth first', () => {
  return import('../js/tabchords.js').then(({ pickTones }) => {
    assert.deepEqual(pickTones([0, 4, 7, 10, 14], 3), [0, 4, 14]);
    assert.deepEqual(pickTones([0, 4, 8, 10, 15], 4), [0, 4, 8, 15]);
    assert.deepEqual(pickTones([0, 2, 5, 7], 3), [0, 2, 5]);
    assert.deepEqual(pickTones([0, 4, 7, 11, 14, 21], 3), [0, 4, 21]);
  });
});

test('four notes on a triad doubles a chord tone', () => {
  const vs = inversionVoicings(0, 'maj', STANDARD_TUNING, 3, { notes: 4 });
  assert.ok(vs.length > 0);
  for (const v of vs) assert.equal(v.notes.length, 4);
});
