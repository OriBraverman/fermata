import { buildSteps } from './score.js';
import { WaitJudge } from './engine.js';
import { Piano, Mic, listenMidi } from './audio.js';
import { TYPES, keysFor, keyHe, scalePiece, drillPiece, spell, spellHe } from './scales.js';

const VRV = 'https://cdn.jsdelivr.net/npm/verovio@6.3.0/dist/';
const $ = s => document.querySelector(s);
const NAMES = ['דו', 'דו#', 'רה', 'רה#', 'מי', 'פה', 'פה#', 'סול', 'סול#', 'לה', 'לה#', 'סי'];
const LEVELS = ['', 'קל', 'בינוני-קל', 'בינוני', 'מתקדם', 'וירטואוזי'];
const black = m => [1, 3, 6, 8, 10].includes(m % 12);
const store = { get(k, d) { try { const v = localStorage.getItem('fermata:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('fermata:' + k, JSON.stringify(v)); } catch { } } };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const icon = (name, label) => `<svg class="i"><use href="#i-${name}"/></svg>${label ? `<span>${label}</span>` : ''}`;

// ---------- settings ----------
const S = Object.assign({ hands: 'both', speed: 80, accomp: true, octave: false, fingers: true, sens: 50, zoom: 46, layout: 'page' }, store.get('settings', {}));
const saveS = () => store.set('settings', S);

// ---------- Verovio (Humdrum build only when a .krn file needs it) ----------
const tks = {}, mods = {};
const vrvModule = hum => (mods[hum ? 'hum' : 'std'] ||= Promise.all([import(VRV + (hum ? 'verovio-module-hum.mjs' : 'verovio-module.mjs')), import(VRV + 'verovio.mjs')])
  .then(async ([mod, { VerovioToolkit }]) => ({ module: await mod.default(), VerovioToolkit })));
function toolkit(hum) { const k = hum ? 'hum' : 'std'; return tks[k] ||= vrvModule(hum).then(({ module, VerovioToolkit }) => new VerovioToolkit(module)); }
// a separate Verovio instance for small examples (scale previews, lessons): it never replaces the open
// piece, and Verovio 6.3's ABC importer leaks key signatures between loads within one instance
let snipTk = null;
async function snippet(data, scale = 36) {
  snipTk ||= await Promise.all([import(VRV + 'verovio-module.mjs'), import(VRV + 'verovio.mjs')]).then(async ([mod, { VerovioToolkit }]) => new VerovioToolkit(await mod.default()));
  snipTk.setOptions({ scale, breaks: 'none', adjustPageWidth: true, adjustPageHeight: true, header: 'none', footer: 'none', pageMarginTop: 10, pageMarginBottom: 10, pageMarginLeft: 10, pageMarginRight: 10 });
  return snipTk.loadData(data) ? snipTk.renderToSVG(1) : '';
}

// ---------- imported files (IndexedDB) ----------
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('fermata', 1); r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function dbAll() { try { const d = await idb(); return await new Promise(r => { const q = d.transaction('files').objectStore('files').getAll(); q.onsuccess = () => r(q.result); q.onerror = () => r([]); }); } catch { return []; } }
async function dbPut(v) { const d = await idb(); return new Promise(r => { const t = d.transaction('files', 'readwrite'); t.objectStore('files').put(v); t.oncomplete = r; }); }
async function dbDel(id) { const d = await idb(); return new Promise(r => { const t = d.transaction('files', 'readwrite'); t.objectStore('files').delete(id); t.oncomplete = r; }); }

// ---------- library ----------
let catalog = [], mine = [], level = 0;
async function loadLibrary() {
  try { catalog = await (await fetch('library/catalog.json')).json(); } catch { catalog = []; }
  $('#countChip').textContent = `${catalog.length} יצירות קלאסיות`;
  mine = await dbAll(); renderLibrary(); fromHash();
}
const levelBars = l => `<span class="lv" title="${LEVELS[l] || ''}" aria-label="רמה: ${LEVELS[l] || ''}">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= l ? 'on' : ''}"></i>`).join('')}</span>`;
function card(p, own) {
  return `<button class="card" data-id="${esc(p.id)}" data-own="${own ? 1 : ''}">
    <span class="who">${esc(p.composerHe || p.composer || 'קובץ מיובא')}</span>
    <span class="ttl">${esc(p.titleHe || p.title)}</span>${p.titleHe && p.title ? `<span class="en">${esc(p.title)}</span>` : ''}
    <span class="ft">${p.level ? levelBars(p.level) + `<span>${LEVELS[p.level]}</span>` : ''}${p.hasFingering ? '<span class="tag">אצבוע מהעורך</span>' : ''}</span>
    ${own ? `<span class="del" data-del="1" role="button" aria-label="מחק">${icon('trash')}</span>` : ''}</button>`;
}
function renderLibrary() {
  const q = $('#q').value.trim().toLowerCase();
  const ok = p => (!level || p.level === level) && (!q || [p.title, p.titleHe, p.composer, p.composerHe].some(s => s && s.toLowerCase().includes(q)));
  const list = catalog.filter(ok);
  // grouped by level; one flat grid while searching or filtering
  const groups = q || level ? [[0, list]] : [1, 2, 3, 4, 5].map(l => [l, list.filter(p => p.level === l)]).filter(g => g[1].length);
  $('#lib').innerHTML = list.length ? groups.map(([l, ps]) => `<section>${l ? `<div class="sect"><h2>${LEVELS[l]}</h2><span>${ps.length} יצירות</span></div>` : ''}<div class="grid">${ps.map(p => card(p)).join('')}</div></section>`).join('<div style="height:18px"></div>')
    : '<p class="foot">לא נמצאו יצירות. נסה מילה אחרת, או ייבא קובץ משלך.</p>';
  $('#mine').hidden = !mine.length; $('#mineGrid').innerHTML = mine.filter(p => !q || p.title.toLowerCase().includes(q)).map(p => card(p, true)).join('');
  // pieces practised recently, with how far you got
  const recent = store.get('recent', []).map(r => ({ r, p: catalog.find(c => c.id === r.id) || mine.find(c => c.id === r.id) })).filter(x => x.p).slice(0, 4);
  $('#recentWrap').hidden = !recent.length || !!q || !!level;
  $('#recent').innerHTML = recent.map(({ r, p }) => `<button class="card" data-id="${esc(p.id)}" data-own="${p.data ? 1 : ''}"><span class="play">${icon('play')}</span>
    <span class="grow"><span class="who">${esc(p.composerHe || p.composer || '')}</span><span class="ttl">${esc(p.titleHe || p.title)}</span><span class="bar"><i style="width:${Math.round(r.pct * 100)}%"></i></span></span></button>`).join('');
}
$('#q').oninput = renderLibrary;
$('#levels').onclick = e => { const b = e.target.closest('button'); if (!b) return; level = +b.dataset.l; $('#levels').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); renderLibrary(); };
document.addEventListener('click', async e => {
  const c = e.target.closest('.card[data-id]'); if (!c) return;
  if (e.target.closest('[data-del]')) { const p = mine.find(x => x.id === c.dataset.id); if (await ask(`למחוק את "${p.title}" מהשירים שלי?`)) { await dbDel(p.id); mine = await dbAll(); renderLibrary(); } return; }
  openPiece(c.dataset.own ? mine.find(x => x.id === c.dataset.id) : catalog.find(x => x.id === c.dataset.id), !!c.dataset.own);
});
$('#file').onchange = async e => {
  for (const f of e.target.files) {
    const ext = f.name.split('.').pop().toLowerCase();
    const data = ext === 'mxl' ? await f.arrayBuffer() : await f.text();
    await dbPut({ id: 'own-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), title: f.name.replace(/\.[^.]+$/, ''), format: ext, data });
  }
  e.target.value = ''; mine = await dbAll(); renderLibrary();
};
function ask(text) { return new Promise(r => { $('#confirmText').textContent = text; $('#confirm').hidden = false; $('#confirmYes').onclick = () => { $('#confirm').hidden = true; r(true); }; $('#confirmNo').onclick = () => { $('#confirm').hidden = true; r(false); }; }); }

// ---------- practice state ----------
let P = null;            // { meta, tk, steps, measures, own }
let idx = 0, mistakes = 0, startedAt = 0, loops = 0;
let ctx = null, piano = null, mic = null, demoTimer = null, autoTimer = null, wakeLock = null;
const judge = new WaitJudge();
const appPlayed = new Map(); // key -> time the app itself sounded it (so the mic ignores it)
const keyEls = new Map();

function audio() { if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); piano = new Piano(ctx); piano.load(); } if (ctx.state === 'suspended') ctx.resume(); return ctx; }
// play key m for dur seconds, starting `delay` seconds from now
function sound(m, dur, delay = 0) {
  audio(); piano.play(m, Math.min(dur, 2), 0.7, ctx.currentTime + delay);
  const start = performance.now() + delay * 1000;
  appPlayed.set(m, Math.max(appPlayed.get(m) || 0, start + Math.min(dur, 2) * 1000));
  appStarts.push(start); while (appStarts.length > 64) appStarts.shift();
}
// when the app's own notes start: a strike heard right then is the speakers, not the player
const appStarts = [];
let seenStrikeT = -1e9, userStrikeT = -1e9;

async function openPiece(meta, own) {
  stopDemo(); clearTimeout(autoTimer);
  $('#library').hidden = true; $('#practice').hidden = false; $('#done').hidden = true;
  $('#title').textContent = meta.titleHe || meta.title; $('#composer').textContent = [meta.composerHe || meta.composer, meta.titleHe && meta.title].filter(Boolean).join(' · ');
  $('#loading').hidden = false; $('#loading .spin').hidden = false; $('#loadingText').textContent = 'טוען תווים…'; $('#score').innerHTML = '';
  $('#credit').innerHTML = meta.source ? `<a href="${esc(meta.source)}" target="_blank" rel="noopener">${esc(new URL(meta.source).hostname)}</a> · ${esc(meta.license || '')}` : meta.scale || meta.drill ? 'נוצר באפליקציה' : 'קובץ שייבאת';
  if (!own) history.replaceState(null, '', '#' + meta.id); // a link straight to this piece
  try {
    const fmt = meta.format || meta.file.split('.').pop();
    const tk = await toolkit(fmt === 'krn');
    let data = own ? meta.data : null;
    if (!own) { const r = await fetch('library/' + meta.file); data = fmt === 'mxl' ? await r.arrayBuffer() : await r.text(); }
    tk.setOptions({ breaks: 'auto' });
    const ok = fmt === 'mxl' ? tk.loadZipDataBuffer(data) : tk.loadData(data);
    if (!ok) throw new Error('load');
    const { steps, measures, hasFingering } = buildSteps(tk);
    if (!steps.length) throw new Error('empty');
    P = { meta, tk, steps, measures, own, hasFingering };
  } catch (err) {
    $('#loadingText').textContent = 'לא הצלחתי לפתוח את הקובץ. בדוק שהוא MusicXML, ‏MXL, ‏Humdrum, ‏MEI או ABC.'; $('#loading .spin').hidden = true; console.error(err); return;
  }
  $('#loopFrom').value = 1; $('#loopTo').value = 4;
  hints = !meta.drill; wrongHere = 0; stepTimes = [];
  $('#status').hidden = !mic?.on; if (mic?.on) $('#heard').textContent = 'נגן את הצליל המסומן';
  document.querySelector('.controls .seg').hidden = !!(meta.scale || meta.drill); // the exercise already fixes the hands
  buildKeyboard(); renderScore();
  const saved = meta.scale || meta.drill ? 0 : store.get('pos:' + meta.id, 0);
  idx = 0; mistakes = 0; startedAt = 0; loops = 0; $('#miss').textContent = 0;
  setStep(saved < P.steps.length ? saved : 0);
}
function leavePractice() {
  stopDemo(); clearTimeout(autoTimer); stopListening(); $('#practice').hidden = true; $('#library').hidden = false; renderLibrary();
}
// back to the section the exercise came from
$('#back').onclick = () => { leavePractice(); showPane(P?.meta.scale ? 'scales' : P?.meta.drill ? 'drill' : 'pieces'); };
// routing: #<piece-id>, #scales, #drill, #theory, #lesson-<id>
function fromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (['pieces', 'scales', 'drill', 'theory'].includes(id)) { if (!$('#practice').hidden) leavePractice(); return showPane(id, false); }
  if (id.startsWith('lesson-')) { if (!$('#practice').hidden) leavePractice(); showPane('theory', false); return openLesson(id.slice(7)); }
  const p = id && catalog.find(c => c.id === id); if (p && P?.meta.id !== id) openPiece(p, false);
}
addEventListener('hashchange', fromHash);

// ---------- score rendering ----------
function renderScore() {
  const tk = P.tk, w = $('#scorewrap').clientWidth - 8;
  tk.setOptions({ scale: S.zoom, pageWidth: Math.max(600, Math.round(w * 100 / S.zoom)), pageHeight: 60000, adjustPageHeight: true, adjustPageWidth: S.layout === 'line',
    breaks: S.layout === 'line' ? 'none' : 'auto', header: 'none', footer: 'none', pageMarginLeft: 40, pageMarginRight: 40, pageMarginTop: 40, pageMarginBottom: 40, svgAdditionalAttribute: [] });
  tk.setOptions({ spacingLinear: 0.25 }); tk.redoLayout();
  let html = ''; for (let p = 1; p <= tk.getPageCount(); p++) html += tk.renderToSVG(p);
  // some exported files lay out far too tightly (notes on top of each other): widen the spacing
  if (S.layout === 'page' && P.measures.length / Math.max(1, (html.match(/class="system"/g) || []).length) > 6) {
    tk.setOptions({ spacingLinear: 0.5 }); tk.redoLayout(); html = ''; for (let p = 1; p <= tk.getPageCount(); p++) html += tk.renderToSVG(p);
  }
  $('#score').innerHTML = html; $('#loading').hidden = true;
  if (S.fingers && hints) addFingerLabels();
  $('#score').querySelectorAll('g.fing').forEach(g => (g.style.display = S.fingers && hints ? '' : 'none'));
  // editors often hide dozens of bare metronome marks to shape rubato; show only the first one
  [...$('#score').querySelectorAll('g.tempo')].filter(g => !/[A-Za-z֐-׿]{2}/.test(g.textContent)).slice(1).forEach(g => (g.style.display = 'none'));
  highlight(true);
}
// draw computed fingers for notes the score gives none
function addFingerLabels() {
  // measure every notehead first, then insert: interleaving reads and writes re-lays out the page each time
  const todo = [];
  for (const s of P.steps) for (const n of s.notes) {
    if (!n.auto || !n.finger) continue;
    const g = document.getElementById(n.id); if (!g) continue;
    const b = (g.querySelector('.notehead') || g).getBBox(); if (b.height) todo.push([g, b, n]);
  }
  for (const [g, b, n] of todo) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('class', 'afing'); t.setAttribute('x', b.x + b.width / 2); t.setAttribute('font-size', b.height * 1.15);
    t.setAttribute('y', n.hand === 'R' ? b.y - b.height * 0.5 : b.y + b.height * 2.1); t.textContent = n.finger;
    g.appendChild(t);
  }
}
let lit = [];
function highlight(scroll) {
  lit.forEach(el => el.classList.remove('cur-R', 'cur-L')); lit = [];
  const s = P.steps[idx]; if (!s) return;
  for (const n of s.notes) { const el = document.getElementById(n.id); if (el) { el.classList.add('cur-' + n.hand); lit.push(el); } }
  if (scroll && lit[0]) {
    const wrap = $('#scorewrap'), r = lit[0].getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const sys = lit[0].closest('g.system'), sr = sys ? sys.getBoundingClientRect() : r;
    if (S.layout === 'line') { if (r.left < wr.left + 80 || r.right > wr.right - 80) wrap.scrollBy({ left: r.left - wr.left - wr.width * 0.3, behavior: 'smooth' }); }
    else if (sr.top < wr.top || sr.bottom > wr.bottom - 10) wrap.scrollBy({ top: sr.top - wr.top - 12, behavior: 'smooth' });
  }
}
$('#score').addEventListener('click', e => { // tap a note to start from there
  const g = e.target.closest('g.note'); if (!g || !P) return;
  const i = P.steps.findIndex(s => s.notes.some(n => n.id === g.id)); if (i >= 0) { stopDemo(); setStep(i); }
});
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => P && !$('#practice').hidden && renderScore(), 250); });

// ---------- keyboard ----------
function buildKeyboard() {
  const ms = P.steps.flatMap(s => s.notes.map(n => n.midi)); let lo = Math.min(...ms), hi = Math.max(...ms);
  lo -= lo % 12; hi += 11 - hi % 12; if (hi - lo < 35) { lo = Math.max(21, lo - 12); hi = Math.min(108, lo + 47); }
  const kb = $('#kb'); kb.innerHTML = ''; keyEls.clear();
  const whites = []; for (let m = lo; m <= hi; m++) if (!black(m)) whites.push(m);
  const W = whites.length, bw = 100 / W * 0.6;
  for (let m = lo; m <= hi; m++) {
    const el = document.createElement('div'); el.dataset.m = m; el.innerHTML = '<span class="badge"></span>';
    if (black(m)) { el.className = 'key bk'; el.style.left = (whites.indexOf(m + 1) / W * 100 - bw / 2) + '%'; el.style.width = bw + '%'; }
    else { el.className = 'key wk'; if (m % 12 === 0) el.insertAdjacentHTML('beforeend', `<span class="nm">דו${Math.floor(m / 12) - 1}</span>`); }
    kb.appendChild(el); keyEls.set(m, el);
  }
}
function showTargets(force = false) {
  keyEls.forEach(el => el.classList.remove('tgt', 'R', 'L'));
  const s = P.steps[idx]; if (!s || (!hints && !force)) return;
  for (const n of s.notes) { const el = keyEls.get(n.midi); if (!el) continue; el.classList.add('tgt', n.hand); el.querySelector('.badge').textContent = S.fingers ? n.finger : ''; }
}
function flash(m, cls, ms = 300) { const el = keyEls.get(m); if (!el) return; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); }
$('#kb').addEventListener('pointerdown', e => { const k = e.target.closest('.key'); if (!k) return; e.preventDefault(); const m = +k.dataset.m; flash(m, 'down', 150); sound(m, 0.8); input([m], 'tap'); });

// ---------- wait-mode flow ----------
// scales and drills already contain only the hands you chose for them
const playable = n => P?.meta.scale || P?.meta.drill || S.hands === 'both' || n.hand === S.hands;
// drills: no hints on the keyboard or in the score; after two wrong tries the right key lights up briefly
let hints = true, wrongHere = 0, stepTimes = [], stepShownAt = 0;
const loopOn = () => $('#loopBtn').getAttribute('aria-pressed') === 'true';
// bar numbers as printed in the score (a pickup bar is often "0") → measure indices
const barIndex = (num, last) => { const all = P.measures.map((m, i) => (parseInt(m.n) === num ? i : -1)).filter(i => i >= 0); return all.length ? (last ? all[all.length - 1] : all[0]) : Math.min(P.measures.length - 1, Math.max(0, num - 1)); };
const loopRange = () => { const a = barIndex(+$('#loopFrom').value, false), b = Math.max(a, barIndex(+$('#loopTo').value, true)); return [a, b]; };
const targetsOf = s => [...new Set(s.notes.filter(playable).map(n => n.midi))];
const prevKeys = () => (idx > 0 ? [...new Set(P.steps[idx - 1].notes.map(n => n.midi))] : []); // still sounding: yours and the accompaniment

function setStep(i) {
  clearTimeout(autoTimer); idx = i;
  const s = P.steps[idx];
  $('#pos').innerHTML = s ? `תיבה <b>${esc(P.measures[s.measure]?.n ?? s.measure + 1)}</b> / ${P.measures.length}` : '';
  $('#progBar').style.width = (idx / P.steps.length * 100) + '%';
  showTargets(); highlight(true); stepShownAt = performance.now(); wrongHere = 0;
  if (!s) return;
  if (idx % 8 === 0 && !P.meta.scale && !P.meta.drill) {
    store.set('pos:' + P.meta.id, idx);
    store.set('recent', [{ id: P.meta.id, pct: idx / P.steps.length }, ...store.get('recent', []).filter(r => r.id !== P.meta.id)].slice(0, 8));
  }
  const tg = targetsOf(s);
  judge.setTarget(tg, S.octave && !P.meta.drill, performance.now()); // reading drills need the exact octave
  mic?.detector?.setTargets(tg, prevKeys());
  if (!tg.length) {
    // only the other hand plays here: go straight to your next note, and let the other hand
    // sound in the background with its own timing (stepping through it looked like skipping)
    let j = idx, guard = 0;
    while (j >= 0 && P.steps[j] && !targetsOf(P.steps[j]).length && guard++ < P.steps.length) {
      const sj = P.steps[j], delay = Math.max(0, (sj.t - s.t) / 1000 * 100 / S.speed);
      if (S.accomp && delay < 8) sj.notes.forEach(n => sound(n.midi, n.dur / 1000 * 100 / S.speed, delay));
      j = nextIndex(j);
    }
    if (j < 0 || guard >= P.steps.length) return finish();
    return setStep(j);
  }
}
// the step after i (wrapping inside an active loop), or -1 at the end of the piece
function nextIndex(i) {
  let next = i + 1;
  if (loopOn()) { const [a, b] = loopRange(); const nm = P.steps[next]?.measure; if (next >= P.steps.length || nm > b) { next = P.steps.findIndex(s => s.measure >= a); loops++; } }
  return next >= P.steps.length ? -1 : next;
}
function advance() { const next = nextIndex(idx); if (next < 0) return finish(); setStep(next); }
// debug log of what the microphone hears and what the judge decides: window.__fermata.log
const LOG = []; const log = e => { LOG.push(e); if (LOG.length > 600) LOG.shift(); };
let lastMistakeT = -1e9;
// keys played by the user (mic onsets, MIDI or tapping); fr = the detector frame for the mic
function input(keys, src, fr) {
  if (!P || demoTimer || !P.steps[idx]) return;
  const now = performance.now(), step = idx;
  const r = judge.feed(keys, now, fr?.db, src === 'mic' ? 110 : 0, src === 'mic' ? userStrikeT : null);
  r.hit.forEach(m => flash(m, 'hit', 250));
  let wrong = r.wrong;
  // through the mic, count a mistake only for a real strike: a fresh attack, nothing expected was hit,
  // the wrong key is the loudest sound, and at most one per attack
  if (src === 'mic') wrong = fr.attack && !r.hit.length && now - lastMistakeT > 350 ? wrong.filter(m => fr.db[m] >= fr.maxDb - 3).slice(0, 1) : [];
  if (wrong.length) {
    lastMistakeT = now; mistakes += wrong.length; $('#miss').textContent = mistakes; wrong.forEach(m => flash(m, 'bad', 400));
    if (!hints && ++wrongHere >= 2) { showTargets(true); setTimeout(() => { if (idx === step) showTargets(); }, 1300); }
  }
  log({ t: Math.round(now), src, step, want: targetsOf(P.steps[step]), keys, hit: r.hit, wrong, accepted: r.accepted, stale: r.stale });
  if (r.accepted) {
    if (!startedAt) startedAt = performance.now();
    stepTimes.push(now - stepShownAt);
    if (!hints) { const m = P.steps[step].notes[0].midi; $('#status').hidden = false; $('#heard').textContent = `נכון: ${NAMES[m % 12]}${Math.floor(m / 12) - 1}`; }
    const s = P.steps[idx];
    if (S.accomp && S.hands !== 'both') s.notes.filter(n => !playable(n)).forEach(n => sound(n.midi, n.dur / 1000 * 100 / S.speed));
    advance();
  }
}
function finish() {
  store.set('pos:' + P.meta.id, 0); $('#progBar').style.width = '100%';
  store.set('recent', store.get('recent', []).filter(r => r.id !== P.meta.id));
  const secs = startedAt ? Math.round((performance.now() - startedAt) / 1000) : 0;
  $('#dSteps').textContent = P.steps.length; $('#dTime').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`; $('#dMiss').textContent = mistakes;
  if (P.meta.drill && stepTimes.length) { // drills: average time per note, and your best for this drill
    const avg = stepTimes.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, stepTimes.length - 1) / 1000;
    $('#dTime').textContent = avg.toFixed(1) + ' שנ׳'; $('#dTime').nextElementSibling.textContent = 'לתו בממוצע';
    const best = store.get('best:' + P.meta.id); if (!best || avg < best) store.set('best:' + P.meta.id, +avg.toFixed(2));
  } else $('#dTime').nextElementSibling.textContent = 'זמן';
  $('#done').hidden = false;
}
$('#again').onclick = () => {
  $('#done').hidden = true; mistakes = 0; startedAt = 0; $('#miss').textContent = 0; stepTimes = [];
  if (P.meta.drill) return startDrill(); // a fresh set of notes
  setStep(0);
};
$('#toLib').onclick = () => { $('#done').hidden = true; $('#back').click(); };
$('#restart').onclick = () => { stopDemo(); mistakes = 0; startedAt = 0; $('#miss').textContent = 0; setStep(loopOn() ? Math.max(0, P.steps.findIndex(s => s.measure >= loopRange()[0])) : 0); };

