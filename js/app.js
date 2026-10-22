import { LiteJam, hexToRgb, scaleColor, packNotes, MAX_FRET } from './litejam-ble.js';
import { FretboardView } from './fretboard.js';
import { ChordChart } from './chordchart.js';
import { ChordPicker } from './chordpicker.js';
import { QUALITY_DEGREES, chordColorClass, setTuning as setChordTuning } from './chords.js';
import {
  STANDARD_TUNING,
  TUNING_MAX_MIDI,
  TUNING_MIN_MIDI,
  describeTuning,
  isValidTuning,
  midiToName,
  placeNotes,
  sameTuning,
} from './tuning.js';
import { melodySummary, melodyToTex } from './solotab.js';
import { jianpuHtml, scoreToJianpu } from './jianpu.js';
import { VideoPlayer } from './videosync.js';
import { CHORD_TYPES, SHARED_COLOR, analyzeTrack, chordTypeIntervals, inversionVoicings, segmentAt, tabChordIntervals } from './tabchords.js';
import { recommendScales } from './tabscales.js';
import { StemMixer } from './mixer.js';
import { waveformPeaks } from './waveform.js';

const $ = (id) => document.getElementById(id);

/**
 * Bind events, skipping elements that do not exist.
 *
 * This is not defensive-programming fussiness: if the browser loads an old index.html (missing an element),
 * the original `el.someElement.addEventListener` would throw a TypeError, and **none of the later event bindings would run**,
 * leaving a bunch of buttons that appear completely unresponsive and are hard to debug. Better for just one button to fail.
 */
function on(node, type, handler, opts) {
  if (node) node.addEventListener(type, handler, opts);
  else console.warn('[GlowTab] UI element not found. The page may be out of sync; force reload (⌘⇧R).');
}

const el = {
  open: $('btn-open'),
  file: $('file-input'),
  title: $('song-title'),
  artist: $('song-artist'),
  bleChip: $('ble-chip'),
  bleText: $('ble-text'),
  bleBatt: $('ble-battery'),
  connect: $('btn-connect'),
  ig: $('btn-ig'),
  clean: $('btn-clean'),
  panel: $('btn-panel'),
  tracks: $('tracks'),
  colorMain: $('color-main'),
  colorNext: $('color-next'),
  togglePaint: $('toggle-paint'),
  colorPaint: $('color-paint'),
  paintClear: $('btn-paint-clear'),
  scaleRoot: $('scale-root'),
  scalePreset: $('scale-preset'),
  scaleIntervals: $('scale-intervals'),
  scaleName: $('scale-name'),
  scaleAllRoots: $('scale-all-roots'),
  scaleRootColor: $('scale-root-color'),
  scaleNoteColor: $('scale-note-color'),
  toggleScaleWithTab: $('toggle-scale-with-tab'),
  scaleSave: $('btn-scale-save'),
  scaleAccountStatus: $('scale-account-status'),
  googleLogin: $('btn-google-login'),
  googleLogout: $('btn-google-logout'),
  scaleSend: $('btn-scale-send'),
  scaleClear: $('btn-scale-clear'),
  scaleDelete: $('btn-scale-delete'),
  tuningPreset: $('tuning-preset'),
  tuningStrings: $('tuning-strings'),
  tuningSummary: $('tuning-summary'),
  toggleScoreTuning: $('toggle-score-tuning'),
  tuningName: $('tuning-name'),
  tuningSave: $('btn-tuning-save'),
  tuningReset: $('btn-tuning-reset'),
  toggleNext: $('toggle-next'),
  tabChordBtn: $('btn-tab-chords'),
  tabChordCount: $('tab-chord-count'),
  tabChordNotes: $('tab-chord-notes'),
  tabChordType: $('tab-chord-type'),
  tabChordFullExtension: $('tab-chord-full-extension'),
  tabChordName: $('tab-chord-name'),
  tabChordDetail: $('tab-chord-detail'),
  tracksTab: $('tab-view-tracks'),
  stemsTab: $('tab-view-stems'),
  tracksPanel: $('tracks-panel'),
  stemsPanel: $('stems-panel'),
  addTabStems: $('btn-add-tab-stems'),
  tabStemsInput: $('tab-stems-input'),
  tabStemsSummary: $('tab-stems-summary'),
  tabStemsList: $('tab-stems-list'),
  tabStemsView: $('tab-stems-view'),
  addTabStemsView: $('btn-add-tab-stems-view'),
  tabStemRuler: $('tab-stem-ruler'),
  tabStemLanes: $('tab-stem-lanes'),
  tabStemEmpty: $('tab-stem-empty'),
  tabStemPlayhead: $('tab-stem-playhead'),
  tabScaleStyle: $('tab-scale-style'),
  tabScaleChordCount: $('tab-scale-chord-count'),
  tabScaleMinimumFit: $('tab-scale-minimum-fit'),
  tabScaleBehavior: $('tab-scale-behavior'),
  tabScaleEntireSong: $('tab-scale-entire-song'),
  tabScaleShowChordInversions: $('tab-scale-show-chord-inversions'),
  tabScaleRecommendations: $('tab-scale-recommendations'),
  tabScaleResult: $('tab-scale-result'),
  brightness: $('brightness'),
  brightnessOut: $('brightness-out'),
  toggleReverse: $('toggle-reverse'),
  toggleQualityColor: $('toggle-quality-color'),
  test: $('btn-test'),
  off: $('btn-off'),
  stave: $('stave'),
  layout: $('layout'),
  zoom: $('zoom'),
  zoomOut: $('zoom-out'),
  frets: $('frets'),
  fretsOut: $('frets-out'),
  toggleFretboard: $('toggle-fretboard'),
  toggleJianpu: $('toggle-jianpu'),
  jianpuKeyRow: $('jianpu-key-row'),
  jianpuKey: $('jianpu-key'),
  jianpuWrap: $('jianpu-wrap'),
  jianpu: $('jianpu'),
  jianpuInfo: $('jianpu-info'),
  viewport: $('at-viewport'),
  main: $('alphatab'),
  dropHint: $('drop-hint'),
  fretWrap: $('fretboard-wrap'),
  canvas: $('fretboard'),
  rewind: $('btn-rewind'),
  play: $('btn-play'),
  stop: $('btn-stop'),
  timeCur: $('time-cur'),
  timeTotal: $('time-total'),
  seek: $('seek'),
  speed: $('speed'),
  speedOut: $('speed-out'),
  metronome: $('btn-metronome'),
  countin: $('btn-countin'),
  loop: $('btn-loop'),
  toast: $('toast'),
  loading: $('loading'),
  loadingText: $('loading-text'),

  // Chord mode
  chordBtn: $('btn-chord'),
  modal: $('chord-modal'),
  modalClose: $('modal-close'),
  songQ: $('song-q'),
  searchBtn: $('btn-search'),
  searchResults: $('search-results'),
  fileName: $('file-name'),
  ytUrl: $('yt-url'),
  ytBtn: $('btn-yt'),
  ytHint: $('yt-hint'),
  audioFileBtn: $('btn-audio-file'),
  stemsFileBtn: $('btn-stems-file'),
  stemsView: $('stems-view'),
  audioInput: $('audio-input'),
  optBpb: $('opt-bpb'),
  optSimple: $('opt-simple'),
  jobBox: $('job-progress'),
  jobFill: $('job-fill'),
  jobMsg: $('job-msg'),
  jobElapsed: $('job-elapsed'),
  ccViewport: $('cc-viewport'),
  chordchart: $('chordchart'),
  pickerBtn: $('btn-picker'),
  pkViewport: $('pk-viewport'),
  chordpicker: $('chordpicker'),
  panelChord: $('panel-chord'),
  playSource: $('play-source'),
  sourceHint: $('source-hint'),
  panelMixer: $('panel-mixer'),
  mixerTracks: $('mixer-tracks'),
  mixerHint: $('mixer-hint'),
  stemSolo: $('btn-stem-solo'),
  exportMix: $('btn-export-mix'),
  exportStems: $('btn-export-stems'),
  autoLyrics: $('btn-auto-lyrics'),
  whisperModel: $('whisper-model'),
  videoWrap: $('video-wrap'),
  videoHost: $('video-host'),
  videoHead: $('video-head'),
  videoResize: $('video-resize'),
  displayMode: $('display-mode'),
  keyRoot: $('key-root'),
  keyDetected: $('key-detected'),
  transpose: $('transpose'),
  transposeOut: $('transpose-out'),
  downbeat: $('downbeat'),
  capo: $('capo'),
  capoOut: $('capo-out'),
  suggestCapo: $('btn-suggest-capo'),
  capoHint: $('capo-hint'),
  autoScroll: $('toggle-autoscroll'),
  exportBtn: $('btn-export'),
  reanalyze: $('btn-reanalyze'),
  soloBtn: $('btn-solo'),
  editChords: $('btn-edit-chords'),
  resetChords: $('btn-reset-chords'),
  editCount: $('edit-count'),
  panelLyrics: $('panel-lyrics'),
  lyricsInput: $('lyrics-input'),
  pinyinStyle: $('pinyin-style'),
  lyricsOffset: $('lyrics-offset'),
  applyLyrics: $('btn-apply-lyrics'),
  clearLyrics: $('btn-clear-lyrics'),
  backTab: $('btn-back-tab'),
};

const guitar = new LiteJam();
const fretboard = new FretboardView(el.canvas);
const audio = new Audio();
audio.preload = 'auto';

const settings = load();
let api = null;
let scoreLoaded = false;
let seeking = false;
let endTime = 0;

/** 'tab' = view a Guitar Pro score; 'chord' = automatically detected chord chart; 'picker' = choose chords manually */
let mode = 'tab';
let chart = null;
let picker = null;
let lastAnalysisSource = null; // Used for re-analysis

/** 'audio' = downloaded audio; 'video' = YouTube video; 'stems' = stem mixer */
let playSource = 'audio';
let videoPlayer = null;
let mixer = null;
let stemsMedia = null; // Which song's stems are currently loaded in the mixer; re-separate when the song changes
let tabStemMixer = null;
let tabStemFiles = [];
let tabStemScrubbing = false;
let scorePositionMs = 0;
let activeSidebarTab = 'tracks';
let tabStemRulerDuration = -1;

/**
 * The current playback source. All three sources provide
 * play / pause / paused / currentTime / duration, so they can be handled uniformly.
 */
function clock() {
  if (playSource === 'video' && videoPlayer?.available) return videoPlayer;
  if (playSource === 'stems' && mixer?.ready) return mixer;
  return audio;
}

/* ---------------- Settings access ---------------- */

function load() {
  const defaults = {
    colorMain: '#00e5ff',
    colorNext: '#ff2d95',
    colorPaint: '#39ff14',
    colorScaleRoot: '#ff4d4d',
    colorScaleNote: '#4d8bff',
    showScaleWithTab: false,
    showNext: true,
    brightness: 85,
    reverseStrings: false,
    colorByQuality: true,
    stave: 'scoretab',
    layout: 'page',
    zoom: 100,
    frets: 24,
    showFretboard: true,
    speed: 100,
    metronome: false,
    countIn: false,
    loop: false,
    chordAutoScroll: true,
    chordDisplay: 'chord',
    capo: 0,
    showJianpu: false,
    tuning: [...STANDARD_TUNING],
    useCustomTuningForScoreNotes: true,
  };
  try {
    const saved = JSON.parse(localStorage.getItem('litejam-glowtab') ?? '{}');
    const merged = { ...defaults, ...saved };
    // The old default was 15 frets; move browsers still on it to 24 once, then respect later choices
    if (!saved.fretsDefault24 && saved.frets === 15) merged.frets = defaults.frets;
    merged.fretsDefault24 = true;
    if (!isValidTuning(merged.tuning)) merged.tuning = defaults.tuning;
    return merged;
  } catch {
    return defaults;
  }
}

function save() {
  try {
    localStorage.setItem('litejam-glowtab', JSON.stringify(settings));
  } catch {
    /* Writes are unavailable in private browsing; this does not affect use. */
  }
}

/* ---------------- Utilities ---------------- */

let toastTimer = null;
function toast(msg, isError = false) {
  el.toast.textContent = msg;
  el.toast.classList.toggle('err', isError);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, isError ? 6000 : 2600);
}

function busy(text) {
  if (text) {
    el.loadingText.textContent = text;
    el.loading.hidden = false;
  } else {
    el.loading.hidden = true;
  }
}

function fmtTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/* ---------------- alphaTab ---------------- */

function staveProfile(value) {
  const P = alphaTab.StaveProfile;
  if (value === 'tab') return P.Tab;
  if (value === 'score') return P.Score;
  return P.ScoreTab;
}

function initAlphaTab() {
  api = new alphaTab.AlphaTabApi(el.main, {
    core: {
      fontDirectory: 'vendor/alphatab/font/',
      engine: 'svg',
    },
    display: {
      layoutMode: settings.layout === 'horizontal' ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page,
      staveProfile: staveProfile(settings.stave),
      scale: settings.zoom / 100,
    },
    player: {
      playerMode: alphaTab.PlayerMode?.EnabledAutomatic ?? 1,
      enablePlayer: true,
      soundFont: 'vendor/alphatab/soundfont/sonivox.sf3',
      scrollElement: el.viewport,
      enableCursor: true,
      enableUserInteraction: true,
      scrollOffsetY: -30,
    },
  });

  api.soundFontLoad.on((e) => {
    const pct = e.total ? Math.floor((e.loaded / e.total) * 100) : 0;
    busy(`Loading soundfont ${pct}%`);
    if (e.loaded >= e.total) busy(null);
  });

  api.playerReady.on(() => busy(null));

  api.scoreLoaded.on((score) => {
    resetTabChords();
    clearUploadedTabStems();
    scoreLoaded = true;
    activeSidebarTab = 'tracks';
    updateSidebarTabUi();
    el.dropHint.classList.add('hide');
    el.title.textContent = score.title || '(Untitled)';
    el.artist.textContent = [score.artist, score.album].filter(Boolean).join(' — ');
    renderTrackList(score);
    busy('Rendering score…');
  });

  api.renderFinished.on(() => {
    busy(null);
    renderJianpu();
  });

  api.error.on((err) => {
    busy(null);
    toast(`Failed to load: ${err?.message ?? err}`, true);
  });

  api.playerStateChanged.on((e) => {
    const playing = e.state === 1; // 1 = Playing
    scorePlaying = playing;
    el.play.textContent = playing ? '⏸' : '▶';
    if (playing) ledRun++; // Starting playback cancels any running test animation
    handleUploadedStemPlayback(playing);
    if (!playing) clearLeds();
  });

  api.playerPositionChanged.on((e) => {
    endTime = e.endTime;
    scorePositionMs = e.currentTime;
    el.timeCur.textContent = fmtTime(e.currentTime);
    el.timeTotal.textContent = fmtTime(e.endTime);
    if (!seeking && e.endTime > 0) {
      el.seek.value = String(Math.round((e.currentTime / e.endTime) * 1000));
    }
    syncUploadedStemPosition(e.currentTime);
    if (renderTabStemRuler()) requestAnimationFrame(drawTabStemWaveforms);
    updateTabStemPlayhead(e.currentTime / 1000);
  });

  api.playedBeatChanged.on((beat) => onBeat(beat));

  // Apply initial settings
  api.playbackSpeed = settings.speed / 100;
  api.metronomeVolume = settings.metronome ? 1 : 0;
  api.countInVolume = settings.countIn ? 1 : 0;
  api.isLooping = settings.loop;
}

