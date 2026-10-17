// Convert the extracted solo notes into alphaTex and let alphaTab render them as standard notation and tablature.
//
// This lets us reuse the existing score mode for the score, cursor, playback, and note highlighting,
// instead of writing a separate renderer; the result looks like Guitar Pro.
//
// alphaTex note syntax: `fret.string.duration`; rests use `r.duration`, and bars are separated by `|`.
// Durations are 1/2/4/8/16/32 (whole/half/quarter/eighth/sixteenth notes).

/** Convert a number of sixteenth-note units to an alphaTex duration (the closest value not exceeding it). */
function unitsToDuration(units) {
  if (units >= 16) return 1;
  if (units >= 8) return 2;
  if (units >= 4) return 4;
  if (units >= 2) return 8;
  return 16;
}

/** Split a duration into writable note values (for example, 3 sixteenth notes = an eighth + a sixteenth). */
function splitUnits(units) {
  const out = [];
  let left = Math.max(1, Math.round(units));
  for (const size of [16, 8, 4, 2, 1]) {
    while (left >= size) {
      out.push(size);
      left -= size;
    }
  }
  return out;
}

function escapeTex(s) {
  return String(s ?? '').replace(/"/g, "'");
}

/**
 * @param {{title:string, bpm:number, beatsPerBar:number, subdivision:number,
 *          notes:Array<{midi:number,string:number,fret:number,grid:number,units:number}>}} melody
 * @returns {string} alphaTex
 */
export function melodyToTex(melody) {
  const bpb = melody.beatsPerBar || 4;
  const sub = melody.subdivision || 4;
  const unitsPerBar = bpb * sub;
  const notes = (melody.notes ?? []).filter((n) => n.string && n.fret != null);

  const head = [
    `\\title "${escapeTex(melody.title || 'Solo')}"`,
    `\\subtitle "LiteJam GlowTab · Automatically extracted melody (for reference only)"`,
    `\\tempo ${Math.max(30, Math.round(melody.bpm || 100))}`,
    '\\instrument 25', // Acoustic Guitar (steel)
    `\\ts ${bpb} 4`,
    '.',
  ].join('\n');

  if (!notes.length) return `${head}\nr.1 |`;

  // Lay out the notes bar by bar, filling empty spaces with rests.
  const bars = [];
  let cursor = 0; // Current position in sixteenth-note units.
  const lastEnd = notes[notes.length - 1].grid + notes[notes.length - 1].units;
  const barCount = Math.max(1, Math.ceil(lastEnd / unitsPerBar));

  let idx = 0;
  for (let bar = 0; bar < barCount; bar++) {
    const barStart = bar * unitsPerBar;
    const barEnd = barStart + unitsPerBar;
    const beats = [];
    cursor = Math.max(cursor, barStart);

    while (idx < notes.length && notes[idx].grid < barEnd) {
      const note = notes[idx];
      // Fill the gap before the note with rests.
      if (note.grid > cursor) {
        for (const d of splitUnits(Math.min(note.grid, barEnd) - cursor)) {
          beats.push(`r.${unitsToDuration(d)}`);
        }
        cursor = note.grid;
      }
      // Notes do not cross bar lines; truncate them at the bar line if necessary.
      const len = Math.max(1, Math.min(note.units, barEnd - note.grid));
      // When splitting a duration into multiple note values, tie every segment after the first,
      // otherwise a sustained note would be written as several repeated attacks (adding extra notes to the score).
      // Tie syntax is `-.string.duration`; the string number is required. If written as `-.duration`,
      // alphaTex interprets the duration as a string number and throws "Note string is out of range".
      splitUnits(len).forEach((d, i) => {
        const dur = unitsToDuration(d);
        beats.push(i === 0 ? `${note.fret}.${note.string}.${dur}` : `-.${note.string}.${dur}`);
      });
      cursor = note.grid + len;
      idx++;
    }

    if (cursor < barEnd) {
      for (const d of splitUnits(barEnd - cursor)) beats.push(`r.${unitsToDuration(d)}`);
      cursor = barEnd;
    }
    bars.push(beats.join(' '));
  }

  return `${head}\n${bars.join(' |\n')} |`;
}

/** Human-readable summary, displayed in a toast. */
export function melodySummary(melody) {
  const notes = melody.notes ?? [];
  if (!notes.length) return 'No clear single-note melody found.';
  const frets = notes.map((n) => n.fret);
  const lo = Math.min(...frets);
  const hi = Math.max(...frets);
  return `Extracted ${notes.length} notes, spanning frets ${lo}–${hi}`;
}
