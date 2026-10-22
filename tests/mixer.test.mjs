import assert from 'node:assert/strict';
import test from 'node:test';

import { StemMixer } from '../js/mixer.js';

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = {};
    this.sources = [];
  }

  createGain() {
    return {
      gain: { value: 1 },
      connect() {},
      disconnect() {},
    };
  }

  async decodeAudioData() {
    return { duration: 20 };
  }

  createBufferSource() {
    const source = {
      playbackRate: { value: 1 },
      connect() {},
      start(when, offset) {
        source.startOffset = offset;
      },
      stop() {},
      disconnect() {},
    };
    this.sources.push(source);
    return source;
  }

  async close() {
    this.state = 'closed';
  }
}

function audioFile(name) {
  return { name, async arrayBuffer() { return new ArrayBuffer(1); } };
}

test('uploaded mixer tracks stay synchronized when adding and removing lanes during playback', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = { AudioContext: FakeAudioContext };
  const mixer = new StemMixer();
  try {
    await mixer.loadFiles([audioFile('drums.wav'), audioFile('bass.wav')]);
    assert.equal(mixer.ready, true);
    assert.equal(mixer.duration, 20);

    await mixer.play();
    mixer.currentTime = 4;
    await mixer.addFiles([audioFile('guitar.wav')]);
    assert.equal(mixer.tracks.length, 3);
    assert.equal(mixer.paused, false);
    assert.ok(mixer.ctx.sources.slice(-3).every((source) => source.startOffset === 4));

    assert.equal(mixer.removeTrack(mixer.tracks[1].id), true);
    assert.equal(mixer.tracks.length, 2);
    assert.equal(mixer.paused, false);
    assert.ok(mixer.ctx.sources.slice(-2).every((source) => source.startOffset === 4));
  } finally {
    mixer.destroy();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
