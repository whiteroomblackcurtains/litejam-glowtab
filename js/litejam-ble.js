// LiteJam LED guitar — Web Bluetooth connection and lighting control
//
// Protocol (reverse-engineered from the glowtab.litejam.com frontend)
//   Service 0x00FF status: 0xFF01 mode / 0xFF02 battery % / 0xFF03 physical buttons (all support notify)
//   Service 0x00EE control: 0xEE01 LED mode (1B) / 0xEE02 Pattern (4B) / 0xEE03 Party (10B)
//                           0xEE04 Segment (LED group, >=4B) / 0xEE05 SoundReact (9B) / 0xEE06 SoundReactData (1B)
//
//   Segment packet format:
//     [number of groups]
//       Each group: [number of LEDs in group] ([fret][string bitmask]) x N [R][G][B]
//     Three-byte terminator: 0x45 0x4E 0x44 ("END")
//   String bitmask: bit0 = string 1 … bit5 = string 6 (0x3F = all six strings)

const SVC_STATUS = 0x00ff;
const SVC_CONTROL = 0x00ee;

const CHR = {
  MODE: 0xff01,
  BATTERY: 0xff02,
  BUTTON: 0xff03,
  LED_MODE: 0xee01,
  PATTERN: 0xee02,
  PARTY: 0xee03,
  SEGMENT: 0xee04,
  SOUND_REACT: 0xee05,
  SOUND_REACT_DATA: 0xee06,
};

// This guitar does not advertise service UUIDs, so filter by name prefix instead.
// Matching all alphanumeric prefixes should cover real-world device names (Web Bluetooth requires filters).
const NAME_PREFIXES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  .split('')
  .map((c) => ({ namePrefix: c }));

export const MAX_FRET = 24;

/** Scale {r,g,b} by brightness and clamp each channel to 0–255. */
export function scaleColor(color, brightness = 1) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * brightness)));
  return { r: c(color.r), g: c(color.g), b: c(color.b) };
}

