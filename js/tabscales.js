import { QUALITY_DEGREES } from './chords.js';

const MOOD_FAMILIES = {
  'mood:happy': ['Major', 'Ionian', 'Major Pentatonic', 'Lydian', 'Mixolydian'],
  'mood:sad': ['Minor', 'Aeolian', 'Harmonic Minor', 'Dorian', 'Minor Pentatonic'],
  'mood:cool': ['Dorian', 'Minor Pentatonic', 'Blues Minor', 'Melodic Minor', 'Aeolian'],
  'mood:dreamy': ['Lydian', 'Major Pentatonic', 'Augmented', 'Melodic Major', 'Major'],
  'mood:dark': ['Phrygian', 'Harmonic Minor', 'Locrian', 'Diminished', 'Altered'],
  'mood:groovy': ['Mixolydian', 'Blues', 'Blues Minor', 'Minor Pentatonic', 'Dorian'],
  'mood:chaotic': ['Altered', 'Diminished', 'Blues Diminished', 'Locrian', 'Augmented'],
  'mood:poignant': ['Dorian', 'Lydian', 'Harmonic Minor', 'Melodic Minor', 'Locrian'],
};

const GENRE_FAMILIES = {
  'genre:ambient': ['Lydian', 'Major Pentatonic', 'Minor Pentatonic', 'Dorian'],
  'genre:avant-garde': ['Altered', 'Diminished', 'Augmented', 'Blues Diminished'],
  'genre:ballads': ['Major', 'Minor', 'Aeolian', 'Harmonic Minor'],
  'genre:bebop': ['Mixolydian', 'Dorian', 'Melodic Minor', 'Major'],
  'genre:blues': ['Blues Minor', 'Blues', 'Minor Pentatonic', 'Mixolydian'],
  'genre:classical': ['Major', 'Minor', 'Harmonic Minor', 'Harmonic Major', 'Melodic Minor'],
  'genre:dance': ['Major', 'Minor', 'Mixolydian', 'Dorian'],
  'genre:extreme-metal': ['Locrian', 'Altered', 'Diminished', 'Phrygian'],
  'genre:flamenco': ['Phrygian', 'Harmonic Minor', 'Diminished', 'Altered'],
  'genre:folk': ['Major', 'Major Pentatonic', 'Dorian', 'Aeolian'],
  'genre:funk': ['Dorian', 'Mixolydian', 'Blues', 'Minor Pentatonic'],
  'genre:grind': ['Locrian', 'Altered', 'Blues Diminished', 'Diminished'],
  'genre:grunge': ['Minor Pentatonic', 'Blues Minor', 'Aeolian', 'Phrygian'],
  'genre:hip-hop': ['Minor Pentatonic', 'Dorian', 'Blues Minor', 'Minor'],
  'genre:hymns': ['Major', 'Ionian', 'Lydian', 'Major Pentatonic'],
  'genre:indie': ['Major Pentatonic', 'Dorian', 'Mixolydian', 'Lydian'],
  'genre:jazz': ['Dorian', 'Melodic Minor', 'Altered', 'Lydian', 'Mixolydian'],
  'genre:metal': ['Phrygian', 'Locrian', 'Harmonic Minor', 'Diminished'],
  'genre:pop': ['Major', 'Major Pentatonic', 'Ionian', 'Mixolydian'],
  'genre:progressive-rock': ['Lydian', 'Dorian', 'Melodic Minor', 'Harmonic Minor'],
  'genre:r-and-b': ['Dorian', 'Minor Pentatonic', 'Blues Minor', 'Mixolydian'],
  'genre:rock': ['Minor Pentatonic', 'Blues Minor', 'Aeolian', 'Mixolydian'],
  'genre:techno': ['Minor', 'Dorian', 'Phrygian', 'Diminished'],
  'genre:trance': ['Minor', 'Dorian', 'Phrygian', 'Lydian'],
};

const ROOT_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function scaleFamily(scale) {
  return scale.name.slice(scale['Root Note'].length + 1);
}

/**
 * Rank built-in scales against a group of tab-analyzed chords.
 * Chord-tone and root coverage determine musical fit; the selected mood or
 * genre only breaks close matches toward an appropriate scale family.
 */
export function recommendScales(segments, presets, styleId, limit = 5) {
  const familyPreferences = MOOD_FAMILIES[styleId] ?? GENRE_FAMILIES[styleId];
  if (
    !familyPreferences ||
    !Array.isArray(segments) ||
    !segments.length ||
    !Array.isArray(presets)
  ) return [];

  const preferences = new Map(familyPreferences.map((family, index) => [family, index]));
  const scored = [];
  for (const scale of presets.filter((preset) => preset?.isDefault)) {
    if (
      typeof scale.name !== 'string' ||
      typeof scale['Root Note'] !== 'string' ||
      typeof scale.Intervals !== 'string'
    ) {
      continue;
    }
    const root = ROOT_NOTES.indexOf(scale['Root Note']);
    const intervals = scale.Intervals.split(',').map(Number);
    if (root < 0 || !intervals.length || intervals.some((interval) => !Number.isInteger(interval))) continue;
    const pcs = new Set([root, ...intervals.map((interval) => (root + interval) % 12)]);
    let chordToneCoverage = 0;
    let chordRootCoverage = 0;
    let totalTones = 0;

    for (const segment of segments) {
      const degrees = QUALITY_DEGREES[segment.quality] ?? QUALITY_DEGREES.maj;
      const chordTones = degrees.map((degree) => (segment.root + degree) % 12);
      totalTones += chordTones.length;
      chordToneCoverage += chordTones.filter((pitch) => pcs.has(pitch)).length;
      chordRootCoverage += pcs.has(segment.root) ? 1 : 0;
    }

    const family = scaleFamily(scale);
    const preferenceRank = preferences.get(family);
    const styleBonus = preferenceRank === undefined ? 0 : (familyPreferences.length - preferenceRank) * 1.4;
    const fit = (chordToneCoverage / totalTones) * 85 + (chordRootCoverage / segments.length) * 15;
    scored.push({
      ...scale,
      score: fit + styleBonus,
      fit,
      family,
    });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}
