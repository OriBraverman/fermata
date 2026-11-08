// Scales and sight-reading drills as MusicXML, so they run through the same practice engine as pieces.
// Pure module (works in node tests).

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const HEB = { C: 'דו', D: 'רה', E: 'מי', F: 'פה', G: 'סול', A: 'לה', B: 'סי' };
const ACC_HEB = { '-2': ' דאבל במול', '-1': ' במול', 0: '', 1: ' דיאז', 2: ' דאבל דיאז' };
export const spellHe = (letter, alter) => HEB[letter] + ACC_HEB[alter];

export const TYPES = {
  major: { he: "מז'ור", steps: [2, 2, 1, 2, 2, 2, 1] },
  natural: { he: 'מינור טבעי', steps: [2, 1, 2, 2, 1, 2, 2] },
  harmonic: { he: 'מינור הרמוני', steps: [2, 1, 2, 2, 1, 3, 1] },
  melodic: { he: 'מינור מלודי', steps: [2, 1, 2, 2, 2, 2, 1] }, // ascending; descends as natural minor
  chromatic: { he: 'כרומטי', steps: null },
};

// Standard one-octave fingerings, ascending, tonic to tonic (ABRSM). [right hand, left hand]
const MAJOR_FING = {
  C: ['12312345', '54321321'], G: ['12312345', '54321321'], D: ['12312345', '54321321'], A: ['12312345', '54321321'],
  E: ['12312345', '54321321'], B: ['12312345', '43214321'], 'F#': ['23412312', '43213214'], Db: ['23123412', '32143213'],
  Ab: ['34123123', '32143213'], Eb: ['31234123', '32143213'], Bb: ['41231234', '32143213'], F: ['12341234', '54321321'],
};
const MINOR_FING = { // natural, harmonic and melodic minor share these
  A: ['12312345', '54321321'], E: ['12312345', '54321321'], B: ['12312345', '43214321'], D: ['12312345', '54321321'],
  G: ['12312345', '54321321'], C: ['12312345', '54321321'], F: ['12341234', '54321321'],
  'F#': ['34123123', '43213214'], 'C#': ['34123123', '32143213'],
};
// key signature: number of sharps (+) or flats (−) of each major key
const FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const RELATIVE_MAJOR = { A: 'C', E: 'G', B: 'D', 'F#': 'A', 'C#': 'E', D: 'F', G: 'Bb', C: 'Eb', F: 'Ab' };

export const MAJOR_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F']; // circle of fifths
export const MINOR_KEYS = ['A', 'E', 'B', 'F#', 'C#', 'D', 'G', 'C', 'F'];
export const keysFor = type => (type === 'major' ? MAJOR_KEYS : type === 'chromatic' ? ['C'] : MINOR_KEYS);
const parse = k => ({ letter: k[0], alter: k[1] === '#' ? 1 : k[1] === 'b' ? -1 : 0 });
export const keyHe = k => { const { letter, alter } = parse(k); return spellHe(letter, alter); };

// alterations the key signature puts on each letter
function signature(fifths) {
  const sig = Object.fromEntries(LETTERS.map(l => [l, 0]));
  const sharps = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  if (fifths > 0) sharps.slice(0, fifths).forEach(l => (sig[l] = 1));
  if (fifths < 0) [...sharps].reverse().slice(0, -fifths).forEach(l => (sig[l] = -1));
  return sig;
}

// One octave ascending (8 notes) as {letter, alter, octave, midi}; tonic placed in `octave`.
export function spell(key, type, octave) {
  const { letter, alter } = parse(key), steps = TYPES[type].steps;
  let midi = (octave + 1) * 12 + LETTER_PC[letter] + alter, li = LETTERS.indexOf(letter), oct = octave;
  const out = [{ letter, alter, octave: oct, midi }];
  for (const s of steps) {
    midi += s; li++; if (li === 7) { li = 0; oct++; }
    const L = LETTERS[li], natural = (oct + 1) * 12 + LETTER_PC[L];
    out.push({ letter: L, alter: midi - natural, octave: oct, midi });
  }
  return out;
}
const fromMidi = (midi, flats) => { // chromatic spelling
  const pc = midi % 12, oct = Math.floor(midi / 12) - 1;
  const sharp = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'], flat = ['C', 'D', 'D', 'E', 'E', 'F', 'G', 'G', 'A', 'A', 'B', 'B'];
  const L = (flats ? flat : sharp)[pc]; return { letter: L, alter: pc - LETTER_PC[L], octave: oct, midi };
};

