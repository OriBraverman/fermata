// Turns a score loaded in a Verovio toolkit into practice "steps": the notes struck together,
// in time order, with hand and finger. Pure apart from the injected toolkit (works in node tests).
import { fingerHand } from './fingering.js';

const STEP = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }, ALTER = { s: 1, f: -1, ss: 2, x: 2, ff: -2, n: 0, su: 1.5, fd: -1.5 };

// Reads what the timemap does not give: staff of each note, tie continuations, grace notes,
// fingering written in the score, measure numbers, written pitch and 8va lines.
// (Asking Verovio for each note's MIDI pitch costs ~1.5 ms per note — far too slow for big pieces.)
export function parseMei(mei) {
  const staffOf = new Map(), skip = new Set(), finger = new Map(), measures = [], pitch = new Map();
  const octaves = [], sounding = new Set(), chordFirst = new Map(), layerOf = new Map();
  const stack = []; let cur = null, chord = null, layer = 1; // the <note> / <chord> / <layer> we are inside
  const re = /<(\/?)(staff|layer|note|rest|chord|tie|measure|accid|octave)\b([^>]*?)(\/?)>/g; let m;
  const attr = (s, a) => { const r = new RegExp(`\\s${a.replace('.', '\\.')}="([^"]*)"`).exec(s); return r ? r[1] : null; };
  const done = n => { if (n && n.pname in STEP && n.oct != null) pitch.set(n.id, (n.oct + 1) * 12 + STEP[n.pname] + Math.round(n.alt)); };
  while ((m = re.exec(mei))) {
    const [, close, tag, attrs, self] = m;
    if (tag === 'staff') { if (close) stack.pop(); else if (!self) stack.push(+attr(attrs, 'n') || 1); continue; }
    if (tag === 'note' && close) { done(cur); cur = null; continue; }
    if (tag === 'chord') { chord = close || self ? null : attr(attrs, 'xml:id'); if (chord) layerOf.set(chord, layer); continue; }
    if (tag === 'layer') { if (!close) layer = +attr(attrs, 'n') || 1; continue; }
    if (close) continue;
    const id = attr(attrs, 'xml:id');
    if (tag === 'rest') { if (id) layerOf.set(id, layer); continue; }
    if (id) layerOf.set(id, layer);
    if (tag === 'measure') { measures.push({ id, n: attr(attrs, 'n') || String(measures.length + 1) }); continue; }
    if (tag === 'tie') { const e = attr(attrs, 'endid'); if (e) skip.add(e.replace('#', '')); continue; }
    if (tag === 'octave') { octaves.push({ staff: +attr(attrs, 'staff'), dis: +attr(attrs, 'dis'), down: attr(attrs, 'dis.place') === 'below', start: attr(attrs, 'startid')?.replace('#', ''), end: attr(attrs, 'endid')?.replace('#', '') }); continue; }
    if (tag === 'accid' && cur) { const a = attr(attrs, 'accid.ges') ?? attr(attrs, 'accid'); if (a in ALTER) cur.alt = ALTER[a]; continue; }
    if (tag === 'note' && id) {
      staffOf.set(id, +attr(attrs, 'staff') || stack[stack.length - 1] || 1);
      if (chord && !chordFirst.has(chord)) chordFirst.set(chord, id);
      const tie = attr(attrs, 'tie');
      if (attrs.includes('grace=') || tie === 'm' || tie === 't') skip.add(id);
      const a = attr(attrs, 'accid.ges') ?? attr(attrs, 'accid'), og = attr(attrs, 'oct.ges'), o = og ?? attr(attrs, 'oct');
      if (og != null) sounding.add(id); // already the sounding octave: an 8va line must not shift it again
      const n = { id, pname: attr(attrs, 'pname.ges') ?? attr(attrs, 'pname'), oct: o == null ? null : +o, alt: a in ALTER ? ALTER[a] : 0 };
      if (self) done(n); else cur = n;
    }
  }
  const fre = /<fing\b([^>]*)>([\s\S]*?)<\/fing>/g;
  while ((m = fre.exec(mei))) {
    const sid = attr(m[1], 'startid'), digit = /[1-5]/.exec(m[2].replace(/<[^>]*>/g, ''));
    if (sid && digit) for (const s of sid.split(/\s+/)) finger.set(s.replace('#', ''), +digit[0]);
  }
  return { staffOf, skip, finger, measures, pitch, octaves, sounding, chordFirst, layerOf, transposed: /trans\.semi=/.test(mei) };
}

