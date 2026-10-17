#!/usr/bin/env python3
"""Audio file → chord chart.

Pipeline:
  ffmpeg decoding → semitone spectrum (with harmonic summation) → chroma
  → rhythm detection (spectral flux + autocorrelation + dynamic-programming beat tracking)
  → score chord templates against each beat's chroma → Viterbi smoothing → split into bars

Depends only on numpy and the system's ffmpeg.
"""

import json
import subprocess
import sys
import warnings

import numpy as np

# macOS Accelerate BLAS can make numpy matmul emit false divide-by-zero / overflow warnings
# (inputs and outputs are all finite, as verified in testing); disable them here to keep stdout JSON clean.
warnings.filterwarnings('ignore', category=RuntimeWarning)
np.seterr(all='ignore')

SR = 11025
N_FFT = 4096
HOP = 512
FPS = SR / HOP  # Analysis frames per second ≈ 21.5

MIDI_LO = 36  # C2
MIDI_HI = 95  # B6
N_NOTES = MIDI_HI - MIDI_LO + 1

BASS_LO = 36  # Bass range starts at C2
BASS_HI = 55  # G3

# Harmonic summation: the h-th harmonic lies 12*log2(h) semitones above the fundamental
HARMONICS = [(0, 1.0), (12, 0.5), (19, 0.33), (24, 0.25), (28, 0.18), (31, 0.12)]

PITCH_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
PITCH_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

# Chord templates.
#
# The biggest challenge with triads is sustain from the previous chord: an E lingering
# from Am over F can make F sound like Fmaj7.
# A fixed penalty is not enough to distinguish them (reverb at 0.09 vs a true seventh
# chord at 0.16 is too close, and varies by recording), so instead compare the
# **strength of extension tones relative to the triad itself**:
#   In a true seventh chord, the seventh is about as strong as the triad (ratio ≈ 1.2).
#   A lingering note from reverb is noticeably weaker (ratio ≈ 0.8).
# If the ratio is below EXT_RATIO_MIN, subtract a linear penalty proportional to the gap;
# see score_chords().
QUALITIES = [
    # (name, suffix, {pitch class: weight}, base penalty, triad pitch classes, extension pitch classes)
    ('maj', '', {0: 1.0, 4: 0.9, 7: 0.8}, 0.000, [0, 4, 7], None),
    ('min', 'm', {0: 1.0, 3: 0.9, 7: 0.8}, 0.000, [0, 3, 7], None),
    ('7', '7', {0: 1.0, 4: 0.85, 7: 0.7, 10: 0.8}, 0.030, [0, 4, 7], 10),
    ('m7', 'm7', {0: 1.0, 3: 0.85, 7: 0.7, 10: 0.8}, 0.030, [0, 3, 7], 10),
    ('maj7', 'maj7', {0: 1.0, 4: 0.85, 7: 0.7, 11: 0.8}, 0.045, [0, 4, 7], 11),
    ('sus4', 'sus4', {0: 1.0, 5: 0.9, 7: 0.85}, 0.050, [0, 7], 5),
    ('dim', 'dim', {0: 1.0, 3: 0.9, 6: 0.9}, 0.070, [0, 3], 6),
    ('aug', 'aug', {0: 1.0, 4: 0.9, 8: 0.9}, 0.100, [0, 4], 8),
]

EXT_RATIO_MIN = 1.0   # Penalize extension/triad strength ratios below this threshold
EXT_RATIO_COST = 0.35  # Penalty per 1.0 of ratio difference