// ---------- demo playback ----------
$('#demo').onclick = () => {
  if (demoTimer) { stopDemo(); return setStep(idx); } // keep practising from where playback stopped
  audio(); const from = idx; let i = idx; const [a, b] = loopRange();
  $('#demo').innerHTML = icon('stop', 'עצור');
  const step = () => {
    const s = P.steps[i];
    if (!s || (loopOn() && s.measure > b)) { stopDemo(); setStep(from); return; }
    idx = i; showTargets(); highlight(true);
    s.notes.forEach(n => sound(n.midi, n.dur / 1000 * 100 / S.speed));
    const nx = P.steps[i + 1]; i++;
    demoTimer = setTimeout(step, nx ? (nx.t - s.t) * 100 / S.speed : 800);
  };
  clearTimeout(autoTimer); demoTimer = -1; step();
};
function stopDemo() { if (demoTimer) { clearTimeout(demoTimer); demoTimer = null; $('#demo').innerHTML = icon('play', 'השמע'); } }

// ---------- microphone ----------
$('#listen').onclick = () => (mic?.on ? stopListening() : startListening());
async function startListening() {
  const note = $('#notice'); note.hidden = true;
  if (!navigator.mediaDevices?.getUserMedia) { note.textContent = 'המיקרופון זמין רק כשהדף נפתח בכתובת https.'; note.hidden = false; return; }
  audio();
  mic = new Mic(ctx, r => {
    $('#listen').style.setProperty('--lvl', Math.min(1, r.rms * 12).toFixed(2));
    if (demoTimer) return;
    const now = performance.now();
    if (r.strikeT !== seenStrikeT) { // a new key strike: yours, unless the app started a note just then
      seenStrikeT = r.strikeT;
      if (!appStarts.some(s => r.strikeT >= s - 20 && r.strikeT <= s + 220)) { userStrikeT = r.strikeT; log({ t: Math.round(now), src: 'strike', at: Math.round(r.strikeT) }); }
    }
    // ignore what the app itself is playing (accompaniment / taps) and its octaves
    const keys = r.onsets.filter(m => ![0, 12, -12, 19, 24].some(d => (appPlayed.get(m - d) || 0) > now - 150));
    if (keys.length) $('#heard').textContent = 'שומע: ' + keys.slice(0, 4).map(m => NAMES[m % 12] + (Math.floor(m / 12) - 1)).join(' ');
    if (r.checked.length) log({ t: Math.round(now), src: 'frame', on: r.checked.map(([m, ton]) => `${m}:${(r.db[m] - r.maxDb).toFixed(0)}:${ton}${r.onsets.includes(m) ? '' : 'x'}`), max: Math.round(r.maxDb), floor: Math.round(r.floor), atk: r.attack, rms: +r.rms.toFixed(4) });
    if (keys.length) input(keys, 'mic', r);
  });
  try { await mic.start({ aboveFloorDb: 20 - S.sens / 100 * 12 }); }
  catch { note.textContent = 'אין גישה למיקרופון. אשר גישה בהגדרות הדפדפן ונסה שוב.'; note.hidden = false; mic = null; return; }
  if (P?.steps[idx]) mic.detector.setTargets(targetsOf(P.steps[idx]), prevKeys());
  $('#listen').innerHTML = icon('stop', 'מקשיב…'); $('#listen').classList.add('on'); $('#heard').textContent = 'נגן את הצליל המסומן'; $('#status').hidden = false;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { }
}
function stopListening() {
  mic?.stop(); mic = null; try { wakeLock?.release(); } catch { } wakeLock = null;
  $('#listen').innerHTML = icon('mic', 'האזנה'); $('#listen').classList.remove('on'); $('#listen').style.removeProperty('--lvl'); $('#status').hidden = true;
}
listenMidi((m) => { if (!P || $('#practice').hidden) return; flash(m, 'down', 150); input([m], 'midi'); }, names => { $('#midiState').textContent = names.length ? 'MIDI: ' + names.join(', ') : ''; });