function renderTrackList(score) {
  el.tracks.innerHTML = '';
  const rendered = new Set((api.tracks ?? []).map((t) => t.index));
  score.tracks.forEach((track) => {
    const row = document.createElement('div');
    row.className = 'track' + (rendered.has(track.index) ? ' active' : '');
    row.innerHTML = `
      <span class="track-name"></span>
      <span class="track-badge">${track.staves?.[0]?.tuning?.length ?? 6} strings</span>`;
    row.querySelector('.track-name').textContent = track.name || `Track ${track.index + 1}`;
    row.addEventListener('click', () => {
      api.renderTracks([track]);
      resetTabChords();
      [...el.tracks.children].forEach((c) => c.classList.remove('active'));
      row.classList.add('active');
    });
    el.tracks.appendChild(row);
  });
}

function updateSidebarTabUi() {
  const canShowStems = scoreLoaded && mode === 'tab';
  el.stemsTab.disabled = !canShowStems;
  el.tracksTab.classList.toggle('active', activeSidebarTab === 'tracks');
  el.stemsTab.classList.toggle('active', activeSidebarTab === 'stems');
  el.tracksTab.setAttribute('aria-selected', String(activeSidebarTab === 'tracks'));
  el.stemsTab.setAttribute('aria-selected', String(activeSidebarTab === 'stems'));
  el.tracksPanel.hidden = activeSidebarTab !== 'tracks';
  el.stemsPanel.hidden = activeSidebarTab !== 'stems';

  const showStems = canShowStems && activeSidebarTab === 'stems';
  el.tabStemsView.hidden = !showStems;
  if (mode === 'tab') el.viewport.hidden = showStems;
  el.jianpuWrap.hidden = showStems || !(settings.showJianpu && mode === 'tab' && api?.score);
  if (showStems) {
    renderTabStemLanes();
    requestAnimationFrame(drawTabStemWaveforms);
  }
}

function selectSidebarTab(tab) {
  if (tab === 'stems' && (mode !== 'tab' || !scoreLoaded)) return;
  activeSidebarTab = tab;
  updateSidebarTabUi();
  if (tab === 'tracks') renderJianpu();
}

function updateTabStemPlayhead(timeSeconds) {
  const duration = Math.max(endTime / 1000, tabStemMixer?.duration ?? 0);
  const progress = duration > 0 ? Math.max(0, Math.min(1, timeSeconds / duration)) : 0;
  const waveformWidth = Math.max(0, el.tabStemLanes.clientWidth - 200);
  el.tabStemPlayhead.style.left = `${158 + waveformWidth * progress}px`;
}

function tabStemTimelineDuration() {
  return Math.max(endTime / 1000, tabStemMixer?.duration ?? 0);
}

function renderTabStemLanes() {
  el.tabStemLanes.querySelectorAll('.tab-stem-lane').forEach((lane) => lane.remove());
  el.tabStemEmpty.hidden = Boolean(tabStemMixer?.tracks.length);
  el.tabStemsSummary.textContent = tabStemMixer?.tracks.length
    ? `${tabStemMixer.tracks.length} of 6 stems loaded. Play and seek with the score transport.`
    : 'Load up to 6 aligned audio stems to play with this tablature.';
  el.tabStemsList.replaceChildren();

  if (tabStemMixer?.tracks.length) {
    for (const [index, track] of tabStemMixer.tracks.entries()) {
      const sidebarName = document.createElement('div');
      sidebarName.className = 'tab-stem-list-item';
      sidebarName.title = track.label;
      sidebarName.textContent = `${index + 1}. ${track.label}`;
      el.tabStemsList.append(sidebarName);

      const lane = document.createElement('div');
      lane.className = 'tab-stem-lane';
      const name = document.createElement('div');
      name.className = 'tab-stem-lane-name';
      name.title = track.label;
      name.textContent = track.label;
      const waveform = document.createElement('canvas');
      waveform.className = 'tab-stem-waveform';
      waveform.dataset.stemId = track.id;
      waveform.setAttribute('aria-label', `Waveform for ${track.label}; click or drag to seek`);
      const remove = document.createElement('button');
      remove.className = 'tab-stem-remove';
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = `Remove ${track.label}`;
      remove.setAttribute('aria-label', `Remove ${track.label}`);
      remove.addEventListener('click', () => removeUploadedTabStem(track.id));
      lane.append(name, waveform, remove);
      el.tabStemLanes.insertBefore(lane, el.tabStemPlayhead);
    }
  }

  renderTabStemRuler();
  updateTabStemPlayhead(scorePositionMs / 1000);
  drawTabStemWaveforms();
}

function renderTabStemRuler() {
  const duration = tabStemTimelineDuration();
  if (duration === tabStemRulerDuration) return false;
  tabStemRulerDuration = duration;
  const ruler = document.createElement('div');
  ruler.className = 'tab-stem-ruler-track';
  for (let tick = 0; tick <= 4; tick++) {
    const label = document.createElement('span');
    label.textContent = fmtTime((duration * tick * 1000) / 4);
    ruler.append(label);
  }
  el.tabStemRuler.replaceChildren(document.createElement('span'), ruler, document.createElement('span'));
  return true;
}

const TAB_STEM_COLORS = ['#55c2ff', '#ffbe55', '#bb83ff', '#63df9b', '#ff7185', '#d2da66'];

function drawTabStemWaveforms() {
  if (!tabStemMixer?.tracks.length) return;
  for (const [index, track] of tabStemMixer.tracks.entries()) {
    const canvas = el.tabStemLanes.querySelector(`canvas[data-stem-id="${CSS.escape(track.id)}"]`);
    if (!canvas) continue;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) continue;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const context = canvas.getContext('2d');
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = 'rgba(255,255,255,0.12)';
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();
    const peaks = waveformPeaks(track.buffer, Math.min(1800, Math.max(1, Math.round(width * dpr))));
    const binWidth = width / peaks.length;
    context.fillStyle = TAB_STEM_COLORS[index % TAB_STEM_COLORS.length];
    for (let bin = 0; bin < peaks.length; bin++) {
      const amplitude = Math.max(1, peaks[bin] * height * 0.44);
      context.fillRect(bin * binWidth, (height - amplitude) / 2, Math.max(1, binWidth), amplitude);
    }
  }
}

function syncUploadedStemPosition(positionMs, force = false) {
  if (!tabStemMixer?.ready || mode !== 'tab') return;
  const target = Math.max(0, Math.min(positionMs / 1000, tabStemMixer.duration));
  if (force || tabStemMixer.paused) tabStemMixer.currentTime = target;
}

function handleUploadedStemPlayback(playing) {
  if (!tabStemMixer?.ready) return;
  if (mode !== 'tab' || !playing) {
    tabStemMixer.pause();
    return;
  }
  tabStemMixer.setRate(settings.speed / 100);
  syncUploadedStemPosition(scorePositionMs, true);
  tabStemMixer.play().catch((error) => toast(`Stem playback failed: ${error.message}`, true));
}

function updateScoreAudioVolume() {
  if (api) api.masterVolume = mode === 'tab' && tabStemMixer?.ready ? 0 : 1;
}

function clearUploadedTabStems() {
  tabStemMixer?.destroy();
  tabStemMixer = null;
  tabStemFiles = [];
  scorePositionMs = 0;
  endTime = 0;
  tabStemRulerDuration = -1;
  updateScoreAudioVolume();
  renderTabStemLanes();
}

async function addUploadedTabStems(files) {
  if (!scoreLoaded || mode !== 'tab') {
    toast('Load a tablature score before adding audio stems.', true);
    return;
  }
  if (!files.length) return;
  if ((tabStemMixer?.tracks.length ?? 0) + files.length > 6) {
    toast(`You can load up to 6 audio stems; ${6 - (tabStemMixer?.tracks.length ?? 0)} slot(s) remain.`, true);
    return;
  }
  const supported = /\.(mp3|m4a|wav|aac|flac|ogg|opus|aif|aiff|caf)$/i;
  const invalid = files.find((file) => !file.type.startsWith('audio/') && !supported.test(file.name));
  if (invalid) {
    toast(`"${invalid.name}" does not appear to be a supported audio file.`, true);
    return;
  }

  const mixerToLoad = tabStemMixer ?? new StemMixer();
  const wasPlaying = scorePlaying;
  busy('Loading audio stems…');
  try {
    if (tabStemMixer) {
      await mixerToLoad.addFiles(files, (loaded, total) => busy(`Decoding stems ${loaded}/${total}…`));
    } else {
      await mixerToLoad.loadFiles(files, (loaded, total) => busy(`Decoding stems ${loaded}/${total}…`));
    }
    tabStemMixer = mixerToLoad;
    tabStemFiles.push(...files);
    tabStemMixer.setRate(settings.speed / 100);
    syncUploadedStemPosition(scorePositionMs, true);
    updateScoreAudioVolume();
    renderTabStemLanes();
    busy(null);
    if (wasPlaying) handleUploadedStemPlayback(true);
    toast(`${files.length} audio stem${files.length === 1 ? '' : 's'} loaded.`);
  } catch (error) {
    if (!tabStemMixer) mixerToLoad.destroy();
    busy(null);
    toast(`Unable to load audio stems: ${error.message}`, true);
  }
}

function removeUploadedTabStem(id) {
  if (!tabStemMixer) return;
  const index = tabStemMixer.tracks.findIndex((track) => track.id === id);
  if (index < 0) return;
  tabStemMixer.removeTrack(id);
  tabStemFiles.splice(index, 1);
  if (!tabStemMixer.tracks.length) {
    tabStemMixer.destroy();
    tabStemMixer = null;
    updateScoreAudioVolume();
  }
  renderTabStemLanes();
}

function seekScoreFromTabStems(clientX) {
  if (!api || endTime <= 0) return;
  const waveform = el.tabStemLanes.querySelector('.tab-stem-waveform');
  if (!waveform) return;
  const rect = waveform.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const targetMs = Math.min(ratio * tabStemTimelineDuration() * 1000, endTime);
  scorePositionMs = targetMs;
  api.timePosition = targetMs;
  syncUploadedStemPosition(targetMs, true);
  updateTabStemPlayhead(targetMs / 1000);
}

on(el.tracksTab, 'click', () => selectSidebarTab('tracks'));
on(el.stemsTab, 'click', () => selectSidebarTab('stems'));
on(el.addTabStems, 'click', () => el.tabStemsInput.click());
on(el.addTabStemsView, 'click', () => el.tabStemsInput.click());
on(el.tabStemsInput, 'change', (event) => {
  const files = [...(event.target.files ?? [])];
  event.target.value = '';
  addUploadedTabStems(files);
});
on(el.tabStemLanes, 'pointerdown', (event) => {
  if (!event.target.closest('.tab-stem-waveform')) return;
  tabStemScrubbing = true;
  el.tabStemLanes.setPointerCapture(event.pointerId);
  seekScoreFromTabStems(event.clientX);
});
on(el.tabStemLanes, 'pointermove', (event) => {
  if (tabStemScrubbing) seekScoreFromTabStems(event.clientX);
});
on(el.tabStemLanes, 'pointerup', () => {
  tabStemScrubbing = false;
});
on(el.tabStemLanes, 'pointercancel', () => {
  tabStemScrubbing = false;
});
window.addEventListener('resize', () => {
  drawTabStemWaveforms();
});

/* ---------------- Light LEDs ---------------- */

/**
 * alphaTab's note.string numbering is opposite to guitar convention: 1 = the lowest-pitched sixth string (thick),
 * 6 = the highest-pitched first string (thin). Verified against the actual pitches in the sample score
 * (string 2 + fret 3 = MIDI 48 = C3, which only works on the A string, i.e. the fifth string).
 */
function atStringToGuitar(atString) {
  return 7 - atString;
}

/**
 * Guitar convention (1 = thin string) → the number sent to the guitar.
 * In LiteJam's bitmask, bit0 = first string, so the numbers normally map directly;
 * if the physical LEDs light strings in the opposite order, enable "Reverse string order."
 */
function hwString(guitarString) {
  return settings.reverseStrings ? 7 - guitarString : guitarString;
}

/**
 * Which string and fret to light for the notes in this beat (guitar convention: 1 = thin string).
 * Score positions are used unchanged for standard tuning or when the score
 * already encodes the intended custom tuning. Otherwise, calculate by pitch.
 */
function beatPositions(beat) {
  const notes = (beat?.notes ?? []).filter(
    // Do not relight the second half of a tie
    (n) => !n.isTieDestination && n.string != null && n.fret != null && n.fret >= 0
  );
  if (!settings.useCustomTuningForScoreNotes || sameTuning(settings.tuning, STANDARD_TUNING)) {
    return notes.map((note) => ({ note, gstr: atStringToGuitar(note.string), fret: note.fret }));
  }
  // Harmonics should light the fret being pressed, so use the pitch without the harmonic
  const requests = notes.map((n) => ({
    pitch: n.realValueWithoutHarmonic ?? n.realValue,
    preferred: atStringToGuitar(n.string),
  }));
  const spots = placeNotes(requests, settings.tuning, MAX_FRET);
  return notes.flatMap((note, i) => (spots[i] ? [{ note, gstr: spots[i].string, fret: spots[i].fret }] : []));
}

function beatToNotes(beat) {
  return beatPositions(beat).map(({ gstr, fret }) => ({ string: hwString(gstr), fret }));
}

function currentGroups(beat) {
  const b = settings.brightness / 100;
  const groups = [];

  const now = beatToNotes(beat);
  if (now.length) {
    groups.push({ leds: packNotes(now), color: scaleColor(hexToRgb(settings.colorMain), b) });
  }

  if (settings.showNext) {
    const next = beatToNotes(beat?.nextBeat);
    // Do not send the same fret again if it is already occupied by a currently playing note, to avoid colors overwriting each other
    const taken = new Set(now.map((n) => `${n.string}:${n.fret}`));
    const preview = next.filter((n) => !taken.has(`${n.string}:${n.fret}`));
    if (preview.length) {
      groups.push({ leds: packNotes(preview), color: scaleColor(hexToRgb(settings.colorNext), b * 0.5) });
    }
  }

  return groups;
}

// Bend-animation generation counter: changing beats or turning off the lights stops the previous slide
let bendRun = 0;

/**
 * Bend amount → number of strings to sweep. alphaTab's bend value is measured in quarter tones,
 * so "semitones = maximum bend value / 2": one semitone → 1, a whole tone (2 semitones) → 2, 1.5 tones (3 semitones) → 3.
 */
function bendStringCount(note) {
  const vals = (note.bendPoints ?? []).map((p) => p.value);
  if (!vals.length) return 2; // Assume a whole tone if no details are available
  const semitones = Math.max(...vals) / 2;
  return Math.max(1, Math.min(5, Math.round(semitones)));
}

/**
 * Notes with a bend in this beat → sweep the string toward the neighboring string at the same fret; larger bends sweep more strings.
 * Bending strings 1, 2, and 3 upward sweeps toward the thicker strings (higher string numbers); bending strings 4, 5, and 6 downward sweeps toward the thinner strings (lower string numbers).
 */
function bendTargets(beat) {
  const out = [];
  for (const { note, gstr, fret } of beatPositions(beat)) {
    if (!note.hasBend) continue;
    const dir = gstr <= 3 ? 1 : -1;
    out.push({ gstr, fret, dir, count: bendStringCount(note) });
  }
  return out;
}