// Notes of a scale exercise for one hand: up `octaves` octaves and back down, with fingers.
export function scaleNotes(key, type, hand, octaves, startOctave) {
  if (type === 'chromatic') {
    const lo = (startOctave + 1) * 12 + LETTER_PC[key[0]], up = [], down = [];
    for (let m = lo; m <= lo + 12 * octaves; m++) up.push(fromMidi(m, false));
    for (let m = lo + 12 * octaves - 1; m >= lo; m--) down.push(fromMidi(m, true));
    // 3 on black keys, 1 on white keys, 2 on the white key next to another white (F and C going up in the RH; E and B in the LH)
    const fing = n => { const pc = n.midi % 12; if ([1, 3, 6, 8, 10].includes(pc)) return 3; if (hand === 'R') return pc === 5 || pc === 0 ? 2 : 1; return pc === 4 || pc === 11 ? 2 : 1; };
    const all = [...up, ...down].map(n => ({ ...n, finger: fing(n) }));
    all[0].finger = 1; all[all.length - 1].finger = 1;
    return all;
  }
  const table = (type === 'major' ? MAJOR_FING : MINOR_FING)[key];
  const p = (table ? table[hand === 'R' ? 0 : 1] : '12312345').split('').map(Number);
  const up = [];
  for (let o = 0; o < octaves; o++) {
    const oct = spell(key, type, startOctave + o);
    oct.slice(0, 7).forEach((n, i) => up.push({ ...n, finger: i === 0 && o > 0 ? (p[0] === 5 ? p[7] : p[0]) : p[i] }));
  }
  const top = spell(key, type, startOctave + octaves - 1)[7]; up.push({ ...top, finger: p[7] });
  // coming down: same fingers in reverse; melodic minor comes down as natural minor (same fingering)
  const down = [];
  for (let i = up.length - 2; i >= 0; i--) {
    let n = up[i];
    if (type === 'melodic') {
      const deg = (LETTERS.indexOf(n.letter) - LETTERS.indexOf(key[0]) + 7) % 7;
      if (deg === 5 || deg === 6) n = { ...n, alter: n.alter - 1, midi: n.midi - 1 };
    }
    down.push(n);
  }
  return [...up, ...down];
}

