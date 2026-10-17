// On-screen fretboard mirror: display the lights sent to the guitar in sync.
// This lets you verify the full data flow without a guitar, or use it as the main view in Instagram reels.

const SHARED_OVERLAY = { hex: '#ff6ec7', text: '#2b0020' };
const STRING_GAUGE = [3.4, 3.0, 2.6, 2.2, 1.9, 1.6]; // String 6 is thickest → string 1 is thinnest.

export class FretboardView {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.frets = 24; // Number of frets to display.
    this.orientation = 'horizontal'; // horizontal | vertical
    /** @type {Array<{leds:Array<{fret:number,strings:number[]}>, color:{r:number,g:number,b:number}}>} */
    this.groups = [];
    /** Chord-analysis overlay: each voicing is { notes:[{string,fret}] }, drawn beneath the notes on the score. */
    this.overlay = [];
    this._raf = null;
    this._pulse = 0;

    // Interactive lighting: when enabled, clicking any fretboard cell calls _onCell(string, fret).
    this.interactive = false;
    this._onCell = null;

    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    // Layout changes (Instagram portrait mode, collapsed panels) do not trigger window resize,
    // so observe the element itself.
    this._observer = new ResizeObserver(this._resize);
    this._observer.observe(canvas);

    this._onClick = this._onClick.bind(this);
    canvas.addEventListener('click', this._onClick);