/**
 * Dynamic LEDs for bends: sweep toward neighboring strings at the same fret. The bend amount determines
 * how many strings to sweep (one semitone sweeps 1 string, a whole tone 2, 1.5 tones 3). Layer this over the normal lights, sweeping one string at a time.
 */
async function animateBends(bends, baseGroups, run) {
  const b = settings.brightness / 100;
  const color = scaleColor(hexToRgb(settings.colorMain), b);
  const maxCount = Math.max(...bends.map((bd) => bd.count));
  for (let step = 1; step <= maxCount; step++) {
    if (run !== bendRun) return; // Stop if the beat changed or the lights were turned off
    const lit = [];
    for (const bd of bends) {
      // Accumulate: light neighboring strings one by one, up to the number specified by this bend
      for (let k = 1; k <= Math.min(step, bd.count); k++) {
        const gs = bd.gstr + bd.dir * k;
        if (gs >= 1 && gs <= 6) lit.push({ string: hwString(gs), fret: bd.fret });
      }
    }
    if (lit.length) {
      const groups = [...baseGroups, { leds: packNotes(lit), color }];
      fretboard.setGroups(groups);
      if (guitar.status === 'connected') guitar.sendSegment([...overlayLedGroups(), ...groups]);
    }
    await new Promise((r) => setTimeout(r, 85));
  }
}

/* ---------------- Score chord analysis (colored overlay, also sent to the guitar) ---------------- */

let tabChords = null; // { segments, current, variants }
let lastBeat = null;
let tabScaleAnalysis = null;
let activeTabScale = null;
const SCALE_ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Overlay light groups: one color per shape, with shared notes combined into a pink group */
function overlayLedGroups() {
  if (!el.tabScaleShowChordInversions.checked) return [];
  const variants = tabChords?.variants ?? [];
  if (!variants.length) return [];
  const b = settings.brightness / 100;
  const groups = [];
  const pink = new Map();
  for (const v of variants) {
    const own = [];
    for (const n of v.notes) {
      if (n.shared) pink.set(`${n.string}:${n.fret}`, n);
      else own.push({ string: hwString(n.string), fret: n.fret });
    }
    if (own.length) groups.push({ leds: packNotes(own), color: scaleColor(hexToRgb(v.color.hex), b) });
  }
  if (pink.size) {
    const notes = [...pink.values()].map((n) => ({ string: hwString(n.string), fret: n.fret }));
    groups.push({ leds: packNotes(notes), color: scaleColor(hexToRgb(SHARED_COLOR.hex), b) });
  }
  return groups;
}

function scaleReferenceGroup(segment) {
  const segments = tabChords?.segments ?? [];
  const count = tabScaleAnalysis?.entireSong
    ? segments.length
    : tabScaleAnalysis?.chordCount ?? 2;
  if (tabScaleAnalysis?.entireSong || tabScaleAnalysis?.behavior === 'static') {
    return { key: tabScaleAnalysis.entireSong ? 'entire-song' : 'initial', segments: segments.slice(0, count) };
  }
  const index = Math.max(0, segments.indexOf(segment));
  const start = Math.max(0, Math.min(index - Math.floor((count - 1) / 2), segments.length - count));
  const end = Math.min(segments.length, start + count);
  return { key: `${start}:${end}`, segments: segments.slice(start, end) };
}

function setActiveTabScale(scale) {
  if (!scale) {
    activeTabScale = null;
    return;
  }
  const root = SCALE_ROOT_NAMES.indexOf(scale['Root Note']);
  activeTabScale = root < 0
    ? null
    : { name: scale.name, root, intervals: scale.Intervals.split(',').map(Number) };
}

function updateTabScaleRecommendation(segment) {
  if (!tabScaleAnalysis || !tabChords) return;
  if (tabChords.segments.length < 2) {
    activeTabScale = null;
    el.tabScaleRecommendations.replaceChildren(new Option('Not enough chords', ''));
    el.tabScaleRecommendations.disabled = true;
    el.tabScaleResult.textContent = 'At least two chord sections are needed to recommend a scale.';
    return;
  }

  const reference = scaleReferenceGroup(segment ?? tabChords.segments[0]);
  if (reference.key === tabScaleAnalysis.lastWindowKey) return;
  tabScaleAnalysis.lastWindowKey = reference.key;
  const candidates = recommendScales(
    reference.segments,
    Object.values(scalePresets),
    tabScaleAnalysis.style,
    22,
    tabScaleAnalysis.minimumFit
  );
  const previousName = tabScaleAnalysis.selected?.name;
  tabScaleAnalysis.candidates = candidates;
  tabScaleAnalysis.selected = candidates.find((candidate) => candidate.name === previousName) ?? candidates[0] ?? null;
  el.tabScaleRecommendations.replaceChildren();

  if (!candidates.length) {
    activeTabScale = null;
    el.tabScaleRecommendations.add(new Option('No scales meet the minimum match', ''));
    el.tabScaleRecommendations.disabled = true;
    el.tabScaleResult.textContent = `No scales meet the ${tabScaleAnalysis.minimumFit}% chord-note match. Lower the minimum or analyze a different chord group.`;
    return;
  }

  for (const candidate of candidates) {
    el.tabScaleRecommendations.add(
      new Option(`${candidate.name} (${Math.round(candidate.fit)}%)`, candidate.name)
    );
  }
  el.tabScaleRecommendations.value = tabScaleAnalysis.selected.name;
  el.tabScaleRecommendations.disabled = false;
  el.tabScaleResult.textContent = tabScaleAnalysis.entireSong
    ? `Best match across the whole song: ${tabScaleAnalysis.selected.name}.`
    : tabScaleAnalysis.behavior === 'static'
      ? `Using the initial ${reference.segments.length}-chord group: ${tabScaleAnalysis.selected.name}.`
      : `Using ${reference.segments.length} nearby chords: ${tabScaleAnalysis.selected.name}.`;
  setActiveTabScale(tabScaleAnalysis.selected);
}

function configureTabScaleAnalysis() {
  if (!tabChords) {
    tabScaleAnalysis = null;
    activeTabScale = null;
    el.tabScaleRecommendations.replaceChildren(new Option('Run Analyse Tab Chords first', ''));
    el.tabScaleRecommendations.disabled = true;
    el.tabScaleResult.textContent = 'Run Analyse Tab Chords to find scale suggestions. None leaves the tab notes and chord overlays without a scale.';
    return;
  }

  if (el.tabScaleStyle.value === 'none') {
    tabScaleAnalysis = null;
    activeTabScale = null;
    el.tabScaleRecommendations.replaceChildren(new Option('No scale selected', ''));
    el.tabScaleRecommendations.disabled = true;
    el.tabScaleResult.textContent = 'No scale selected. Tab notes and chord overlays remain visible.';
    return;
  }

  const configuredMinimum = Number(el.tabScaleMinimumFit.value);
  tabScaleAnalysis = {
    style: el.tabScaleStyle.value,
    chordCount: Math.max(
      2,
      Math.min(
        tabChords.segments.length,
        Math.floor(Number(el.tabScaleChordCount.value)) || 2
      )
    ),
    minimumFit: Number.isFinite(configuredMinimum)
      ? Math.max(0, Math.min(100, configuredMinimum))
      : 50,
    behavior: el.tabScaleBehavior.value,
    entireSong: el.tabScaleEntireSong.checked,
    lastWindowKey: null,
    candidates: [],
    selected: null,
  };
  updateTabScaleRecommendation(tabChords.current ?? tabChords.segments[0]);
}

function refreshScaleWithTabDisplay() {
  if (!settings.showScaleWithTab && !activeTabScale && !tabChords) return;
  const groups = [...(scorePlaying ? scaleWithTabGroups() : []), ...currentGroups(lastBeat)];
  fretboard.setGroups(groups);
  if (guitar.status === 'connected') guitar.sendSegment([...overlayLedGroups(), ...groups]);
}

/** Resend the current score lights and overlay to the guitar when paused or just after analysis starts */
function resendLeds() {
  if (guitar.status !== 'connected') return;
  const scale = scorePlaying ? scaleWithTabGroups() : [];
  guitar.sendSegment([...overlayLedGroups(), ...scale, ...currentGroups(lastBeat)]);
}

