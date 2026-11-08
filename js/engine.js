// Polyphonic, score-informed note detection for an acoustic piano heard through a microphone.
// Pure module (no DOM / WebAudio) so it runs the same in the browser and in node tests.
//
// Idea: we always know which notes the player should play next. Instead of blind transcription,
// every frame we measure a "salience" for each piano key (weighted sum of the spectrum at that
// key's harmonics), and report a key as struck when its salience jumps (an onset) and it stands
// out from its semitone neighbours. The wait-mode judge then only has to check that every
// expected key had an onset within a short window.

export const LOW = 21, HIGH = 108; // A0..C8

export class Spectrum {
  constructor(n) {
    this.n = n; this.re = new Float32Array(n); this.im = new Float32Array(n); this.mag = new Float32Array(n / 2);
    this.win = new Float32Array(n); for (let i = 0; i < n; i++) this.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    this.rev = new Uint32Array(n); const bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = r; }
    this.cos = new Float32Array(n / 2); this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) { this.cos[i] = Math.cos(-2 * Math.PI * i / n); this.sin[i] = Math.sin(-2 * Math.PI * i / n); }
  }
  // timeData: the most recent n samples. Returns magnitude spectrum (n/2 bins).
  compute(timeData) {
    const { n, re, im, rev, win } = this, off = timeData.length - n;
    for (let i = 0; i < n; i++) { re[rev[i]] = timeData[off + i] * win[i]; im[rev[i]] = 0; }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let s = 0; s < n; s += size) for (let k = 0; k < half; k++) {
        const c = this.cos[k * step], si = this.sin[k * step], a = s + k, b = a + half;
        const tr = re[b] * c - im[b] * si, ti = re[b] * si + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
    for (let i = 0; i < n / 2; i++) this.mag[i] = Math.hypot(re[i], im[i]);
    return this.mag;
  }
}

export const midiHz = m => 440 * 2 ** ((m - 69) / 12);

// For each key: the bin ranges of its first harmonics (with a little string inharmonicity).
export class Salience {
  constructor(sr, n, { harmonics = 16, maxHz = 5500, inharm = 0.0002 } = {}) {
    const binHz = sr / n; this.keys = [];
    for (let m = LOW; m <= HIGH; m++) {
      const f0 = midiHz(m), parts = [];
      for (let h = 1; h <= harmonics; h++) {
        const f = h * f0 * Math.sqrt(1 + inharm * h * h);
        if (f > maxHz || f > sr / 2 - 2 * binHz) break;
        const tol = f * (2 ** ((20 + 2 * h) / 1200) - 1); // ±(20+2h) cents, at least one bin
        // partials narrower than a semitone in FFT bins can't tell neighbouring keys apart: weight them down
        const resolvable = Math.min(1, (f * 0.0595 / binHz) / 3);
        parts.push({ lo: Math.max(1, Math.floor((f - Math.max(tol, binHz)) / binHz)), hi: Math.ceil((f + Math.max(tol, binHz)) / binHz), w: resolvable / h ** 0.5 });
      }
      this.keys.push(parts);
    }
    this.out = new Float32Array(128);
  }
  compute(mag) {
    const out = this.out;
    for (let k = 0; k < this.keys.length; k++) out[LOW + k] = this.sum(this.keys[k], mag);
    return out;
  }
  sum(parts, mag) { let s = 0; for (const p of parts) { let mx = 0; for (let b = p.lo; b <= p.hi; b++) if (mag[b] > mx) mx = mag[b]; s += p.w * mx; } return s; }
  // partials of key m that don't coincide with any partial of the keys in `others`
  exclusive(m, others) {
    const theirs = others.flatMap(o => this.keys[o - LOW] || []);
    return (this.keys[m - LOW] || []).filter(p => !theirs.some(q => p.lo <= q.hi && q.lo <= p.hi));
  }
}

