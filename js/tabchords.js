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

/**
 * 可選的和弦類型（音程 = 離根音的半音數，>12 表示高八度的延伸音）。
 * 13 和弦照慣例省略 11 音。
 */
const T = (id, intervals) => ({ id, intervals });
export const CHORD_TYPES = [
  T('Major', [0, 4, 7]),
  T('Minor', [0, 3, 7]),
  T('7', [0, 4, 7, 10]),
  T('5', [0, 7]),
  T('dim', [0, 3, 6]),
  T('dim7', [0, 3, 6, 9]),
  T('aug', [0, 4, 8]),
  T('sus2', [0, 2, 7]),
  T('sus4', [0, 5, 7]),
  T('maj7', [0, 4, 7, 11]),
  T('m7', [0, 3, 7, 10]),
  T('7sus4', [0, 5, 7, 10]),
  T('maj9', [0, 4, 7, 11, 14]),
  T('maj11', [0, 4, 7, 11, 14, 17]),
  T('maj13', [0, 4, 7, 11, 14, 21]),
  T('maj9#11', [0, 4, 7, 11, 14, 18]),
  T('maj13#11', [0, 4, 7, 11, 14, 18, 21]),
  T('add9', [0, 4, 7, 14]),
  T('6add9', [0, 4, 7, 9, 14]),
  T('maj7b5', [0, 4, 6, 11]),
  T('maj7#5', [0, 4, 8, 11]),
  T('m6', [0, 3, 7, 9]),
  T('m9', [0, 3, 7, 10, 14]),
  T('m11', [0, 3, 7, 10, 14, 17]),
  T('m13', [0, 3, 7, 10, 14, 21]),
  T('madd9', [0, 3, 7, 14]),
  T('m6add9', [0, 3, 7, 9, 14]),
  T('mmaj7', [0, 3, 7, 11]),
  T('mmaj9', [0, 3, 7, 11, 14]),
  T('m7b5', [0, 3, 6, 10]),
  T('m7#5', [0, 3, 8, 10]),
  T('6', [0, 4, 7, 9]),
  T('9', [0, 4, 7, 10, 14]),
  T('11', [0, 4, 7, 10, 14, 17]),
  T('13', [0, 4, 7, 10, 14, 21]),
  T('7b5', [0, 4, 6, 10]),
  T('7#5', [0, 4, 8, 10]),
  T('7b9', [0, 4, 7, 10, 13]),
  T('7#9', [0, 4, 7, 10, 15]),
  T('7(b5,b9)', [0, 4, 6, 10, 13]),
  T('7(b5,#9)', [0, 4, 6, 10, 15]),
  T('7(#5,b9)', [0, 4, 8, 10, 13]),
  T('7(#5,#9)', [0, 4, 8, 10, 15]),
  T('9b5', [0, 4, 6, 10, 14]),
  T('9#5', [0, 4, 8, 10, 14]),
  T('13#11', [0, 4, 7, 10, 14, 18, 21]),
  T('13b9', [0, 4, 7, 10, 13, 21]),
  T('11b9', [0, 4, 7, 10, 13, 17]),
  T('sus2sus4', [0, 2, 5, 7]),
  T('-5', [0, 4, 6]),
];
const TYPE_BY_ID = new Map(CHORD_TYPES.map((t) => [t.id, t]));

export function chordTypeIntervals(id) {
  return TYPE_BY_ID.get(id)?.intervals ?? null;
}

/**
 * In add-on mode keep the tab chord's triad and add only extension tones not
 * already present in that triad. The note limit controls how many extra tones
 * fit beyond the retained base triad. Full mode instead uses the selected
 * chord type exactly as before.
 */