    this._resize();
  }

  destroy() {
    window.removeEventListener('resize', this._resize);
    this.canvas.removeEventListener('click', this._onClick);
    this._observer?.disconnect();
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  /** Enable/disable interactive lighting. onCell(string, fret) is called when a cell is clicked. */
  setInteractive(on, onCell = null) {
    this.interactive = !!on;
    if (onCell) this._onCell = onCell;
    this.canvas.style.cursor = this.interactive ? 'pointer' : '';
  }

  /** Convert clicked screen coordinates to the nearest {string, fret}; return null if too far away. */
  _hit(px, py) {
    let best = null;
    let bestD = Infinity;
    for (let s = 1; s <= 6; s++) {
      for (let f = 0; f <= this.frets; f++) {
        const p = this._dot(s, f);
        const d = (p.x - px) ** 2 + (p.y - py) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { string: s, fret: f };
        }
      }
    }
    // Ignore clicks too far from any cell (for example, outside the fretboard).
    const short = this.orientation === 'horizontal' ? this.h : this.w;
    const limit = (short * 0.16) ** 2;
    return best && bestD <= limit ? best : null;
  }

  _onClick(e) {
    if (!this.interactive || !this._onCell) return;
    const rect = this.canvas.getBoundingClientRect();
    const hit = this._hit(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) this._onCell(hit.string, hit.fret);
  }

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
    this.draw();
  }

  setFrets(n) {
    this.frets = Math.max(5, Math.min(24, n | 0));
    this.draw();
  }

  setOrientation(o) {
    this.orientation = o === 'vertical' ? 'vertical' : 'horizontal';
    this._resize();
  }

  setGroups(groups) {
    this.groups = groups ?? [];
    this._pulse = 1;
    this.draw();
  }

  clear() {
    this.groups = [];
    this.draw();
  }

  setOverlay(variants) {
    this.overlay = variants ?? [];
    this.draw();
  }

  _overlayDot(n, color, label, r) {
    const ctx = this.ctx;
    const p = this._dot(n.string, n.fret);
    ctx.save();
    ctx.shadowColor = color.hex;
    ctx.shadowBlur = r * 1.4;
    ctx.fillStyle = color.hex;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = color.text;
    const size = label.length > 1 ? r * 0.72 : r * 1.05;
    ctx.font = `bold ${Math.max(7, size)}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, p.x, p.y + 0.5);
  }

  /** Fret number → position ratio along the neck (0 = open-string marker area, 1 = last fret). */
  _fretPos(fret) {
    // Real guitar fret spacing decreases along the neck; match it here for a realistic look.
    const scale = (n) => 1 - Math.pow(2, -n / 12);
    const total = scale(this.frets);
    const nut = 0.055; // Leave room on the left for open-string markers.
    if (fret <= 0) return nut * 0.45;
    const a = scale(fret - 1) / total;
    const b = scale(fret) / total;
    return nut + ((a + b) / 2) * (1 - nut);
  }

  _fretLinePos(fret) {
    const scale = (n) => 1 - Math.pow(2, -n / 12);
    const nut = 0.055;
    return nut + (scale(fret) / scale(this.frets)) * (1 - nut);
  }

  /** Horizontal position ratio for a string; reserve 12% at the bottom for fret numbers. */
  _across(string) {
    return 0.02 + ((string - 0.5) / 6) * 0.86;
  }

  /**
   * @returns {{x:number,y:number}} Screen coordinates for the given string and fret.
   */
  _dot(string, fret) {
    const along = this._fretPos(fret);
    const across = this._across(string); // String 1 is at the top (thin strings above, as in standard notation).
    return this.orientation === 'horizontal'
      ? { x: along * this.w, y: across * this.h }
      : { x: (1 - across) * this.w, y: along * this.h };
  }

  /** Position of fret-number labels (bottom edge of fretboard / side edge in portrait mode). */
  _labelPos(fret) {
    const along = this._fretPos(fret);
    return this.orientation === 'horizontal'
      ? { x: along * this.w, y: 0.945 * this.h }
      : { x: 0.055 * this.w, y: along * this.h };
  }

  _line(fret) {
    const along = this._fretLinePos(fret);
    return this.orientation === 'horizontal'
      ? [{ x: along * this.w, y: 0 }, { x: along * this.w, y: this.h }]
      : [{ x: 0, y: along * this.h }, { x: this.w, y: along * this.h }];
  }

  _stringLine(string) {
    const across = this._across(string);
    return this.orientation === 'horizontal'
      ? [{ x: 0, y: across * this.h }, { x: this.w, y: across * this.h }]
      : [{ x: (1 - across) * this.w, y: 0 }, { x: (1 - across) * this.w, y: this.h }];
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.w) return;
    ctx.clearRect(0, 0, this.w, this.h);

    const long = this.orientation === 'horizontal' ? this.w : this.h;
    const short = this.orientation === 'horizontal' ? this.h : this.w;

    // Fretboard background
    const grad =
      this.orientation === 'horizontal'
        ? ctx.createLinearGradient(0, 0, 0, this.h)
        : ctx.createLinearGradient(0, 0, this.w, 0);
    grad.addColorStop(0, '#15171d');
    grad.addColorStop(0.5, '#1d2029');
    grad.addColorStop(1, '#12141a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.w, this.h);

    // Nut
    const nut = this._line(0);
    ctx.strokeStyle = '#c9c6bd';
    ctx.lineWidth = Math.max(3, short * 0.018);
    ctx.beginPath();
    ctx.moveTo(nut[0].x, nut[0].y);
    ctx.lineTo(nut[1].x, nut[1].y);
    ctx.stroke();

    // Fret lines
    ctx.lineWidth = 1.2;
    for (let f = 1; f <= this.frets; f++) {
      const [a, b] = this._line(f);
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Position markers (3, 5, 7, 9, 12, 15, 17, 19, 21, 24)
    const inlays = [3, 5, 7, 9, 15, 17, 19, 21];
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    const inlayR = Math.max(2.5, short * 0.026);
    for (const f of inlays) {
      if (f > this.frets) continue;
      const p = this._dot(3.5, f);
      ctx.beginPath();
      ctx.arc(p.x, p.y, inlayR, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const f of [12, 24]) {
      if (f > this.frets) continue;
      for (const s of [2.2, 4.8]) {
        const p = this._dot(s, f);
        ctx.beginPath();
        ctx.arc(p.x, p.y, inlayR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Strings
    for (let s = 1; s <= 6; s++) {
      const [a, b] = this._stringLine(s);
      ctx.strokeStyle = 'rgba(226,226,232,0.42)';
      ctx.lineWidth = STRING_GAUGE[6 - s] * (short / 220);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Fret numbers
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.font = `${Math.max(9, short * 0.055)}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]) {
      if (f > this.frets) continue;
      const p = this._labelPos(f);
      ctx.fillText(String(f), p.x, p.y);
    }

    // Illuminated LEDs
    const r = Math.max(5, short * 0.062);

    // Chord-analysis overlay: one color per voicing (numbered from low to high along the neck);
    // notes shared by multiple voicings are pink.
    const shared = new Map();
    this.overlay.forEach((v, idx) => {
      for (const n of v.notes) {
        if (!n.shared) {
          this._overlayDot(n, v.color, String(idx + 1), r);
        } else {
          const k = `${n.string}:${n.fret}`;
          if (!shared.has(k)) shared.set(k, { n, ids: [] });
          shared.get(k).ids.push(idx + 1);
        }
      }
    });
    for (const { n, ids } of shared.values()) {
      this._overlayDot(n, SHARED_OVERLAY, ids.join('/'), r);
    }
    for (const g of this.groups) {
      const css = `rgb(${g.color.r},${g.color.g},${g.color.b})`;
      for (const led of g.leds) {
        for (const s of led.strings) {
          const p = this._dot(s, led.fret);

          ctx.save();
          ctx.shadowColor = css;
          ctx.shadowBlur = r * 2.6;
          ctx.fillStyle = css;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = r * 1.2;
          ctx.fill();
          ctx.restore();

          // Center highlight keeps the LED visible when its color is dark.
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 0.32, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Give open strings (fret 0) a separate ring to distinguish them from fretted notes.
    for (const g of this.groups) {
      for (const led of g.leds) {
        if (led.fret !== 0) continue;
        for (const s of led.strings) {
          const p = this._dot(s, 0);
          ctx.strokeStyle = `rgb(${g.color.r},${g.color.g},${g.color.b})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 1.55, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }
}
