// 從目前載入的指法譜（tab）分析和弦，並產生各轉位的指型。
// 純運算、不碰 DOM，方便測試。string 編號用吉他慣例：1 = 細弦。

import { QUALITY_DEGREES, chordName } from './chords.js';

const NAMES = {
  root: 'Root position',
  1: '1st inversion',
  2: '2nd inversion',
  3: '3rd inversion',
  4: '4th inversion',
};

/** 各轉位指型的顏色（依沿琴頸由低到高的順序），與被共用的音（粉紅） */
export const VARIANT_COLORS = [
  { name: 'light green', hex: '#8ff7a0', text: '#04210f' },
  { name: 'light orange', hex: '#ffc58a', text: '#2b1500' },
  { name: 'white', hex: '#ffffff', text: '#111111' },
  { name: 'purple', hex: '#8a3fd1', text: '#ffffff' },
  { name: 'scarlet', hex: '#ff2a1a', text: '#ffffff' },
];
export const SHARED_COLOR = { name: 'pink', hex: '#ff6ec7', text: '#2b0020' };

// 辨識用的和弦種類；越前面越優先（分數相同時）
const QUALITIES = ['maj', 'min', '7', 'm7', 'maj7', 'sus4', 'sus2', 'dim', 'aug', '5'];

/**
 * 一組音（pitch class → 權重）找最像的和弦。
 * @param {Map<number, number>} weights
 * @param {number|null} bassPc 最低音，用來加分「根音在低音」
 * @returns {{root:number, quality:string, name:string, score:number}|null}
 */
export function detectChord(weights, bassPc = null) {
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  if (weights.size < 2 || total <= 0) return null;

  let best = null;
  for (let root = 0; root < 12; root++) {
    for (const quality of QUALITIES) {
      const tones = QUALITY_DEGREES[quality].map((d) => (root + d) % 12);
      const set = new Set(tones);
      let hit = 0;
      for (const [pc, w] of weights) if (set.has(pc)) hit += w;
      const covered = tones.filter((t) => weights.has(t)).length;
      // 缺根音或缺三度/五度的扣分；多出來的外音由 hit/total 扣掉
      if (!weights.has(root)) continue;
      const score =
        (hit / total) * 0.6 +
        (covered / tones.length) * 0.35 +
        (bassPc === root ? 0.05 : 0) -
        (QUALITIES.indexOf(quality) * 0.001);
      if (!best || score > best.score) best = { root, quality, score };
    }
  }
  if (!best || best.score < 0.7) return null;
  return { ...best, name: chordName(best.root, best.quality) };
}

/**
 * 掃描一個音軌，回傳依時間排序的和弦段落。
 * 一小節一個和弦；如果整小節湊不出和弦，就對半切再試一次。
 * @param {object} track alphaTab Track
 * @returns {Array<{start:number,end:number,bar:number,name:string,root:number,quality:string}>}
 */
export function analyzeTrack(track) {
  const segments = [];
  const staff = track?.staves?.[0];
  const bars = staff?.bars ?? [];

  for (const bar of bars) {
    const mb = bar.masterBar;
    if (!mb) continue;
    const start = mb.start;
    const end = start + mb.calculateDuration();
    const events = [];
    for (const voice of bar.voices ?? []) {
      if (voice.isEmpty) continue;
      for (const beat of voice.beats ?? []) {
        const notes = (beat.notes ?? []).filter((n) => !n.isTieDestination && !n.isDead);
        if (!notes.length) continue;
        const dur = Math.max(1, beat.playbackDuration ?? 1);
        events.push({
          at: beat.absolutePlaybackStart,
          dur,
          pitches: notes.map((n) => n.realValueWithoutHarmonic ?? n.realValue),
        });
      }
    }
    if (!events.length) continue;

    const whole = detectInWindow(events, start, end);
    if (whole) {
      segments.push({ start, end, bar: bar.index, ...whole });
      continue;
    }
    const mid = Math.floor((start + end) / 2);
    for (const [a, b] of [[start, mid], [mid, end]]) {
      const half = detectInWindow(events, a, b);
      if (half) segments.push({ start: a, end: b, bar: bar.index, ...half });
    }
  }

  // 相鄰且同名的段落合併，播放時畫面不會一直閃
  const merged = [];
  for (const s of segments) {
    const prev = merged[merged.length - 1];
    if (prev && prev.name === s.name && prev.end === s.start) prev.end = s.end;
    else merged.push({ ...s });
  }
  return merged;
}

function detectInWindow(events, from, to) {
  const weights = new Map();
  let lowest = Infinity;
  for (const e of events) {
    if (e.at < from || e.at >= to) continue;
    for (const p of e.pitches) {
      const pc = ((p % 12) + 12) % 12;
      weights.set(pc, (weights.get(pc) ?? 0) + e.dur);
      lowest = Math.min(lowest, p);
    }
  }
  if (!weights.size) return null;
  const found = detectChord(weights, Number.isFinite(lowest) ? ((lowest % 12) + 12) % 12 : null);
  return found ? { name: found.name, root: found.root, quality: found.quality } : null;
}

/** 目前播放位置（tick）落在哪個和弦段落 */
export function segmentAt(segments, tick) {
  return segments.find((s) => tick >= s.start && tick < s.end) ?? null;
}