// tk: a loaded VerovioToolkit. Returns { steps, measures, hasFingering }.
export function buildSteps(tk) {
  const { staffOf, skip, finger, measures, pitch, octaves, sounding, chordFirst, layerOf, transposed } = parseMei(tk.getMEI());
  const mIndex = new Map(measures.map((ms, i) => [ms.id, i]));
  const tm = tk.renderToTimemap({ includeMeasures: true, includeRests: true }); // rests: an 8va line may start on one
  const onAt = new Map(), offAt = new Map();
  for (const e of tm) { for (const id of e.on || []) if (!onAt.has(id)) onAt.set(id, e.tstamp); for (const id of e.off || []) if (!offAt.has(id)) offAt.set(id, e.tstamp); }
  // 8va / 8vb / 15ma: shift the notes in that staff and voice sounding from the line's start to its end
  let exact = transposed; const shift = new Map();
  const at = id => onAt.get(id) ?? onAt.get(chordFirst.get(id));
  for (const o of octaves) {
    const a = at(o.start), b = at(o.end), ly = layerOf.get(o.start);
    if (a == null || b == null || b < a || !(o.dis === 8 || o.dis === 15)) { exact = true; break; } // unusual encoding: ask Verovio per note (slow)
    const d = (o.dis === 15 ? 24 : 12) * (o.down ? -1 : 1);
    for (const [id, t] of onAt) if (t >= a && t <= b && staffOf.get(id) === o.staff && layerOf.get(id) === ly && !sounding.has(id)) shift.set(id, d);
  }
  const steps = []; let measure = 0;
  for (const e of tm) {
    if (e.measureOn && mIndex.has(e.measureOn)) measure = mIndex.get(e.measureOn);
    const notes = [];
    for (const id of e.on || []) {
      if (skip.has(id) || !staffOf.has(id)) continue;
      let midi = exact ? null : pitch.get(id), dur = (offAt.get(id) ?? e.tstamp + 500) - e.tstamp;
      if (midi == null) { const v = tk.getMIDIValuesForElement(id); if (!v || !(v.pitch > 0)) continue; midi = v.pitch; dur = v.duration; }
      else midi += shift.get(id) || 0;
      notes.push({ id, midi, dur, hand: staffOf.get(id) === 1 ? 'R' : 'L', finger: finger.get(id) || 0, auto: !finger.has(id) });
    }
    if (notes.length) steps.push({ t: e.tstamp, q: e.qstamp, measure, notes });
  }
  // fill in fingers the score does not give
  for (const hand of ['R', 'L']) {
    const chords = [], refs = []; let lastEnd = -1e9;
    for (const s of steps) {
      const ns = s.notes.filter(n => n.hand === hand); if (!ns.length) continue;
      const byKey = new Map(); for (const n of ns) if (!byKey.has(n.midi)) byKey.set(n.midi, []); for (const n of ns) byKey.get(n.midi).push(n);
      const keys = [...byKey.keys()].sort((a, b) => a - b);
      chords.push({ keys, gapMs: s.t - lastEnd }); refs.push(keys.map(k => byKey.get(k)));
      lastEnd = Math.max(...ns.map(n => s.t + n.dur));
    }
    fingerHand(chords, hand).forEach((fs, ci) => refs[ci].forEach((group, ki) => group.forEach(n => { if (!n.finger) n.finger = fs[ki] || 0; })));
  }
  return { steps, measures, hasFingering: finger.size > 0, exact };
}
