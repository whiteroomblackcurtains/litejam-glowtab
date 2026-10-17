// Chord names → guitar fingerings. Shared by the LED display and on-screen chord diagrams.
//
// Common open chords use a lookup table (the familiar beginner shapes); all others are found by search:
// within a four-fret span, find combinations that "cover every chord tone, include no non-chord tones,
// put the root in the bass, and use a reasonable number of fingers," then sort by playability.
// This provides fingerings for any key and chord quality without maintaining a huge table.

import { STANDARD_TUNING, sameTuning } from './tuning.js';

const PITCH_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PITCH_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Current tuning; index 0 = first (thinnest) string. Defaults to standard tuning; setTuning() can change it.
let TUNING = [...STANDARD_TUNING]; // E4 B3 G3 D3 A2 E2
let standardTuning = true;

export const QUALITY_DEGREES = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  7: [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  5: [0, 7],
};

const SUFFIX_TO_QUALITY = [
  ['maj7', 'maj7'],
  ['m7', 'm7'],
  ['sus4', 'sus4'],
  ['sus2', 'sus2'],
  ['dim', 'dim'],
  ['aug', 'aug'],
  ['m', 'min'],
  ['7', '7'],
  ['5', '5'],
  ['', 'maj'],
];

/** Note name (including sharps/flats) → pitch class, e.g. 'F#' → 6 */
function noteToPc(letter, accidental) {
  let pc = PITCH_SHARP.indexOf(letter);
  if (pc < 0) return null;
  if (accidental === '#') pc = (pc + 1) % 12;
  if (accidental === 'b') pc = (pc + 11) % 12;
  return pc;
}

/**
 * 「Am7」→ {root: 9, quality: 'm7', suffix: 'm7', bass: null}
 * 「Bm/F#」→ {root: 11, quality: 'min', suffix: 'm', bass: 6}
 *
 * Always strip the bass note after the slash before determining chord quality; otherwise 'm/F#' matches no suffix
 * and is treated as a major triad—the color turns blue and the fretboard shows a major-triad shape.
 */