function showTabChord(seg) {
  if (!tabChords) return;
  if (
    seg?.start === tabChords.current?.start &&
    (seg?.name ?? null) === (tabChords.current?.name ?? null) &&
    !tabChords.dirty
  ) return;
  tabChords.current = seg;
  tabChords.dirty = false;
  if (seg) updateTabScaleRecommendation(seg);
  if (!seg) {
    tabChords.variants = [];
    fretboard.setOverlay([]);
    resendLeds();
    el.tabChordName.textContent = '';
    el.tabChordDetail.textContent = '';
    return;
  }
  const limit = Number(el.tabChordCount.value) || 5;
  const notes = Number(el.tabChordNotes.value) || 3;
  const typeId = el.tabChordType.value;
  const extension = typeId ? chordTypeIntervals(typeId) : null;
  const intervals = extension
    ? tabChordIntervals(seg.quality, extension, el.tabChordFullExtension.checked, notes)
    : seg.quality;
  const variants = inversionVoicings(seg.root, intervals, settings.tuning, limit, { notes });
  tabChords.variants = variants;
  fretboard.setOverlay(el.tabScaleShowChordInversions.checked ? variants : []);
  resendLeds();
  const rootName = seg.name.match(/^[A-G][#b]?/)[0];
  el.tabChordName.textContent = typeId
    ? `${rootName} ${typeId}${el.tabChordFullExtension.checked ? '' : ' add-on'}`
    : seg.name;
  el.tabChordDetail.replaceChildren();
  variants.forEach((v, i) => {
    const s = document.createElement('span');
    s.style.color = v.color.hex;
    s.style.textShadow = '0 0 1px #000';
    s.textContent = `${i + 1}: ${v.label}`;
    if (i) el.tabChordDetail.append(' · ');
    el.tabChordDetail.append(s);
  });
}

function analyzeTabChords() {
  const track = api?.tracks?.[0];
  if (!track) {
    toast('Load a tab first', true);
    return;
  }
  const segments = analyzeTrack(track);
  if (!segments.length) {
    toast('No chords could be detected in this track', true);
    return;
  }
  tabChords = { segments, current: null, dirty: true };
  configureTabScaleAnalysis();
  el.tabChordBtn.textContent = 'Re-analyse Tab Chords';
  toast(`Found ${new Set(segments.map((s) => s.name)).size} chords in ${segments.length} sections`);
  showTabChord(segments[0]);
}

function resetTabChords(redraw = true) {
  const hadDisplay = Boolean(tabChords?.variants?.length || activeTabScale || settings.showScaleWithTab);
  tabChords = null;
  fretboard.setOverlay([]);
  el.tabChordName.textContent = '';
  el.tabChordDetail.textContent = '';
  el.tabChordBtn.textContent = 'Analyse Tab Chords';
  tabScaleAnalysis = null;
  activeTabScale = null;
  el.tabScaleRecommendations.replaceChildren(new Option('Run Analyse Tab Chords first', ''));
  el.tabScaleRecommendations.disabled = true;
  el.tabScaleResult.textContent = 'Run Analyse Tab Chords to find scale suggestions. None leaves the tab notes and chord overlays without a scale.';
  if (hadDisplay && redraw) resendLeds();
}

on(el.tabChordBtn, 'click', analyzeTabChords);
on(el.tabScaleShowChordInversions, 'change', () => {
  fretboard.setOverlay(
    el.tabScaleShowChordInversions.checked ? tabChords?.variants ?? [] : []
  );
  resendLeds();
});
el.tabChordType.append(new Option('Auto (from tab)', ''));
for (const t of CHORD_TYPES) el.tabChordType.append(new Option(t.id, t.id));
for (const sel of [el.tabChordCount, el.tabChordNotes, el.tabChordType, el.tabChordFullExtension]) {
  on(sel, 'change', () => {
    if (tabChords) {
      tabChords.dirty = true;
      showTabChord(tabChords.current);
    }
  });
}

function updateTabScaleAnalysisControls() {
  const entireSong = el.tabScaleEntireSong.checked;
  el.tabScaleChordCount.disabled = entireSong;
  el.tabScaleBehavior.disabled = entireSong;
}

function recomputeTabScaleAnalysis() {
  updateTabScaleAnalysisControls();
  if (!tabChords) return;
  configureTabScaleAnalysis();
  refreshScaleWithTabDisplay();
}

for (const control of [
  el.tabScaleStyle,
  el.tabScaleChordCount,
  el.tabScaleMinimumFit,
  el.tabScaleBehavior,
  el.tabScaleEntireSong,
]) {
  on(control, 'change', recomputeTabScaleAnalysis);
}
updateTabScaleAnalysisControls();

on(el.tabScaleRecommendations, 'change', () => {
  const selected = tabScaleAnalysis?.candidates.find(
    (candidate) => candidate.name === el.tabScaleRecommendations.value
  );
  if (!selected || !tabScaleAnalysis) return;
  tabScaleAnalysis.selected = selected;
  setActiveTabScale(selected);
  el.tabScaleResult.textContent = tabScaleAnalysis.entireSong
    ? `Selected for the whole song: ${selected.name}.`
    : tabScaleAnalysis.behavior === 'static'
      ? `Selected for the initial chord group: ${selected.name}.`
      : `Selected scale for the current chord group: ${selected.name}.`;
  refreshScaleWithTabDisplay();
});

function onBeat(beat) {
  lastBeat = beat;
  if (tabChords && beat?.absolutePlaybackStart != null) {
    showTabChord(segmentAt(tabChords.segments, beat.absolutePlaybackStart));
  }
  const run = ++bendRun; // Cancel the bend animation still sliding from the previous beat
  const groups = [...scaleWithTabGroups(), ...currentGroups(beat)];
  fretboard.setGroups(groups);
  if (guitar.status === 'connected') guitar.sendSegment([...overlayLedGroups(), ...groups]);
  const bends = bendTargets(beat);
  if (bends.length) animateBends(bends, groups, run);
}

let scaleActive = false;
let scorePlaying = false;

let scalePresets = {};
let scaleAuth = null;

function populateScalePresetOptions(selectedName = '') {
  const rootNote = el.scaleRoot.selectedOptions[0]?.textContent.trim();
  const matchingScales = Object.values(scalePresets)
    .filter((scale) => scale['Root Note'] === rootNote)
    .sort((a, b) => a.name.localeCompare(b.name));
  el.scalePreset.replaceChildren(new Option('Choose a scale…', ''));
  for (const scale of matchingScales) {
    const label = scale.isDefault ? scale.name : `${scale.name} (Saved)`;
    el.scalePreset.add(new Option(label, scale.name));
  }
  if (matchingScales.some((scale) => scale.name === selectedName)) {
    el.scalePreset.value = selectedName;
  }
  updateScaleDeleteButton();
}

function updateScaleDeleteButton() {
  const selected = scalePresets[el.scalePreset.value];
  el.scaleDelete.disabled = !scaleAuth?.authenticated || !selected || selected.isDefault;
}

function readScaleDefinition() {
  const intervalsText = el.scaleIntervals.value.trim();
  const intervalParts = intervalsText ? intervalsText.split(',').map((part) => part.trim()) : [];
  const intervals = intervalParts.map(Number);
  if (
    intervals.length < 4 ||
    intervals.length > 11 ||
    intervals.some((interval, index) =>
      !/^\d+$/.test(intervalParts[index]) ||
      interval < 1 ||
      interval > 11 ||
      (index > 0 && interval <= intervals[index - 1])
    )
  ) return null;
  return { root: Number(el.scaleRoot.value), intervals };
}

function scaleWithTabGroups() {
  const definition = activeTabScale ?? (settings.showScaleWithTab ? readScaleDefinition() : null);
  if (!definition) return [];

  const scale = new Set([
    definition.root,
    ...definition.intervals.map((interval) => (definition.root + interval) % 12),
  ]);
  const rootNotes = [];
  const otherNotes = [];
  for (let string = 1; string <= settings.tuning.length; string++) {
    for (let fret = 0; fret <= MAX_FRET; fret++) {
      const pitchClass = (settings.tuning[string - 1] + fret) % 12;
      if (!scale.has(pitchClass)) continue;
      const note = { string: hwString(string), fret };
      (pitchClass === definition.root ? rootNotes : otherNotes).push(note);
    }
  }

  const brightness = settings.brightness / 100;
  return [
    { leds: packNotes(rootNotes), color: scaleColor(hexToRgb(settings.colorScaleRoot), brightness) },
    { leds: packNotes(otherNotes), color: scaleColor(hexToRgb(settings.colorScaleNote), brightness) },
  ];
}

function setScaleWithTab(enabled) {
  if (enabled && !readScaleDefinition()) {
    el.toggleScaleWithTab.checked = false;
    toast('Enter 4–11 ascending semitone intervals (1–11) before showing a scale with the tab.', true);
    return;
  }
  settings.showScaleWithTab = enabled;
  el.tabChordBtn.disabled = enabled;
  save();
  if (enabled) {
    resetTabChords(false);
    clearLeds();
    return;
  }
  if (scorePlaying && lastBeat) {
    const groups = currentGroups(lastBeat);
    fretboard.setGroups(groups);
    if (guitar.status === 'connected') guitar.sendSegment([...overlayLedGroups(), ...groups]);
  } else {
    clearLeds();
  }
}

async function loadScalePresets() {
  try {
    const [authResponse, scalesResponse] = await Promise.all([
      fetch('/api/auth'),
      fetch('/api/scales'),
    ]);
    if (!authResponse.ok || !scalesResponse.ok) {
      throw new Error(`Server returned ${authResponse.status}/${scalesResponse.status}`);
    }
    const [auth, data] = await Promise.all([authResponse.json(), scalesResponse.json()]);
    if (!Array.isArray(data.scales)) throw new Error('Invalid scale data');

    scaleAuth = auth;
    scalePresets = Object.fromEntries(data.scales.map((scale) => [scale.name, scale]));
    const selected = el.scalePreset.value;
    populateScalePresetOptions(selected);
    if (tabChords && tabScaleAnalysis) {
      configureTabScaleAnalysis();
      refreshScaleWithTabDisplay();
    }

    if (auth.authenticated) {
      el.scaleAccountStatus.textContent = `Signed in as ${auth.user.email}`;
      el.googleLogin.hidden = true;
      el.googleLogout.hidden = false;
    } else if (auth.googleConfigured) {
      el.scaleAccountStatus.textContent = 'Sign in to save scales to your account.';
      el.googleLogin.hidden = false;
      el.googleLogout.hidden = true;
    } else {
      el.scaleAccountStatus.textContent = 'Google sign-in is not configured on this server.';
      el.googleLogin.hidden = false;
      el.googleLogout.hidden = true;
    }
    el.scaleSave.disabled = !auth.authenticated;
    updateScaleDeleteButton();
  } catch (error) {
    console.error('Failed to load scale presets:', error);
    toast('Unable to load scale presets.', true);
  }
}

async function saveCustomScale() {
  if (!scaleAuth?.authenticated) {
    toast('Sign in with Google to save a personal scale.', true);
    return;
  }
  const payload = {
    name: el.scaleName.value,
    rootNote: el.scaleRoot.selectedOptions[0]?.textContent.trim(),
    intervals: el.scaleIntervals.value,
    allRootNotes: el.scaleAllRoots.checked,
  };
  el.scaleSave.disabled = true;
  try {
    const response = await fetch('/api/scales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Server returned ${response.status}`);
    await loadScalePresets();
    const savedScales = result.scales ?? [result.scale];
    const rootNote = payload.rootNote;
    const selectedScale = savedScales.find((scale) => scale['Root Note'] === rootNote) ?? savedScales[0];
    el.scalePreset.value = selectedScale.name;
    updateScaleDeleteButton();
    toast(
      payload.allRootNotes
        ? `Saved ${savedScales.length} scales for all root notes.`
        : `Saved scale: ${selectedScale.name}`
    );
  } catch (error) {
    toast(error?.message ?? String(error), true);
  } finally {
    el.scaleSave.disabled = !scaleAuth?.authenticated;
  }
}

async function deleteCustomScale() {
  const scale = scalePresets[el.scalePreset.value];
  if (!scaleAuth?.authenticated || !scale || scale.isDefault) {
    updateScaleDeleteButton();
    return;
  }
  if (!window.confirm(`Delete "${scale.name}" and its saved versions for all root notes? This cannot be undone.`)) {
    return;
  }

  el.scaleDelete.disabled = true;
  try {
    const response = await fetch('/api/scales', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: scale.name, rootNote: scale['Root Note'] }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Server returned ${response.status}`);
    await loadScalePresets();
    el.scalePreset.value = '';
    updateScaleDeleteButton();
    toast(`Deleted ${result.deletedCount} custom scale${result.deletedCount === 1 ? '' : 's'}.`);
  } catch (error) {
    toast(error?.message ?? String(error), true);
    updateScaleDeleteButton();
  }
}

on(el.googleLogout, 'click', async () => {
  try {
    const response = await fetch('/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    await loadScalePresets();
    await loadTuningPresets();
    toast('Signed out.');
  } catch (error) {
    toast(error?.message ?? String(error), true);
  }
});

const authError = new URLSearchParams(location.search).get('auth_error');
if (authError) {
  const messages = {
    not_configured: 'Google sign-in is not configured on this server.',
    cancelled: 'Google sign-in was cancelled.',
    state: 'Sign-in expired or could not be verified. Please try again.',
    signin_failed: 'Google sign-in failed. Please try again.',
  };
  toast(messages[authError] || 'Google sign-in failed.', true);
  history.replaceState(null, '', location.pathname + location.hash);
}

on(el.scalePreset, 'change', () => {
  updateScaleDeleteButton();
  const preset = scalePresets[el.scalePreset.value];
  if (!preset) return;

  const rootOption = [...el.scaleRoot.options].find(
    (option) => option.textContent.trim() === preset['Root Note']
  );
  if (!rootOption || typeof preset.Intervals !== 'string') {
    toast('This scale preset has an invalid root or interval list.', true);
    return;
  }

  el.scaleRoot.value = rootOption.value;
  el.scaleIntervals.value = preset.Intervals;
  refreshScaleWithTabDisplay();
});

function clearLeds() {
  ledRun++; // Stop any running test animation
  bendRun++; // Stop the bend-slide animation
  if (scaleActive) {
    scaleActive = false;
    fretboard.setFrets(settings.frets);
  }
  fretboard.clear();
  if (guitar.status === 'connected') guitar.ledOff();
}

function sendScale() {
  const definition = readScaleDefinition();
  if (!definition) {
    toast('Enter 4–11 ascending semitone intervals (1–11) for 5–12 notes including the root.', true);
    return;
  }

  if (el.togglePaint.checked) {
    el.togglePaint.checked = false;
    setPaintMode(false);
  } else {
    clearLeds();
  }

  const { root } = definition;
  const scale = new Set([root, ...definition.intervals.map((interval) => (root + interval) % 12)]);
  const rootNotes = [];
  const otherNotes = [];
  for (let string = 1; string <= settings.tuning.length; string++) {
    for (let fret = 0; fret <= MAX_FRET; fret++) {
      const pitchClass = (settings.tuning[string - 1] + fret) % 12;
      if (!scale.has(pitchClass)) continue;
      const note = { string: hwString(string), fret };
      (pitchClass === root ? rootNotes : otherNotes).push(note);
    }
  }

  const brightness = settings.brightness / 100;
  const groups = [
    { leds: packNotes(rootNotes), color: scaleColor(hexToRgb(settings.colorScaleRoot), brightness) },
    { leds: packNotes(otherNotes), color: scaleColor(hexToRgb(settings.colorScaleNote), brightness) },
  ];
  scaleActive = true;
  fretboard.setFrets(MAX_FRET);
  fretboard.setGroups(groups);
  if (guitar.status === 'connected') guitar.sendSegment(groups);
}

function clearScale() {
  if (scaleActive) clearLeds();
}

/* ---------------- Guitar tuning ---------------- */

let tuningPresets = [];
let tuningAuthenticated = false;

function buildTuningSelects() {
  if (!el.tuningStrings) return;
  el.tuningStrings.replaceChildren();
  // Listed low string → high string, the way tunings are normally written
  for (let string = 6; string >= 1; string--) {
    const label = document.createElement('label');
    label.className = 'tuning-string';
    const caption = document.createElement('span');
    caption.textContent = `String ${string}`;
    const select = document.createElement('select');
    select.dataset.string = String(string);
    select.setAttribute('aria-label', `Open note for string ${string}`);
    for (let midi = TUNING_MIN_MIDI; midi <= TUNING_MAX_MIDI; midi++) {
      select.add(new Option(midiToName(midi), String(midi)));
    }
    on(select, 'change', () => applyTuning(readTuningSelects()));
    label.append(caption, select);
    el.tuningStrings.append(label);
  }
}

function readTuningSelects() {
  return [1, 2, 3, 4, 5, 6].map((string) =>
    Number(el.tuningStrings.querySelector(`select[data-string="${string}"]`)?.value)
  );
}

function syncTuningUi() {
  for (const select of el.tuningStrings?.querySelectorAll('select') ?? []) {
    select.value = String(settings.tuning[Number(select.dataset.string) - 1]);
  }
  if (el.tuningSummary) {
    el.tuningSummary.textContent = `Active tuning (low to high): ${describeTuning(settings.tuning)}`;
  }
  // Keep the chosen preset selected unless the strings no longer match it
  const selected = tuningPresets.find((p) => p.name === el.tuningPreset?.value);
  if (el.tuningPreset && !(selected && sameTuning(selected.notes, settings.tuning))) {
    const match = tuningPresets.find((p) => sameTuning(p.notes, settings.tuning));
    el.tuningPreset.value = match ? match.name : '';
  }
}

/** Make `next` the tuning for everything sent to the fretboard, and redraw whatever is lit. */
function applyTuning(next) {
  if (!isValidTuning(next)) return;
  settings.tuning = [...next];
  save();
  setChordTuning(settings.tuning);
  syncTuningUi();

  chart?.refresh();
  if (scaleActive) sendScale();
  else if (mode === 'chord' && chart?.beatIndex >= 0) onChordBeat(chart.beatIndex);
  else if (mode === 'picker') picker?.update();
}

async function loadTuningPresets() {
  try {
    const response = await fetch('/api/tunings');
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.tunings)) throw new Error('Invalid tuning data');

    tuningPresets = data.tunings.filter((t) => isValidTuning(t.notes));
    tuningAuthenticated = !!data.authenticated;
    el.tuningPreset.replaceChildren(new Option('Custom', ''));
    for (const tuning of tuningPresets) {
      el.tuningPreset.add(new Option(tuning.isDefault ? tuning.name : `${tuning.name} (Saved)`, tuning.name));
    }
    el.tuningSave.disabled = !tuningAuthenticated;
    syncTuningUi();
  } catch (error) {
    console.error('Failed to load tunings:', error);
    toast('Unable to load tuning presets.', true);
  }
}

async function saveCustomTuning() {
  if (!tuningAuthenticated) {
    toast('Sign in with Google to save a personal tuning.', true);
    return;
  }
  el.tuningSave.disabled = true;
  try {
    const response = await fetch('/api/tunings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: el.tuningName.value, notes: settings.tuning }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Server returned ${response.status}`);
    await loadTuningPresets();
    el.tuningPreset.value = result.tuning.name;
    toast(`Saved tuning: ${result.tuning.name}`);
  } catch (error) {
    toast(error?.message ?? String(error), true);
  } finally {
    el.tuningSave.disabled = !tuningAuthenticated;
  }
}

on(el.tuningPreset, 'change', () => {
  const preset = tuningPresets.find((p) => p.name === el.tuningPreset.value);
  if (preset) applyTuning(preset.notes);
});
on(el.tuningSave, 'click', saveCustomTuning);
on(el.tuningReset, 'click', () => {
  applyTuning(STANDARD_TUNING);
  toast('Tuning reset to standard.');
});
on(el.toggleScoreTuning, 'change', () => {
  settings.useCustomTuningForScoreNotes = el.toggleScoreTuning.checked;
  save();
});

/* ---------------- Manual LEDs: click the fretboard to build chords ---------------- */

// The on-screen fretboard uses "hardware string numbers," so a click corresponds to the physical position;
// do not apply hwString here—light exactly the clicked position.
const manualLeds = new Map(); // `${string}:${fret}` -> {string, fret}

function showManual() {
  ledRun++; // Stop the test animation
  if (!manualLeds.size) {
    fretboard.clear();
    if (guitar.status === 'connected') guitar.ledOff();
    return;
  }
  const b = settings.brightness / 100;
  const color = scaleColor(hexToRgb(settings.colorPaint), b);
  const notes = [...manualLeds.values()];
  const groups = [{ leds: packNotes(notes), color }];
  fretboard.setGroups(groups);
  if (guitar.status === 'connected') guitar.sendSegment(groups);
}

function toggleManualCell(string, fret) {
  const key = `${string}:${fret}`;
  if (manualLeds.has(key)) manualLeds.delete(key);
  else manualLeds.set(key, { string, fret });
  showManual();
}

function setPaintMode(on) {
  if (on && scaleActive) clearLeds();
  fretboard.setInteractive(on, toggleManualCell);
  document.body.classList.toggle('paint-mode', on);
  if (on) {
    showManual(); // Draw the existing manual lights on entry (there may be none)
  } else {
    manualLeds.clear();
    clearLeds();
  }
}

/* ---------------- Chord mode ---------------- */

/**
 * Which color to use for this chord.
 * When coloring by major/minor, use --major (blue) for major and --minor (red) for minor,
 * matching the score colors so the fretboard shows at a glance whether a chord is major or minor.
 */
function qualityColor(name) {
  if (!settings.colorByQuality || !name) return hexToRgb(settings.colorMain);
  const varName = chordColorClass(name) === 'minor' ? '--minor' : '--major';
  const css = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return css ? hexToRgb(css) : hexToRgb(settings.colorMain);
}

function chordGroups(beatIndex) {
  const v = chart?.voicingAt(beatIndex);
  if (!v) return [];
  const b = settings.brightness / 100;
  const color = scaleColor(qualityColor(chart.nameAt(beatIndex)), b);
  const capo = chart.capo ?? 0;
  const notes = v.notes.map((n) => ({
    string: hwString(n.string),
    // Shapes are relative to the capo; add the capo fret to get the actual position.
    // Open strings in the shape are fretted by the capo, so light the capo fret
    // (lighting fret 0 would point to the nut, not where the finger actually is).
    fret: n.fret > 0 ? n.fret + capo : capo,
  }));
  return [{ leds: packNotes(notes), color }];
}

function onChordBeat(beatIndex) {
  const groups = chordGroups(beatIndex);
  fretboard.setGroups(groups);
  if (guitar.status === 'connected') guitar.sendSegment(groups);
}

// Use a timer instead of requestAnimationFrame: rAF pauses when the window is in the background,
// which would freeze the lights; LED synchronization should not depend on whether the screen is being redrawn.
let tickTimer = null;

function chordTick() {
  if (mode === 'stems') return stemsTick();
  if (mode !== 'chord' || !chart) return stopChordTick();

  const src = clock();
  let t = src.currentTime;

  // Loop selection: jump back to the start after passing the end (more precise than audio.loop and allows looping just one section)
  const range = chart.loopRange;
  if (settings.loop && range && t >= range.end - 0.02) {
    src.currentTime = range.start;
    t = range.start;
  }

  const beat = chart.beatAtTime(t);
  if (beat !== chart.beatIndex) {
    chart.setBeat(beat);
    if (beat >= 0) onChordBeat(beat);
  }

  el.timeCur.textContent = fmtTime(t * 1000);
  const dur = src.duration;
  if (!seeking && dur) {
    el.seek.value = String(Math.round((t / dur) * 1000));
  }
  if (src.paused) {
    el.play.textContent = '▶';
    stopChordTick();
  }
}

function startChordTick() {
  if (tickTimer == null) tickTimer = setInterval(chordTick, 40);
}

function stopChordTick() {
  if (tickTimer != null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function enterChordMode(result) {
  if (mode === 'stems') exitStemsMode();
  mode = 'chord';
  activeSidebarTab = 'tracks';
  updateSidebarTabUi();
  updateScoreAudioVolume();
  document.body.classList.add('chord-mode');
  document.body.classList.remove('picker-mode');
  el.viewport.hidden = true;
  el.ccViewport.hidden = false;
  el.pkViewport.hidden = true;
  el.pickerBtn.classList.remove('on');
  el.panelChord.hidden = false;

  if (api) api.stop();

  if (!chart) {
    chart = new ChordChart(el.chordchart, {
      onSeek: (time) => {
        audio.currentTime = time;
        chart.setBeat(chart.beatAtTime(time), true);
        onChordBeat(chart.beatIndex);
        el.timeCur.textContent = fmtTime(time * 1000);
      },
      // Click a chord diagram above → open the chord browser to see every position for that chord
      onChordClick: (name) => enterPickerMode(name),
      onLoopChange: (range) => {
        // If a range is selected, use the custom loop logic instead of letting audio.loop restart the whole song
        audio.loop = settings.loop && !range;
        if (!range) return toast('Loop selection cleared.');
        toast(`Looping bars ${range.fromBar + 1}–${range.toBar + 1}${settings.loop ? '' : ' (press Loop to start)'}`);
      },
    });
  }

  chart.setAutoScroll(settings.chordAutoScroll);
  chart.setData(result);

  // Restore previously edited chords, and save any future changes
  chart.onEditsChanged((edits) => {
    saveEdits(result.media, edits);
    refreshEditCount();
  });
  const saved = loadEdits(result.media);
  if (Object.keys(saved).length) {
    chart.applyEdits(saved);
    toast(`Restored ${Object.keys(saved).length} previous manual beat edits.`);
  }
  chart.setEditMode(false);
  el.editChords?.classList.remove('on');
  refreshEditCount();

  // Restore lyrics too
  el.panelLyrics.hidden = false;
  const savedLyrics = loadLyricsRaw(result.media);
  if (savedLyrics?.text) {
    el.lyricsInput.value = savedLyrics.text;
    el.lyricsOffset.value = String((savedLyrics.offsetBar ?? 0) + 1);
    el.pinyinStyle.value = savedLyrics.style ?? 'tone';
    buildLyrics(savedLyrics.text, savedLyrics.offsetBar ?? 0, savedLyrics.style ?? 'tone')
      .then((lyrics) => chart.setLyrics(lyrics))
      .catch(() => {});
  } else {
    el.lyricsInput.value = '';
    chart.setLyrics([]);
  }

  // The scale-degree chart defaults to the detected key as "1"; the user can change it
  if (el.keyRoot) el.keyRoot.value = String(result.keyRoot ?? 0);
  if (el.displayMode) el.displayMode.value = settings.chordDisplay ?? 'chord';
  chart.setDisplayMode(settings.chordDisplay ?? 'chord');
  if (el.keyDetected) {
    el.keyDetected.textContent = `Detected key: ${result.key} (${result.keyMinor ? 'minor' : 'major'})`;
  }

  el.transpose.value = '0';
  el.transposeOut.textContent = '0';
  if (el.downbeat) el.downbeat.value = result.downbeat === result.autoDownbeat ? 'auto' : String(result.downbeat);
  chart.setCapo(settings.capo ?? 0);
  if (el.capo) el.capo.value = String(settings.capo ?? 0);
  if (el.capoOut) el.capoOut.textContent = describeCapo(settings.capo ?? 0);
  if (el.capoHint) el.capoHint.textContent = '';

  audio.src = result.media;
  audio.playbackRate = settings.speed / 100;
  audio.loop = settings.loop;
  audio.load();

  // Switch back to audio whenever a new song loads; the user can switch to video manually
  playSource = 'audio';
  el.playSource.value = 'audio';
  el.videoWrap.hidden = true;
  videoPlayer?.pause();
  const hasVideo = !!result.videoId;
  el.playSource.options[1].disabled = !hasVideo;
  el.sourceHint.textContent = hasVideo ? '' : 'This track was not sourced from YouTube, so there is no video to sync.';

  el.title.textContent = result.title || 'Chord Chart';
  el.artist.textContent = `${Math.round(result.bpm)} BPM ・ ${result.key}`;
  el.timeCur.textContent = '00:00';
  el.timeTotal.textContent = fmtTime(result.duration * 1000);
  el.seek.value = '0';
  el.play.textContent = '▶';

  // The metronome and count-in are alphaTab player features and are unavailable in audio mode
  el.metronome.disabled = true;
  el.countin.disabled = true;

  clearLeds();
}

function exitChordMode() {
  audio.pause();
  stopChordTick();
  mode = 'tab';
  activeSidebarTab = 'tracks';
  updateSidebarTabUi();
  updateScoreAudioVolume();
  document.body.classList.remove('chord-mode');
  el.viewport.hidden = false;
  el.ccViewport.hidden = true;
  el.panelChord.hidden = true;
  el.panelLyrics.hidden = true;
  el.videoWrap.hidden = true;
  el.panelMixer.hidden = true;
  if (el.jianpuWrap) el.jianpuWrap.hidden = true;
  videoPlayer?.pause();
  mixer?.pause();
  el.metronome.disabled = false;
  el.countin.disabled = false;
  clearLeds();
  restoreTabHeader();
  requestAnimationFrame(() => api?.render());
}

audio.addEventListener('play', () => {
  el.play.textContent = '⏸';
  ledRun++;
  startChordTick();
});
audio.addEventListener('pause', () => {
  el.play.textContent = '▶';
  stopChordTick();
  clearLeds();
  chart?.clearBeat();
});
audio.addEventListener('ended', () => {
  el.play.textContent = '▶';
  stopChordTick();
  clearLeds();
  chart?.clearBeat();
});
audio.addEventListener('error', () => {
  if (mode === 'chord') toast('Unable to play this audio file. Its format may not be supported by the browser.', true);
});

/* ---- Scale-degree chart ---- */

const KEY_NAMES = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];

if (el.keyRoot && !el.keyRoot.options.length) {
  KEY_NAMES.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = name;
    el.keyRoot.appendChild(opt);
  });
}

on(el.displayMode, 'change', () => {
  settings.chordDisplay = el.displayMode.value;
  chart?.setDisplayMode(settings.chordDisplay);
  save();
});

on(el.keyRoot, 'change', () => {
  chart?.setKeyRoot(Number(el.keyRoot.value));
});

/* ---- Manually adjust the first beat position (for incorrectly placed bar lines) ---- */

on(el.downbeat, 'change', async () => {
  const media = chart?.data?.media;
  if (!media) return toast('Analyze a song first.');

  const raw = el.downbeat.value;
  const downbeat = raw === 'auto' ? null : Number(raw);

  // Manual chord edits are indexed by beat number, so changing bar lines does not lose them;
  // lyrics are indexed by bar, so they shift when the bars change and must be reapplied afterward.
  const edits = chart.editsSnapshot();
  const lyricsRaw = loadLyricsRaw(media);

  el.downbeat.disabled = true;
  busy('Recalculating bars…');
  try {
    const res = await fetch(`/api/rechord?bpb=${chart.data.beatsPerBar}&simple=${el.optSimple?.checked ? 1 : 0}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media,
        title: chart.data.title,
        videoId: chart.data.videoId,
        downbeat,
      }),
    });
    const payload = await readJson(res);
    if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);

    const result = await pollJob(payload.job, (pct, msg) => busy(`${msg} ${Math.round(pct)}%`));
    busy(null);
    enterChordMode(result);
    if (Object.keys(edits).length) chart.applyEdits(edits);
    if (lyricsRaw?.text) {
      el.lyricsInput.value = lyricsRaw.text;
      el.lyricsOffset.value = String((lyricsRaw.offsetBar ?? 0) + 1);
      await applyLyricsFromInput();
    }
    toast(
      downbeat === null
        ? `Restored automatic detection (starting on beat ${result.autoDownbeat + 1})`
        : `Shifted the downbeat by ${downbeat} beat(s); recalculated ${result.bars.length} bars`
    );
  } catch (err) {
    busy(null);
    toast(err?.message ?? String(err), true);
  } finally {
    el.downbeat.disabled = false;
  }
});

/* ---- Capo ---- */

function describeCapo(n) {
  return n ? `Fret ${n}` : 'None';
}

on(el.capo, 'input', () => {
  const n = Number(el.capo.value);
  el.capoOut.textContent = describeCapo(n);
  settings.capo = n;
  chart?.setCapo(n);
  if (chart && chart.beatIndex >= 0) onChordBeat(chart.beatIndex);
  if (el.capoHint && chart?.data) {
    const beat = Math.max(0, chart.beatIndex);
    const sounding = chart.soundingAt(beat);
    const shape = chart.nameAt(beat);
    el.capoHint.textContent =
      n && sounding && shape !== sounding ? `For example, play a ${shape} shape to sound ${sounding}` : '';
  }
  save();
});

on(el.suggestCapo, 'click', () => {
  const list = chart?.suggestCapo();
  if (!list?.length) return toast('Analyze a song first.');

  const best = list[0];
  const top = list.slice(0, 3).map((s) => `${s.capo ? `Fret ${s.capo}` : 'No capo'} ${Math.round(s.ratio * 100)}%`);
  el.capo.value = String(best.capo);
  el.capo.dispatchEvent(new Event('input'));
  if (el.capoHint) {
    el.capoHint.textContent = `Capo at ${describeCapo(best.capo)}: ${best.chords.slice(0, 6).join(' ')}`;
  }
  toast(`Suggested capo: ${describeCapo(best.capo)} (${Math.round(best.ratio * 100)}% easy chords). Top options: ${top.join(', ')}`);
});

on(el.transpose, 'input', () => {
  const n = Number(el.transpose.value);
  el.transposeOut.textContent = n > 0 ? `+${n}` : String(n);
  chart?.setTranspose(n);
  if (chart && chart.beatIndex >= 0) onChordBeat(chart.beatIndex);
});

on(el.autoScroll, 'change', () => {
  settings.chordAutoScroll = el.autoScroll.checked;
  chart?.setAutoScroll(settings.chordAutoScroll);
  save();
});

on(el.exportBtn, 'click', () => {
  const text = chart?.toText();
  if (!text) return;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(chart.data.title || 'Chord Chart').replace(/[/\\?%*:|"<>]/g, '_')}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  toast('Text file exported.');
});

/* ---- Lyrics (paste them in; pinyin is added automatically) ---- */

function lyricsStoreKey(media) {
  return `litejam-lyrics:${media ?? ''}`;
}

function loadLyricsRaw(media) {
  try {
    return JSON.parse(localStorage.getItem(lyricsStoreKey(media)) ?? 'null');
  } catch {
    return null;
  }
}

function saveLyricsRaw(media, payload) {
  try {
    if (payload) localStorage.setItem(lyricsStoreKey(media), JSON.stringify(payload));
    else localStorage.removeItem(lyricsStoreKey(media));
  } catch {
    /* Writes are unavailable in private browsing */
  }
}

/** Add pinyin to text with one line per bar and place it in the corresponding bars */
async function buildLyrics(text, offsetBar, style) {
  const lines = text.replace(/\r/g, '').split('\n');
  let pinyins = lines.map(() => '');

  if (style !== 'off' && lines.some((l) => /[\u3400-\u9FFF]/.test(l))) {
    const res = await fetch('/api/pinyin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines, style }),
    });
    const payload = await readJson(res);
    if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);
    pinyins = payload.pinyin ?? pinyins;
  }

  const out = [];
  lines.forEach((line, i) => {
    out[offsetBar + i] = { text: line.trim(), pinyin: (pinyins[i] ?? '').trim() };
  });
  return out;
}

async function applyLyricsFromInput() {
  if (!chart?.data) return toast('Analyze a song first.');
  const text = el.lyricsInput.value;
  const offsetBar = Math.max(0, (Number(el.lyricsOffset.value) || 1) - 1);
  const style = el.pinyinStyle.value;

  el.applyLyrics.disabled = true;
  try {
    const lyrics = await buildLyrics(text, offsetBar, style);
    chart.setLyrics(lyrics);
    saveLyricsRaw(chart.data.media, { text, offsetBar, style });
    const filled = lyrics.filter((l) => l?.text).length;
    toast(filled ? `Lyrics applied to ${filled} bars.` : 'No lyrics entered.');
  } catch (err) {
    toast(err?.message ?? String(err), true);
  } finally {
    el.applyLyrics.disabled = false;
  }
}

on(el.applyLyrics, 'click', applyLyricsFromInput);

on(el.clearLyrics, 'click', () => {
  el.lyricsInput.value = '';
  chart?.setLyrics([]);
  if (chart?.data) saveLyricsRaw(chart.data.media, null);
  toast('Lyrics cleared.');
});

/* ---- Manual chord edits ---- */

/** Edits are stored in the browser using the audio file as the key, so they persist when the same song is reopened */
function editStoreKey(media) {
  return `litejam-edits:${media ?? ''}`;
}

function loadEdits(media) {
  try {
    return JSON.parse(localStorage.getItem(editStoreKey(media)) ?? '{}');
  } catch {
    return {};
  }
}

function saveEdits(media, edits) {
  try {
    if (Object.keys(edits).length) {
      localStorage.setItem(editStoreKey(media), JSON.stringify(edits));
    } else {
      localStorage.removeItem(editStoreKey(media));
    }
  } catch {
    /* Writes are unavailable in private browsing */
  }
}

function refreshEditCount() {
  if (!el.editCount) return;
  const n = chart?.edited.size ?? 0;
  el.editCount.textContent = n ? `${n} manually edited beats (marked with orange dots)` : '';
}

on(el.editChords, 'click', () => {
  if (!chart?.data) return toast('Analyze a song first.');
  const on_ = !chart.editMode;
  chart.setEditMode(on_);
  el.editChords.classList.toggle('on', on_);
  chart.render();
  chart.setBeat(chart.beatIndex, true);
  toast(on_ ? 'Click a chord to edit it. Matching consecutive chords are edited together.' : 'Chord editing closed.');
});

on(el.resetChords, 'click', () => {
  if (!chart?.data) return;
  if (!chart.edited.size) return toast('There are no manually edited chords.');
  const media = chart.data.media;
  chart.clearEdits();
  saveEdits(media, {});
  refreshEditCount();
  toast('Manual edits cleared. Reanalyze to restore automatic results.');
});

/* ---- Extract solo notes → create tablature ---- */

on(el.soloBtn, 'click', async () => {
  const media = chart?.data?.media;
  if (!media) return toast('Analyze a song before extracting its solo.');

  el.soloBtn.disabled = true;
  busy('Extracting solo notes…');
  try {
    const res = await fetch(`/api/melody?bpb=${chart.data.beatsPerBar ?? 4}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media, title: chart.data.title }),
    });
    const payload = await readJson(res);
    if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);

    const melody = await pollJob(payload.job, (pct, msg) => busy(`${msg} ${Math.round(pct)}%`));
    if (!melody.notes?.length) throw new Error('No clear single-note melody found. The mix may be too dense, or this section may have no lead part.');

    // Let alphaTab render actual tablature; playback and LEDs then work just like score mode
    audio.pause();
    exitChordMode();
    api.tex(melodyToTex(melody));
    busy(null);
    toast(`${melodySummary(melody)}. Timing is aligned automatically and may be approximate.`);
  } catch (err) {
    busy(null);
    toast(err?.message ?? String(err), true);
  } finally {
    el.soloBtn.disabled = false;
  }
});

