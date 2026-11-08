// Browser audio: a sampled grand piano for playback, microphone capture, MIDI keyboards.
import { Detector } from './engine.js';

const SAMPLE_URL = 'https://tonejs.github.io/audio/salamander/';
// Salamander Grand Piano samples every minor third: A0, C1, D#1, F#1, A1 ... C8
const SAMPLES = []; for (let m = 21; m <= 108; m += 3) SAMPLES.push(m);
const sampleName = m => ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'][m % 12] + (Math.floor(m / 12) - 1);

export class Piano {
  constructor(ctx) { this.ctx = ctx; this.buffers = new Map(); this.loading = null; this.active = new Map(); this.out = ctx.createGain(); this.out.gain.value = 0.8; this.out.connect(ctx.destination); }
  load() {
    return this.loading ||= Promise.all(SAMPLES.map(async m => {
      try { const r = await fetch(SAMPLE_URL + sampleName(m) + '.mp3'); this.buffers.set(m, await this.ctx.decodeAudioData(await r.arrayBuffer())); } catch { /* fall back to synth for this range */ }
    }));
  }
  // play key m now (or at ctx time `at`) for `dur` seconds; dest defaults to speakers
  play(m, dur = 1, vel = 0.7, at = 0, dest = this.out) {
    const c = this.ctx, t = Math.max(at, c.currentTime), near = SAMPLES.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));
    const g = c.createGain(); g.connect(dest);
    // like a real piano, striking a key again damps the string that is still sounding
    const prev = this.active.get(m); if (prev && prev.end > t) { prev.g.gain.cancelScheduledValues(t); prev.g.gain.setTargetAtTime(0, t, 0.015); }
    this.active.set(m, { g, end: t + dur + 0.4 });
    const buf = this.buffers.get(near);
    if (buf) {
      const s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = 2 ** ((m - near) / 12); s.connect(g);
      g.gain.setValueAtTime(vel, t); g.gain.setValueAtTime(vel, t + dur); g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.35);
      s.start(t); s.stop(t + dur + 0.4);
    } else {
      const f = 440 * 2 ** ((m - 69) / 12);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * 0.3, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.4);
      for (const [h, a] of [[1, 1], [2, 0.3], [3, 0.1]]) { const o = c.createOscillator(), og = c.createGain(); o.type = h === 1 ? 'triangle' : 'sine'; o.frequency.value = f * h; og.gain.value = a; o.connect(og).connect(g); o.start(t); o.stop(t + dur + 0.45); }
    }
  }
}

// Microphone → Detector, calling onFrame({onsets, db, floor, rms}) about every 25 ms.
export class Mic {
  constructor(ctx, onFrame) { this.ctx = ctx; this.onFrame = onFrame; this.stream = null; }
  async start(opts) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const an = this.ctx.createAnalyser(); an.fftSize = 8192; an.smoothingTimeConstant = 0;
    this.ctx.createMediaStreamSource(this.stream).connect(an);
    this.detector = new Detector(this.ctx.sampleRate, opts);
    const buf = new Float32Array(an.fftSize);
    this.timer = setInterval(() => { an.getFloatTimeDomainData(buf); this.onFrame(this.detector.process(buf, performance.now())); }, 25);
  }
  stop() { clearInterval(this.timer); this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; }
  get on() { return !!this.stream; }
}

// MIDI keyboards (Chrome, Edge, Android). onNote(midi, velocity) for every key press.
export function listenMidi(onNote, onDevices) {
  if (!navigator.requestMIDIAccess) return;
  navigator.requestMIDIAccess().then(acc => {
    const bind = () => {
      const names = [];
      acc.inputs.forEach(inp => { names.push(inp.name); inp.onmidimessage = e => { const [st, m, v] = e.data; if ((st & 0xf0) === 0x90 && v > 0) onNote(m, v); }; });
      onDevices?.(names);
    };
    bind(); acc.onstatechange = bind;
  }).catch(() => {});
}
