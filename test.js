// Self-check for the pure logic in index.html.  Run: node test.js
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const core = /<script id="core">([\s\S]*?)<\/script>/.exec(html)[1];
const { yin, freqToMidi, createJudge, SONGS } = new Function(core + ';return {yin,freqToMidi,createJudge,SONGS}')();

// 1. songs parse, fingers 1-5
for (const s of SONGS) for (const n of s.notes) {
  assert(n.midi >= 36 && n.midi <= 84, `${s.id} midi ${n.midi}`);
  assert(n.finger >= 1 && n.finger <= 5 && n.beats > 0, `${s.id} bad token`);
}

// 2. YIN on a synthetic piano-like tone (inharmonic partials, decay, noise)
function pianoTone(midi, sr, t0) {
  const f = 440 * 2 ** ((midi - 69) / 12), buf = new Float32Array(2048), B = 0.0004;
  for (let i = 0; i < buf.length; i++) {
    const t = t0 + i / sr; let s = 0;
    for (let n = 1; n <= 8; n++) s += Math.sin(2 * Math.PI * n * f * Math.sqrt(1 + B * n * n) * t + n) / n ** 1.2 * Math.exp(-t * (1 + n));
    buf[i] = s * 0.3 + (Math.random() - 0.5) * 0.004;
  }
  return buf;
}
let exact = 0, octave = 0, total = 0;
for (const sr of [44100, 48000]) for (let m = 40; m <= 88; m++) for (const t0 of [0.05, 0.4]) {
  const hz = yin(pianoTone(m, sr, t0), sr); total++;
  const got = hz ? freqToMidi(hz) : null;
  if (got === m) exact++; else if (got != null && (got - m) % 12 === 0) octave++;
}
console.log(`pitch: ${exact}/${total} exact, ${octave} octave-off, ${total - exact - octave} wrong/none`);
assert(exact / total > 0.95, 'pitch accuracy too low');

// 3. judge: drive frames every 30 ms
function run(frames, expectedSeq, oct = true) {
  const j = createJudge({ gate: 0.01 }); let k = 0, t = 0; const out = [];
  for (const [rms, midi] of frames) { t += 30; const r = j.frame(t, rms, midi, expectedSeq[k], oct); if (r.accepted) { out.push(midi); k++; } if (r.wrong) out.push('x' + midi); }
  return out;
}
const strike = (m, n = 10, peak = 0.2) => Array.from({ length: n }, (_, i) => [peak * 0.9 ** i, m]);
// C E G in order
assert.deepStrictEqual(run([...strike(60), ...strike(64), ...strike(67)], [60, 64, 67]), [60, 64, 67]);
// one long E must not count for two E's; a second strike must
assert.deepStrictEqual(run(strike(64, 25), [64, 64]), [64]);
assert.deepStrictEqual(run([...strike(64), ...strike(64)], [64, 64]), [64, 64]);
// ringing C4 must not satisfy an expected C5 (octave-tolerant) without a new attack
assert.deepStrictEqual(run(strike(60, 25), [60, 72]), [60]);
// a wrong note is reported once, then the right one is accepted
assert.deepStrictEqual(run([...strike(62), ...strike(60)], [60]), ['x62', 60]);
// silence between notes is fine
assert.deepStrictEqual(run([...strike(60), [0, null], [0, null], ...strike(60)], [60, 60]), [60, 60]);
console.log('all checks passed');