/* ---- Stem view: extract the guitar stem directly as lead tablature (cleaner than the full mix) ---- */
on(el.stemSolo, 'click', async () => {
  const guitar = mixer?.tracks.find((t) => t.id === 'guitar');
  if (!guitar?.url) return toast('Split the stems first to extract a lead from the guitar track.');

  el.stemSolo.disabled = true;
  busy('Extracting lead from guitar stem…');
  try {
    const res = await fetch('/api/melody?bpb=4', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media: guitar.url, title: `${el.title.textContent || 'Lead'} (Lead)` }),
    });
    const payload = await readJson(res);
    if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);

    const melody = await pollJob(payload.job, (pct, msg) => busy(`${msg} ${Math.round(pct)}%`));
    if (!melody.notes?.length) throw new Error('No clear single-note lead found in this guitar stem.');

    mixer?.pause();
    exitStemsMode();
    api.tex(melodyToTex(melody));
    busy(null);
    toast(`${melodySummary(melody)}. Timing is aligned automatically and may be approximate.`);
  } catch (err) {
    busy(null);
    toast(err?.message ?? String(err), true);
  } finally {
    el.stemSolo.disabled = false;
  }
});

on(el.backTab, 'click', exitChordMode);
on(el.reanalyze, 'click', () => openChordModal());

