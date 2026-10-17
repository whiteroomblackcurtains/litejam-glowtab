// Chord chart view: bar cells + chord diagrams + playback cursor

import {
  chordColorClass,
  degreeName,
  diagramSvg,
  parseChord,
  transposeName,
  voicing,
} from './chords.js';

const EDIT_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const EDIT_QUALITIES = [
  ['', 'Major'],
  ['m', 'Minor'],
  ['7', '7'],
  ['m7', 'm7'],
  ['maj7', 'maj7'],
  ['sus4', 'sus4'],
  ['sus2', 'sus2'],
  ['dim', 'dim'],
  ['aug', 'aug'],
  ['5', 'Power'],
];

export class ChordChart {
  /**
   * @param {HTMLElement} container
   * @param {{onSeek?: (time:number)=>void}} opts
   */
  constructor(container, { onSeek, onChordClick, onLoopChange } = {}) {
    this.el = container;
    this.onSeek = onSeek;
    this.onChordClick = onChordClick;
    this.onLoopChange = onLoopChange;
    this.data = null;
    this.transpose = 0;
    this.beatIndex = -1;
    this._barEls = [];
    this._slotEls = [];
    this._autoScroll = true;

    // Section loop: click a bar to set the start, then Shift-click another to set the end
    this.loopFrom = null;
    this.loopTo = null;

    // Display chord names or scale degrees, and which key to use as 1 for scale degrees
    this.displayMode = 'chord'; // 'chord' | 'degree'
    this.keyRoot = 0;

    // Capo fret (0 = no capo)
    this.capo = 0;

    // Lyrics: one {text, pinyin} entry per bar, pasted in by the user
    this.lyrics = [];

    // Manually edited chords
    this.editMode = false;
    this.edited = new Set(); // Beat numbers that have been edited
    this._popover = null;
    this._onEditsChanged = null;
  }

  /**
   * Set lyrics. The index is the bar number.
   * @param {Array<{text:string, pinyin?:string}>} lyrics
   */
  setLyrics(lyrics) {
    this.lyrics = Array.isArray(lyrics) ? lyrics : [];
    this.render();
    this.setBeat(this.beatIndex, true);
  }

  hasLyrics() {
    return this.lyrics.some((l) => l && (l.text || l.pinyin));
  }

  setEditMode(on) {
    this.editMode = !!on;
    this.el.classList.toggle('editing', this.editMode);
    this.closePopover();
  }

  /** Notify the caller to save after a chord is edited */
  onEditsChanged(fn) {
    this._onEditsChanged = fn;
  }

  /** All current manual edits, in the form {beat number: chord name} */
  editsSnapshot() {
    const out = {};
    for (const i of this.edited) out[i] = this.data.perBeat[i].name;
    return out;
  }

  /** Reapply saved edits (used when re-analyzing the same song) */
  applyEdits(edits) {
    if (!edits || !this.data) return;
    for (const [key, name] of Object.entries(edits)) {
      const i = Number(key);
      if (Number.isInteger(i) && this.data.perBeat[i]) {
        this._setBeatChord(i, name);
        this.edited.add(i);
      }
    }
    this.render();
  }

  _setBeatChord(beatIndex, name) {
    const d = this.data;
    const pb = d.perBeat[beatIndex];
    if (!pb) return;
    const parsed = name === 'N.C.' ? null : parseChord(name);
    pb.name = name;
    pb.root = parsed ? parsed.root : null;
    pb.quality = parsed ? parsed.quality : 'nc';

    // bars[].beats is derived from perBeat, so both must be updated for the chart to render correctly
    const bpb = d.beatsPerBar;
    const barIdx = Math.floor((beatIndex - d.downbeat) / bpb);
    const slotIdx = beatIndex - d.downbeat - barIdx * bpb;
    if (d.bars[barIdx] && slotIdx >= 0 && slotIdx < d.bars[barIdx].beats.length) {
      d.bars[barIdx].beats[slotIdx] = name;
    }
  }