export function parseChord(name) {
  if (!name || name === 'N.C.') return null;

  const [head, bassPart] = String(name).trim().split('/');

  const m = /^([A-G])([#b]?)(.*)$/.exec(head);
  if (!m) return null;
  const root = noteToPc(m[1], m[2]);
  if (root === null) return null;

  let bass = null;
  if (bassPart) {
    const bm = /^([A-G])([#b]?)$/.exec(bassPart.trim());
    if (bm) bass = noteToPc(bm[1], bm[2]);
  }

  const rest = m[3];
  for (const [suffix, quality] of SUFFIX_TO_QUALITY) {
    if (rest === suffix) return { root, quality, suffix, bass };
  }
  return { root, quality: 'maj', suffix: rest, bass };
}

export function chordName(root, quality, useFlats = false) {
  const names = useFlats ? PITCH_FLAT : PITCH_SHARP;
  const entry = SUFFIX_TO_QUALITY.find(([, q]) => q === quality);
  return names[((root % 12) + 12) % 12] + (entry ? entry[0] : '');
}

/**
 * Whether this chord is major or minor (used to choose its display color).
 * The criterion is whether it has a minor third: min / m7 / dim count as minor; everything else counts as major.
 * @returns {'major'|'minor'}
 */
export function chordColorClass(name) {
  const parsed = parseChord(name);
  if (!parsed) return 'major';
  return ['min', 'm7', 'dim'].includes(parsed.quality) ? 'minor' : 'major';
}

// For scale-degree charts: semitone distance → scale-degree notation (spell using the major scale, with flats for out-of-scale notes)
const DEGREE_BY_INTERVAL = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];

// Chord suffixes for scale-degree charts (superscripts for sevenths are easier to read than "57")
const DEGREE_SUFFIX = {
  maj: '',
  min: 'm',
  7: '⁷',
  m7: 'm⁷',
  maj7: 'M⁷',
  sus4: 'sus4',
  sus2: 'sus2',
  dim: 'dim',
  aug: 'aug',
  5: '(5)',
};

/**
 * Chord name → scale degree. For example, in C major, Am → 6m and G7 → 5⁷.
 * @param {string} name Chord name
 * @param {number} keyRoot Key root (0 = C)
 */
export function degreeName(name, keyRoot) {
  if (!name || name === 'N.C.') return name;
  const parsed = parseChord(name);
  if (!parsed) return name;
  const interval = (((parsed.root - keyRoot) % 12) + 12) % 12;
  const suffix = DEGREE_SUFFIX[parsed.quality] ?? parsed.suffix;
  // Express an inversion's bass note as a scale degree too, e.g. G/B → 5/7 in C major
  let slash = '';
  if (parsed.bass !== null && parsed.bass !== undefined) {
    const bassInterval = (((parsed.bass - keyRoot) % 12) + 12) % 12;
    slash = `/${DEGREE_BY_INTERVAL[bassInterval]}`;
  }
  return DEGREE_BY_INTERVAL[interval] + suffix + slash;
}

/** Transpose a chord name by n semitones (also transpose the bass note after a slash) */
export function transposeName(name, semitones, useFlats = false) {
  if (!name || name === 'N.C.') return name;
  const parsed = parseChord(name);
  if (!parsed) return name;
  const names = useFlats ? PITCH_FLAT : PITCH_SHARP;
  const root = (((parsed.root + semitones) % 12) + 12) % 12;
  let slash = '';
  if (parsed.bass !== null && parsed.bass !== undefined) {
    slash = `/${names[(((parsed.bass + semitones) % 12) + 12) % 12]}`;
  }
  return names[root] + parsed.suffix + slash;
}

// ---------------------------------------------------------------- Open chords
// frets run from the first string to the sixth; null = do not play
const OPEN_SHAPES = {
  C: [0, 1, 0, 2, 3, null],
  D: [2, 3, 2, 0, null, null],
  E: [0, 0, 1, 2, 2, 0],
  F: [1, 1, 2, 3, 3, 1],
  G: [3, 3, 0, 0, 2, 3],
  A: [0, 2, 2, 2, 0, null],
  B: [2, 4, 4, 4, 2, null],
  Am: [0, 1, 2, 2, 0, null],
  Bm: [2, 3, 4, 4, 2, null],
  Cm: [3, 4, 5, 5, 3, null],
  Dm: [1, 3, 2, 0, null, null],
  Em: [0, 0, 0, 2, 2, 0],
  Fm: [1, 1, 1, 3, 3, 1],
  Gm: [3, 3, 3, 5, 5, 3],
  A7: [0, 2, 0, 2, 0, null],
  B7: [2, 0, 2, 1, 2, null],
  C7: [0, 1, 3, 2, 3, null],
  D7: [2, 1, 2, 0, null, null],
  E7: [0, 0, 1, 0, 2, 0],
  G7: [1, 0, 0, 0, 2, 3],
  Am7: [0, 1, 0, 2, 0, null],
  Bm7: [2, 3, 2, 4, 2, null],
  Dm7: [1, 1, 2, 0, null, null],
  Em7: [0, 0, 0, 0, 2, 0],
  Cmaj7: [0, 0, 0, 2, 3, null],
  Dmaj7: [2, 2, 2, 0, null, null],
  Fmaj7: [0, 1, 2, 3, null, null],
  Gmaj7: [2, 0, 0, 0, 2, 3],
  Amaj7: [0, 2, 1, 2, 0, null],
  Asus4: [0, 3, 2, 2, 0, null],
  Dsus4: [3, 3, 2, 0, null, null],
  Esus4: [0, 0, 2, 2, 2, 0],
  Gsus4: [3, 3, 0, 0, 3, 3],
  Csus4: [1, 1, 0, 3, 3, null],
};

// ---------------------------------------------------------------- Fingering search

function pitchClass(string, fret) {
  return (TUNING[string - 1] + fret) % 12;
}

/**
 * Search for a fingering for a chord.
 * @returns {{frets: Array<number|null>, fingers: number, base: number} | null}
 *   frets[0] is the first string … frets[5] is the sixth string; null means do not play
 */
function searchVoicing(root, quality) {
  // First require the root to be the lowest note (the fingering should make the root obvious for teaching).
  // Relax this only if no match is found, to avoid returning null.
  return searchVoicingInner(root, quality, true) ?? searchVoicingInner(root, quality, false);
}

/**
 * Pick the easiest fingering for a chord at each position along the entire neck.
 * @returns {Array<{frets: Array<number|null>, base: number, fingers: number, barre: boolean}>}
 */
function searchAllPositions(root, quality, maxFret = 12) {
  // Pick the easiest fingering in each "scanned position."
  //
  // Use the scanned base as the key, not the calculated minFretted:
  // the scan at base 0 may find a shape with open strings but a lowest fretted note at fret 2;
  // if its key collides with the base 2 scan, a standard barre chord is discarded
  // (this is how F#m 244222 used to disappear).
  const results = [];
  for (let base = 0; base <= maxFret; base++) {
    const best = searchVoicingInner(root, quality, true, base, base);
    if (best) results.push(best);
  }

  // The same fingering may be found at adjacent positions; deduplicate by shape
  const seen = new Set();
  return results
    .sort((a, b) => a.base - b.base)
    .filter((v) => {
      const sig = v.frets.join(',');
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
}

function searchVoicingInner(root, quality, requireRootInBass, baseFrom = 0, baseTo = 12) {
  const degrees = QUALITY_DEGREES[quality] ?? QUALITY_DEGREES.maj;
  const needed = new Set(degrees.map((d) => (root + d) % 12));
  const allowed = new Set(needed);

  let best = null;

  for (let base = baseFrom; base <= baseTo; base++) {
    // Candidates per string: open, base..base+3, or muted
    const options = [];
    for (let s = 1; s <= 6; s++) {
      const opts = [null];
      // Use open strings only in low positions. Combining them with high-position frets produces shapes like [0,13,0,10,x,x],
      // which are theoretically playable but no one would actually play.
      const lo = base === 0 ? 0 : base;
      for (let f = lo; f <= base + 3; f++) {
        if (f === 0 && base !== 0) continue;
        if (allowed.has(pitchClass(s, f))) opts.push(f);
      }
      options.push(opts);
    }

    // Try all combinations across six strings, but there are few candidates (usually 2–4), so the total is manageable
    const frets = new Array(6).fill(null);
    const walk = (i) => {
      if (i === 6) {
        const cand = evaluate(frets.slice(), root, needed, base);
        if (cand && (!requireRootInBass || cand.rootInBass) && (!best || cand.score > best.score)) {
          best = cand;
        }
        return;
      }
      for (const f of options[i]) {
        frets[i] = f;
        walk(i + 1);
      }
      frets[i] = null;
    };
    walk(0);

    if (best && best.base <= 3 && best.score > 0.8) break; // A very playable low-position fingering has been found
  }

  return best;
}

function evaluate(frets, root, needed, base) {
  // frets[0] = first string … frets[5] = sixth string
  const sounding = [];
  for (let i = 0; i < 6; i++) {
    if (frets[i] !== null) sounding.push({ string: i + 1, fret: frets[i] });
  }
  if (sounding.length < 3) return null;

  // Muted strings must be consecutive from the bass end (starting at the sixth string); one gap in the middle is barely acceptable
  let muteRun = 0;
  for (let i = 5; i >= 0; i--) {
    if (frets[i] === null) muteRun++;
    else break;
  }
  const totalMutes = frets.filter((f) => f === null).length;
  if (totalMutes - muteRun > 1) return null;

  const covered = new Set(sounding.map((n) => pitchClass(n.string, n.fret)));
  for (const pc of needed) if (!covered.has(pc)) return null;

  // Penalize shapes whose lowest note is not the root. In standard tuning, the sixth string is assumed to be the bass;
  // with custom tuning, check the actual pitch because the sixth string may not be the lowest.
  const pitchOf = (n) => TUNING[n.string - 1] + n.fret;
  const lowest = standardTuning
    ? sounding.reduce((a, b) => (a.string > b.string ? a : b))
    : sounding.reduce((a, b) => (pitchOf(b) < pitchOf(a) ? b : a));
  const rootInBass = pitchClass(lowest.string, lowest.fret) === root;

  // Finger count: pressing multiple strings at the same fret counts as one (a barre)
  const fretted = sounding.filter((n) => n.fret > 0);
  const byFret = new Map();
  for (const n of fretted) byFret.set(n.fret, (byFret.get(n.fret) ?? 0) + 1);
  let fingers = 0;
  for (const [fret, count] of byFret) {
    fingers += count > 1 && fret === Math.min(...byFret.keys()) ? 1 : count;
  }
  if (fingers > 4) return null;

  const maxFret = Math.max(...sounding.map((n) => n.fret));
  const minFretted = fretted.length ? Math.min(...fretted.map((n) => n.fret)) : 0;
  if (maxFret - minFretted > 3) return null;

  const score =
    sounding.length * 0.18 +
    (rootInBass ? 0.55 : 0) +
    (4 - fingers) * 0.12 -
    base * 0.045 -
    (frets.filter((f) => f === 0).length ? 0 : 0.08);

  return { frets, fingers, base: minFretted, score, rootInBass };
}

// ---------------------------------------------------------------- Public API

const cache = new Map();

/** Change tuning: discard fingerings from the old tuning and search using the new tuning from now on */
export function setTuning(tuning) {
  TUNING = [...tuning];
  standardTuning = sameTuning(TUNING, STANDARD_TUNING);
  cache.clear();
  allCache.clear();
}

/**
 * Get a chord fingering.
 * @param {string} name For example, "Am7"
 * @returns {{name: string, frets: Array<number|null>, notes: Array<{string:number,fret:number}>} | null}
 */
export function voicing(name) {
  if (!name || name === 'N.C.') return null;
  if (cache.has(name)) return cache.get(name);

  let frets = null;

  // Check the lookup table first (also try enharmonic equivalents, e.g. look up A# for Bb)
  const parsed = parseChord(name);
  if (parsed) {
    const sharp = PITCH_SHARP[parsed.root] + parsed.suffix;
    const flat = PITCH_FLAT[parsed.root] + parsed.suffix;
    frets = standardTuning ? OPEN_SHAPES[name] ?? OPEN_SHAPES[sharp] ?? OPEN_SHAPES[flat] ?? null : null;
    if (frets) frets = frets.slice();
  }

  if (!frets && parsed) {
    const found = searchVoicing(parsed.root, parsed.quality);
    if (found) frets = found.frets;
  }

  const result = frets
    ? {
        name,
        frets,
        notes: frets
          .map((f, i) => (f === null ? null : { string: i + 1, fret: f }))
          .filter(Boolean),
      }
    : null;

  cache.set(name, result);
  return result;
}

/** Wrap a frets array (first string → sixth string, null = do not play) in a chord object */
export function toVoicing(name, frets) {
  return {
    name,
    frets: frets.slice(),
    notes: frets.map((f, i) => (f === null ? null : { string: i + 1, fret: f })).filter(Boolean),
  };
}

const allCache = new Map();

/**
 * Fingerings for a chord at each position on the neck, ordered from low to high.
 * The first is always the most commonly used (lookup-table open chords take priority).
 * @param {string} name
 * @returns {Array<{name:string, frets:Array<number|null>, notes:Array, base:number, fingers:number, label:string}>}
 */
export function allVoicings(name) {
  if (!name || name === 'N.C.') return [];
  if (allCache.has(name)) return allCache.get(name);

  const parsed = parseChord(name);
  if (!parsed) return [];

  const out = [];
  const seen = new Set();

  const push = (frets, meta = {}) => {
    const sig = frets.join(',');
    if (seen.has(sig)) return;
    seen.add(sig);
    const fretted = frets.filter((f) => f !== null && f > 0);
    const base = fretted.length ? Math.min(...fretted) : 0;
    const hasOpen = frets.some((f) => f === 0);
    out.push({
      ...toVoicing(name, frets),
      base,
      fingers: meta.fingers ?? countFingers(frets),
      // Shapes using open strings are "open chords"; otherwise, label by the lowest fretted position
      label: hasOpen ? 'Open' : `Fret ${base}`,
    });
  };

  // Put the common lookup-table fingering first
  const sharp = PITCH_SHARP[parsed.root] + parsed.suffix;
  const flat = PITCH_FLAT[parsed.root] + parsed.suffix;
  const table = standardTuning ? OPEN_SHAPES[name] ?? OPEN_SHAPES[sharp] ?? OPEN_SHAPES[flat] : null;
  if (table) push(table.slice());

  for (const v of searchAllPositions(parsed.root, parsed.quality)) {
    push(v.frets, { fingers: v.fingers });
  }

  out.sort((a, b) => a.base - b.base);

  // Remove versions that use the same shape but mute an extra string; keep the more complete one
  const kept = out.filter((v, i) => !out.some((other, j) => j !== i && isSubsetVoicing(v, other)));

  allCache.set(name, kept);
  return kept;
}

/** Is a a subset of b (same fretted positions, but fewer strings sounding)? */
function isSubsetVoicing(a, b) {
  let fewer = false;
  for (let i = 0; i < 6; i++) {
    const fa = a.frets[i];
    const fb = b.frets[i];
    if (fa === null) {
      if (fb !== null) fewer = true;
    } else if (fa !== fb) {
      return false;
    }
  }
  return fewer;
}

function countFingers(frets) {
  const fretted = frets.filter((f) => f !== null && f > 0);
  if (!fretted.length) return 0;
  const lowest = Math.min(...fretted);
  const atLowest = fretted.filter((f) => f === lowest).length;
  return fretted.length - (atLowest > 1 ? atLowest - 1 : 0);
}

/**
 * Chord diagram SVG (portrait).
 * @param {string|{name:string, frets:Array<number|null>}} chord Chord name or an already computed shape
 */
export function diagramSvg(chord, { width = 74, frets = 5 } = {}) {
  const name = typeof chord === 'string' ? chord : chord.name;
  const v = typeof chord === 'string' ? voicing(chord) : chord;
  const padX = 13;       // Space on the left for the position number
  const nameY = 10;      // Chord-name baseline
  const markY = 20;      // Row for ○ / × markers
  const padTop = 27;     // Nut position; keep it below the markers to avoid overlap
  const boardW = width - padX * 2;
  const stringGap = boardW / 5;
  const fretGap = 15;
  const height = padTop + fretGap * frets + 8;

  if (!v) {
    return `<svg viewBox="0 0 ${width} ${height}" class="chord-dia"><text x="${width / 2}" y="${height / 2}"
      text-anchor="middle" class="dia-name">${escapeHtml(name)}</text></svg>`;
  }

  const played = v.frets.filter((f) => f !== null && f > 0);
  const minFret = played.length ? Math.min(...played) : 1;
  const maxFret = played.length ? Math.max(...played) : 1;
  const offset = maxFret > frets ? minFret - 1 : 0;

  const x = (stringIdx) => padX + (5 - stringIdx) * stringGap; // Draw the first string on the right
  const y = (fret) => padTop + (fret - 0.5) * fretGap;

  let out = `<svg viewBox="0 0 ${width} ${height}" class="chord-dia">`;
  out += `<text x="${width / 2}" y="${nameY}" text-anchor="middle" class="dia-name">${escapeHtml(name)}</text>`;

  // Strings
  for (let s = 0; s < 6; s++) {
    out += `<line x1="${x(s)}" y1="${padTop}" x2="${x(s)}" y2="${padTop + fretGap * frets}" class="dia-string"/>`;
  }
  // Frets
  for (let f = 0; f <= frets; f++) {
    const cls = f === 0 && offset === 0 ? 'dia-nut' : 'dia-fret';
    out += `<line x1="${padX}" y1="${padTop + f * fretGap}" x2="${padX + boardW}" y2="${padTop + f * fretGap}" class="${cls}"/>`;
  }
  if (offset > 0) {
    out += `<text x="${padX - 3}" y="${y(1) + 3}" text-anchor="end" class="dia-pos">${offset + 1}</text>`;
  }

  v.frets.forEach((f, i) => {
    const sx = x(i);
    if (f === null) {
      out += `<text x="${sx}" y="${markY + 3}" text-anchor="middle" class="dia-x">×</text>`;
    } else if (f === 0) {
      out += `<circle cx="${sx}" cy="${markY}" r="2.6" class="dia-open"/>`;
    } else {
      out += `<circle cx="${sx}" cy="${y(f - offset)}" r="4.3" class="dia-dot"/>`;
    }
  });

  return out + '</svg>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