// ---------- MusicXML ----------
const ACC_NAME = { '-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };
const TYPE_DUR = { 1: 'quarter', 2: 'half', 4: 'whole' };
function measuresXml(notes, staff, voice, fifths, beats = 4) {
  // notes: [{letter, alter, octave, finger, dur}] (dur in quarters); returns array of measure bodies for this staff
  const sig = signature(fifths), out = []; let cur = [], used = 0, shown = {};
  const flush = () => { if (used < beats && cur.length) cur.push(`<note><rest/><duration>${beats - used}</duration><voice>${voice}</voice><type>${TYPE_DUR[beats - used] || 'quarter'}</type><staff>${staff}</staff></note>`); out.push(cur.join('')); cur = []; used = 0; shown = {}; };
  for (const n of notes) {
    const d = n.dur || 1, slot = n.letter + n.octave, want = n.alter, now = slot in shown ? shown[slot] : sig[n.letter];
    const acc = want !== now ? `<accidental>${ACC_NAME[want]}</accidental>` : '';
    shown[slot] = want;
    cur.push(`<note><pitch><step>${n.letter}</step>${want ? `<alter>${want}</alter>` : ''}<octave>${n.octave}</octave></pitch><duration>${d}</duration><voice>${voice}</voice><type>${TYPE_DUR[d]}</type>${acc}<staff>${staff}</staff>${n.finger ? `<notations><technical><fingering>${n.finger}</fingering></technical></notations>` : ''}</note>`);
    used += d; if (used >= beats) flush();
  }
  if (cur.length) flush();
  return out;
}
const restMeasure = (staff, voice, beats = 4) => `<note><rest measure="yes"/><duration>${beats}</duration><voice>${voice}</voice><staff>${staff}</staff></note>`;

// rh / lh: note arrays for each staff (either may be empty). Returns a two-staff MusicXML document.
export function toMusicXML({ title, fifths = 0, rh = [], lh = [], beats = 4 }) {
  const R = rh.length ? measuresXml(rh, 1, 1, fifths, beats) : [], L = lh.length ? measuresXml(lh, 2, 5, fifths, beats) : [];
  const n = Math.max(R.length, L.length, 1); let body = '';
  for (let i = 0; i < n; i++) {
    const attrs = i === 0 ? `<attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>` : '';
    body += `<measure number="${i + 1}">${attrs}${R[i] ?? restMeasure(1, 1, beats)}<backup><duration>${beats}</duration></backup>${L[i] ?? restMeasure(2, 5, beats)}${i === n - 1 ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>' : ''}</measure>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>${title}</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
}

// A scale exercise as a practice "piece" (same shape as library entries, with the score inline).
export function scalePiece(key, type, hands, octaves) {
  const fifths = type === 'chromatic' ? 0 : FIFTHS[type === 'major' ? key : RELATIVE_MAJOR[key]] ?? 0;
  const rhStart = 4, lhStart = 3; // tonic in the 4th octave for the right hand, an octave lower for the left
  const rh = hands === 'L' ? [] : scaleNotes(key, type, 'R', octaves, rhStart);
  const lh = hands === 'R' ? [] : scaleNotes(key, type, 'L', octaves, lhStart);
  [rh, lh].forEach(a => { if (a.length) a[a.length - 1] = { ...a[a.length - 1], dur: 4 - ((a.length - 1) % 4) }; }); // let the last note ring to the bar's end
  const name = type === 'chromatic' ? 'סולם כרומטי' : `${keyHe(key)} ${TYPES[type].he}`;
  const handsHe = { R: 'יד ימין', L: 'יד שמאל', both: 'שתי ידיים' }[hands];
  return {
    id: `scale-${type}-${key}-${hands}-${octaves}`, titleHe: `סולם ${name}`, title: `${key} ${type === 'major' ? 'major' : type === 'chromatic' ? 'chromatic' : type + ' minor'} scale`,
    composerHe: `${handsHe} · ${octaves === 1 ? 'אוקטבה אחת' : `${octaves} אוקטבות`}`, format: 'musicxml', scale: true,
    data: toMusicXML({ title: name, fifths, rh, lh }),
  };
}

// Sight-reading drill: `count` random notes, one per beat, in the chosen clef(s).
// range: 'staff' = on the five lines only; 'ledger' = up to two ledger lines beyond.
export function drillPiece({ clef = 'bass', range = 'staff', accidentals = false, count = 24, seed = Date.now() }) {
  let s = seed % 2147483647 || 1; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  // diatonic positions (letter index + 7*octave): treble E4..F5 is the staff, bass G2..A3
  const di = (l, o) => LETTERS.indexOf(l) + 7 * o;
  const ranges = { G: range === 'staff' ? [di('E', 4), di('F', 5)] : [di('A', 3), di('C', 6)], F: range === 'staff' ? [di('G', 2), di('A', 3)] : [di('C', 2), di('E', 4)] };
  const rh = [], lh = []; let last = -1;
  for (let i = 0; i < count; i++) {
    const staff = clef === 'both' ? (rnd() < 0.5 ? 'G' : 'F') : clef === 'treble' ? 'G' : 'F';
    const [a, b] = ranges[staff]; let d;
    do d = a + Math.floor(rnd() * (b - a + 1)); while (d === last && b > a);
    last = d;
    const letter = LETTERS[d % 7], octave = Math.floor(d / 7);
    let alter = 0; if (accidentals && rnd() < 0.3) alter = rnd() < 0.5 ? 1 : -1;
    const n = { letter, alter, octave, midi: (octave + 1) * 12 + LETTER_PC[letter] + alter };
    // both staves move together beat by beat; the idle staff rests
    (staff === 'G' ? rh : lh).push(n); (staff === 'G' ? lh : rh).push({ rest: true });
  }
  const clean = arr => (arr.some(n => !n.rest) ? arr : []);
  const title = { treble: 'מפתח סול', bass: 'מפתח פה', both: 'שני המפתחות' }[clef];
  return {
    id: `drill-${clef}-${range}-${accidentals ? 'acc' : 'nat'}`, titleHe: `אימון קריאה · ${title}`, title: 'Note reading drill',
    composerHe: `${count} תווים${accidentals ? ' · עם סימני היתק' : ''}`, format: 'musicxml', drill: true,
    data: toMusicXMLWithRests(title, clean(rh), clean(lh)),
  };
}
// like toMusicXML, but notes marked {rest:true} become quarter rests (drills keep both staves in step)
function toMusicXMLWithRests(title, rh, lh) {
  const conv = (arr, staff, voice) => {
    const out = []; let cur = [], used = 0, shown = {};
    for (const n of arr) {
      if (n.rest) cur.push(`<note><rest/><duration>1</duration><voice>${voice}</voice><type>quarter</type><staff>${staff}</staff></note>`);
      else {
        const slot = n.letter + n.octave, now = shown[slot] ?? 0, acc = n.alter !== now ? `<accidental>${ACC_NAME[n.alter]}</accidental>` : '';
        shown[slot] = n.alter;
        cur.push(`<note><pitch><step>${n.letter}</step>${n.alter ? `<alter>${n.alter}</alter>` : ''}<octave>${n.octave}</octave></pitch><duration>1</duration><voice>${voice}</voice><type>quarter</type>${acc}<staff>${staff}</staff></note>`);
      }
      if (++used === 4) { out.push(cur.join('')); cur = []; used = 0; shown = {}; }
    }
    if (cur.length) { while (used++ < 4) cur.push(`<note><rest/><duration>1</duration><voice>${voice}</voice><type>quarter</type><staff>${staff}</staff></note>`); out.push(cur.join('')); }
    return out;
  };
  const R = rh.length ? conv(rh, 1, 1) : [], L = lh.length ? conv(lh, 2, 5) : [], n = Math.max(R.length, L.length);
  let body = '';
  for (let i = 0; i < n; i++) {
    const attrs = i === 0 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>' : '';
    body += `<measure number="${i + 1}">${attrs}${R[i] ?? restMeasure(1, 1)}<backup><duration>4</duration></backup>${L[i] ?? restMeasure(2, 5)}</measure>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>${title}</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
}
