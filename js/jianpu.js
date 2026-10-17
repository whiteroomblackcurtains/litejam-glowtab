// Generate numbered notation from an alphaTab score object.
//
// Common Taiwanese numbered-notation conventions:
//   1–7 are scale degrees; add # / b for notes outside the scale.
//   Dots above a number indicate higher octaves, dots below indicate lower octaves (one per octave).
//   Eighth notes have one underline; sixteenth notes have two.
//   Extend long notes with - (half note = "1 -", whole note = "1 - - -").
//   Rests are represented by 0.

const DEGREE_BY_INTERVAL = ['1', '#1', '2', '#2', '3', '4', '#4', '5', '#5', '6', '#6', '7'];

// Reference octave with no dots. Defaults near C4, but adjusts to the song's range.
// (Guitar scores mostly fall between C3 and C5; always using C4 would add many hard-to-read low-octave dots.)
const DEFAULT_BASE_MIDI = 60;

/** Choose a tonic position that minimizes octave dots for the song's range. */
export function tonicMidiFor(keyRoot, referenceMidi = DEFAULT_BASE_MIDI) {
  const pc = ((keyRoot % 12) + 12) % 12;
  let best = null;
  for (let midi = pc; midi <= 127; midi += 12) {
    const dist = Math.abs(midi - referenceMidi);
    if (best === null || dist < Math.abs(best - referenceMidi)) best = midi;
  }
  return best ?? DEFAULT_BASE_MIDI;
}

/**
 * Convert a MIDI pitch to numbered notation.
 * @param {number} midi
 * @param {number} keyRoot Tonic pitch class of the key (0 = C).
 * @param {number} tonicMidi MIDI pitch of the tonic (determines the number of octave dots).
 * @returns {{num:string, octave:number}} octave 0 = no dot, +1 = one dot above, -1 = one dot below.
 */
export function midiToJianpu(midi, keyRoot = 0, tonicMidi = null) {
  const interval = (((midi - keyRoot) % 12) + 12) % 12;
  const num = DEGREE_BY_INTERVAL[interval];
  const tonic = tonicMidi ?? tonicMidiFor(keyRoot);
  const octave = Math.floor((midi - tonic) / 12);
  return { num, octave };
}

/** Convert alphaTab duration values (1=whole, 2=half, 4=quarter, 8=eighth, …) to underlines and extension dashes. */
function durationShape(duration, dots = 0) {
  const underlines = duration >= 8 ? Math.round(Math.log2(duration / 4)) : 0;
  // Use - to extend notes longer than a quarter note: one for a half note, three for a whole note.
  let dashes = duration <= 2 ? 4 / duration - 1 : 0;
  if (dots > 0 && duration <= 4) dashes += dots * 0.5;
  return { underlines, dashes: Math.round(dashes) };
}

/**
 * Convert a score to numbered-notation data.
 * @param {object} score An alphaTab Score.
 * @param {{keyRoot?:number, trackIndex?:number, staffIndex?:number}} opts
 * @returns {{bars: Array<Array<{num:string, octave:number, underlines:number, dashes:number, rest:boolean}>>}}
 */
export function scoreToJianpu(score, { keyRoot = 0, trackIndex = 0, staffIndex = 0 } = {}) {
  const staff = score?.tracks?.[trackIndex]?.staves?.[staffIndex];
  if (!staff) return { bars: [] };

  // Find the median pitch first and use it to choose the tonic's octave, keeping octave dots to a minimum.
  const pitches = [];
  for (const bar of staff.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of beat.notes ?? []) pitches.push(note.realValue);
      }
      break;
    }
  }
  pitches.sort((a, b) => a - b);
  const median = pitches.length ? pitches[Math.floor(pitches.length / 2)] : DEFAULT_BASE_MIDI;
  const tonicMidi = tonicMidiFor(keyRoot, median);

  const bars = [];
  for (const bar of staff.bars) {
    const cells = [];
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        const { underlines, dashes } = durationShape(beat.duration, beat.dots ?? 0);

        if (beat.isRest || !beat.notes?.length) {
          cells.push({ num: '0', octave: 0, underlines, dashes, rest: true });
          continue;
        }
        // For a monophonic melody, use the highest note (for chords, treat the highest note as the melody).
        const top = beat.notes.reduce((a, b) => (b.realValue > a.realValue ? b : a));
        const { num, octave } = midiToJianpu(top.realValue, keyRoot, tonicMidi);
        cells.push({ num, octave, underlines, dashes, rest: false, tied: !!top.isTieDestination });
      }
      break; // Use only the first voice; numbered notation is monophonic.
    }
    bars.push(cells);
  }
  return { bars };
}

/** Generate numbered-notation HTML. */
export function jianpuHtml(data, { barsPerRow = 4 } = {}) {
  if (!data.bars.length) return '<p class="muted small">This score has no notes to convert to numbered notation.</p>';

  const cellHtml = (c) => {
    // Rests: one 0 per beat (no extension dashes); longer rests are consecutive 0s.
    if (c.rest) {
      const first = `<span class="jp-cell jp-rest jp-u${c.underlines}"><span class="jp-num">0</span></span>`;
      const more = `<span class="jp-cell jp-rest"><span class="jp-num">0</span></span>`.repeat(c.dashes);
      return first + more;
    }
    const dots =
      c.octave > 0
        ? `<span class="jp-dot jp-up">${'·'.repeat(Math.min(3, c.octave))}</span>`
        : c.octave < 0
          ? `<span class="jp-dot jp-down">${'·'.repeat(Math.min(3, -c.octave))}</span>`
          : '';
    const num = c.tied ? '-' : c.num;
    // Each extension dash takes one beat's width, so half and whole notes align with their durations.
    const dashes = `<span class="jp-dash">-</span>`.repeat(c.dashes);
    return (
      `<span class="jp-cell jp-u${c.underlines}">` +
      `${dots}<span class="jp-num">${num}</span></span>${dashes}`
    );
  };

  let out = '';
  for (let i = 0; i < data.bars.length; i += barsPerRow) {
    out += '<div class="jp-row">';
    for (const bar of data.bars.slice(i, i + barsPerRow)) {
      out += `<span class="jp-bar">${bar.map(cellHtml).join('')}</span><span class="jp-line">|</span>`;
    }
    out += '</div>';
  }
  return out;
}
