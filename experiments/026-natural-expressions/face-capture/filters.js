// The 1€ filter (Casiez, Roussel and Vogel, CHI 2012): an adaptive low-pass filter that smooths jitter when a value is still and
// follows quickly when it moves. One filter per blendshape channel. Reimplemented from the paper's published algorithm.

const alpha = (cutoff, dt) => { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); };

export class OneEuro {
  constructor({ minCutoff = 1.5, beta = 0.3, dCutoff = 1 } = {}) { Object.assign(this, { minCutoff, beta, dCutoff }); this.x = null; this.dx = 0; this.t = null; }
  filter(value, time) {
    if (this.x === null) { this.x = value; this.t = time; return value; }
    const dt = Math.max(1e-3, (time - this.t) / 1000); this.t = time;
    const dx = (value - this.x) / dt;
    this.dx = this.dx + alpha(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x = this.x + alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

/** A bank of 1€ filters keyed by channel name. */
export class FilterBank {
  constructor(options) { this.options = options; this.filters = new Map(); }
  set(options) { this.options = { ...this.options, ...options }; for (const f of this.filters.values()) Object.assign(f, this.options); }
  filter(scores, time) {
    const out = {};
    for (const [name, value] of Object.entries(scores)) {
      let f = this.filters.get(name);
      if (!f) { f = new OneEuro(this.options); this.filters.set(name, f); }
      out[name] = f.filter(value, time);
    }
    return out;
  }
  reset() { this.filters.clear(); }
}
