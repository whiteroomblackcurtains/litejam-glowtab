// Stem mixer: play separated tracks in sync with Web Audio; adjust each track's volume, mute, or solo independently.
//
// The public interface intentionally matches <audio> (play / pause / paused / currentTime / duration),
// so the chord chart can treat it as another audio source without changing its sync logic.

export class StemMixer {
  constructor() {
    this.ctx = null;
    /** @type {Array<{id:string, label:string, url:string, buffer:AudioBuffer|null, gain:GainNode|null, volume:number, muted:boolean}>} */
    this.tracks = [];
    this.master = null;
    this.sources = [];
    this._startedAt = 0;   // Value of ctx.currentTime at start.
    this._offset = 0;      // Playback start position in the song, in seconds.
    this._playing = false;
    this._rate = 1;
    this.soloId = null;
  }

  get ready() {
    return this.tracks.length > 0 && this.tracks.every((t) => t.buffer);
  }

  get duration() {
    return this.tracks.reduce((max, t) => Math.max(max, t.buffer?.duration ?? 0), 0);
  }

  get paused() {
    return !this._playing;
  }

  get currentTime() {
    if (!this._playing) return this._offset;
    const t = this._offset + (this.ctx.currentTime - this._startedAt) * this._rate;
    return Math.min(t, this.duration);
  }

  set currentTime(t) {
    const target = Math.max(0, Math.min(t, this.duration));
    if (this._playing) {
      this._stopSources();
      this._offset = target;
      this._startSources();
    } else {
      this._offset = target;
    }
  }

  /**
   * Load the stems.
   * @param {Array<{id:string,label:string,url:string}>} stems
   * @param {(loaded:number,total:number)=>void} [onProgress]
   */
  async load(stems, onProgress) {
    this.destroy();
    this.ctx = new (window.AudioContext ?? window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);

    this.tracks = stems.map((s) => ({
      ...s,
      buffer: null,
      gain: null,
      volume: 1,
      muted: false,
    }));

    let done = 0;
    // Load stems one at a time so progress is meaningful (each full-length WAV can be large).
    for (const track of this.tracks) {
      const res = await fetch(track.url);
      if (!res.ok) throw new Error(`Failed to load ${track.label} (${res.status})`);
      track.buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
      track.gain = this.ctx.createGain();
      track.gain.connect(this.master);
      done++;
      onProgress?.(done, this.tracks.length);
    }
    this._applyGains();
  }

  _applyGains() {
    for (const t of this.tracks) {
      if (!t.gain) continue;
      const audible = this.soloId ? t.id === this.soloId : !t.muted;
      t.gain.gain.value = audible ? t.volume : 0;
    }
  }

  setVolume(id, volume) {
    const t = this.tracks.find((x) => x.id === id);
    if (!t) return;
    t.volume = Math.max(0, Math.min(1.5, volume));
    this._applyGains();
  }

  setMuted(id, muted) {
    const t = this.tracks.find((x) => x.id === id);
    if (!t) return;
    t.muted = !!muted;
    this._applyGains();
  }

  /** Pass null to cancel solo. */
  setSolo(id) {
    this.soloId = this.soloId === id ? null : id;
    this._applyGains();
    return this.soloId;
  }

  setRate(rate) {
    const next = Math.max(0.25, Math.min(2, rate));
    if (next === this._rate) return;
    const at = this.currentTime;
    this._rate = next;
    if (this._playing) {
      this._stopSources();
      this._offset = at;
      this._startSources();
    }
  }

  _startSources() {
    this.sources = [];
    const when = this.ctx.currentTime + 0.02; // Start slightly in the future so all stems begin together.
    for (const t of this.tracks) {
      if (!t.buffer) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = t.buffer;
      src.playbackRate.value = this._rate;
      src.connect(t.gain);
      src.start(when, this._offset);
      this.sources.push(src);
    }
    this._startedAt = when;
    this._playing = true;
  }

  _stopSources() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* Already stopped. */
      }
      s.disconnect();
    }
    this.sources = [];
    this._playing = false;
  }

  async play() {
    if (!this.ready) throw new Error('Stem tracks have not finished loading.');
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this._playing) return;
    if (this._offset >= this.duration - 0.05) this._offset = 0;
    this._startSources();
  }

  pause() {
    if (!this._playing) return;
    const at = this.currentTime;
    this._stopSources();
    this._offset = at;
  }

  /**
   * Render a stereo AudioBuffer offline using the current volume, mute, and solo settings.
   * Used by "Export My Mix".
   */
  async renderMix() {
    if (!this.ready) throw new Error('Stem tracks have not finished loading.');
    const sr = this.ctx.sampleRate;
    const length = Math.max(1, Math.ceil(this.duration * sr));
    const oac = new OfflineAudioContext(2, length, sr);
    for (const t of this.tracks) {
      if (!t.buffer) continue;
      const audible = this.soloId ? t.id === this.soloId : !t.muted;
      const g = oac.createGain();
      g.gain.value = audible ? t.volume : 0;
      g.connect(oac.destination);
      const src = oac.createBufferSource();
      src.buffer = t.buffer;
      src.connect(g);
      src.start(0);
    }
    return oac.startRendering();
  }

  destroy() {
    this._stopSources();
    try {
      this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.tracks = [];
    this.master = null;
    this._offset = 0;
  }
}