  /**
   * Edit a chord.
   * @param {number} beatIndex
   * @param {string} name New chord name; 'N.C.' means no chord
   * @param {'beat'|'run'} scope Edit only this beat or the entire consecutive run of the same chord
   */
  applyChordEdit(beatIndex, name, scope = 'run') {
    const d = this.data;
    if (!d?.perBeat?.[beatIndex]) return;

    let from = beatIndex;
    let to = beatIndex;
    if (scope === 'run') {
      const original = d.perBeat[beatIndex].name;
      while (from > 0 && d.perBeat[from - 1].name === original) from--;
      while (to < d.perBeat.length - 1 && d.perBeat[to + 1].name === original) to++;
    }

    for (let i = from; i <= to; i++) {
      this._setBeatChord(i, name);
      this.edited.add(i);
    }

    this.closePopover();
    this.render();
    this.setBeat(this.beatIndex, true);
    this._onEditsChanged?.(this.editsSnapshot());
  }

  /** Clear all manual edits (re-analyze to restore the original detections) */
  clearEdits() {
    this.edited.clear();
    this._onEditsChanged?.({});
  }

  closePopover() {
    this._popover?.remove();
    this._popover = null;
  }

  /** Small panel that appears when clicking a beat to edit its chord */
  openEditPopover(beatIndex, anchor) {
    this.closePopover();
    const current = this.data.perBeat[beatIndex]?.name ?? 'N.C.';
    const parsed = parseChord(current);

    const pop = document.createElement('div');
    pop.className = 'cc-edit';
    pop.innerHTML = `
      <div class="cc-edit-head">
        <b></b>
        <span class="muted small">Bar ${Math.floor((beatIndex - this.data.downbeat) / this.data.beatsPerBar) + 1}</span>
      </div>
      <div class="cc-edit-roots"></div>
      <div class="cc-edit-quals"></div>
      <label class="cc-edit-scope">
        <input type="checkbox" checked />
        <span>Edit all consecutive matching chords</span>
      </label>
      <div class="cc-edit-actions">
        <button class="btn btn-sm cc-edit-nc">Set to no chord</button>
        <button class="btn btn-sm cc-edit-cancel">Cancel</button>
      </div>`;

    pop.querySelector('.cc-edit-head b').textContent = current;

    let root = parsed ? parsed.root : 0;
    let suffix = parsed ? parsed.suffix : '';
    const scopeBox = pop.querySelector('.cc-edit-scope input');
    const rootsEl = pop.querySelector('.cc-edit-roots');
    const qualsEl = pop.querySelector('.cc-edit-quals');

    const commit = () => {
      const name = EDIT_ROOTS[root] + suffix;
      this.applyChordEdit(beatIndex, name, scopeBox.checked ? 'run' : 'beat');
    };

    EDIT_ROOTS.forEach((name, i) => {
      const b = document.createElement('button');
      b.className = 'cc-chip' + (i === root ? ' on' : '');
      b.textContent = name;
      b.addEventListener('click', () => {
        root = i;
        commit();
      });
      rootsEl.appendChild(b);
    });

    EDIT_QUALITIES.forEach(([sfx, label]) => {
      const b = document.createElement('button');
      b.className = 'cc-chip cc-chip-wide' + (sfx === suffix ? ' on' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        suffix = sfx;
        commit();
      });
      qualsEl.appendChild(b);
    });

    pop.querySelector('.cc-edit-nc').addEventListener('click', () => {
      this.applyChordEdit(beatIndex, 'N.C.', scopeBox.checked ? 'run' : 'beat');
    });
    pop.querySelector('.cc-edit-cancel').addEventListener('click', () => this.closePopover());
    pop.addEventListener('click', (e) => e.stopPropagation());

    this.el.appendChild(pop);
    this._popover = pop;