// ---------- controls ----------
document.querySelectorAll('[data-hands]').forEach(b => {
  b.setAttribute('aria-pressed', b.dataset.hands === S.hands);
  b.onclick = () => { S.hands = b.dataset.hands; saveS(); document.querySelectorAll('[data-hands]').forEach(x => x.setAttribute('aria-pressed', x === b)); if (P) setStep(idx); };
});
document.querySelectorAll('[data-layout]').forEach(b => {
  b.setAttribute('aria-pressed', b.dataset.layout === S.layout);
  b.onclick = () => { S.layout = b.dataset.layout; saveS(); document.querySelectorAll('[data-layout]').forEach(x => x.setAttribute('aria-pressed', x === b)); if (P) renderScore(); };
});
function togglePanel(open) {
  const p = $('#panel'); open ??= p.hidden; p.hidden = !open; $('#setBtn').setAttribute('aria-expanded', open);
  if (open) p.style.setProperty('--panel-top', ($('.controls').getBoundingClientRect().bottom - $('#practice').getBoundingClientRect().top + 6) + 'px');
}
$('#setBtn').onclick = () => togglePanel();
$('#scorewrap').addEventListener('pointerdown', () => togglePanel(false));
$('#loopBtn').onclick = () => { const on = !loopOn(); $('#loopBtn').setAttribute('aria-pressed', on); if (on) { togglePanel(true); const [a] = loopRange(); setStep(Math.max(0, P.steps.findIndex(s => s.measure >= a))); } };
$('#loopFrom').onchange = $('#loopTo').onchange = () => { if (loopOn()) { const [a] = loopRange(); setStep(Math.max(0, P.steps.findIndex(s => s.measure >= a))); } };
const bindRange = (id, key, fmt) => { const el = $('#' + id); el.value = S[key]; if (fmt) fmt(); el.oninput = () => { S[key] = +el.value; saveS(); fmt?.(); }; };
bindRange('speed', 'speed', () => ($('#speedV').textContent = S.speed + '%'));
bindRange('sens', 'sens', () => { if (mic?.detector) mic.detector.aboveFloorDb = 20 - S.sens / 100 * 12; });
const bindCheck = (id, key, after) => { const el = $('#' + id); el.checked = S[key]; el.onchange = () => { S[key] = el.checked; saveS(); after?.(); }; };
bindCheck('accomp', 'accomp');
bindCheck('octave', 'octave', () => P && setStep(idx));
bindCheck('fingers', 'fingers', () => P && (renderScore(), showTargets()));
$('#zoomIn').onclick = () => { S.zoom = Math.min(90, S.zoom + 6); saveS(); renderScore(); };
$('#zoomOut').onclick = () => { S.zoom = Math.max(22, S.zoom - 6); saveS(); renderScore(); };

