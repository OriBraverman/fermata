// Builds local/catalog.json from the score files in local/ (songs kept only on this computer; local/ is
// not in git). Entries already in the catalog keep their edits (Hebrew title, level...).
// Run after adding files:  node tools/local-catalog.mjs
import fs from 'fs';

const dir = new URL('../local/', import.meta.url), out = new URL('catalog.json', dir);
const old = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : [];
const tag = (x, re) => (x.match(re)?.[1] || '').replace(/<[^>]+>/g, '').trim();
const files = fs.readdirSync(dir).filter(f => /\.(musicxml|xml|mxl|krn|mei|abc)$/i.test(f)).sort();
const cat = files.map(file => {
  const prev = old.find(p => p.file === file); if (prev) return prev;
  const x = /\.mxl$/i.test(file) ? '' : fs.readFileSync(new URL(file, dir), 'utf8').slice(0, 20000);
  const title = tag(x, /<work-title>([\s\S]*?)<\/work-title>/) || tag(x, /<movement-title>([\s\S]*?)<\/movement-title>/) || file.replace(/\.[^.]+$/, '');
  const composer = tag(x, /<creator type="composer">([\s\S]*?)<\/creator>/), ext = file.split('.').pop().toLowerCase();
  return { id: 'local-' + file.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9א-ת]+/g, '-'), title, composer, file, format: ext === 'xml' ? 'musicxml' : ext, level: 3 };
});
fs.writeFileSync(out, JSON.stringify(cat, null, 2));
console.log(`${cat.length} songs in local/catalog.json` + (cat.length ? ':\n' + cat.map(p => `  ${p.id}  ${p.title}`).join('\n') : ''));