export function tabChordIntervals(baseQuality, extension, fullExtension, noteLimit = 5) {
  const base = QUALITY_DEGREES[baseQuality] ?? QUALITY_DEGREES.maj;
  if (!extension) return [...base];
  if (fullExtension) return [...extension];

  const triad = base.slice(0, 3);
  const basePcs = new Set(triad.map((n) => n % 12));
  const seen = new Set(basePcs);
  const extras = [];
  for (const interval of extension) {
    const pc = ((interval % 12) + 12) % 12;
    if (seen.has(pc)) continue;
    seen.add(pc);
    extras.push(pc);
  }

  const degreeRank = (pc) => {
    if (pc === 10 || pc === 11) return 0; // seventh
    if ([1, 2, 3].includes(pc)) return 1; // altered or natural ninth
    if (pc === 5 || pc === 6) return 2; // eleventh
    if ([8, 9].includes(pc)) return 3; // thirteenth / sixth
    return 4;
  };
  extras.sort((a, b) => degreeRank(a) - degreeRank(b));
  const additionalCount = Math.max(0, noteLimit - triad.length);
  return [...triad, ...extras.slice(0, additionalCount)];
}

/** 音域有限時優先保留根音、三度／掛留音和擴展張力，五度（7）最先省略 */
function toneRank(interval, hasThird) {
  switch (interval) {
    case 0: return 0;
    case 3: case 4: return 1;
    case 2: case 5: return hasThird ? 5 : 1; // 沒有三度時 sus 音就是和弦特徵
    case 6: case 8: return 2;
    case 13: case 15: case 18: return 2.2;
    case 21: return 2.2;
    case 14: case 17: return 2.4;
    case 9: return 2.6;
    case 10: case 11: return 3;
    case 7: return 9;
    default: return 6;
  }
}

/** 挑出最多 count 個音，優先保留根音、三度／掛留音和選定的延伸音 */
export function pickTones(intervals, count) {
  if (intervals.length <= count) return [...intervals];
  const hasThird = intervals.some((i) => i === 3 || i === 4);
  return [...intervals]
    .sort((a, b) => toneRank(a, hasThird) - toneRank(b, hasThird) || a - b)
    .slice(0, count)
    .sort((a, b) => a - b);
}

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
 * @param {string|number[]} quality 辨識出的種類（如 'maj'）或音程陣列
 * @param {number[]} tuning 第1弦→第6弦的 MIDI
 * @param {number} limit 最多幾個（1–5）
 * @param {{notes?:number, maxFret?:number}} opts notes = 每個指型幾條弦（3–5）；
 *   和弦音比弦少時重複音（例如加倍根音），比弦多時依重要性省略（先省五度）
 * @returns {Array<{inversion:number,label:string,bass:number,frets:Array<number|null>,notes:Array<{string:number,fret:number}>}>}
 */
export function inversionVoicings(root, quality, tuning, limit = 5, opts = {}) {
  const maxFret = opts.maxFret ?? 12;
  const degrees = Array.isArray(quality) ? quality : QUALITY_DEGREES[quality] ?? QUALITY_DEGREES.maj;
  const chosen = opts.notes ? pickTones(degrees, opts.notes) : pickTones(degrees, 5);
  const tones = chosen.map((d) => (root + d) % 12);
  const size = opts.notes ? Math.min(6, Math.max(opts.notes, 2)) : tones.length;
  // 音靠得很近的和弦（如 madd9）在標準指距內可能湊不出來，就逐步放寬指距
  let pool = [];
  for (let span = size >= 5 ? 4 : 3; span <= 6 && !pool.length; span++) {
    pool = allShapes(tones, tuning, maxFret, size, span);
  }
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
function allShapes(tones, tuning, maxFret, size, maxSpan) {
  const toneSet = new Set(tones);
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
        if (hi - lo > maxSpan) return;
        // 開放弦只在低把位才算同一個把位，免得高把位混進開放弦
        if (used.includes(0) && hi > maxSpan + 1) return;
        const bassPc = (tuning[low - 1] + frets[low - 1]) % 12;
        out.push({
          inv: tones.indexOf(bassPc),
          lowString: low,
          frets: frets.slice(),
          minFret: lo,
          // 重複的音（和弦音比弦少時）稍微扣分，讓不重複的指型優先
          cost: (hi - lo) * 2 - used.filter((f) => f === 0).length * 0.3 + (size - pcs.size) * 0.5,
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
