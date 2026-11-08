// Needs verovio from npm: set VEROVIO_DIR to a folder where `npm i verovio@6.3.0` ran.
import assert from 'assert';
import { createRequire } from 'module';
import { buildSteps } from '../js/score.js';
import fs from 'fs';

const dir = process.env.VEROVIO_DIR; if (!dir) { console.log('skip: set VEROVIO_DIR'); process.exit(0); }
const req = createRequire(dir + '/');
const { default: createVerovioModule } = await import('file:///' + req.resolve('verovio/wasm-hum').replace(/\\/g, '/'));
const { VerovioToolkit } = await import('file:///' + req.resolve('verovio/esm').replace(/\\/g, '/'));
const tk = new VerovioToolkit(await createVerovioModule());

const xml = fs.readFileSync(new URL('./fixture.musicxml', import.meta.url), 'utf8');
tk.loadData(xml);
const { steps, measures, hasFingering } = buildSteps(tk);
const show = steps.map(s => `${s.measure}:` + s.notes.map(n => `${n.hand}${n.midi}/${n.finger}${n.auto ? 'a' : ''}`).join('+'));
console.log(show.join('  '));
assert.strictEqual(measures.length, 2);
assert(hasFingering);
// C5 (finger 5) with LH C3, then the E4+G4 chord (1,3), then C5 tied over the bar (once), then D#5
assert.deepStrictEqual(steps.map(s => s.notes.map(n => n.midi).sort()), [[48, 72], [64, 67], [72], [75]]);
assert.deepStrictEqual(steps[1].notes.map(n => n.finger), [1, 3]);
assert.strictEqual(steps[0].notes.find(n => n.midi === 72).finger, 5);
assert.strictEqual(steps[3].measure, 1);
assert(steps[0].notes.find(n => n.midi === 48).hand === 'L');
assert(steps.every(s => s.notes.every(n => n.finger >= 1 && n.finger <= 5)));
console.log('score checks passed');