// ---------- sections ----------
let pane = 'pieces';
function showPane(name, push = true) {
  pane = name;
  document.querySelectorAll('.tabs button').forEach(b => (b.dataset.pane === name ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  document.querySelectorAll('.pane').forEach(p => (p.hidden = p.id !== 'pane-' + name));
  if (push) history.replaceState(null, '', name === 'pieces' ? location.pathname : '#' + name);
  if (name === 'scales') renderScaleUI();
  if (name === 'drill') renderDrillBest();
  if (name === 'theory') { $('#lesson').hidden = true; $('#lessonList').hidden = false; renderLessonList(); }
}
document.querySelector('.tabs').onclick = e => { const b = e.target.closest('button[data-pane]'); if (b) showPane(b.dataset.pane); };
const segValue = id => $(`#${id} [aria-pressed="true"]`)?.dataset.v;
document.querySelectorAll('#scHands, #scOct, #drClef, #drRange, #drCount').forEach(seg => seg.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
  if (seg.id.startsWith('sc')) renderScaleUI();
}));

// ---------- scales ----------
const SC = Object.assign({ type: 'major', key: 'C' }, store.get('scale', {}));
async function renderScaleUI() {
  $('#scType').innerHTML = Object.entries(TYPES).map(([k, t]) => `<button data-t="${k}" aria-pressed="${k === SC.type}">${t.he}</button>`).join('');
  const keys = keysFor(SC.type); if (!keys.includes(SC.key)) SC.key = keys[0];
  $('#scKeys').innerHTML = keys.map(k => `<button data-k="${k}" aria-pressed="${k === SC.key}">${keyHe(k)}</button>`).join('');
  const hands = segValue('scHands'), oct = +segValue('scOct'), piece = scalePiece(SC.key, SC.type, hands, oct);
  $('#scTitle').textContent = piece.titleHe;
  if (SC.type === 'chromatic') $('#scInfo').innerHTML = 'כל 12 הצלילים בחצאי טונים. אצבע 3 על כל מקש שחור, 1 על הלבנים, ו-2 על הלבן שבא מיד אחרי לבן אחר.';
  else {
    const notes = spell(SC.key, SC.type, 4), pattern = TYPES[SC.type].steps.map(s => ({ 1: 'חצי', 2: 'טון', 3: 'טון וחצי' }[s])).join(' · ');
    const accs = notes.slice(0, 7).filter(n => n.alter);
    $('#scInfo').innerHTML = `<b>הצלילים:</b> ${notes.map(n => spellHe(n.letter, n.alter)).join(' – ')}<br><b>המרווחים:</b> ${pattern}<br>`
      + (accs.length ? `<b>${accs.length} ${accs[0].alter > 0 ? 'דיאזים' : 'במולים'}</b>${SC.type === 'harmonic' || SC.type === 'melodic' ? ' (כולל הצלילים שהוגבהו)' : ''}` : '<b>בלי דיאזים ובמולים</b>')
      + (SC.type === 'melodic' ? '<br>במינור המלודי עולים עם המעלות 6 ו-7 מוגבהות, ויורדים כמו במינור הטבעי.' : '');
  }
  store.set('scale', SC);
  $('#scSvg').innerHTML = '<span class="muted">טוען…</span>';
  try { $('#scSvg').innerHTML = await snippet(piece.data, 30); } catch { $('#scSvg').textContent = ''; }
}
$('#scType').onclick = e => { const b = e.target.closest('button'); if (b) { SC.type = b.dataset.t; renderScaleUI(); } };
$('#scKeys').onclick = e => { const b = e.target.closest('button'); if (b) { SC.key = b.dataset.k; renderScaleUI(); } };
$('#scGo').onclick = () => openPiece(scalePiece(SC.key, SC.type, segValue('scHands'), +segValue('scOct')), true);