/* ---------------- Chord browser: choose chords manually ---------------- */

/** Light a chord shape on the on-screen fretboard and guitar; pass null to turn the lights off */
function showVoicing(v) {
  if (!v) return clearLeds();
  ledRun++; // Stop the test animation
  const b = settings.brightness / 100;
  const color = scaleColor(qualityColor(v.name), b);
  const notes = v.notes.map((n) => ({ string: hwString(n.string), fret: n.fret }));
  const groups = [{ leds: packNotes(notes), color }];
  fretboard.setGroups(groups);
  if (guitar.status === 'connected') guitar.sendSegment(groups);
}

function enterPickerMode(chordName = null) {
  if (mode === 'stems') exitStemsMode();
  if (mode === 'chord') audio.pause();
  if (api) api.stop();

  mode = 'picker';
  activeSidebarTab = 'tracks';
  updateSidebarTabUi();
  updateScoreAudioVolume();
  document.body.classList.add('picker-mode');
  el.viewport.hidden = true;
  el.ccViewport.hidden = true;
  el.pkViewport.hidden = false;
  el.panelChord.hidden = true;
  el.panelLyrics.hidden = true;
  el.videoWrap.hidden = true;
  el.panelMixer.hidden = true;
  if (el.jianpuWrap) el.jianpuWrap.hidden = true;
  videoPlayer?.pause();
  mixer?.pause();
  el.pickerBtn.classList.add('on');

  if (!picker) {
    picker = new ChordPicker(el.chordpicker, {
      onPick: showVoicing,
      onToast: (msg) => toast(msg),
    });
  } else {
    picker.update();
  }
  if (chordName) picker.select(chordName);

  el.title.textContent = 'Chord Finder';
  el.artist.textContent = 'Select a chord to light it on the fretboard.';
  el.timeCur.textContent = '00:00';
  el.timeTotal.textContent = '00:00';
  el.seek.value = '0';
  el.play.textContent = '▶';
  el.metronome.disabled = true;
  el.countin.disabled = true;
}

function exitPickerMode(target = 'tab') {
  document.body.classList.remove('picker-mode');
  el.pkViewport.hidden = true;
  el.pickerBtn.classList.remove('on');
  el.metronome.disabled = false;
  el.countin.disabled = false;
  clearLeds();

  if (target === 'chord' && chart?.data) {
    mode = 'tab'; // Let enterChordMode take over from a clean state
    enterChordMode(chart.data);
    return;
  }

  mode = 'tab';
  activeSidebarTab = 'tracks';
  updateSidebarTabUi();
  updateScoreAudioVolume();
  el.viewport.hidden = false;
  restoreTabHeader();
  requestAnimationFrame(() => api?.render());
}

function restoreTabHeader() {
  if (api?.score) {
    el.title.textContent = api.score.title || '(Untitled)';
    el.artist.textContent = [api.score.artist, api.score.album].filter(Boolean).join(' — ');
    el.timeTotal.textContent = fmtTime(endTime);
  } else {
    el.title.textContent = 'No score loaded';
    el.artist.textContent = '';
    el.timeTotal.textContent = '00:00';
  }
  el.play.textContent = '▶';
}

on(el.pickerBtn, 'click', () => {
  if (mode === 'picker') exitPickerMode(chart?.data ? 'chord' : 'tab');
  else enterPickerMode();
});

/* ---------------- Detect chords: upload / YouTube ---------------- */

/** Switch source tab (search by song title / YouTube link / local audio file) */
function showPane(paneId) {
  for (const tab of document.querySelectorAll('.modal-tab')) {
    tab.classList.toggle('on', tab.dataset.pane === paneId);
  }
  for (const pane of document.querySelectorAll('.pane')) {
    pane.hidden = pane.id !== paneId;
  }
  const focusTarget = paneId === 'pane-search' ? el.songQ : paneId === 'pane-url' ? el.ytUrl : null;
  focusTarget?.focus();
}

for (const tab of document.querySelectorAll('.modal-tab')) {
  on(tab, 'click', () => showPane(tab.dataset.pane));
}

function openChordModal() {
  el.modal.hidden = false;
  el.jobBox.hidden = true;
  showPane('pane-search');
}

function closeChordModal() {
  el.modal.hidden = true;
}

on(el.chordBtn, 'click', openChordModal);
on(el.modalClose, 'click', closeChordModal);
on(el.modal, 'click', (e) => {
  if (e.target === el.modal) closeChordModal();
});

function analysisQuery() {
  const bpb = el.optBpb.value;
  const simple = el.optSimple.checked ? '1' : '0';
  return `bpb=${bpb}&simple=${simple}`;
}

/** Required server API version; if it does not match, tell the user to restart the server */
const NEED_API = 9;

/**
 * Read a JSON response without turning an HTML response into an incomprehensible error.
 * Calling res.json() directly on an error page throws
 * 「Unexpected token '<', "<!DOCTYPE "... is not valid JSON」，
 * and gives no clue what to do.
 */
async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (text.trimStart().startsWith('<')) {
      throw new Error(
        'The server returned a web page instead of data. It may be out of date or need a restart: ' +
          'close the terminal window, run the startup script again, then press ⌘⇧R to reload.'
      );
    }
    throw new Error(`Unexpected server response: ${text.slice(0, 60) || '(empty)'}`);
  }
}

let jobStarted = 0;
let jobTimer = null;

function setJobProgress(pct, msg) {
  el.jobBox.hidden = false;
  el.jobFill.style.width = `${Math.max(2, Math.min(100, pct))}%`;
  el.jobMsg.textContent = msg;
}

/**
 * While a job is running, hide the three source tabs and show only its progress.
 * Otherwise, search results can push the progress out of view;
 * downloading a song takes several seconds, and the user may think "nothing happened."
 */
function setJobRunning(running) {
  document.querySelector('.modal-card')?.classList.toggle('running', running);
  clearInterval(jobTimer);
  if (running) {
    jobStarted = Date.now();
    el.jobElapsed.textContent = '0 seconds elapsed';
    jobTimer = setInterval(() => {
      const s = Math.round((Date.now() - jobStarted) / 1000);
      el.jobElapsed.textContent = `${s} seconds elapsed${s > 25 ? ' (the first download may take longer)' : ''}`;
    }, 1000);
  } else {
    jobTimer = null;
    el.jobElapsed.textContent = '';
  }
}

async function pollJob(jobId, onProgress = null) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 400));
    const res = await fetch(`/api/job/${jobId}`);
    if (!res.ok) throw new Error('The server did not return this job.');
    const job = await readJson(res);
    if (onProgress) onProgress(job.progress ?? 0, job.message ?? 'Processing');
    else setJobProgress(job.progress ?? 0, job.message ?? 'Processing');
    if (job.state === 'done') return job.result;
    if (job.state === 'error') throw new Error(job.message || 'Analysis failed.');
  }
}

async function startAnalysis(request) {
  setJobProgress(2, 'Submitting…');
  setJobRunning(true);
  el.ytBtn.disabled = true;
  el.audioFileBtn.disabled = true;
  try {
    const res = await fetch(request.url, request.init);
    const payload = await readJson(res);
    if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);
    const result = await pollJob(payload.job);
    lastAnalysisSource = request;
    closeChordModal();
    enterChordMode(result);
    toast(`Detected chords in ${result.bars.length} bars.`);
  } catch (err) {
    setJobProgress(100, '');
    el.jobBox.hidden = true;
    toast(err?.message ?? String(err), true);
  } finally {
    setJobRunning(false);
    el.ytBtn.disabled = false;
    el.audioFileBtn.disabled = false;
  }
}

function youtubeRequest(url) {
  return {
    url: `/api/youtube?${analysisQuery()}`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    },
  };
}

on(el.ytBtn, 'click', () => {
  const url = el.ytUrl.value.trim();
  if (!url) return toast('Paste a YouTube URL first.');
  startAnalysis(youtubeRequest(url));
});

/* ---- Search by song title (like Songsterr, but using our own analysis backend) ---- */

function fmtDuration(sec) {
  if (!Number.isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtViews(n) {
  if (!Number.isFinite(n)) return '';
  if (n >= 1e8) return `${(n / 1e9).toFixed(1)}B views`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M views`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K views`;
  return `${n} views`;
}

let searching = false;

async function searchSongs() {
  const q = el.songQ.value.trim();
  if (q.length < 2) return toast('Enter at least two characters.');
  if (searching) return;

  searching = true;
  el.searchBtn.disabled = true;
  el.searchResults.hidden = false;
  el.searchResults.innerHTML = '<p class="muted small">Searching… (about 5–10 seconds)</p>';

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, limit: 8 }),
    });
    const payload = await readJson(res);
    if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);
    renderSearchResults(payload.results ?? []);
  } catch (err) {
    el.searchResults.innerHTML = '';
    el.searchResults.hidden = true;
    toast(err?.message ?? String(err), true);
  } finally {
    searching = false;
    el.searchBtn.disabled = false;
  }
}