# Krumhansl–Schmuckler key profiles, used to determine major/minor and sharp/flat spelling
KEY_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KEY_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# These keys conventionally use flats
FLAT_KEYS = {'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'd', 'g', 'c', 'f', 'bb', 'eb'}


# ---------------------------------------------------------------- Decoding

def decode(path, sr=SR):
    """Decode to mono float32 with ffmpeg."""
    cmd = [
        'ffmpeg', '-v', 'error', '-i', str(path),
        '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-',
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f'ffmpeg decoding failed: {proc.stderr.decode("utf-8", "replace")[:400]}')
    x = np.frombuffer(proc.stdout, dtype=np.float32).astype(np.float64)
    if x.size < sr:
        raise RuntimeError('The audio file is too short or contains no sound.')
    peak = np.abs(x).max()
    if peak > 0:
        x = x / peak
    return x


# ---------------------------------------------------------------- Spectrum

def semitone_filterbank(sr=SR, n_fft=N_FFT):
    """Semitone triangular filter bank: (number of pitches × frequency bins)."""
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
    freqs[0] = 1e-6
    bin_midi = 69 + 12 * np.log2(freqs / 440.0)
    fb = np.zeros((N_NOTES, freqs.size))
    for i in range(N_NOTES):
        center = MIDI_LO + i
        d = np.abs(bin_midi - center)
        w = np.clip(1.0 - d, 0.0, 1.0)  # Triangular window of ±1 semitone
        s = w.sum()
        if s > 0:
            fb[i] = w / s
    return fb


def note_spectrogram(x, sr=SR, n_fft=N_FFT, hop=HOP):
    """Semitone spectrum (log-compressed). Return (number of pitches × frames)."""
    fb = semitone_filterbank(sr, n_fft)
    win = np.hanning(n_fft)
    n_frames = 1 + max(0, (x.size - n_fft) // hop)
    if n_frames < 8:
        raise RuntimeError('The audio file is too short to analyze.')

    out = np.zeros((N_NOTES, n_frames))
    block = 256  # Frames to process at once; limits memory use
    for start in range(0, n_frames, block):
        stop = min(start + block, n_frames)
        idx = np.arange(n_fft)[None, :] + hop * np.arange(start, stop)[:, None]
        frames = x[idx] * win
        mag = np.abs(np.fft.rfft(frames, axis=1))
        out[:, start:stop] = (fb @ mag.T)

    return np.log1p(200.0 * out)


def harmonic_sum(P):
    """Fold harmonic energy back to the fundamental, making root notes much clearer."""
    out = np.zeros_like(P)
    for offset, weight in HARMONICS:
        if offset == 0:
            out += weight * P
        elif offset < N_NOTES:
            out[: N_NOTES - offset] += weight * P[offset:]
    return out


def whiten(P, octaves=1.0):
    """Subtract the mean of neighboring bands to suppress broadband energy from drums, vocal breaths, and similar sounds."""
    k = max(3, int(round(12 * octaves)))
    kernel = np.ones(k) / k
    local = np.apply_along_axis(lambda c: np.convolve(c, kernel, mode='same'), 0, P)
    return np.maximum(P - local, 0.0)


def chroma_from_notes(P, lo=MIDI_LO, hi=MIDI_HI):
    """Fold the semitone spectrum into 12-dimensional chroma."""
    C = np.zeros((12, P.shape[1]))
    for i in range(N_NOTES):
        midi = MIDI_LO + i
        if lo <= midi <= hi:
            C[midi % 12] += P[i]
    norm = np.linalg.norm(C, axis=0)
    norm[norm < 1e-9] = 1.0
    return C / norm


# ---------------------------------------------------------------- Rhythm

def onset_envelope(P):
    """Spectral flux: points where energy jumps are note onsets."""
    D = np.diff(P, axis=1)
    env = np.maximum(D, 0.0).sum(axis=0)
    env = np.concatenate([[0.0], env])
    # Smooth slightly to remove spikes
    kernel = np.hanning(5)
    kernel /= kernel.sum()
    env = np.convolve(env, kernel, mode='same')
    if env.max() > 0:
        env = env / env.max()
    return env


def estimate_period(env, bpm_min=55.0, bpm_max=200.0, bpm_center=115.0, prior_width=0.6):
    """Autocorrelation + log-normal prior → analysis frames per beat."""
    e = env - env.mean()
    ac = np.correlate(e, e, mode='full')[e.size - 1:]
    ac[0] = 0.0
    if ac.max() > 0:
        ac = ac / ac.max()

    lag_min = max(2, int(round(60.0 * FPS / bpm_max)))
    lag_max = min(ac.size - 1, int(round(60.0 * FPS / bpm_min)))
    if lag_max <= lag_min:
        return 60.0 * FPS / bpm_center, bpm_center

    def prior_of(bpm):
        return np.exp(-0.5 * (np.log2(bpm / bpm_center) / prior_width) ** 2)

    lags = np.arange(lag_min, lag_max + 1)
    bpms = 60.0 * FPS / lags
    score = ac[lag_min:lag_max + 1] * prior_of(bpms)

    # Include integer-multiple beat candidates: the true beat period may also peak at 2, 3, or 4 times the period
    for mult in (2, 3, 4):
        idx = lags * mult
        ok = idx < ac.size
        score[ok] += 0.5 / mult * ac[idx[ok]]

    best = int(lags[int(np.argmax(score))])

    # Resolve octave ambiguity: half-time or double-time estimates are common, so compare ×½ and ×2
    def strength(lag):
        if lag < lag_min or lag > lag_max:
            return -1.0
        return float(ac[int(round(lag))] * prior_of(60.0 * FPS / lag))

    for cand in (best / 2.0, best * 2.0):
        if strength(cand) > strength(best) * 1.15:
            best = int(round(cand))

    return float(best), float(60.0 * FPS / best)


def track_beats(env, period, tightness=100.0):
    """Ellis's dynamic-programming beat tracker."""
    n = env.size
    local = env.copy()
    # Use a local mean as the baseline to avoid effects from song-wide volume changes
    k = max(3, int(round(period * 2)))
    kernel = np.ones(k) / k
    local = np.maximum(local - np.convolve(local, kernel, mode='same'), 0.0)
    if local.max() > 0:
        local = local / local.max()

    period = max(2.0, period)
    win_lo = int(round(period * 0.5))
    win_hi = int(round(period * 2.0))

    cum = np.full(n, -np.inf)
    link = np.full(n, -1, dtype=int)
    cum[0] = local[0]

    for i in range(1, n):
        lo = max(0, i - win_hi)
        hi = i - win_lo
        if hi < lo:
            cum[i] = local[i]
            link[i] = -1
            continue
        js = np.arange(lo, hi + 1)
        penalty = -tightness * (np.log(np.maximum(i - js, 1) / period) ** 2)
        cand = cum[js] + penalty
        b = int(np.argmax(cand))
        cum[i] = local[i] + cand[b]
        link[i] = js[b]

    # Backtrack from the highest-scoring point at the end
    tail_start = max(0, n - int(round(period * 2)))
    end = tail_start + int(np.argmax(cum[tail_start:]))
    beats = []
    i = end
    while i >= 0:
        beats.append(i)
        i = link[i]
    beats.reverse()

    if len(beats) < 4:
        # Fall back to evenly spaced beats if tracking fails
        beats = list(range(0, n, max(2, int(round(period)))))
    return np.array(beats, dtype=int)


# ---------------------------------------------------------------- Chords

def build_templates(simplify=False):
    """Return (templates, roots, quality names, base penalties, triad masks, extension masks).

    When simplify=True, do not create templates for extended chords. Excluding them
    with a very large penalty is incorrect: scores are z-normalized later, and those
    extreme negative values would compress the meaningful differences.
    """
    roots, quals, vecs, penalties = [], [], [], []
    tri_sel, ext_sel, mem_sel = [], [], []
    for root in range(12):
        for qual, _suffix, degrees, penalty, triad, ext in QUALITIES:
            if simplify and ext is not None:
                continue
            v = np.zeros(12)
            for deg, w in degrees.items():
                v[(root + deg) % 12] = w
            v /= np.linalg.norm(v)

            t = np.zeros(12)
            for deg in triad:
                t[(root + deg) % 12] = 1.0 / len(triad)
            e = np.zeros(12)
            if ext is not None:
                e[(root + ext) % 12] = 1.0

            # All chord tones (used to check whether the bass is a chord tone)
            m = np.zeros(12)
            for deg in degrees:
                m[(root + deg) % 12] = 1.0
            mem_sel.append(m)

            roots.append(root)
            quals.append(qual)
            vecs.append(v)
            tri_sel.append(t)
            ext_sel.append(e)
            penalties.append(penalty)
    return (np.array(vecs), np.array(roots), quals, np.array(penalties),
            np.array(tri_sel), np.array(ext_sel), np.array(mem_sel))


def beat_chroma(chroma, bass, beats):
    """Take median chroma for each beat; skip onset transients for a more stable timbre."""
    n = chroma.shape[1]
    out, out_bass = [], []
    for i in range(len(beats) - 1):
        a, b = beats[i], min(beats[i + 1], n)
        if b - a >= 3:
            a = a + max(1, int(0.15 * (b - a)))
        seg = chroma[:, a:b] if b > a else chroma[:, a:a + 1]
        segb = bass[:, a:b] if b > a else bass[:, a:a + 1]
        if seg.size == 0:
            seg = chroma[:, min(a, n - 1):min(a, n - 1) + 1]
            segb = bass[:, min(a, n - 1):min(a, n - 1) + 1]
        v = np.median(seg, axis=1)
        nb = np.linalg.norm(v)
        out.append(v / nb if nb > 1e-9 else v)
        vb = np.median(segb, axis=1)
        nbb = np.linalg.norm(vb)
        out_bass.append(vb / nbb if nbb > 1e-9 else vb)
    return np.array(out).T, np.array(out_bass).T  # (12 × number of beats)


def score_chords(bc, bb, vecs, roots, penalties, tri_sel, ext_sel, mem_sel,
                 bass_root_weight=0.0, bass_member_weight=0.10):
    """Score every chord for each beat. Scores are z-normalized so later smoothing is independent of the recording."""
    sim = vecs @ bc  # (number of chords × number of beats)
    # Bass bonuses should not only recognize the root: when the bass is an inversion
    # tone (B in G/B), a "bass = root" bonus can force the result to Bm/Cmaj7.
    # In testing, G/B was correct using chroma alone and became wrong only after adding
    # a root bonus. So split the bonuses: a small one for the root and a larger one
    # when the bass is any chord tone.
    # bass_root_weight defaults to 0: testing showed a root bonus made both cases worse
    # (root-position test set 94.9%→94.0%, inversions 75%→62.5%), so it is not used.
    sim = sim + bass_root_weight * bb[roots, :]
    sim = sim + bass_member_weight * (mem_sel @ bb).clip(max=1.0)

    # Penalize extensions that are not prominent enough (to reject lingering tones from the previous chord)
    tri = tri_sel @ bc
    ext = ext_sel @ bc
    has_ext = ext_sel.sum(axis=1) > 0
    ratio = np.divide(ext, np.maximum(tri, 1e-6), out=np.zeros_like(ext), where=True)
    dyn = EXT_RATIO_COST * np.clip(EXT_RATIO_MIN - ratio, 0.0, None)
    dyn[~has_ext, :] = 0.0

    sim = sim - penalties[:, None] - dyn

    # Give N.C. a baseline score on beats without a clear chord (energy is too diffuse)
    nc = np.full((1, bc.shape[1]), float(np.median(sim)) * 0.72)
    sim = np.vstack([sim, nc])

    mean = sim.mean(axis=0, keepdims=True)
    std = sim.std(axis=0, keepdims=True)
    std[std < 1e-9] = 1.0
    return (sim - mean) / std


def viterbi(scores, stay_bonus=0.30):
    """Each state is a chord; reward staying on the same chord to avoid changing every beat.

    Scores are already z-scores, so stay_bonus is measured in standard deviations.
    0.30 was found by grid search on a synthetic test set (too large a value makes
    the entire song stick to one chord).
    """
    n_states, n_frames = scores.shape
    dp = scores[:, 0].copy()
    back = np.zeros((n_states, n_frames), dtype=np.int32)
    for t in range(1, n_frames):
        best_prev = int(np.argmax(dp))
        best_val = dp[best_prev]
        stay = dp + stay_bonus
        switch = np.full(n_states, best_val)
        take_stay = stay >= switch
        back[:, t] = np.where(take_stay, np.arange(n_states), best_prev)
        dp = np.where(take_stay, stay, switch) + scores[:, t]
    path = np.zeros(n_frames, dtype=np.int32)
    path[-1] = int(np.argmax(dp))
    for t in range(n_frames - 1, 0, -1):
        path[t - 1] = back[path[t], t]
    return path


def detect_key(chroma):
    mean = chroma.mean(axis=1)
    if mean.sum() <= 0:
        return 'C', True, 'C'
    mean = mean / np.linalg.norm(mean)
    best = (-1e9, 0, True)
    for root in range(12):
        for is_major, profile in ((True, KEY_MAJOR), (False, KEY_MINOR)):
            p = np.roll(profile, root)
            p = p / np.linalg.norm(p)
            s = float(mean @ p)
            if s > best[0]:
                best = (s, root, is_major)
    _, root, is_major = best
    sharp_name = PITCH_SHARP[root]
    flat_name = PITCH_FLAT[root]
    tag = sharp_name if is_major else sharp_name.lower()
    use_flats = (flat_name in FLAT_KEYS) or (tag in FLAT_KEYS) or ('b' in flat_name and sharp_name.endswith('#'))
    names = PITCH_FLAT if use_flats else PITCH_SHARP
    label = f'{names[root]} {"major" if is_major else "minor"}'
    return names[root], use_flats, label, root, not is_major


def _block_similarity(a, b):
    """Similarity (0–1) between the chord sequences of two bar segments."""
    if len(a) != len(b) or not a:
        return 0.0
    same = sum(1 for x, y in zip(a, b) if x == y)
    return same / len(a)


# Required similarity for two segments to count as the same, by segment length.
# Do not relax the threshold for 4 bars: 3 of 4 matching (0.75) also matches looped
# phrases shifted by one bar, causing segments to split at the wrong place (in testing,
# the second A in an A-B-A structure was split to start at bar 12).
SECTION_MIN_MATCH = {16: 0.75, 8: 0.75, 4: 1.0}


def detect_sections(bar_signatures, lengths=(16, 8, 4)):
    """Find repeated sections and label them A / B / C… in order of appearance.

    Only identify sections that repeat; do not guess which is a verse or chorus
    (that requires listening or manual transcription, and guessing would be misleading).

    Use fuzzy matching for long sections: chord detection can get a few bars wrong,
    so requiring an exact match would miss nearly all truly repeated sections.
    """
    n = len(bar_signatures)
    labels = [None] * n
    reps = []    # Representative section for each group (its first occurrence)
    blocks = []  # Sections sorted by position

    def is_empty(block):
        return all(s in ((), ('N.C.',)) for s in block)

    i = 0
    while i < n:
        placed = False
        for L in lengths:
            if i + L > n:
                continue
            block = bar_signatures[i:i + L]
            if is_empty(block):
                continue
            min_match = SECTION_MIN_MATCH.get(L, 0.75)

            group = None
            for k, rep in enumerate(reps):
                if len(rep) == L and _block_similarity(block, rep) >= min_match:
                    group = k
                    break

            if group is None:
                # Only label a section if a similar one appears later; do not label one-off sections
                repeats_later = any(
                    _block_similarity(block, bar_signatures[j:j + L]) >= min_match
                    for j in range(i + L, n - L + 1)
                )
                if not repeats_later:
                    continue
                reps.append(block)
                group = len(reps) - 1

            for k in range(L):
                labels[i + k] = group
            blocks.append({'group': group, 'startBar': i, 'bars': L})
            i += L
            placed = True
            break
        if not placed:
            i += 1

    # Assign letters in order of first appearance so the labels read A B C rather than A C B
    def label_name(idx):
        letter = chr(ord('A') + idx % 26)
        return letter if idx < 26 else f'{letter}{idx // 26 + 1}'

    naming = {}
    for b in blocks:
        if b['group'] not in naming:
            naming[b['group']] = label_name(len(naming))

    order = [{'label': naming[b['group']], 'startBar': b['startBar'], 'bars': b['bars']} for b in blocks]
    named_labels = [naming[g] if g is not None else None for g in labels]
    return named_labels, order


# Inversion detection: label a slash chord only when the bass is clearly not the root and is a chord tone
INVERSION_MIN_RATIO = 1.25   # The bass peak must exceed the root's bass energy by this ratio
INVERSION_MIN_SHARE = 0.55   # This share of beats in a chord segment must point to the same bass note


def detect_inversions(path_states, bb, roots, quals, n_chords):
    """Determine whether each beat's bass is another chord tone (an inversion).

    Return the bass pitch class for each beat (None if there is no inversion).

    Label only when the entire chord segment points to the same bass note; beat-by-beat
    decisions would be very unstable (the bass line naturally moves, and passing notes
    should not be treated as inversions).
    """
    n_beats = len(path_states)
    out = [None] * n_beats

    i = 0
    while i < n_beats:
        state = path_states[i]
        j = i
        while j + 1 < n_beats and path_states[j + 1] == state:
            j += 1

        if state < n_chords:
            root = int(roots[state])
            degrees = {d for d, _w in _quality_degrees(quals[state])}
            members = [(root + d) % 12 for d in degrees]
            votes = {}
            for t in range(i, j + 1):
                col = bb[:, t]
                # Do not simply use the strongest note in the bass range—it is noisy,
                # and the strongest note is often not a chord tone (in testing, C was
                # strongest in the G/B section, causing the whole section to be skipped).
                # Instead, find the strongest bass-range note among the chord tones.
                cand = max(members, key=lambda pc: col[pc])
                if cand == root:
                    continue
                if col[cand] < col[root] * INVERSION_MIN_RATIO:
                    continue
                votes[cand] = votes.get(cand, 0) + 1

            if votes:
                best = max(votes, key=votes.get)
                if votes[best] / (j - i + 1) >= INVERSION_MIN_SHARE:
                    for t in range(i, j + 1):
                        out[t] = best

        i = j + 1
    return out


def _quality_degrees(quality):
    for name, _suffix, degrees, *_rest in QUALITIES:
        if name == quality:
            return list(degrees.items())
    return [(0, 1.0), (4, 0.9), (7, 0.8)]


def find_downbeat(chord_ids, beats_per_bar=4):
    """Choose a bar start so chord changes fall on the first beat as often as possible."""
    changes = [i for i in range(1, len(chord_ids)) if chord_ids[i] != chord_ids[i - 1]]
    if not changes:
        return 0
    best_off, best_hits = 0, -1
    for off in range(beats_per_bar):
        hits = sum(1 for c in changes if (c - off) % beats_per_bar == 0)
        if hits > best_hits:
            best_off, best_hits = off, hits
    return best_off


# ---------------------------------------------------------------- Main pipeline

def analyze(path, beats_per_bar=4, simplify=False, progress=None, inversions=True,
            downbeat=None):
    """If downbeat is None, detect the first-beat position automatically; otherwise, use 0..beats_per_bar-1 to split bars as specified."""
    def step(pct, msg):
        if progress:
            progress(pct, msg)

    step(5, 'Decoding audio')
    x = decode(path)
    duration = x.size / SR

    step(20, 'Analyzing spectrum')
    P = note_spectrogram(x)
    Pw = whiten(P)
    Ph = harmonic_sum(Pw)

    step(45, 'Detecting rhythm')
    env = onset_envelope(P)
    period, bpm = estimate_period(env)
    beats = track_beats(env, period)
    beat_times = beats / FPS

    step(65, 'Detecting chords')
    chroma = chroma_from_notes(Ph)
    bass = chroma_from_notes(Pw, BASS_LO, BASS_HI)
    bc, bb = beat_chroma(chroma, bass, beats)
    if bc.shape[1] < 2:
        raise RuntimeError('Not enough beats detected. The audio may be too short or have no clear rhythm.')

    vecs, roots, quals, penalties, tri_sel, ext_sel, mem_sel = build_templates(simplify)
    scores = score_chords(bc, bb, vecs, roots, penalties, tri_sel, ext_sel, mem_sel)

    step(85, 'Smoothing results')
    path = viterbi(scores)

    root_names, use_flats, key_label, key_root, key_minor = detect_key(chroma)
    names = PITCH_FLAT if use_flats else PITCH_SHARP

    n_chords = vecs.shape[0]
    bass_notes = (
        detect_inversions(list(path), bb, roots, quals, n_chords)
        if inversions else [None] * len(path)
    )

    per_beat = []
    for t, state in enumerate(path):
        if state >= n_chords:
            per_beat.append({'name': 'N.C.', 'root': None, 'quality': 'nc', 'bass': None})
        else:
            root = int(roots[state])
            qual = quals[state]
            suffix = next(s for q, s, *_ in QUALITIES if q == qual)
            bass = bass_notes[t]
            slash = f'/{names[bass]}' if bass is not None else ''
            per_beat.append({
                'name': f'{names[root]}{suffix}{slash}',
                'root': root,
                'quality': qual,
                'bass': bass,
            })

    auto_downbeat = find_downbeat([p['name'] for p in per_beat], beats_per_bar)
    if downbeat is None:
        downbeat = auto_downbeat
    else:
        downbeat = int(downbeat) % beats_per_bar

    step(95, 'Organizing bars')
    bars = []
    i = downbeat
    bar_index = 0
    while i < len(per_beat):
        chunk = per_beat[i:i + beats_per_bar]
        t0 = float(beat_times[i])
        t1 = float(beat_times[min(i + beats_per_bar, len(beat_times) - 1)])
        # Collapse repeated chords within a bar, keeping only change points
        slots = []
        for k, c in enumerate(chunk):
            if k == 0 or c['name'] != chunk[k - 1]['name']:
                slots.append({'beat': k, 'name': c['name'], 'root': c['root'], 'quality': c['quality']})
        bars.append({
            'index': bar_index,
            'start': t0,
            'end': t1,
            'beats': [c['name'] for c in chunk],
            'chords': slots,
        })
        bar_index += 1
        i += beats_per_bar

    # Sections: label groups of bars with matching chord progressions as A / B / C
    signatures = [tuple(dict.fromkeys(b['beats'])) for b in bars]
    labels, sections = detect_sections(signatures)
    for b, label in zip(bars, labels):
        b['section'] = label

    step(100, 'Complete')
    return {
        'sections': sections,
        'duration': round(duration, 3),
        'bpm': round(bpm, 1),
        'key': key_label,
        'keyRoot': int(key_root),
        'keyMinor': bool(key_minor),
        'useFlats': bool(use_flats),
        'beatsPerBar': beats_per_bar,
        'downbeat': int(downbeat),
        'autoDownbeat': int(auto_downbeat),
        'beats': [round(float(t), 4) for t in beat_times],
        'perBeat': per_beat,
        'bars': bars,
    }


# ---------------------------------------------------------------- Solo melody
# The upper pitch limit must be compatible with MAX_FRET_MELODY; otherwise, some notes cannot be played on the guitar
MELODY_LO = 52   # E3
MELODY_HI = 86   # D6 = fret 22 on the first string
MELODY_MIN_MS = 70      # Discard notes shorter than this as noise
MELODY_SILENCE = 0.42   # Below this salience, treat as no melody
MELODY_STEP_COST = 0.055  # Penalty per semitone of movement (keeps the melody line smooth and avoids octave jumps)


def split_repeats(notes, env, fps=FPS, min_gap_ms=190, thresh=0.30, prominence=2.2, dip=1.6,
                  end_margin=2):
    """Split repeated notes of the same pitch.

    Melody tracking merges consecutive frames of the same pitch into one note, so a
    repeated C-C would become one long note. Use the onset envelope to find a new
    attack peak in the middle of the note.

    Do not decide based only on whether a threshold is exceeded—the natural volume
    variation of a plucked note can exceed it, splitting an unaccompanied recording
    into many false notes (in testing, 40 notes became 47).
    Require each peak to satisfy both:
      1. It is clearly above the note's own median energy (prominence).
      2. Energy dips before the peak (dip)—a genuine re-attack creates this valley.
    """
    if not notes or env is None or env.size == 0:
        return notes

    min_gap = max(2, int(min_gap_ms / 1000 * fps))
    out = []
    for note in notes:
        a = int(round(note['start'] * fps))
        b = min(int(round(note['end'] * fps)), env.size - 1)
        cuts = []
        # Leave a margin at the end of the search: the tracker is a few frames late
        # when changing notes, so the next note's onset falls near the end of this
        # note's range. Without a margin, it can be mistaken for a repeated note.
        if b - a > min_gap * (1 + end_margin):
            base = float(np.median(env[a:b])) + 1e-6
            for t in range(a + min_gap, b - end_margin * min_gap + 1):
                if env[t] < thresh or env[t] < base * prominence:
                    continue
                lo = max(0, t - min_gap // 2)
                hi = min(env.size, t + min_gap // 2 + 1)
                if env[t] < env[lo:hi].max():
                    continue
                # A dip must precede the peak to count as a release and re-attack
                valley = float(env[lo:t].min()) if t > lo else env[t]
                if env[t] < valley * dip:
                    continue
                if not cuts or t - cuts[-1] >= min_gap:
                    cuts.append(t)

        bounds = [a] + cuts + [b]
        for i in range(len(bounds) - 1):
            out.append({
                'midi': note['midi'],
                'start': bounds[i] / fps,
                'end': bounds[i + 1] / fps,
            })
    return out


def track_melody(Ph, fps=FPS):
    """Extract the most prominent monophonic melody line.

    Select the most salient note in the melody range after harmonic summation, then
    use Viterbi to keep it coherent. Include a "no melody" state so passages without
    a monophonic lead remain blank.

    This works reasonably well for solo guitar and clear lead parts; it performs
    noticeably worse on full-band mixes (especially with vocals).
    """
    lo = MELODY_LO - MIDI_LO
    hi = MELODY_HI - MIDI_LO + 1
    band = Ph[lo:hi]
    if band.size == 0:
        return []

    peak = band.max(axis=0)
    peak[peak < 1e-9] = 1.0
    sal = band / peak  # Normalize each frame to 0–1

    n_pitch, n_frames = sal.shape
    # States = n_pitch notes + 1 "no melody" state
    emit = np.vstack([sal, np.full((1, n_frames), MELODY_SILENCE)])

    # Penalty for pitch jumps; apply a fixed small penalty when entering or leaving "no melody"
    idx = np.arange(n_pitch)
    step = np.abs(idx[:, None] - idx[None, :]) * MELODY_STEP_COST
    trans = np.zeros((n_pitch + 1, n_pitch + 1))
    trans[:n_pitch, :n_pitch] = step
    trans[n_pitch, :n_pitch] = 0.12
    trans[:n_pitch, n_pitch] = 0.12

    dp = emit[:, 0].copy()
    back = np.zeros((n_pitch + 1, n_frames), dtype=np.int32)
    for t in range(1, n_frames):
        # cand[j, i] = score for transitioning from j to i
        cand = dp[:, None] - trans
        best = np.argmax(cand, axis=0)
        back[:, t] = best
        dp = cand[best, np.arange(n_pitch + 1)] + emit[:, t]

    path = np.zeros(n_frames, dtype=np.int32)
    path[-1] = int(np.argmax(dp))
    for t in range(n_frames - 1, 0, -1):
        path[t - 1] = back[path[t], t]

    # Merge consecutive frames of the same pitch into one note
    notes = []
    cur_pitch, cur_start = None, 0
    for t, state in enumerate(list(path) + [n_pitch]):
        pitch = None if state >= n_pitch else int(state) + MELODY_LO
        if pitch != cur_pitch:
            if cur_pitch is not None:
                dur_ms = (t - cur_start) / fps * 1000
                if dur_ms >= MELODY_MIN_MS:
                    notes.append({
                        'midi': cur_pitch,
                        'start': cur_start / fps,
                        'end': t / fps,
                    })
            cur_pitch, cur_start = pitch, t
    return notes


def quantize_melody(notes, beat_times, subdivision=4):
    """Align notes to the beat grid (sixteenth notes by default) and calculate how many grid slots each note occupies."""
    if not notes or len(beat_times) < 2:
        return []

    # Build the subdivided grid timestamps
    grid = []
    for i in range(len(beat_times) - 1):
        a, b = beat_times[i], beat_times[i + 1]
        for k in range(subdivision):
            grid.append(a + (b - a) * k / subdivision)
    grid.append(beat_times[-1])
    grid = np.array(grid)

    def nearest(t):
        return int(np.abs(grid - t).argmin())

    out = []
    last_grid = -1
    for note in notes:
        g0 = nearest(note['start'])
        # If two notes land on the same slot, move the later one forward rather than
        # dropping it; dropping it would shift the alignment of all subsequent notes.
        g0 = max(g0, last_grid + 1)
        if g0 >= len(grid) - 1:
            break
        g1 = max(g0 + 1, nearest(note['end']))
        out.append({
            'midi': note['midi'],
            'grid': g0,
            'units': g1 - g0,
            'start': round(float(grid[g0]), 4),
        })
        last_grid = g0

    # A note's duration must not overlap the next note
    for i in range(len(out) - 1):
        out[i]['units'] = max(1, min(out[i]['units'], out[i + 1]['grid'] - out[i]['grid']))
    return out


# Standard tuning; index 0 = first (thinnest) string
TUNING = [64, 59, 55, 50, 45, 40]
MAX_FRET_MELODY = 22


def assign_frets(notes, max_span=4):
    """Map MIDI pitches to strings and frets while minimizing left-hand movement (dynamic programming)."""
    if not notes:
        return notes

    def options(midi):
        out = []
        for s in range(1, 7):
            fret = midi - TUNING[s - 1]
            if 0 <= fret <= MAX_FRET_MELODY:
                out.append((s, fret))
        return out

    # Discard notes that cannot be played. Previously, (1, 0) was inserted as a
    # default, producing false data such as "B5 at first string, fret 0," where the
    # pitch and position do not match.
    playable = [(n, options(n['midi'])) for n in notes]
    playable = [(n, o) for n, o in playable if o]
    if not playable:
        return []
    notes = [n for n, _o in playable]
    all_opts = [o for _n, o in playable]

    # dp[i][j] = minimum cost of assigning the j-th option to the i-th note
    prev_cost = [abs(f - 5) * 0.15 for (_s, f) in all_opts[0]]  # Prefer starting near fret 5
    prev_choice = [[j] for j in range(len(all_opts[0]))]

    for i in range(1, len(notes)):
        cost, choice = [], []
        for j, (s, f) in enumerate(all_opts[i]):
            best_val, best_k = None, 0
            for k, (ps, pf) in enumerate(all_opts[i - 1]):
                # Avoid large hand shifts; changing strings has a small cost; nearby frets are preferable.
                # Also add a slight preference for lower positions: penalizing movement
                # alone lets the whole melody drift to higher frets even when it could
                # be played lower (in testing, it drifted to frets 12–17).
                move = abs(f - pf)
                penalty = prev_cost[k] + move * 0.28 + (0.06 if s != ps else 0) + f * 0.035
                if move > max_span:
                    penalty += 1.2
                if best_val is None or penalty < best_val:
                    best_val, best_k = penalty, k
            cost.append(best_val)
            choice.append(prev_choice[best_k] + [j])
        prev_cost, prev_choice = cost, choice

    best_path = prev_choice[int(np.argmin(prev_cost))]
    for i, (note, j) in enumerate(zip(notes, best_path)):
        string, fret = all_opts[i][j]
        note['string'] = string
        note['fret'] = fret
    return notes


def analyze_melody(path, beats_per_bar=4, subdivision=4, progress=None):
    """Audio file → solo notes (including strings and frets)."""
    def step(pct, msg):
        if progress:
            progress(pct, msg)

    step(5, 'Decoding audio')
    x = decode(path)

    step(25, 'Analyzing spectrum')
    P = note_spectrogram(x)
    Pw = whiten(P)
    Ph = harmonic_sum(Pw)

    step(50, 'Detecting rhythm')
    env = onset_envelope(P)
    period, bpm = estimate_period(env)
    beats = track_beats(env, period)
    beat_times = beats / FPS

    step(70, 'Extracting melody')
    raw = track_melody(Ph)
    raw = split_repeats(raw, env)

    step(90, 'Aligning beats and fretboard positions')
    notes = quantize_melody(raw, beat_times, subdivision)
    notes = assign_frets(notes)

    step(100, 'Complete')
    return {
        'duration': round(x.size / SR, 3),
        'bpm': round(bpm, 1),
        'beatsPerBar': beats_per_bar,
        'subdivision': subdivision,
        'beats': [round(float(t), 4) for t in beat_times],
        'notes': notes,
    }


def main():
    if len(sys.argv) < 2:
        print('Usage: analyze.py <audio-file> [beats-per-bar] [--simple]', file=sys.stderr)
        return 1
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    simplify = '--simple' in sys.argv
    bpb = int(args[1]) if len(args) > 1 else 4
    result = analyze(args[0], bpb, simplify)
    json.dump(result, sys.stdout, ensure_ascii=False)
    print()
    return 0


if __name__ == '__main__':
    sys.exit(main())
