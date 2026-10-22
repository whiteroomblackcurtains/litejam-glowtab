import assert from 'node:assert/strict';
import test from 'node:test';

import {
  audioTimeForScore,
  isScorePositionSeek,
  normalizeTabStemCalibration,
  scoreTimeForAudio,
} from '../js/tab-stem-calibration.js';

test('normalizes missing, invalid, and out-of-range calibration values', () => {
  assert.deepEqual(normalizeTabStemCalibration(), { delaySeconds: 0, ratePercent: 0 });
  assert.deepEqual(normalizeTabStemCalibration({ delaySeconds: 'bad', ratePercent: Infinity }), {
    delaySeconds: 0,
    ratePercent: 0,
  });
  assert.deepEqual(normalizeTabStemCalibration({ delaySeconds: 20, ratePercent: -10 }), {
    delaySeconds: 10,
    ratePercent: -5,
  });
});

test('maps score time to the delayed audio timeline without reapplying playback rate', () => {
  const calibration = normalizeTabStemCalibration({ delaySeconds: 2.3, ratePercent: 1.8 });
  const audioTime = audioTimeForScore(18, calibration);
  assert.equal(audioTime, 20.3);
  assert.equal(scoreTimeForAudio(audioTime, calibration), 18);
});

test('keeps negative positions at the calibrated starting point', () => {
  const calibration = normalizeTabStemCalibration({ delaySeconds: 2.3, ratePercent: 1.8 });
  assert.equal(audioTimeForScore(-1, calibration), 2.3);
  assert.equal(scoreTimeForAudio(1, calibration), 0);
});

test('detects manual score seeks without treating normal playback as a seek', () => {
  assert.equal(isScorePositionSeek(10, 10.5, 0.5, 1), false);
  assert.equal(isScorePositionSeek(10, 18, 0.5, 1), true);
  assert.equal(isScorePositionSeek(10, 2, 0.5, 1), true);
});