function renderSearchResults(results) {
  el.searchResults.innerHTML = '';
  if (!results.length) {
    el.searchResults.innerHTML = '<p class="muted small">No results. Try another search.</p>';
    return;
  }

  for (const r of results) {
    const row = document.createElement('button');
    row.className = 'result';
    row.innerHTML = `
      ${r.thumb ? `<img class="result-thumb" src="${r.thumb}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="result-thumb"></span>'}
      <span class="result-text">
        <span class="result-title"></span>
        <span class="result-meta"></span>
      </span>
      <span class="result-go">Analyze →</span>`;
    row.querySelector('.result-title').textContent = r.title;
    row.querySelector('.result-meta').textContent = [
      r.uploader,
      fmtDuration(r.duration),
      fmtViews(r.views),
    ].filter(Boolean).join(' ・ ');

    row.addEventListener('click', () => {
      if (r.duration && r.duration > 900) {
        toast('This video is over 15 minutes long. It may be a compilation, and analysis may take a while.', true);
      }
      startAnalysis(youtubeRequest(r.url));
    });
    el.searchResults.appendChild(row);
  }
}

on(el.searchBtn, 'click', searchSongs);
on(el.songQ, 'keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    searchSongs();
  }
});

on(el.ytUrl, 'keydown', (e) => {
  if (e.key === 'Enter') el.ytBtn.click();
});

const MAX_UPLOAD_MB = 200; // Must match MAX_UPLOAD in server.py

// Both buttons share the same file picker; remember whether this is for chord detection or stem separation only
let pendingFileAction = 'analyze';
on(el.audioFileBtn, 'click', () => {
  pendingFileAction = 'analyze';
  el.audioInput?.click();
});
on(el.stemsFileBtn, 'click', () => {
  pendingFileAction = 'stems';
  el.audioInput?.click();
});

on(el.audioInput, 'change', (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  const mb = file.size / 1024 / 1024;
  if (el.fileName) el.fileName.textContent = `Selected: ${file.name} (${mb.toFixed(1)} MB)`;

  // Reject it here instead of letting the server refuse it halfway through the upload—by then the connection is gone,
  // and the browser only says "Failed to fetch," hiding the real reason
  if (mb > MAX_UPLOAD_MB) {
    return toast(
      `File is ${mb.toFixed(0)} MB, exceeding the ${MAX_UPLOAD_MB} MB limit. Convert it to MP3 before uploading: ` +
        `run ffmpeg -i "input-file" -b:a 192k output.mp3 in a terminal.`,
      true
    );
  }

  if (pendingFileAction === 'stems') {
    separateFile(file);
    return;
  }

  startAnalysis({
    url: `/api/analyze?name=${encodeURIComponent(file.name)}&${analysisQuery()}`,
    init: { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } },
  });
});

// Explain backend problems right away instead of making people click around before discovering them.
// Show the warning on both tabs because "Search by song title" is the default view.
function warnBackend(message) {
  for (const hint of [$('search-hint'), el.ytHint]) {
    if (!hint) continue;
    hint.textContent = message;
    hint.classList.add('warn');
  }
  if (el.searchBtn) el.searchBtn.disabled = true;
  if (el.ytBtn) el.ytBtn.disabled = true;
}

fetch('/api/health')
  .then((r) => (r.ok ? readJson(r) : null))
  .then((h) => {
    if (!h) return warnBackend('The server response is invalid. Chord analysis may not work.');
    if ((h.api ?? 0) < NEED_API) {
      return warnBackend(
        `The server is out of date (API ${h.api ?? '?'}, version ${NEED_API} required). ` +
          'Close the terminal window and run the startup script again.'
      );
    }
    if (!h.ytdlp) {
      warnBackend('yt-dlp was not found. Search and YouTube downloads are unavailable, but local audio still works.');
    }
  })
  .catch(() => {
    warnBackend('Local server not detected. Close this tab and launch the app with its startup script. Opening index.html directly disables chord analysis.');
    if (el.chordBtn) el.chordBtn.title = 'Launch with the startup script';
  });

/* ---------------- Bluetooth UI ---------------- */

function renderBle() {
  const s = guitar.snapshot();
  el.bleChip.dataset.status = s.status;
  el.bleText.textContent =
    s.status === 'connected' ? s.name || 'LiteJam' : s.status === 'connecting' ? 'Connecting…' : 'Disconnected';
  if (s.battery != null && s.status === 'connected') {
    el.bleBatt.hidden = false;
    el.bleBatt.textContent = `🔋 ${s.battery}%`;
  } else {
    el.bleBatt.hidden = true;
  }
  el.connect.textContent = s.status === 'connected' ? 'Disconnect' : 'Connect Guitar';
}

guitar.addEventListener('state', renderBle);
guitar.addEventListener('status', renderBle);
guitar.addEventListener('error', (e) => toast(e.detail.message, true));

on(el.connect, 'click', async () => {
  if (guitar.status === 'connected') {
    guitar.disconnect();
    toast('Disconnected.');
    return;
  }
  if (!guitar.supported) {
    toast('This browser does not support Web Bluetooth. Use Chrome or Edge; Safari is not supported.', true);
    return;
  }
  try {
    const res = await guitar.connect();
    if (res) {
      toast(`Connected to ${res.name || 'LiteJam'}.`);
      // Flash once after connecting to confirm the lights are working
      await testLeds();
    }
  } catch {
    /* The error event has already displayed the error message */
  }
});

// Test-animation generation counter: starting another test, turning off the lights, or playing stops the previous run
let ledRun = 0;

async function testLeds() {
  const run = ++ledRun;
  const b = settings.brightness / 100;
  const color = scaleColor(hexToRgb(settings.colorMain), b);
  for (const fret of [3, 5, 7, 9, 12]) {
    if (run !== ledRun) return;
    const groups = [{ leds: [{ fret, strings: [1, 2, 3, 4, 5, 6] }], color }];
    fretboard.setGroups(groups);
    if (guitar.status === 'connected') await guitar.sendSegment(groups);
    await new Promise((r) => setTimeout(r, 160));
  }
  if (run === ledRun) clearLeds();
}

on(el.test, 'click', testLeds);
on(el.off, 'click', () => {
  clearLeds();
  toast('All LEDs turned off.');
});

/* ---------------- File loading ---------------- */

async function loadFile(file) {
  if (!file) return;
  if (/\.(mid|midi)$/i.test(file.name)) {
    toast('MIDI files cannot be imported. Use Guitar Pro, MusicXML, or Capella files instead.', true);
    return;
  }
  if (mode === 'picker') exitPickerMode('tab');
  if (mode === 'chord') exitChordMode();
  if (mode === 'stems') exitStemsMode();
  busy(`Loading ${file.name}…`);
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const ok = api.load(buf, [0]);
    if (!ok) {
      busy(null);
      toast(`Unsupported file format: ${file.name}`, true);
    }
  } catch (err) {
    busy(null);
    toast(`Failed to load: ${err?.message ?? err}`, true);
  }
}

async function loadDemo() {
  busy('Loading demo score…');
  try {
    const res = await fetch('sample/demo.gp');
    if (!res.ok) throw new Error(`Could not find sample/demo.gp (${res.status})`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!api.load(buf, [0])) throw new Error('Could not parse the demo score.');
  } catch (err) {
    busy(null);
    toast(err?.message ?? String(err), true);
  }
}

$('btn-demo')?.addEventListener('click', loadDemo);

on(el.open, 'click', () => el.file.click());
on(el.file, 'change', (e) => {
  loadFile(e.target.files?.[0]);
  e.target.value = '';
});

for (const type of ['dragenter', 'dragover']) {
  on(el.viewport, type, (e) => {
    e.preventDefault();
    el.viewport.classList.add('dragover');
  });
}
for (const type of ['dragleave', 'drop']) {
  on(el.viewport, type, (e) => {
    e.preventDefault();
    el.viewport.classList.remove('dragover');
  });
}
on(el.viewport, 'drop', (e) => loadFile(e.dataTransfer?.files?.[0]));

/* ---------------- Playback controls ---------------- */

on(el.play, 'click', () => {
  if (mode === 'picker') return toast('There is nothing to play in Chord Finder. Select a chord to light it.');
  if (mode === 'chord' || mode === 'stems') {
    const src = clock();
    if (src.paused) {
      const p = src.play();
      if (p?.catch) p.catch((err) => toast(`Playback failed: ${err.message}`, true));
      el.play.textContent = '⏸';
      startChordTick();
    } else {
      src.pause();
    }
    return;
  }
  if (!scoreLoaded) return toast('Open a score or select Analyze Chords to analyze an audio file.');
  if (tabStemMixer?.ready) {
    tabStemMixer.ctx.resume().catch((error) => toast(`Stem audio could not start: ${error.message}`, true));
  }
  api.playPause();
});

on(el.stop, 'click', () => {
  if (mode === 'picker') return clearLeds();
  if (mode === 'chord' || mode === 'stems') {
    const src = clock();
    src.pause();
    src.currentTime = 0;
    el.seek.value = '0';
    el.timeCur.textContent = '00:00';
  } else {
    api?.stop();
    scorePositionMs = 0;
    if (tabStemMixer?.ready) tabStemMixer.currentTime = 0;
    updateTabStemPlayhead(0);
  }
  clearLeds();
});

on(el.rewind, 'click', () => {
  if (mode === 'picker') return;
  if (mode === 'chord' || mode === 'stems') {
    clock().currentTime = 0;
    el.seek.value = '0';
  } else if (api) {
    api.tickPosition = 0;
    scorePositionMs = 0;
    if (tabStemMixer?.ready) tabStemMixer.currentTime = 0;
    updateTabStemPlayhead(0);
  }
  clearLeds();
});

on(el.seek, 'input', () => {
  seeking = true;
});
on(el.seek, 'change', () => {
  seeking = false;
  if (mode === 'picker') return;
  const ratio = Number(el.seek.value) / 1000;
  if (mode === 'stems') {
    const src = clock();
    if (src.duration) src.currentTime = ratio * src.duration;
  } else if (mode === 'chord') {
    const src = clock();
    if (src.duration) {
      src.currentTime = ratio * src.duration;
      chart?.setBeat(chart.beatAtTime(src.currentTime), true);
      if (chart?.beatIndex >= 0) onChordBeat(chart.beatIndex);
    }
  } else if (api && endTime > 0) {
    const targetMs = ratio * endTime;
    scorePositionMs = targetMs;
    api.timePosition = targetMs;
    syncUploadedStemPosition(targetMs, true);
    updateTabStemPlayhead(targetMs / 1000);
  }
});

on(el.speed, 'input', () => {
  settings.speed = Number(el.speed.value);
  el.speedOut.textContent = `${settings.speed}%`;
  if (api) api.playbackSpeed = settings.speed / 100;
  audio.playbackRate = settings.speed / 100;
  if (videoPlayer?.available) videoPlayer.setRate(settings.speed / 100);
  if (mixer?.ready) mixer.setRate(settings.speed / 100);
  if (tabStemMixer?.ready) tabStemMixer.setRate(settings.speed / 100);
  save();
});

/* ---- Audio source: downloaded audio or YouTube video ---- */

async function setPlaySource(next) {
  const prev = clock();
  const at = prev.currentTime;
  const wasPlaying = !prev.paused;
  prev.pause();

  if (next === 'video') {
    const videoId = chart?.data?.videoId;
    if (!videoId) {
      el.playSource.value = 'audio';
      playSource = 'audio';
      el.sourceHint.textContent = 'This track was not sourced from YouTube, so there is no video to sync.';
      return toast('There is no YouTube video associated with this track.', true);
    }
    busy('Loading YouTube player…');
    try {
      videoPlayer ??= new VideoPlayer(el.videoHost, {
        onStateChange: (playing) => {
          if (playSource !== 'video' || mode !== 'chord') return;
          el.play.textContent = playing ? '⏸' : '▶';
          if (playing) {
            ledRun++;
            startChordTick();
          } else {
            clearLeds();
            chart?.clearBeat();
          }
        },
      });
      await videoPlayer.load(videoId);
      videoPlayer.setRate(settings.speed / 100);
      videoPlayer.currentTime = at;
      el.videoWrap.hidden = false;
      playSource = 'video';
      el.sourceHint.textContent = 'The score follows the video. You can also use the video player controls.';
      if (wasPlaying) videoPlayer.play();
    } catch (err) {
      el.playSource.value = 'audio';
      playSource = 'audio';
      toast(err?.message ?? String(err), true);
    } finally {
      busy(null);
    }
    return;
  }

  if (next === 'stems') {
    try {
      if (!mixer?.ready || stemsMedia !== chart?.data?.media) await loadStems();
      mixer.setRate(settings.speed / 100);
      mixer.currentTime = at;
      playSource = 'stems';
      el.videoWrap.hidden = true;
      el.panelMixer.hidden = false;
      el.sourceHint.textContent = 'Adjust each track independently. M = mute; S = solo.';
      if (wasPlaying) mixer.play().catch(() => {});
    } catch (err) {
      busy(null);
      el.playSource.value = 'audio';
      playSource = 'audio';
      toast(err?.message ?? String(err), true);
    }
    return;
  }

  playSource = 'audio';
  el.videoWrap.hidden = true;
  videoPlayer?.pause();
  mixer?.pause();
  audio.currentTime = at;
  el.sourceHint.textContent = '';
  if (wasPlaying) audio.play().catch(() => {});
}

/* ---- Stem mixer ---- */

function renderMixer() {
  el.mixerTracks.innerHTML = '';
  if (!mixer?.tracks.length) return;

  for (const track of mixer.tracks) {
    const row = document.createElement('div');
    row.className = 'mx-track';
    row.innerHTML = `
      <span class="mx-name"></span>
      <input class="mx-vol" type="range" min="0" max="150" value="${Math.round(track.volume * 100)}" />
      <button class="mx-btn mx-mute" title="Mute">M</button>
      <button class="mx-btn mx-solo" title="Solo">S</button>`;
    row.querySelector('.mx-name').textContent = track.label;

    const vol = row.querySelector('.mx-vol');
    const mute = row.querySelector('.mx-mute');
    const solo = row.querySelector('.mx-solo');

    vol.addEventListener('input', () => mixer.setVolume(track.id, Number(vol.value) / 100));
    mute.addEventListener('click', () => {
      mixer.setMuted(track.id, !track.muted);
      mute.classList.toggle('on', track.muted);
    });
    solo.addEventListener('click', () => {
      const active = mixer.setSolo(track.id);
      for (const b of el.mixerTracks.querySelectorAll('.mx-solo')) b.classList.remove('on');
      if (active === track.id) solo.classList.add('on');
    });

    el.mixerTracks.appendChild(row);
  }
}

async function loadStems(media = chart?.data?.media) {
  if (!media) throw new Error('Analyze a song first.');

  busy('Splitting stems…');
  const res = await fetch('/api/stems', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media }),
  });
  const payload = await readJson(res);
  if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);

  const result = await pollJob(payload.job, (pct, msg) => busy(`${msg} ${Math.round(pct)}%`));
  if (!result.stems?.length) throw new Error('No stems were created.');

  mixer ??= new StemMixer();
  await mixer.load(result.stems, (done, total) => busy(`Loading tracks ${done}/${total}`));
  stemsMedia = media;
  renderMixer();
  busy(null);
}

on(el.playSource, 'change', () => setPlaySource(el.playSource.value));

/* ---- Stem-only mode: separate tracks for practice without detecting chords first ---- */

// Update only the timeline and playback button (there are no chord beats to follow)
function stemsTick() {
  if (mode !== 'stems') return stopChordTick();
  const src = clock();
  const t = src.currentTime;
  el.timeCur.textContent = fmtTime(t * 1000);
  const dur = src.duration;
  if (!seeking && dur) el.seek.value = String(Math.round((t / dur) * 1000));
  if (src.paused) {
    el.play.textContent = '▶';
    stopChordTick();
  }
}

async function enterStemsMode(media, title) {
  if (mode === 'chord') exitChordMode();
  if (mode === 'picker') exitPickerMode('tab');
  audio.pause();
  api?.stop();

  // Separate the tracks and load them into the mixer first (progress is shown); do not switch modes if this fails.
  try {
    await loadStems(media);
  } catch (err) {
    busy(null);
    toast(err?.message ?? String(err), true);
    return false;
  }

  mode = 'stems';
  activeSidebarTab = 'tracks';
  updateSidebarTabUi();
  updateScoreAudioVolume();
  document.body.classList.add('stems-mode');
  document.body.classList.remove('chord-mode', 'picker-mode');
  el.viewport.hidden = true;
  el.ccViewport.hidden = true;
  el.pkViewport.hidden = true;
  el.stemsView.hidden = false;
  el.panelChord.hidden = true;
  el.panelLyrics.hidden = true;
  el.videoWrap.hidden = true;
  el.pickerBtn.classList.remove('on');
  el.panelMixer.hidden = false;

  playSource = 'stems';
  mixer.setRate(settings.speed / 100);
  mixer.currentTime = 0;

  el.title.textContent = title || 'Stem Mixer';
  el.artist.textContent = 'Independent track volume · mute (M) · solo (S)';
  el.timeCur.textContent = '00:00';
  el.timeTotal.textContent = fmtTime(mixer.duration * 1000);
  el.seek.value = '0';
  el.play.textContent = '▶';
  el.metronome.disabled = true;
  el.countin.disabled = true;
  clearLeds();
  return true;
}

function exitStemsMode() {
  mixer?.pause();
  stopChordTick();
  mode = 'tab';
  activeSidebarTab = 'tracks';
  updateSidebarTabUi();
  updateScoreAudioVolume();
  playSource = 'audio';
  document.body.classList.remove('stems-mode');
  el.stemsView.hidden = true;
  el.panelMixer.hidden = true;
  el.viewport.hidden = false;
  el.metronome.disabled = false;
  el.countin.disabled = false;
  clearLeds();
  restoreTabHeader();
  requestAnimationFrame(() => api?.render());
}

async function separateFile(file) {
  const mb = file.size / 1024 / 1024;
  if (mb > MAX_UPLOAD_MB) {
    return toast(
      `File is ${mb.toFixed(0)} MB, exceeding the ${MAX_UPLOAD_MB} MB limit. Convert it to MP3 before uploading: ` +
        `run ffmpeg -i "input-file" -b:a 192k output.mp3 in a terminal.`,
      true
    );
  }
  closeChordModal();
  busy('Uploading…');
  try {
    const res = await fetch(`/api/upload-audio?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    const payload = await readJson(res);
    if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);
    const ok = await enterStemsMode(payload.media, payload.title);
    if (ok) toast('Stem splitting complete. Each track can now be adjusted independently.');
  } catch (err) {
    busy(null);
    toast(err?.message ?? String(err), true);
  }
}

/* ---- Export stems: my mix (WAV) / all stems (zip) ---- */