/** #rrggbb → {r,g,b} */
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { r: 255, g: 255, b: 255 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

/**
 * Encode an LED group as Segment bytes.
 * @param {Array<{leds: Array<{fret:number, strings:number[]}>, color:{r:number,g:number,b:number}}>} groups
 */
export function encodeSegment(groups) {
  let size = 4; // 1 byte for the group count + 3 bytes for the "END" terminator
  for (const g of groups) size += 1 + g.leds.length * 2 + 3;

  const buf = new Uint8Array(size);
  let i = 0;
  buf[i++] = groups.length & 0xff;
  for (const g of groups) {
    buf[i++] = g.leds.length & 0xff;
    for (const led of g.leds) {
      buf[i++] = led.fret & 0xff;
      let mask = 0;
      for (const s of led.strings) {
        if (s >= 1 && s <= 6) mask |= 1 << (s - 1);
      }
      buf[i++] = mask & 0x3f;
    }
    buf[i++] = g.color.r & 0xff;
    buf[i++] = g.color.g & 0xff;
    buf[i++] = g.color.b & 0xff;
  }
  buf[i++] = 0x45; // E
  buf[i++] = 0x4e; // N
  buf[i++] = 0x44; // D
  return buf;
}

/** Merge multiple strings at the same fret into one entry and sort by fret (smaller packets, faster writes). */
export function packNotes(notes) {
  const byFret = new Map();
  for (const n of notes) {
    const fret = Math.max(0, Math.min(MAX_FRET, n.fret | 0));
    const string = Math.max(1, Math.min(6, n.string | 0));
    if (!byFret.has(fret)) byFret.set(fret, []);
    const arr = byFret.get(fret);
    if (!arr.includes(string)) arr.push(string);
  }
  return [...byFret.keys()]
    .sort((a, b) => a - b)
    .map((fret) => ({ fret, strings: byFret.get(fret).sort((a, b) => a - b) }));
}

export class LiteJam extends EventTarget {
  constructor() {
    super();
    this.status = 'disconnected'; // disconnected | connecting | connected
    this.deviceName = '';
    this.battery = null;
    this.mode = null;
    this.button = null;
    this.hasStatus = false;
    this.hasControl = false;
    this.lastError = null;

    this._device = null;
    this._server = null;
    this._chr = {};
    this._writeChain = Promise.resolve();
    this._pending = new Map(); // Keep only the latest pending write for each characteristic.
    this._lastSegmentHex = '';
  }

  get supported() {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _setStatus(status) {
    this.status = status;
    this._emit('status', { status });
  }

  async connect({ allDevices = false } = {}) {
    if (!this.supported) {
      this.lastError = 'This browser does not support Web Bluetooth. Use Chrome, Edge, or Opera; Safari is not supported.';
      this._emit('error', { message: this.lastError });
      throw new Error(this.lastError);
    }

    this._setStatus('connecting');
    this.lastError = null;

    try {
      const base = { optionalServices: [SVC_STATUS, SVC_CONTROL] };
      const device = await navigator.bluetooth.requestDevice(
        allDevices ? { ...base, acceptAllDevices: true } : { ...base, filters: NAME_PREFIXES }
      );

      this._device = device;
      this.deviceName = device.name ?? '';
      device.addEventListener('gattserverdisconnected', () => this._reset());

      this._server = await device.gatt.connect();

      // Status service (mode / battery / buttons)
      try {
        const svc = await this._server.getPrimaryService(SVC_STATUS);
        const mode = await svc.getCharacteristic(CHR.MODE);
        const battery = await svc.getCharacteristic(CHR.BATTERY);
        const button = await svc.getCharacteristic(CHR.BUTTON);
        Object.assign(this._chr, { mode, battery, button });
        this.hasStatus = true;

        try {
          this.mode = (await mode.readValue()).getUint8(0);
          this.battery = (await battery.readValue()).getUint8(0);
          this.button = (await button.readValue()).getUint8(0);
          this._emit('state', this.snapshot());
        } catch {
          /* Failing to read the initial value does not affect lighting control. */
        }

        const onNotify = (ev) => {
          const chr = ev.target;
          const v = chr.value.getUint8(0);
          if (chr === this._chr.mode) this.mode = v;
          else if (chr === this._chr.battery) this.battery = v;
          else if (chr === this._chr.button) {
            this.button = v;
            this._emit('button', { value: v });
          }
          this._emit('state', this.snapshot());
        };
        for (const chr of [mode, battery, button]) {
          try {
            await chr.startNotifications();
            chr.addEventListener('characteristicvaluechanged', onNotify);
          } catch {
            /* Some firmware does not support notify. */
          }
        }
      } catch {
        this.hasStatus = false;
      }

      // Control service (lights)
      try {
        const svc = await this._server.getPrimaryService(SVC_CONTROL);
        this._chr.ledMode = await svc.getCharacteristic(CHR.LED_MODE);
        this._chr.pattern = await svc.getCharacteristic(CHR.PATTERN);
        this._chr.party = await svc.getCharacteristic(CHR.PARTY);
        this._chr.segment = await svc.getCharacteristic(CHR.SEGMENT);
        this._chr.soundReact = await svc.getCharacteristic(CHR.SOUND_REACT);
        this._chr.soundReactData = await svc.getCharacteristic(CHR.SOUND_REACT_DATA);
        this.hasControl = true;
      } catch {
        this.hasControl = false;
      }

      if (!this.hasStatus || !this.hasControl) {
        const msg = 'This device is not a LiteJam guitar (required BLE services 0x00FF / 0x00EE were not found).';
        this.lastError = msg;
        try {
          this._server.disconnect();
        } catch {
          /* ignore */
        }
        this._reset();
        this._emit('error', { message: msg });
        throw new Error(msg);
      }

      this._setStatus('connected');
      this._emit('state', this.snapshot());
      return this.snapshot();
    } catch (err) {
      if (err?.name === 'NotFoundError') {
        // User-initiated cancellation is not an error.
        this._reset();
        return null;
      }
      this.lastError = this.lastError ?? (err?.message ?? String(err));
      this._reset();
      throw err;
    }
  }

  disconnect() {
    try {
      this._server?.disconnect();
    } catch {
      /* ignore */
    }
    this._reset();
  }

  _reset() {
    this._device = null;
    this._server = null;
    this._chr = {};
    this._pending.clear();
    this._lastSegmentHex = '';
    this.deviceName = '';
    this.battery = null;
    this.mode = null;
    this.button = null;
    this.hasStatus = false;
    this.hasControl = false;
    this._setStatus('disconnected');
    this._emit('state', this.snapshot());
  }

  snapshot() {
    return {
      status: this.status,
      name: this.deviceName,
      battery: this.battery,
      mode: this.mode,
      button: this.button,
      hasStatus: this.hasStatus,
      hasControl: this.hasControl,
      lastError: this.lastError,
    };
  }

  /**
   * Queue writes. BLE allows only one GATT operation at a time; concurrent writes
   * throw "GATT operation already in progress". Since the lights only care about
   * the latest state, discard stale data for the same characteristic and keep only the newest write.
   */
  _write(key, data) {
    if (this.status !== 'connected') return Promise.resolve(false);
    this._pending.set(key, data);
    this._writeChain = this._writeChain.then(async () => {
      const payload = this._pending.get(key);
      if (!payload) return false;
      this._pending.delete(key);
      const chr = this._chr[key];
      if (!chr) return false;
      try {
        if (chr.writeValueWithoutResponse) await chr.writeValueWithoutResponse(payload);
        else await chr.writeValue(payload);
        return true;
      } catch (err) {
        this._emit('error', { message: `Write failed (${key}): ${err?.message ?? err}` });
        return false;
      }
    });
    return this._writeChain;
  }

  /** LED mode: 0 = turn all lights off / relinquish control. */
  setLedMode(mode) {
    return this._write('ledMode', new Uint8Array([mode & 0xff]));
  }

  ledOff() {
    this._lastSegmentHex = '';
    return this.setLedMode(0);
  }

  /** Send an LED group; skip it if identical to the previous one to save Bluetooth bandwidth. */
  sendSegment(groups) {
    const valid = groups.filter((g) => g.leds.length > 0);
    if (valid.length === 0) return this.ledOff();
    const payload = encodeSegment(valid);
    const hex = [...payload].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex === this._lastSegmentHex) return Promise.resolve(true);
    this._lastSegmentHex = hex;
    return this._write('segment', payload);
  }

  /** Convenience method: a set of notes + a single color. */
  sendNotes(notes, color) {
    return this.sendSegment([{ leds: packNotes(notes), color }]);
  }

  sendPattern(bytes) {
    if (bytes.length !== 4) throw new Error('Pattern requires 4 bytes.');
    return this._write('pattern', bytes);
  }

  sendParty(bytes) {
    if (bytes.length !== 10) throw new Error('Party requires 10 bytes.');
    return this._write('party', bytes);
  }

  sendSoundReact(bytes) {
    if (bytes.length !== 9) throw new Error('SoundReact requires 9 bytes.');
    return this._write('soundReact', bytes);
  }
}
