import assert from 'node:assert/strict';
import test from 'node:test';

import { waveformPeaks } from '../js/waveform.js';

function audioBuffer(channels) {
  return {
    length: channels[0].length,
    numberOfChannels: channels.length,
    getChannelData(channel) {
      return Float32Array.from(channels[channel]);
    },
  };
}

test('waveformPeaks includes the loudest sample from every channel in each bin', () => {
  const peaks = waveformPeaks(
    audioBuffer([
      [0.1, -0.5, 0.2, 0.3, -0.1, 0.4],
      [0.2, 0.3, -0.6, 0.1, -0.8, 0.2],
    ]),
    3
  );
  assert.deepEqual(
    [...peaks].map((peak) => Number(peak.toFixed(5))),
    [0.5, 0.6, 0.8]
  );
});

test('waveformPeaks always returns at least one bin and does not exceed sample count', () => {
  const buffer = audioBuffer([[0.25, -0.75]]);
  assert.deepEqual([...waveformPeaks(buffer, 0)], [0.75]);
  assert.deepEqual([...waveformPeaks(buffer, 100)], [0.25, 0.75]);
});