// AudioBuffer → 16-bit PCM WAV Blob
function audioBufferToWav(buf) {
  const numCh = buf.numberOfChannels;
  const sr = buf.sampleRate;
  const len = buf.length;
  const blockAlign = numCh * 2;
  const dataSize = len * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(ab);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + dataSize, true); wr(8, 'WAVE');
  wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, numCh, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * blockAlign, true); dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true); wr(36, 'data'); dv.setUint32(40, dataSize, true);
  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(buf.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

function downloadUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function safeName(s) {
  return String(s || 'Stems').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
}

on(el.exportMix, 'click', async () => {
  if (!mixer?.ready) return toast('Split the stems before exporting.');
  el.exportMix.disabled = true;
  busy('Rendering your mix…');
  try {
    const rendered = await mixer.renderMix();
    const blob = audioBufferToWav(rendered);
    const url = URL.createObjectURL(blob);
    downloadUrl(url, `${safeName(el.title.textContent)}_my_mix.wav`);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    busy(null);
    toast('Your mix has been exported.');
  } catch (err) {
    busy(null);
    toast(err?.message ?? String(err), true);
  } finally {
    el.exportMix.disabled = false;
  }
});

on(el.exportStems, 'click', () => {
  if (!stemsMedia) return toast('Split the stems before exporting them.');
  downloadUrl(`/api/stems-zip?media=${encodeURIComponent(stemsMedia)}`);
  toast('Downloading all stems as a ZIP. This large file may take a while.');
});

/* ---- YouTube video window: draggable and resizable (position and size are saved in the browser) ---- */
(function initVideoBox() {
  const box = el.videoWrap;
  if (!box || !el.videoHead) return;
  const STORE = 'litejam-videobox';

  function apply(state) {
    if (state.width) box.style.width = `${state.width}px`;
    if (state.left != null && state.top != null) {
      box.style.left = `${state.left}px`;
      box.style.top = `${state.top}px`;
      box.style.right = 'auto';
    }
  }

  function save() {
    const r = box.getBoundingClientRect();
    try {
      localStorage.setItem(STORE, JSON.stringify({ left: r.left, top: r.top, width: r.width }));
    } catch {
      /* Writes are unavailable in private browsing; this does not affect operation */
    }
  }

  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved) apply(saved);
  } catch {
    /* Use the default position if the saved one is invalid */
  }

  // Generic drag-until-release handling: onMove receives pointer movement
  function startDrag(handle, e, onMove) {
    e.preventDefault();
    e.stopPropagation();
    box.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => onMove(ev);
    const up = () => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      box.classList.remove('dragging');
      save();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }

  // Drag the title bar → move the window
  el.videoHead.addEventListener('pointerdown', (e) => {
    const r = box.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    box.style.right = 'auto';
    startDrag(el.videoHead, e, (ev) => {
      const w = box.offsetWidth;
      const left = Math.max(0, Math.min(ev.clientX - dx, window.innerWidth - Math.min(w, window.innerWidth * 0.5)));
      const top = Math.max(0, Math.min(ev.clientY - dy, window.innerHeight - 40));
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
    });
  });

  // Drag the bottom-right corner → resize (adjust width only; height follows the 16:9 aspect ratio)
  el.videoResize?.addEventListener('pointerdown', (e) => {
    const startX = e.clientX;
    const startW = box.offsetWidth;
    startDrag(el.videoResize, e, (ev) => {
      const w = Math.max(200, Math.min(startW + (ev.clientX - startX), window.innerWidth * 0.96));
      box.style.width = `${w}px`;
    });
  });
})();

/* ---- AI lyric transcription (Demucs separates vocals → Whisper transcribes → align to bars) ---- */

/** Place transcribed lines in the corresponding bars based on their timestamps */
function segmentsToBarLines(segments, bars) {
  const lines = new Array(bars.length).fill('');
  for (const seg of segments) {
    // Find which bar the beginning of this line falls in
    let idx = bars.findIndex((b) => seg.start < b.end);
    if (idx < 0) idx = bars.length - 1;
    lines[idx] = lines[idx] ? `${lines[idx]} ${seg.text}` : seg.text;
  }
  return lines;
}

on(el.autoLyrics, 'click', async () => {
  const media = chart?.data?.media;
  if (!media) return toast('Analyze a song first.');

  el.autoLyrics.disabled = true;
  busy('Preparing lyric transcription…');
  try {
    const res = await fetch('/api/lyrics-auto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media, model: el.whisperModel.value, language: 'zh' }),
    });
    const payload = await readJson(res);
    if (!res.ok) throw new Error(payload.error || `Server returned ${res.status}`);

    const result = await pollJob(payload.job, (pct, msg) => busy(`${msg} ${Math.round(pct)}%`));
    const segments = result.segments ?? [];
    if (!segments.length) throw new Error('No lyrics were detected. The track may be instrumental.');

    const lines = segmentsToBarLines(segments, chart.data.bars);
    // Remove trailing blank lines and move the starting bar to the first line's position
    let first = lines.findIndex((l) => l);
    if (first < 0) first = 0;
    let last = lines.length - 1;
    while (last > first && !lines[last]) last--;

    el.lyricsInput.value = lines.slice(first, last + 1).join('\n');
    el.lyricsOffset.value = String(first + 1);
    busy(null);
    await applyLyricsFromInput();
    toast(`Transcribed ${segments.length} lines starting at bar ${first + 1}. Review the results for accuracy.`);
  } catch (err) {
    busy(null);
    toast(err?.message ?? String(err), true);
  } finally {
    el.autoLyrics.disabled = false;
  }
});

function toggleButton(button, key, apply) {
  button.addEventListener('click', () => {
    settings[key] = !settings[key];
    button.classList.toggle('on', settings[key]);
    apply(settings[key]);
    save();
  });
  button.classList.toggle('on', settings[key]);
}

toggleButton(el.metronome, 'metronome', (v) => api && (api.metronomeVolume = v ? 1 : 0));
toggleButton(el.countin, 'countIn', (v) => api && (api.countInVolume = v ? 1 : 0));
toggleButton(el.loop, 'loop', (v) => {
  if (api) api.isLooping = v;
  // When a section is selected, chordTick handles jumping back to the start; audio.loop must not also be enabled
  audio.loop = v && !chart?.loopRange;
  if (v && chart?.loopRange) {
    const r = chart.loopRange;
    toast(`Looping bars ${r.fromBar + 1}–${r.toBar + 1}.`);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    el.play.click();
  } else if (e.key === 'Escape') {
    if (!el.modal.hidden) return closeChordModal();
    document.body.classList.remove('clean');
    el.clean.classList.remove('on');
  }
});

/* ---------------- Display settings ---------------- */

on(el.stave, 'change', () => {
  settings.stave = el.stave.value;
  api.settings.display.staveProfile = staveProfile(settings.stave);
  api.updateSettings();
  api.render();
  save();
});

on(el.layout, 'change', () => {
  settings.layout = el.layout.value;
  api.settings.display.layoutMode =
    settings.layout === 'horizontal' ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page;
  api.updateSettings();
  api.render();
  save();
});

on(el.zoom, 'input', () => {
  settings.zoom = Number(el.zoom.value);
  el.zoomOut.textContent = `${settings.zoom}%`;
  save();
});
on(el.zoom, 'change', () => {
  api.settings.display.scale = settings.zoom / 100;
  api.updateSettings();
  api.render();
});

on(el.frets, 'input', () => {
  settings.frets = Number(el.frets.value);
  el.fretsOut.textContent = String(settings.frets);
  fretboard.setFrets(settings.frets);
  save();
});

/* ---- Numbered notation ---- */

if (el.jianpuKey && !el.jianpuKey.options.length) {
  ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'].forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = name;
    el.jianpuKey.appendChild(opt);
  });
}

function renderJianpu() {
  if (!el.jianpuWrap) return;
  const show = settings.showJianpu && mode === 'tab' && activeSidebarTab === 'tracks' && api?.score;
  el.jianpuWrap.hidden = !show;
  if (!show) return;

  const keyRoot = Number(el.jianpuKey?.value ?? 0);
  const trackIndex = api.tracks?.[0]?.index ?? 0;
  const data = scoreToJianpu(api.score, { keyRoot, trackIndex });
  el.jianpu.innerHTML = jianpuHtml(data);
  if (el.jianpuInfo) {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    el.jianpuInfo.textContent = `1 = ${names[keyRoot]} · ${data.bars.length} bars (melody follows the highest note)`;
  }
}

on(el.toggleJianpu, 'change', () => {
  settings.showJianpu = el.toggleJianpu.checked;
  if (el.jianpuKeyRow) el.jianpuKeyRow.hidden = !settings.showJianpu;
  save();
  renderJianpu();
  if (settings.showJianpu && mode !== 'tab') toast('Numbered notation requires a score. Load a score or extract a solo first.');
});

on(el.jianpuKey, 'change', renderJianpu);

on(el.toggleFretboard, 'change', () => {
  settings.showFretboard = el.toggleFretboard.checked;
  el.fretWrap.classList.toggle('hidden', !settings.showFretboard);
  save();
});

/* ---------------- LED settings ---------------- */

on(el.colorMain, 'input', () => {
  settings.colorMain = el.colorMain.value;
  save();
});
on(el.colorNext, 'input', () => {
  settings.colorNext = el.colorNext.value;
  save();
});
on(el.colorPaint, 'input', () => {
  settings.colorPaint = el.colorPaint.value;
  save();
  if (manualLeds.size) showManual(); // Apply the color change immediately
});
on(el.togglePaint, 'change', () => setPaintMode(el.togglePaint.checked));
on(el.paintClear, 'click', () => {
  manualLeds.clear();
  clearLeds();
});
on(el.scaleSend, 'click', sendScale);
on(el.scaleClear, 'click', clearScale);
on(el.scaleSave, 'click', saveCustomScale);
on(el.scaleDelete, 'click', deleteCustomScale);
on(el.toggleScaleWithTab, 'change', () => setScaleWithTab(el.toggleScaleWithTab.checked));
on(el.scaleRoot, 'change', () => {
  const selected = scalePresets[el.scalePreset.value];
  const rootNote = el.scaleRoot.selectedOptions[0]?.textContent.trim();
  populateScalePresetOptions(selected?.['Root Note'] === rootNote ? selected.name : '');
  refreshScaleWithTabDisplay();
});
on(el.scaleIntervals, 'input', refreshScaleWithTabDisplay);
on(el.scaleIntervals, 'change', () => {
  if (settings.showScaleWithTab && !readScaleDefinition()) {
    setScaleWithTab(false);
    toast('Scale display turned off because the interval list is invalid.', true);
  }
});
on(el.scaleRootColor, 'input', () => {
  settings.colorScaleRoot = el.scaleRootColor.value;
  save();
  if (scaleActive) sendScale();
  refreshScaleWithTabDisplay();
});
on(el.scaleNoteColor, 'input', () => {
  settings.colorScaleNote = el.scaleNoteColor.value;
  save();
  if (scaleActive) sendScale();
  refreshScaleWithTabDisplay();
});
loadScalePresets();
setChordTuning(settings.tuning);
buildTuningSelects();
syncTuningUi();
loadTuningPresets();
on(el.toggleNext, 'change', () => {
  settings.showNext = el.toggleNext.checked;
  save();
});
on(el.brightness, 'input', () => {
  settings.brightness = Number(el.brightness.value);
  el.brightnessOut.textContent = `${settings.brightness}%`;
  save();
});
on(el.toggleQualityColor, 'change', () => {
  settings.colorByQuality = el.toggleQualityColor.checked;
  save();
  // Apply immediately to the currently lit LEDs
  if (mode === 'chord' && chart?.beatIndex >= 0) onChordBeat(chart.beatIndex);
  else if (mode === 'picker' && picker) picker.update();
});

on(el.toggleReverse, 'change', () => {
  settings.reverseStrings = el.toggleReverse.checked;
  save();
});

/* ---------------- Layout switch ---------------- */

on(el.ig, 'click', () => {
  const on = document.body.classList.toggle('ig');
  el.ig.classList.toggle('on', on);
  fretboard.setOrientation(on ? 'vertical' : 'horizontal');
  // In portrait orientation the screen is narrower, so horizontal score scrolling is easier to read
  requestAnimationFrame(() => api?.render());
});

on(el.clean, 'click', () => {
  const on = document.body.classList.toggle('clean');
  el.clean.classList.toggle('on', on);
  if (on) toast('Press Esc to restore the interface.');
});

let panelToggledByUser = false;

on(el.panel, 'click', () => {
  panelToggledByUser = true;
  document.body.classList.toggle('no-panel');
  requestAnimationFrame(() => api?.render());
});

// Automatically resize the panel with the window unless the user has changed it manually
window.addEventListener('resize', () => {
  if (panelToggledByUser) return;
  document.body.classList.toggle('no-panel', window.innerWidth <= 900);
});

/* ---------------- Startup ---------------- */

function applySettingsToUi() {
  el.colorMain.value = settings.colorMain;
  el.colorNext.value = settings.colorNext;
  if (el.colorPaint) el.colorPaint.value = settings.colorPaint;
  el.scaleRootColor.value = settings.colorScaleRoot;
  el.scaleNoteColor.value = settings.colorScaleNote;
  el.toggleScaleWithTab.checked = settings.showScaleWithTab;
  el.tabChordBtn.disabled = settings.showScaleWithTab;
  el.toggleNext.checked = settings.showNext;
  el.brightness.value = String(settings.brightness);
  el.brightnessOut.textContent = `${settings.brightness}%`;
  el.toggleReverse.checked = settings.reverseStrings;
  if (el.toggleQualityColor) el.toggleQualityColor.checked = settings.colorByQuality;
  if (el.toggleScoreTuning) el.toggleScoreTuning.checked = settings.useCustomTuningForScoreNotes;
  el.stave.value = settings.stave;
  el.layout.value = settings.layout;
  el.zoom.value = String(settings.zoom);
  el.zoomOut.textContent = `${settings.zoom}%`;
  el.frets.value = String(settings.frets);
  el.fretsOut.textContent = String(settings.frets);
  el.toggleFretboard.checked = settings.showFretboard;
  if (el.toggleJianpu) el.toggleJianpu.checked = settings.showJianpu;
  if (el.jianpuKeyRow) el.jianpuKeyRow.hidden = !settings.showJianpu;
  el.fretWrap.classList.toggle('hidden', !settings.showFretboard);
  el.speed.value = String(settings.speed);
  el.speedOut.textContent = `${settings.speed}%`;
  el.autoScroll.checked = settings.chordAutoScroll;
  fretboard.setFrets(settings.frets);
}

applySettingsToUi();
renderBle();

if (window.innerWidth <= 900) document.body.classList.add('no-panel');

if (!guitar.supported) {
  el.connect.title = 'Chrome, Edge, or Opera is required';
}

if (typeof alphaTab === 'undefined') {
  toast('alphaTab was not found. Check that the vendor folder is present.', true);
} else {
  initAlphaTab();
}

window.addEventListener('beforeunload', () => {
  if (guitar.status === 'connected') guitar.ledOff();
});

// For development/debugging: access internal objects directly from the console
window.glowtab = {
  get api() {
    return api;
  },
  get chart() {
    return chart;
  },
  get picker() {
    return picker;
  },
  get video() {
    return videoPlayer;
  },
  get playSource() {
    return playSource;
  },
  setPlaySource,
  get mode() {
    return mode;
  },
  guitar,
  fretboard,
  audio,
  settings,
  testLeds,
  enterChordMode,
  exitChordMode,
  enterPickerMode,
  exitPickerMode,
  showVoicing,
};