// ---------- note-reading drill ----------
function startDrill() {
  const opts = { clef: segValue('drClef'), range: segValue('drRange'), count: +segValue('drCount'), accidentals: $('#drAcc').checked, seed: Date.now() };
  openPiece(drillPiece(opts), true);
}
$('#drGo').onclick = startDrill;
$('#drAcc').onchange = renderDrillBest;
function renderDrillBest() {
  const id = `drill-${segValue('drClef')}-${segValue('drRange')}-${$('#drAcc').checked ? 'acc' : 'nat'}`, best = store.get('best:' + id);
  $('#drBest').textContent = best ? `השיא שלך באימון הזה: ${best} שניות לתו בממוצע.` : '';
}
document.querySelectorAll('#drClef, #drRange').forEach(s => s.addEventListener('click', renderDrillBest));

// ---------- theory ----------
let LESSONS = null;
const lessons = async () => (LESSONS ||= await import('./lessons.js').then(m => m.LESSONS).catch(() => []));
async function renderLessonList() {
  const ls = await lessons();
  $('#lessons').innerHTML = ls.length ? ls.map((l, i) => `<a class="card lesson-card" href="#lesson-${esc(l.id)}"><span class="num">${i + 1}</span><span class="ttl">${esc(l.title)}</span><span class="en" style="direction:rtl;text-align:start">${esc(l.summary || '')}</span></a>`).join('')
    : '<p class="foot">השיעורים עוד לא זמינים.</p>';
}
async function openLesson(id) {
  const ls = await lessons(), i = ls.findIndex(l => l.id === id), l = ls[i]; if (!l) return renderLessonList();
  $('#lessonList').hidden = true; const el = $('#lesson'); el.hidden = false;
  // lesson HTML is our own bundled content (lessons.js), limited to p/b/em/ul/ol/li/br
  el.innerHTML = `<a class="btn" href="#theory" style="align-self:flex-start">${icon('back')}<span>כל השיעורים</span></a>
    <h2>${esc(l.title)}</h2>
    ${l.sections.map((s, si) => `<section><h3>${esc(s.heading)}</h3>${s.html}
      ${s.example ? `<div class="ex"><div class="paper" data-ex="${si}"><span class="muted">טוען…</span></div><div class="bar2"><button class="btn" data-play="${si}">${icon('play', 'השמע')}</button><span>${esc(s.example.caption || '')}</span></div></div>` : ''}</section>`).join('')}
    ${l.quiz?.length ? `<section class="quiz"><h3>בדוק את עצמך</h3>${l.quiz.map((q, qi) => `<div class="q" data-q="${qi}"><b>${esc(q.q)}</b><div class="opts2">${q.options.map((o, oi) => `<button class="btn" data-o="${oi}">${esc(o)}</button>`).join('')}</div><div class="why" hidden>${esc(q.explain || '')}</div></div>`).join('')}</section>` : ''}
    <div class="lessnav">${ls[i - 1] ? `<a class="btn" href="#lesson-${esc(ls[i - 1].id)}">${icon('back')}<span>${esc(ls[i - 1].title)}</span></a>` : '<span></span>'}
      ${ls[i + 1] ? `<a class="btn primary" href="#lesson-${esc(ls[i + 1].id)}"><span>${esc(ls[i + 1].title)}</span></a>` : ''}</div>`;
  scrollTo(0, 0);
  for (const box of el.querySelectorAll('[data-ex]')) { try { box.innerHTML = await snippet(l.sections[+box.dataset.ex].example.abc, 40); } catch { box.textContent = ''; } }
  el.onclick = e => {
    const p = e.target.closest('[data-play]');
    if (p) { const keys = l.sections[+p.dataset.play].example.keys || []; audio(); keys.forEach((k, j) => [].concat(k).forEach(m => sound(m, 0.9, j * 0.55))); return; }
    const o = e.target.closest('[data-o]'); if (!o) return;
    const qEl = o.closest('[data-q]'), q = l.quiz[+qEl.dataset.q], ok = +o.dataset.o === q.answer;
    o.classList.add(ok ? 'ok' : 'no'); if (ok) { qEl.querySelectorAll('[data-o]').forEach(b => (b.disabled = true)); qEl.querySelector('.why').hidden = false; }
  };
}

loadLibrary();
window.__app = { get P() { return P; }, get idx() { return idx; }, input, setStep, LOG, get mic() { return mic; } }; // for testing / live debugging