/**
 * 產生這個和弦的各轉位指型。
 * 指型沿著琴頸（前 12 格內）由低把位往高把位排開，盡量輪流用不同轉位、
 * 不同的最低弦（根音可在任何一條弦）。顏色綠／橘交替，相鄰指型不會同色。
 * @param {number} root pitch class
 * @param {string} quality
 * @param {number[]} tuning 第1弦→第6弦的 MIDI
 * @param {number} limit 最多幾個（1–5）
 * @returns {Array<{inversion:number,label:string,bass:number,frets:Array<number|null>,notes:Array<{string:number,fret:number}>}>}
 */
export function inversionVoicings(root, quality, tuning, limit = 5, maxFret = 12) {
  const degrees = QUALITY_DEGREES[quality] ?? QUALITY_DEGREES.maj;
  const tones = degrees.map((d) => (root + d) % 12);
  const pool = allShapes(tones, tuning, maxFret);
  if (!pool.length) return [];

  const out = [];
  const taken = new Set(); // 已被前面指型佔用的 string:fret
  const usedInv = new Set();
  const usedSets = new Set();
  let prevMin = -1;
  const span = Math.max(0, maxFret - 3);
  const key = (s, f) => `${s}:${f}`;

  for (let i = 0; i < limit; i++) {
    // 目標把位沿著琴頸由低到高均勻分佈（0 … maxFret-3）
    const target = limit === 1 ? 0 : (i * span) / (limit - 1);
    let best = null;
    for (const c of pool) {
      if (c.minFret < prevMin || out.some((o) => o.frets.join() === c.frets.join())) continue;
      const overlap = c.frets.reduce((n, f, k) => n + (f !== null && taken.has(key(k + 1, f)) ? 1 : 0), 0);
      const cost =
        Math.abs(c.minFret - target) +
        overlap * 2.5 +
        (usedInv.has(c.inv) ? 1.5 : 0) +
        (usedSets.has(c.lowString) ? 1.2 : 0) +
        c.cost * 0.1;
      if (!best || cost < best.cost2) best = { ...c, cost2: cost };
    }
    if (!best) break;
    usedInv.add(best.inv);
    usedSets.add(best.lowString);
    prevMin = best.minFret;
    best.frets.forEach((f, k) => f !== null && taken.add(key(k + 1, f)));
    out.push({
      inversion: best.inv,
      label: NAMES[best.inv === 0 ? 'root' : best.inv] ?? `${best.inv}th inversion`,
      bass: best.lowString,
      color: VARIANT_COLORS[i % VARIANT_COLORS.length],
      frets: best.frets,
      notes: best.frets.map((f, k) => (f === null ? null : { string: k + 1, fret: f })).filter(Boolean),
    });
  }

  // 同一個位置被兩個以上的指型共用 → 該音一律標成粉紅色
  const count = new Map();
  for (const v of out) for (const n of v.notes) count.set(key(n.string, n.fret), (count.get(key(n.string, n.fret)) ?? 0) + 1);
  for (const v of out) for (const n of v.notes) n.shared = count.get(key(n.string, n.fret)) > 1;
  return out;
}

/**
 * 列出所有緊湊指型：相鄰 2／3／4 條弦（五度和弦 2 條、三和弦 3 條、七和弦 4 條），
 * 湊齊全部和弦音、手指跨度 ≤ 3 格、全在 maxFret 之內。
 * 最低弦的音決定是第幾轉位，所以根音可以落在六條弦的任何一條。
 */
function allShapes(tones, tuning, maxFret) {
  const toneSet = new Set(tones);
  const size = tones.length;
  const out = [];
  for (let low = 6; low - size + 1 >= 1; low--) {
    const strings = [];
    for (let s = low; s > low - size; s--) strings.push(s);
    const options = strings.map((s) => {
      const list = [];
      for (let f = 0; f <= maxFret; f++) if (toneSet.has((tuning[s - 1] + f) % 12)) list.push(f);
      return list;
    });
    const frets = new Array(6).fill(null);
    const walk = (i) => {
      if (i === strings.length) {
        const used = strings.map((s) => frets[s - 1]);
        const pcs = new Set(strings.map((s) => (tuning[s - 1] + frets[s - 1]) % 12));
        if (pcs.size < toneSet.size) return;
        const fretted = used.filter((f) => f > 0);
        const lo = fretted.length ? Math.min(...fretted) : 0;
        const hi = fretted.length ? Math.max(...fretted) : 0;
        if (hi - lo > 3) return;
        // 開放弦只在低把位才算同一個把位，免得高把位混進開放弦
        if (used.includes(0) && hi > 4) return;
        const bassPc = (tuning[low - 1] + frets[low - 1]) % 12;
        out.push({
          inv: tones.indexOf(bassPc),
          lowString: low,
          frets: frets.slice(),
          minFret: lo,
          cost: (hi - lo) * 2 - used.filter((f) => f === 0).length * 0.3,
        });
        return;
      }
      const s = strings[i];
      for (const f of options[i]) {
        frets[s - 1] = f;
        walk(i + 1);
      }
      frets[s - 1] = null;
    };
    walk(0);
  }
  return out;
}
