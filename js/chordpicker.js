// Chord picker: choose a chord to see its voicings at each position on the right.
//
// Click any voicing to light it up on the guitar and the on-screen fretboard.
// Use "My Chord Progression" below to arrange selected chords; it is saved in the browser and persists between visits.

import { allVoicings, chordColorClass, diagramSvg, parseChord } from './chords.js';

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROOT_FLATS = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' };

const QUALITIES = [
  { suffix: '', label: 'Major' },
  { suffix: 'm', label: 'Minor' },
  { suffix: '7', label: '7' },
  { suffix: 'm7', label: 'm7' },
  { suffix: 'maj7', label: 'maj7' },
  { suffix: 'sus4', label: 'sus4' },
  { suffix: 'sus2', label: 'sus2' },
  { suffix: 'dim', label: 'dim' },
  { suffix: 'aug', label: 'aug' },
  { suffix: '5', label: 'Power Chord' },
];

const STORE_KEY = 'litejam-progression';

export class ChordPicker {
  /**
   * @param {HTMLElement} container
   * @param {{onPick?: (voicing:Object|null)=>void, onToast?: (msg:string)=>void}} opts
   */
  constructor(container, { onPick, onToast } = {}) {
    this.el = container;
    this.onPick = onPick;
    this.onToast = onToast;

    this.root = 'C';
    this.suffix = '';
    this.positions = [];
    this.selected = 0;
    this.progression = this._load();

    this._build();
    this.update();
  }

  get chordName() {
    return this.root + this.suffix;
  }

  /** Set which chord to display from outside, for example when selected from a chord chart. */
  select(name) {
    const parsed = parseChord(name);
    if (!parsed) return false;
    this.root = ROOTS[parsed.root];
    // Only accept chord types supported by the picker; fall back to a major triad for others (such as inversions).
    this.suffix = QUALITIES.some((q) => q.suffix === parsed.suffix) ? parsed.suffix : '';
    this.update();
    return true;
  }

