// Automatic piano fingering for scores that have none: dynamic programming over a
// Parncutt-style cost model (comfortable spans per finger pair, weak fingers, thumb on black keys).
// Pure module.

// Right-hand span table, semitones from the lower-numbered finger to the higher one:
// [MinPrac, MinComf, MinRel, MaxRel, MaxComf, MaxPrac]
const SPAN = {
  '1-2': [-5, -3, 1, 5, 8, 10], '1-3': [-4, -2, 3, 7, 10, 12], '1-4': [-3, -1, 5, 9, 12, 14], '1-5': [-1, 1, 7, 10, 13, 15],
  '2-3': [1, 1, 1, 2, 3, 5], '2-4': [1, 1, 3, 4, 5, 7], '2-5': [2, 2, 5, 6, 8, 10],
  '3-4': [1, 1, 1, 2, 2, 4], '3-5': [1, 1, 3, 4, 5, 7], '4-5': [1, 1, 1, 2, 3, 5],
};
const black = m => [1, 3, 6, 8, 10].includes(m % 12);

// Cost of finger fa on key a followed by (or together with) finger fb on key b. hand: 'R' | 'L'.
export function pairCost(fa, a, fb, b, hand) {
  let d = hand === 'R' ? b - a : a - b; // mirror the left hand
  if (fa === fb) return a === b ? 0 : 6 + Math.abs(d); // same finger on another key
  let i = fa, j = fb; if (i > j) { [i, j] = [j, i]; d = -d; }
  const [minP, minC, minR, maxR, maxC, maxP] = SPAN[`${i}-${j}`];
  let c = 0; const thumb = i === 1;
  if (d < minC) c += 2 * (minC - d); if (d > maxC) c += 2 * (d - maxC);
  if (d < minR) c += (minR - d) * (thumb ? 2 : 1); if (d > maxR) c += (d - maxR) * (thumb ? 1 : 2);
  if (d < minP) c += 10 * (minP - d); if (d > maxP) c += 10 * (d - maxP);
  return c;
}
const keyCost = (f, m) => (f >= 4 ? 1 : 0) + (f === 1 && black(m) ? 2.5 : 0) + (f === 5 && black(m) ? 1 : 0);

// All ways to give k keys (sorted ascending) distinct fingers that respect hand shape.
function assignments(k, hand) {
  const out = [], pick = (start, acc) => {
    if (acc.length === k) { out.push(hand === 'R' ? [...acc] : [...acc].reverse()); return; }
    for (let f = start; f <= 5; f++) pick(f + 1, [...acc, f]);
  };
  if (k <= 5) pick(1, []); return out;
}

// chords: array of { keys:[midi...], gapMs } for ONE hand, in time order.
// Returns array of finger arrays aligned with each chord's keys sorted ascending.
export function fingerHand(chords, hand) {
  const states = chords.map(c => {
    const keys = [...c.keys].sort((a, b) => a - b).slice(0, 5);
    return assignments(keys.length, hand).map(fs => {
      let own = 0; for (let i = 0; i < keys.length; i++) own += keyCost(fs[i], keys[i]);
      for (let i = 1; i < keys.length; i++) {
        own += pairCost(fs[i - 1], keys[i - 1], fs[i], keys[i], hand);
        if (Math.abs(fs[i] - fs[i - 1]) === 1 && keys[i] - keys[i - 1] >= 3) own += 1; // in chords, a third or more wants a finger skipped
      }
      return { keys, fs, own };
    });
  });
  if (!states.length) return [];
  let prev = states[0].map(s => ({ cost: s.own, back: -1 })); const backs = [prev];
  for (let t = 1; t < states.length; t++) {
    const relax = chords[t].gapMs > 900 ? 0.15 : 1; // a long rest lets the hand reposition freely
    const cur = states[t].map(s => {
      let best = Infinity, arg = 0;
      states[t - 1].forEach((p, pi) => {
        let tr = 0; for (let i = 0; i < p.keys.length; i++) for (let j = 0; j < s.keys.length; j++) tr += pairCost(p.fs[i], p.keys[i], s.fs[j], s.keys[j], hand);
        tr /= p.keys.length * s.keys.length;
        const c = prev[pi].cost + relax * tr;
        if (c < best) { best = c; arg = pi; }
      });
      return { cost: best + s.own, back: arg };
    });
    backs.push(cur); prev = cur;
  }
  let i = prev.reduce((bi, s, k, a) => (s.cost < a[bi].cost ? k : bi), 0); const res = [];
  for (let t = states.length - 1; t >= 0; t--) { res[t] = states[t][i].fs; i = backs[t][i].back; }
  return res;
}
