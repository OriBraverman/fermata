import assert from 'assert';
import { fingerHand } from '../js/fingering.js';

const seq = (keys, hand) => fingerHand(keys.map(k => ({ keys: Array.isArray(k) ? k : [k], gapMs: 0 })), hand).map(f => f.join('+')).join(' ');

// C major scale, right hand up: standard 1 2 3 1 2 3 4 5
const rhScale = seq([60, 62, 64, 65, 67, 69, 71, 72], 'R');
console.log('RH C scale :', rhScale);
assert.strictEqual(rhScale, '1 2 3 1 2 3 4 5');
// left hand up from C3: standard 5 4 3 2 1 3 2 1
const lhScale = seq([48, 50, 52, 53, 55, 57, 59, 60], 'L');
console.log('LH C scale :', lhScale);
assert.strictEqual(lhScale, '5 4 3 2 1 3 2 1');
// five-finger position stays put
assert.strictEqual(seq([60, 62, 64, 65, 67, 65, 64, 62, 60], 'R'), '1 2 3 4 5 4 3 2 1');
// triads: root position C major, RH 1-3-5; LH 5-3-1
assert.strictEqual(seq([[60, 64, 67]], 'R'), '1+3+5');
assert.strictEqual(seq([[48, 52, 55]], 'L'), '5+3+1');
// octave in RH: 1+5
assert.strictEqual(seq([[60, 72]], 'R'), '1+5');
console.log('RH Für Elise:', seq([76, 75, 76, 75, 76, 71, 74, 72, 69], 'R'));
console.log('fingering checks passed');