  _load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
      return Array.isArray(raw) ? raw.filter((c) => c?.name && Array.isArray(c.frets)) : [];
    } catch {
      return [];
    }
  }

  _save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.progression));
    } catch {
      /* Private browsing may prevent saving; this does not affect operation. */
    }
  }

  // ------------------------------------------------------------ Build the structure

  _build() {
    this.el.innerHTML = `
      <div class="pk-picker">
        <div class="pk-row">
          <span class="pk-label">Root</span>
          <div class="pk-roots"></div>
        </div>
        <div class="pk-row">
          <span class="pk-label">Quality</span>
          <div class="pk-quals"></div>
        </div>
      </div>

      <div class="pk-current">
        <h2 class="pk-name"></h2>
        <div class="pk-actions">
          <button class="btn btn-sm pk-add">＋ Add to Progression</button>
          <button class="btn btn-sm pk-off">Turn Off</button>
        </div>
      </div>

      <div class="pk-positions"></div>

      <div class="pk-prog">
        <div class="pk-prog-head">
          <h3>My Chord Progression</h3>
          <div class="row gap">
            <button class="btn btn-sm pk-export">Export Text</button>
            <button class="btn btn-sm pk-clear">Clear</button>
          </div>
        </div>
        <div class="pk-prog-list"></div>
      </div>`;

    this.rootsEl = this.el.querySelector('.pk-roots');
    this.qualsEl = this.el.querySelector('.pk-quals');
    this.nameEl = this.el.querySelector('.pk-name');
    this.posEl = this.el.querySelector('.pk-positions');
    this.progEl = this.el.querySelector('.pk-prog-list');

    ROOTS.forEach((r) => {
      const b = document.createElement('button');
      b.className = 'pk-chip';
      b.dataset.root = r;
      b.innerHTML = ROOT_FLATS[r]
        ? `${r}<small>${ROOT_FLATS[r]}</small>`
        : r;
      b.addEventListener('click', () => {
        this.root = r;
        this.update();
      });
      this.rootsEl.appendChild(b);
    });

    QUALITIES.forEach((q) => {
      const b = document.createElement('button');
      b.className = 'pk-chip pk-chip-wide';
      b.dataset.suffix = q.suffix;
      b.textContent = q.label;
      b.addEventListener('click', () => {
        this.suffix = q.suffix;
        this.update();
      });
      this.qualsEl.appendChild(b);
    });

    this.el.querySelector('.pk-add').addEventListener('click', () => this.addCurrent());
    this.el.querySelector('.pk-off').addEventListener('click', () => this.onPick?.(null));
    this.el.querySelector('.pk-clear').addEventListener('click', () => {
      if (!this.progression.length) return;
      this.progression = [];
      this._save();
      this._renderProgression();
      this.onToast?.('Cleared.');
    });
    this.el.querySelector('.pk-export').addEventListener('click', () => this.exportText());
  }

  // ------------------------------------------------------------ Update the display

  update() {
    for (const b of this.rootsEl.children) {
      b.classList.toggle('on', b.dataset.root === this.root);
    }
    for (const b of this.qualsEl.children) {
      b.classList.toggle('on', b.dataset.suffix === this.suffix);
    }

    this.nameEl.textContent = this.chordName;
    this.nameEl.className = `pk-name q-${chordColorClass(this.chordName)}`;
    this.positions = allVoicings(this.chordName);
    this.selected = 0;

    this._renderPositions();
    this._renderProgression();
    this._emitSelected();
  }

  _renderPositions() {
    this.posEl.innerHTML = '';
    if (!this.positions.length) {
      this.posEl.innerHTML = '<p class="muted small">No playable six-string voicings found for this chord.</p>';
      return;
    }

    this.positions.forEach((v, i) => {
      const card = document.createElement('button');
      card.className = 'pk-pos' + (i === this.selected ? ' on' : '');
      card.innerHTML = `
        ${diagramSvg({ name: this.chordName, frets: v.frets }, { width: 88, frets: 5 })}
        <span class="pk-pos-label">${v.label}</span>
        <span class="pk-pos-meta">${v.fingers ? `${v.fingers} fingers` : 'Open'} · ${
          v.frets.filter((f) => f !== null).length
        } strings</span>`;
      card.addEventListener('click', () => {
        this.selected = i;
        this._renderPositions();
        this._emitSelected();
      });
      this.posEl.appendChild(card);
    });
  }

  _renderProgression() {
    this.progEl.innerHTML = '';
    if (!this.progression.length) {
      this.progEl.innerHTML = '<p class="muted small">Select “＋ Add to Progression” above to add chords here.</p>';
      return;
    }

    this.progression.forEach((c, i) => {
      const card = document.createElement('div');
      card.className = 'pk-prog-item';
      card.innerHTML = `
        <button class="pk-prog-pick" title="Light on guitar">
          ${diagramSvg({ name: c.name, frets: c.frets }, { width: 72, frets: 5 })}
        </button>
        <button class="pk-prog-del" title="Remove">✕</button>
        <span class="pk-prog-num">${i + 1}</span>`;

      card.querySelector('.pk-prog-pick').addEventListener('click', () => {
        this.onPick?.({ name: c.name, frets: c.frets, notes: fretsToNotes(c.frets) });
      });
      card.querySelector('.pk-prog-del').addEventListener('click', () => {
        this.progression.splice(i, 1);
        this._save();
        this._renderProgression();
      });

      this.progEl.appendChild(card);
    });
  }

  _emitSelected() {
    const v = this.positions[this.selected];
    this.onPick?.(v ?? null);
  }

  addCurrent() {
    const v = this.positions[this.selected];
    if (!v) return;
    this.progression.push({ name: this.chordName, frets: v.frets });
    this._save();
    this._renderProgression();
    this.onToast?.(`Added ${this.chordName}.`);
  }

  exportText() {
    if (!this.progression.length) return this.onToast?.('The progression is empty.');

    const lines = ['My Chord Progression', ''];
    lines.push(this.progression.map((c) => c.name).join(' → '));
    lines.push('');
    for (const c of this.progression) {
      const tab = c.frets
        .slice()
        .reverse() // Tablature convention lists strings from string 6 to string 1.
        .map((f) => (f === null ? 'x' : String(f)))
        .join('-');
      lines.push(`${c.name.padEnd(7)} ${tab}   (leftmost number is the 6th string)`);
    }
    lines.push('');
    lines.push('(Generated by LiteJam GlowTab)');

    const text = lines.join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'my-chord-progression.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    this.onToast?.('Text file exported.');
  }
}

function fretsToNotes(frets) {
  return frets.map((f, i) => (f === null ? null : { string: i + 1, fret: f })).filter(Boolean);
}
