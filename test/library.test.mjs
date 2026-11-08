// Every library piece loads and gives practice steps, and the fast pitches (read from the MEI,
// 8va lines applied) equal Verovio's own MIDI pitches. Needs VEROVIO_DIR (`npm i verovio@6.3.0`).
import assert from 'assert';
import fs from 'fs';
import { createRequire } from 'module';
import { buildSteps } from '../js/score.js';

const dir = process.env.VEROVIO_DIR; if (!dir) { console.log('skip: set VEROVIO_DIR'); process.exit(0); }
const req = createRequire(dir + '/');
const { default: createModule } = await import('file:///' + req.resolve('verovio/wasm-hum').replace(/\\/g, '/'));
const { VerovioToolkit } = await import('file:///' + req.resolve('verovio/esm').replace(/\\/g, '/'));
const tk = new VerovioToolkit(await createModule());
const lib = new URL('../library/', import.meta.url);
const catalog = JSON.parse(fs.readFileSync(new URL('catalog.json', lib), 'utf8'));
let bad = 0, checked = 0, slow = 0;
for (const p of catalog) {
  assert(tk.loadData(fs.readFileSync(new URL(p.file, lib), 'utf8')), p.id + ' load');
  const { steps, exact } = buildSteps(tk);
  let mism = 0, k = 0;
  if (!exact) for (const s of steps) for (const n of s.notes) {
    if (k++ % 5) continue; // sample: the per-note Verovio call is slow
    const v = tk.getMIDIValuesForElement(n.id); checked++;
    if (v.pitch !== n.midi && mism++ < 2) console.log(`  ${p.id} ${n.id}: ours ${n.midi} vs verovio ${v.pitch}`);
  }
  if (mism) bad++; if (exact) slow++;
  console.log(`${mism ? 'MISMATCH' : 'ok'.padEnd(8)} ${p.id.padEnd(40)} steps ${steps.length}${exact ? ' (slow exact path)' : ''}`);
  assert(steps.length > 10, p.id + ' has steps');
}
console.log(`${checked} notes compared, ${bad} pieces with mismatches, ${slow} on the slow path`);
assert.strictEqual(bad, 0);