// Turns a stream of time-domain frames into per-key onsets.
// A key is "struck" when it becomes a spectral peak (louder than both semitone neighbours and
// clearly above the noise floor) — or, if it already was one, when it jumps again together with
// a broadband attack (a repeated note).
export class Detector {
  // targetRangeDb: an expected key must be within this many dB of the loudest key to count
  constructor(sr, { n = 8192, riseDb = 6, aboveFloorDb = 14, neighbourDb = 1, historyFrames = 4, refractoryMs = 90, attackRatio = 2.2, targetRangeDb = 18 } = {}) {
    Object.assign(this, { sr, n, riseDb, aboveFloorDb, neighbourDb, historyFrames, refractoryMs, attackRatio, targetRangeDb });
    this.spec = new Spectrum(n); this.sal = new Salience(sr, n);
    this.hist = Array.from({ length: 128 }, () => new Float32Array(historyFrames).fill(-200));
    this.hi = 0; this.last = new Float64Array(128).fill(-1e9); this.db = new Float32Array(128); this.floor = null;
    this.rise = new Float32Array(128); this.peakT = new Float64Array(128).fill(-1e9);
    this.armed = new Uint8Array(128).fill(1); // one onset per attack: re-armed once the rise is over
    this.eHist = []; // short-time energy of recent hops, for broadband attack detection
    this.targets = new Set();
  }
  // Score-informed: keys the player should strike next get a more lenient re-strike threshold,
  // because they are often already ringing as an overtone of a lower note.
  // For each target, its semitone neighbours are judged only on partials the other targets can't
  // explain (D3+F4 together light up B♭3 as a "missing fundamental"; that must not mask A3).
  setTargets(midis) {
    const key = midis.join(','); if (key === this.targetKey) return; this.targetKey = key;
    this.targets = new Set(midis); this.nbParts = new Map();
    for (const m of this.targets) {
      const others = [...this.targets].filter(o => o !== m);
      this.nbParts.set(m, [m - 1, m + 1].filter(n => n >= LOW && n <= HIGH && !this.targets.has(n)).map(n => this.sal.exclusive(n, others)));
    }
  }
  // returns { onsets:[midi], db: Float32Array(128) (salience in dB), floor, rms, attack }
  process(timeData, t) {
    let e = 0; for (let i = timeData.length - this.n; i < timeData.length; i++) e += timeData[i] * timeData[i];
    const rms = Math.sqrt(e / this.n);
    let es = 0; for (let i = timeData.length - 1024; i < timeData.length; i++) es += timeData[i] * timeData[i];
    const prevE = this.eHist.length ? this.eHist.reduce((a, b) => a + b) / this.eHist.length : es;
    if (es > this.attackRatio * prevE + 1e-6) this.attackT = t;
    const attack = t - (this.attackT ?? -1e9) < 160; // the spectrum lags the attack by a few hops
    this.eHist.push(es); if (this.eHist.length > 4) this.eHist.shift();
    this.attackNow = es > this.attackRatio * prevE + 1e-6;
    const mag = this.spec.compute(timeData), sal = this.sal.compute(mag), db = this.db;
    for (let m = LOW; m <= HIGH; m++) db[m] = 20 * Math.log10(sal[m] + 1e-9);
    // noise floor: 30th percentile of key saliences, tracked slowly
    const sorted = Array.from(db.subarray(LOW, HIGH + 1)).sort((a, b) => a - b), q = sorted[Math.floor(sorted.length * 0.3)];
    this.floor = this.floor == null ? q : this.floor + (q - this.floor) * (q < this.floor ? 0.5 : 0.08);
    const onsets = [], rise = this.rise;
    for (let m = LOW; m <= HIGH; m++) { let mn = Infinity; for (const v of this.hist[m]) if (v < mn) mn = v; rise[m] = db[m] - mn; }
    let maxDb = -200; for (let m = LOW; m <= HIGH; m++) if (db[m] > maxDb) maxDb = db[m];
    for (let m = LOW; m <= HIGH; m++) {
      const tgt = this.targets.has(m);
      const nb = tgt ? Math.max(-200, ...this.nbParts.get(m).map(ps => 20 * Math.log10(this.sal.sum(ps, mag) + 1e-9)))
        : Math.max(m > LOW ? db[m - 1] : -200, m < HIGH ? db[m + 1] : -200);
      const peak = db[m] > nb + this.neighbourDb && db[m] > this.floor + this.aboveFloorDb + (m < 40 ? 4 : 0) && db[m] > maxDb - (tgt ? this.targetRangeDb : 22);
      const newPeak = peak && t - this.peakT[m] > 250 && rise[m] > 3;
      if (peak) this.peakT[m] = t;
      if (rise[m] < (tgt ? 1.5 : this.riseDb * 0.4) && !newPeak) { this.armed[m] = 1; continue; }
      const restrike = peak && (rise[m] > this.riseDb || (attack && rise[m] > 2.5) || (tgt && rise[m] > 3));
      if (this.armed[m] && (newPeak || restrike) && t - this.last[m] > this.refractoryMs) {
        onsets.push(m); this.last[m] = t; this.armed[m] = 0;
      }
    }
    for (let m = LOW; m <= HIGH; m++) this.hist[m][this.hi] = db[m];
    this.hi = (this.hi + 1) % this.historyFrames;
    return { onsets, db, floor: this.floor, rms, attack, maxDb };
  }
}

// Intervals at which a struck key's overtones light up another key.
const OVERTONE = [12, 19, 24, 28, 31, 34, 36];
// Is key m probably just an overtone of one of `sources` (louder or comparable)?
export function explainedBy(m, sources, db) {
  return sources.some(s => OVERTONE.includes(m - s) && db[s] > db[m] - 9);
}

// Wait mode: accepts the step once every expected key had an onset within `windowMs`.
// Keys struck a little ahead (while the previous step was still being recognised) are kept and
// count for the next step, so fast passages don't get stuck.
export class WaitJudge {
  constructor({ windowMs = 400 } = {}) { this.windowMs = windowMs; this.target = []; this.hits = new Map(); this.octave = false; this.recent = []; this.lastUsed = -1e9; }
  setTarget(midis, octaveOk = false, t = null) {
    this.target = [...midis]; this.hits.clear(); this.octave = octaveOk;
    if (t != null) for (const r of this.recent) {
      if (r.t > this.lastUsed + 80 && t - r.t <= 200) { const w = this.target.find(x => this.matches(r.m, x)); if (w !== undefined) this.hits.set(w, r.t); }
    }
  }
  matches(played, want) { return played === want || (this.octave && (played - want) % 12 === 0); }
  // onsets: keys struck now (from mic Detector or MIDI). Returns { accepted, wrong:[midi], hit:[midi] }.
  feed(onsets, t, db = null) {
    const hit = [], wrong = [];
    for (const m of onsets) {
      this.recent.push({ m, t });
      const tgt = this.target.find(w => this.matches(m, w));
      if (tgt !== undefined) { this.hits.set(tgt, t); hit.push(tgt); }
      else if (!db || !explainedBy(m, [...this.target, ...onsets.filter(o => o < m)], db)) wrong.push(m);
    }
    this.recent = this.recent.filter(r => t - r.t <= this.windowMs * 1.5);
    for (const [k, v] of this.hits) if (t - v > this.windowMs) this.hits.delete(k);
    const accepted = this.target.length > 0 && this.target.every(w => this.hits.has(w));
    if (accepted) { this.lastUsed = Math.max(...this.hits.values()); this.hits.clear(); }
    return { accepted, wrong, hit };
  }
}
