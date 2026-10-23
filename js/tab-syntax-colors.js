export const TAB_SYNTAX_GROUPS = [
  {
    title: 'Articulation & Technique',
    items: [
      ['hammerOn', 'Hammer-on'],
      ['pullOff', 'Pull-off'],
      ['bend', 'Bend'],
      ['release', 'Release'],
      ['preBend', 'Pre-bend'],
      ['preBendRelease', 'Pre-bend & release'],
      ['bendReleaseBend', 'Bend-release-bend'],
      ['slideUp', 'Slide up'],
      ['slideDown', 'Slide down'],
      ['legatoSlide', 'Legato slide'],
      ['vibrato', 'Vibrato'],
      ['tapping', 'Tapping'],
      ['leftHandTap', 'Left-hand tap'],
      ['dead', 'Dead / muted note'],
      ['palmMute', 'Palm mute'],
      ['tremoloPicking', 'Tremolo picking'],
      ['graceNote', 'Grace note / let ring'],
      ['accent', 'Accent'],
      ['dottedNote', 'Dotted note'],
      ['staccato', 'Staccato'],
      ['fermata', 'Fermata'],
    ],
  },
  {
    title: 'Harmonics',
    items: [
      ['naturalHarmonic', 'Natural harmonic'],
      ['pinchHarmonic', 'Pinch harmonic'],
      ['tapHarmonic', 'Tap harmonic'],
    ],
  },
  {
    title: 'Whammy Bar',
    items: [
      ['whammyDip', 'Whammy dip'],
      ['invertedDip', 'Inverted dip'],
      ['whammyDive', 'Whammy dive'],
      ['diveReturn', 'Dive and return'],
      ['scoop', 'Scoop'],
      ['gargle', 'Gargle'],
      ['whammyBend', 'Whammy bend'],
    ],
  },
  {
    title: 'Picking & Hand Indicators',
    items: [
      ['downstroke', 'Downstroke'],
      ['upstroke', 'Upstroke'],
      ['leftHandFinger', 'Left-hand fingers'],
      ['rightHandFinger', 'Right-hand fingers'],
      ['classicalFingerstyle', 'Classical fingerstyle'],
    ],
  },
];

export const DEFAULT_TAB_SYNTAX_COLORS = Object.fromEntries(
  TAB_SYNTAX_GROUPS.flatMap(({ items }) => items.map(([key]) => [key, '#00e5ff']))
);

function textOf(...values) {
  return values
    .filter((value) => value != null)
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
    .join(' ')
    .toLowerCase();
}

export function tabSyntaxKey(note, beat = null) {
  if (!note) return null;
  if (note.isDead) return 'dead';
  if (note.isPalmMute) return 'palmMute';
  if (note.isLeftHandTapped) return 'leftHandTap';
  const harmonicText = textOf(note.harmonicType);
  switch (Number(note.harmonicType)) {
    case 1: return 'naturalHarmonic';
    case 2: return 'naturalHarmonic';
    case 3: return 'pinchHarmonic';
    case 4: return 'tapHarmonic';
    case 5: return 'naturalHarmonic';
    case 6: return 'naturalHarmonic';
    default: break;
  }
  if (/pinch/.test(harmonicText)) return 'pinchHarmonic';
  if (/tap/.test(harmonicText)) return 'tapHarmonic';
  if (/natural|artificial|semi|feedback/.test(harmonicText)) return 'naturalHarmonic';
  if (note.isHammerPullOrigin) return 'hammerOn';
  if (note.isHammerPullDestination) return 'pullOff';
  if (note.slideTarget?.fret != null && note.fret != null) {
    return note.slideTarget.fret >= note.fret ? 'slideUp' : 'slideDown';
  }
  switch (Number(note.slideOutType)) {
    case 2: return 'legatoSlide';
    case 3: return 'slideUp';
    case 4: return 'slideDown';
    default: break;
  }
  switch (Number(note.slideInType)) {
    case 1: return 'slideUp';
    case 2: return 'slideDown';
    default: break;
  }
  const slideText = textOf(note.slideInType, note.slideOutType);
  if (/legato/.test(slideText)) return 'legatoSlide';
  if (/out.?up|from.?below/.test(slideText)) return 'slideUp';
  if (/out.?down|from.?above/.test(slideText)) return 'slideDown';
  if (note.hasBend || note.bendType) {
    const bend = textOf(note.bendType, note.bendStyle, note.bendPoints);
    if (bend.includes('pre') && bend.includes('release')) return 'preBendRelease';
    if (bend.includes('pre')) return 'preBend';
    if (bend.includes('release') && bend.includes('bend')) return 'bendReleaseBend';
    if (bend.includes('release')) return 'release';
    return 'bend';
  }
  if (note.isTremolo) return 'tremoloPicking';
  if (note.isStaccato) return 'staccato';

  const text = textOf(
    note.technique,
    note.effect,
    note.effects,
    note.slideType,
    note.harmonicType,
    note.pickStroke,
    beat?.technique,
    beat?.effect,
    beat?.effects,
    beat?.whammyBar
  );
  if (/natural.?harmonic|harmonictype.*natural/.test(text)) return 'naturalHarmonic';
  if (/pinch.?harmonic/.test(text)) return 'pinchHarmonic';
  if (/tap.?harmonic/.test(text)) return 'tapHarmonic';
  if (/left.?hand.?tap|lefthandtap/.test(text)) return 'leftHandTap';
  if (/tapping|tap/.test(text)) return 'tapping';
  if (/legato.?slide/.test(text)) return 'legatoSlide';
  if (/slide.*up|slideup/.test(text)) return 'slideUp';
  if (/slide.*down|slidedown/.test(text)) return 'slideDown';
  if (/vibrato/.test(text)) return 'vibrato';
  if (/grace|let.?ring/.test(text)) return 'graceNote';
  if (/fermata/.test(text)) return 'fermata';
  if (/accent/.test(text)) return 'accent';
  if (/dotted|dot/.test(text)) return 'dottedNote';
  if (/downstroke|pickstroke.*down/.test(text)) return 'downstroke';
  if (/upstroke|pickstroke.*up/.test(text)) return 'upstroke';
  if (/whammy.*dip|dip/.test(text)) return 'whammyDip';
  if (/inverted.*dip/.test(text)) return 'invertedDip';
  if (/dive.*return|return.*dive/.test(text)) return 'diveReturn';
  if (/whammy.*dive|dive/.test(text)) return 'whammyDive';
  if (/scoop/.test(text)) return 'scoop';
  if (/gargle/.test(text)) return 'gargle';
  if (/whammy.*bend/.test(text)) return 'whammyBend';
  if (/left.?hand|finger.*[1234]/.test(text)) return 'leftHandFinger';
  if (/right.?hand/.test(text)) return 'rightHandFinger';
  if (/classical|fingerstyle|[pima]/.test(text)) return 'classicalFingerstyle';
  return null;
}