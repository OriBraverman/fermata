// Scales and drills: correct notes (as Verovio hears them), spelling, fingering. Needs VEROVIO_DIR.
import assert from 'assert';
import { createRequire } from 'module';
import { scalePiece, drillPiece, spell, MAJOR_KEYS, MINOR_KEYS, TYPES } from '../js/scales.js';
import { buildSteps } from '../js/score.js';

// spelling: every degree uses the next letter, and F# major has E#, Db major has Gb
const name = n => n.letter + ['bb', 'b', '', '#', '##'][n.alter + 2];
assert.strictEqual(spell('D', 'major', 4).map(name).join(' '), 'D E F# G A B C# D');
assert.strictEqual(spell('F#', 'major', 4).map(name).join(' '), 'F# G# A# B C# D# E# F#');
assert.strictEqual(spell('Db', 'major', 4).map(name).join(' '), 'Db Eb F Gb Ab Bb C Db');
assert.strictEqual(spell('A', 'harmonic', 4).map(name).join(' '), 'A B C D E F G# A');
assert.strictEqual(spell('C#', 'harmonic', 4).map(name).join(' '), 'C# D# E F# G# A B# C#');
assert.strictEqual(spell('A', 'melodic', 4).map(name).join(' '), 'A B C D E F# G# A');

const dir = process.env.VEROVIO_DIR; if (!dir) { console.log('spelling ok; skip Verovio part: set VEROVIO_DIR'); process.exit(0); }
const req = createRequire(dir + '/');
const { default: createModule } = await import('file:///' + req.resolve('verovio/wasm').replace(/\\/g, '/'));
const { VerovioToolkit } = await import('file:///' + req.resolve('verovio/esm').replace(/\\/g, '/'));
const tk = new VerovioToolkit(await createModule());
const load = p => { assert(tk.loadData(p.data), p.id + ' loads'); return buildSteps(tk); };

const melody = (steps, hand) => steps.flatMap(s => s.notes.filter(n => n.hand === hand)).map(n => n.midi);
const fingers = (steps, hand) => steps.flatMap(s => s.notes.filter(n => n.hand === hand)).map(n => n.finger).join('');
// C major, both hands, 2 octaves: pitches, the score's (not computed) fingering, and LH an octave below
{
  const { steps, hasFingering } = load(scalePiece('C', 'major', 'both', 2));
  assert(hasFingering);
  assert.deepStrictEqual(melody(steps, 'R').slice(0, 15), [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84]);
  assert.strictEqual(fingers(steps, 'R').slice(0, 15), '123123412312345');
  assert.strictEqual(fingers(steps, 'L').slice(0, 15), '543213214321321');
  assert.deepStrictEqual(melody(steps, 'L').slice(0, 3), [48, 50, 52]);
  assert(steps.every(s => s.notes.every(n => !n.auto)), 'all fingers come from the score');
}
// key signatures and accidentals come out as the right sounding pitches
for (const [key, type, want] of [['B', 'major', [71, 73, 75, 76, 78, 80, 82, 83]], ['Eb', 'major', [63, 65, 67, 68, 70, 72, 74, 75]],
  ['F#', 'harmonic', [66, 68, 69, 71, 73, 74, 77, 78]], ['D', 'melodic', [62, 64, 65, 67, 69, 71, 73, 74]]]) {
  const { steps } = load(scalePiece(key, type, 'R', 1));
  assert.deepStrictEqual(melody(steps, 'R').slice(0, 8), want, `${key} ${type}`);
}
// melodic minor comes down natural: A melodic minor down = A G F E D C B A
assert.deepStrictEqual(melody(load(scalePiece('A', 'melodic', 'R', 1)).steps, 'R').slice(7), [81, 79, 77, 76, 74, 72, 71, 69]);
// chromatic, right hand: 3 on black keys
{ const { steps } = load(scalePiece('C', 'chromatic', 'R', 1)); assert.deepStrictEqual(melody(steps, 'R').slice(0, 13), Array.from({ length: 13 }, (_, i) => 60 + i)); assert.strictEqual(fingers(steps, 'R').slice(0, 13), '1313123131312'); }
// every scale in the menu loads and goes up and back down to where it started
let n = 0;
for (const type of Object.keys(TYPES)) for (const key of type === 'major' ? MAJOR_KEYS : type === 'chromatic' ? ['C'] : MINOR_KEYS) for (const hands of ['R', 'L', 'both']) {
  const { steps } = load(scalePiece(key, type, hands, 2)); n++;
  for (const h of hands === 'both' ? ['R', 'L'] : [hands]) { const m = melody(steps, h); assert.strictEqual(m[0], m[m.length - 1], `${key} ${type} ${h} returns`); assert(m.every(x => x >= 21 && x <= 108)); }
}
// drills: the right clef, the right number of notes, within range
for (const clef of ['treble', 'bass', 'both']) for (const range of ['staff', 'ledger']) {
  const p = drillPiece({ clef, range, accidentals: true, count: 24, seed: 7 }), { steps } = load(p);
  assert.strictEqual(steps.length, 24, p.id);
  if (clef === 'bass') assert(steps.every(s => s.notes[0].hand === 'L' && s.notes[0].midi <= 66));
  if (clef === 'treble') assert(steps.every(s => s.notes[0].hand === 'R' && s.notes[0].midi >= 56));
}
console.log(`scale checks passed (${n} scale exercises loaded)`);