    // Position it beside the clicked bar without letting it go off-screen
    const box = this.el.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const width = 268;
    let left = rect.left - box.left;
    left = Math.max(4, Math.min(left, this.el.clientWidth - width - 4));
    pop.style.left = `${left}px`;
    pop.style.top = `${rect.bottom - box.top + 6}px`;
  }

  /** Toggle between chord names and scale-degree notation */
  setDisplayMode(mode) {
    this.displayMode = mode === 'degree' ? 'degree' : 'chord';
    this.render();
    this.setBeat(this.beatIndex, true);
  }

  /** Retune: recalculate chord diagrams and the fingering for the current beat */
  refresh() {
    this.render();
    this.setBeat(this.beatIndex, true);
  }

  /** Set the capo fret (0–7). After this, displayed chord names reflect the shape you actually play. */
  setCapo(fret) {
    this.capo = Math.max(0, Math.min(11, fret | 0));
    this.render();
    this.setBeat(this.beatIndex, true);
  }

  /**
   * Recommend a capo position: which fret turns the most chords into easy open shapes.
   * @returns {Array<{capo:number, easy:number, total:number, chords:string[]}>} Sorted from best to worst
   */
  suggestCapo(maxFret = 7) {
    if (!this.data) return [];
    // The easiest chords to play on guitar (including common seventh chords)
    const EASY = new Set([
      'C', 'D', 'E', 'G', 'A', 'Am', 'Em', 'Dm', 'F',
      'C7', 'D7', 'E7', 'G7', 'A7', 'Am7', 'Em7', 'Dm7',
      'Cmaj7', 'Dmaj7', 'Fmaj7', 'Gmaj7', 'Amaj7', 'Asus4', 'Dsus4', 'Esus4',
    ]);

    // Consider only the chords actually used and weight them by frequency
    const counts = new Map();
    for (const b of this.data.perBeat) {
      const sounding = this.transpose ? transposeName(b.name, this.transpose) : b.name;
      if (!sounding || sounding === 'N.C.') continue;
      counts.set(sounding, (counts.get(sounding) ?? 0) + 1);
    }
    if (!counts.size) return [];

    const out = [];
    for (let capo = 0; capo <= maxFret; capo++) {
      let easy = 0;
      let total = 0;
      const shapes = new Set();
      for (const [name, n] of counts) {
        const shape = capo ? transposeName(name, -capo) : name;
        // For slash chords, consider only how easy the main chord is to play
        const base = shape.split('/')[0];
        shapes.add(base);
        total += n;
        if (EASY.has(base)) easy += n;
      }
      out.push({ capo, easy, total, ratio: easy / total, chords: [...shapes] });
    }
    out.sort((a, b) => b.ratio - a.ratio || a.capo - b.capo);
    return out;
  }

  /** Which note to use as 1 in scale-degree notation */
  setKeyRoot(root) {
    this.keyRoot = ((root % 12) + 12) % 12;
    if (this.displayMode === 'degree') {
      this.render();
      this.setBeat(this.beatIndex, true);
    }
  }

  /** Text to display (chord name or scale degree) */
  label(rawName) {
    const sounding = this.transpose ? transposeName(rawName, this.transpose) : rawName;
    if (this.displayMode === 'degree') {
      // Scale degrees describe harmonic function, not finger position, so they are unaffected by the capo
      return degreeName(sounding, (this.keyRoot + this.transpose + 120) % 12);
    }
    // With a capo, display the shape you actually play—that is what you need to see while playing
    return this.capo ? transposeName(sounding, -this.capo) : sounding;
  }

  setData(data) {
    this.data = data;
    this.transpose = 0;
    this.beatIndex = -1;
    this.loopFrom = null;
    this.loopTo = null;
    this.keyRoot = data?.keyRoot ?? 0;
    this.render();
  }

  /** Time range for the loop, or null if none is selected */
  get loopRange() {
    if (this.loopFrom == null || !this.data) return null;
    const bars = this.data.bars;
    const a = Math.min(this.loopFrom, this.loopTo ?? this.loopFrom);
    const b = Math.max(this.loopFrom, this.loopTo ?? this.loopFrom);
    if (!bars[a] || !bars[b]) return null;
    return { start: bars[a].start, end: bars[b].end, fromBar: a, toBar: b };
  }

  setLoop(fromBar, toBar = null) {
    this.loopFrom = fromBar;
    this.loopTo = toBar;
    this._paintLoop();
    this.onLoopChange?.(this.loopRange);
  }

  clearLoop() {
    this.loopFrom = null;
    this.loopTo = null;
    this._paintLoop();
    this.onLoopChange?.(null);
  }

  _paintLoop() {
    const range = this.loopRange;
    this._barEls.forEach((el, i) => {
      if (!el) return;
      const inside = range && i >= range.fromBar && i <= range.toBar;
      el.classList.toggle('in-loop', !!inside);
      el.classList.toggle('loop-start', !!range && i === range.fromBar);
      el.classList.toggle('loop-end', !!range && i === range.toBar);
    });
  }

  setTranspose(semitones) {
    this.transpose = semitones;
    this.render();
    this.setBeat(this.beatIndex, true);
  }

  setAutoScroll(on) {
    this._autoScroll = on;
  }

  /** Chord name for display (transposition applied) */
  /** Chord that is actually heard (regardless of capo fret) */
  soundingAt(beatIndex) {
    const d = this.data;
    if (!d || beatIndex < 0 || beatIndex >= d.perBeat.length) return null;
    const raw = d.perBeat[beatIndex].name;
    return this.transpose ? transposeName(raw, this.transpose) : raw;
  }

  /**
   * The chord shape you actually play.
   * With a capo, to sound a D you play a C shape (capo 2), so transpose down by the capo fret.
   */
  nameAt(beatIndex) {
    const sounding = this.soundingAt(beatIndex);
    if (!sounding || !this.capo) return sounding;
    return transposeName(sounding, -this.capo);
  }

  /** Fingering to light for this beat */
  voicingAt(beatIndex) {
    const name = this.nameAt(beatIndex);
    return name ? voicing(name) : null;
  }

  /** Time → beat number */
  beatAtTime(time) {
    const beats = this.data?.beats;
    if (!beats?.length) return -1;
    let lo = 0;
    let hi = beats.length - 1;
    if (time < beats[0]) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (beats[mid] <= time) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  render() {
    const d = this.data;
    this.el.innerHTML = '';
    this._barEls = [];
    this._slotEls = [];
    if (!d) return;

    const bpb = d.beatsPerBar;

    // ---- Header
    const head = document.createElement('div');
    head.className = 'cc-head';
    const keyLabel = this.transpose
      ? `${d.key} (transpose ${this.transpose > 0 ? '+' : ''}${this.transpose})`
      : d.key;
    head.innerHTML = `
      <div class="cc-title"></div>
      <div class="cc-meta">
        <span>${Math.round(d.bpm)} BPM</span>
        <span>${escapeHtml(keyLabel)}</span>
        <span>${bpb}/4</span>
        <span>${d.bars.length} bars</span>
        ${this.capo ? `<span class="cc-capo">Capo ${this.capo} (showing the chord shapes you play)</span>` : ''}
      </div>`;
    head.querySelector('.cc-title').textContent = d.title || 'Chord Chart';
    this.el.appendChild(head);

    // ---- Chord diagrams used
    const used = [];
    const seen = new Set();
    for (const b of d.perBeat) {
      const name = this.transpose ? transposeName(b.name, this.transpose) : b.name;
      if (name && name !== 'N.C.' && !seen.has(name)) {
        seen.add(name);
        used.push(name);
      }
    }
    if (used.length) {
      const strip = document.createElement('div');
      strip.className = 'cc-diagrams';
      for (const n of used.slice(0, 16)) {
        const card = document.createElement('button');
        // Chord diagrams always show the actual chord name (a shape is a physical fingering, not a scale degree)
        card.className = `cc-dia q-${chordColorClass(n)}`;
        card.title =
          this.displayMode === 'degree'
            ? `${n} = ${degreeName(n, (this.keyRoot + this.transpose + 120) % 12)}. Click to view other positions.`
            : `View other positions for ${n}`;
        card.innerHTML = diagramSvg(n);
        card.addEventListener('click', () => this.onChordClick?.(n));
        strip.appendChild(card);
      }
      this.el.appendChild(strip);
    }

    // ---- Quick section navigation (the song's structure; useful when scanning the chart)
    const sections = d.sections ?? [];
    if (sections.length > 1) {
      const nav = document.createElement('div');
      nav.className = 'cc-sections';
      nav.innerHTML = '<span class="cc-sec-label">Sections</span>';
      for (const s of sections) {
        const bar = d.bars[s.startBar];
        if (!bar) continue;
        const b = document.createElement('button');
        b.className = 'cc-sec';
        b.innerHTML = `<b>${escapeHtml(s.label)}</b><small>Bar ${s.startBar + 1}</small>`;
        b.title = `${s.bars} bars`;
        b.addEventListener('click', () => this.onSeek?.(bar.start));
        nav.appendChild(b);
      }
      this.el.appendChild(nav);
    }

    // ---- Bar cells
    const grid = document.createElement('div');
    grid.className = 'cc-grid';
    let lastSection;

    d.bars.forEach((bar, barIdx) => {
      // Insert a full-width heading when the section changes
      if (bar.section !== lastSection) {
        lastSection = bar.section;
        if (bar.section) {
          const head = document.createElement('div');
          head.className = 'cc-sechead';
          head.textContent = `Section ${bar.section}`;
          grid.appendChild(head);
        }
      }

      const cell = document.createElement('div');
      cell.className = 'cc-bar';
      cell.dataset.bar = String(barIdx);

      const num = document.createElement('span');
      num.className = 'cc-barnum';
      num.textContent = String(barIdx + 1);
      cell.appendChild(num);

      const slots = document.createElement('div');
      slots.className = 'cc-slots';
      slots.style.gridTemplateColumns = `repeat(${bpb}, 1fr)`;

      bar.beats.forEach((raw, slotIdx) => {
        const prev = slotIdx > 0 ? bar.beats[slotIdx - 1] : null;
        const isNew = slotIdx === 0 || raw !== prev;

        const beatIndex = d.downbeat + barIdx * bpb + slotIdx;

        const slot = document.createElement('span');
        // Major chords are blue, minor chords are red; add a marker to edited chords
        slot.className =
          `cc-slot ${isNew ? 'is-new' : 'is-hold'} q-${chordColorClass(raw)}` +
          (this.edited.has(beatIndex) ? ' is-edited' : '');
        slot.textContent = isNew ? this.label(raw) : '·';
        if (this.edited.has(beatIndex)) slot.title = 'Manually edited';
        slot.addEventListener('click', (e) => {
          if (!this.editMode) return; // Outside edit mode, let the bar click handler seek to this position
          e.stopPropagation();
          this.openEditPopover(beatIndex, slot);
        });
        slots.appendChild(slot);

        this._slotEls[beatIndex] = slot;
      });

      cell.appendChild(slots);

      // Lyrics (Chinese + pinyin on two lines)
      const lyric = this.lyrics[barIdx];
      if (lyric && (lyric.text || lyric.pinyin)) {
        const wrap = document.createElement('div');
        wrap.className = 'cc-lyric';
        if (lyric.text) {
          const zh = document.createElement('span');
          zh.className = 'cc-lyric-zh';
          zh.textContent = lyric.text;
          wrap.appendChild(zh);
        }
        if (lyric.pinyin) {
          const py = document.createElement('span');
          py.className = 'cc-lyric-py';
          py.textContent = lyric.pinyin;
          wrap.appendChild(py);
        }
        cell.appendChild(wrap);
      }

      cell.addEventListener('click', (e) => {
        if (this.editMode) return; // In edit mode, the cell handles this itself
        if (e.shiftKey && this.loopFrom != null) {
          // Shift-click a second bar → set the loop end
          this.setLoop(this.loopFrom, barIdx);
          return;
        }
        if (e.altKey || (e.metaKey && !e.shiftKey)) {
          // Alt / ⌘-click → set the loop start, then Shift-click another bar to set the end
          this.setLoop(barIdx, null);
          return;
        }
        this.onSeek?.(bar.start);
      });
      grid.appendChild(cell);
      this._barEls[barIdx] = cell;
    });

    this.el.appendChild(grid);
    this._paintLoop();

    // Click outside to close the edit panel
    if (!this._outsideBound) {
      this._outsideBound = true;
      this.el.addEventListener('click', () => this.closePopover());
    }

    const note = document.createElement('p');
    note.className = 'cc-note';
    note.innerHTML = this.editMode
      ? '<b>Chord editing is on.</b> Click any chord to edit it. Consecutive matching chords are edited together by default.'
      : 'Automatically detected chords may be inaccurate. <b>Click a bar</b> to seek; ' +
        '<b>Alt or ⌘-click</b> to set the loop start, then <b>Shift-click</b> to set the end. Press <b>Loop</b> below to practice that section. ' +
        'To correct a chord, select <b>Edit Chords</b> on the left.';
    this.el.appendChild(note);
  }

  setBeat(beatIndex, force = false) {
    if (!this.data) return;
    if (beatIndex === this.beatIndex && !force) return;
    const bpb = this.data.beatsPerBar;

    const old = this._slotEls[this.beatIndex];
    if (old) old.classList.remove('is-now');
    const oldBar = this._barEls[Math.floor((this.beatIndex - this.data.downbeat) / bpb)];
    if (oldBar) oldBar.classList.remove('is-now');

    this.beatIndex = beatIndex;

    const slot = this._slotEls[beatIndex];
    if (slot) slot.classList.add('is-now');
    const barIdx = Math.floor((beatIndex - this.data.downbeat) / bpb);
    const bar = this._barEls[barIdx];
    if (bar) {
      bar.classList.add('is-now');
      if (this._autoScroll) this._scrollIntoView(bar);
    }
  }

  _scrollIntoView(el) {
    const box = this.el.parentElement;
    if (!box) return;
    const top = el.offsetTop - box.clientHeight * 0.4;
    if (Math.abs(box.scrollTop - top) > 24) {
      box.scrollTo({ top, behavior: 'smooth' });
    }
  }

  clearBeat() {
    const slot = this._slotEls[this.beatIndex];
    if (slot) slot.classList.remove('is-now');
    const bpb = this.data?.beatsPerBar ?? 4;
    const bar = this._barEls[Math.floor((this.beatIndex - (this.data?.downbeat ?? 0)) / bpb)];
    if (bar) bar.classList.remove('is-now');
    this.beatIndex = -1;
  }

  /** Export as a plain-text chord chart for pasting into handouts or messages */
  toText() {
    const d = this.data;
    if (!d) return '';
    const lines = [];
    lines.push(d.title || 'Chord Chart');
    const modeLabel = this.displayMode === 'degree' ? 'Scale Degrees' : 'Chord Names';
    lines.push(`${Math.round(d.bpm)} BPM · ${d.key}${this.transpose ? ` (transpose ${this.transpose > 0 ? '+' : ''}${this.transpose})` : ''} · ${d.beatsPerBar}/4 · ${modeLabel}`);
    lines.push('');

    // Widen the columns when lyrics are present so Chinese text fits
    const withLyrics = this.hasLyrics();
    const colWidth = withLyrics ? 22 : 14;
    const perRow = withLyrics ? 2 : 4;

    for (let i = 0; i < d.bars.length; i += perRow) {
      const row = d.bars.slice(i, i + perRow).map((bar) => {
        const parts = [];
        bar.beats.forEach((raw, k) => {
          if (k === 0 || raw !== bar.beats[k - 1]) parts.push(this.label(raw));
        });
        return padDisplay(parts.join(' '), colWidth);
      });
      lines.push(`| ${row.join('| ')}|`);

      // Keep lyrics aligned with the chords so it is clear which bar each word belongs to
      if (withLyrics) {
        const zh = [];
        const py = [];
        for (let k = 0; k < perRow; k++) {
          const l = this.lyrics[i + k] ?? {};
          zh.push(padDisplay(l.text ?? '', colWidth));
          py.push(padDisplay(l.pinyin ?? '', colWidth));
        }
        if (zh.some((s) => s.trim())) lines.push(`  ${zh.join('  ')}`);
        if (py.some((s) => s.trim())) lines.push(`  ${py.join('  ')}`);
        lines.push('');
      }
    }
    lines.push('');
    lines.push('(Automatically analyzed by LiteJam GlowTab; for reference only.)');
    return lines.join('\n');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** CJK characters take two cells in monospace fonts, so padEnd will not align them correctly */
function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  }
  return w;
}

function padDisplay(s, width) {
  const text = String(s ?? '');
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}
