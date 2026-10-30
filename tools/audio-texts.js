#!/usr/bin/env node
/*
 * Prints every Persian text the app speaks, one per line as "<file name>\t<text>".
 * The file names use the app's own hs() so say() in index.html finds audio/<file name>.
 *
 *   node tools/audio-texts.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadApp() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const el = () => new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : el(), set: () => true, apply: () => el() });
  const store = {};
  const ctx = {
    document: el(), navigator: {}, console, Date, Math, JSON,
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v } },
    setTimeout: () => 0, clearTimeout: () => {}, matchMedia: () => ({ matches: false }), scrollTo: () => {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

function collectTexts(A) {
  const set = new Set(), add = t => { if (t && /[؀-ۿ]/.test(t)) set.add(t) };
  A.ALL.forEach(w => add(w.fa));
  A.LET.forEach(l => add(l[0]));
  A.DLG.forEach(d => d.l.forEach(l => add(l[0])));
  A.RD.forEach(d => d.s.forEach(l => add(l[0])));
  A.GR.forEach(g => g.e.forEach(e => add(e[0])));
  A.PRV.forEach(p => add(p[0]));
  A.CHEER.forEach(c => add(c[0]));
  A.V.forEach(v => A.TN.forEach((n, t) => A.forms(v, t).forEach(x => add(x[0]))));
  const items = [...set].map(t => ({ t, n: A.hs(t) + '.mp3' })), seen = {};
  for (const i of items) {
    if (seen[i.n]) throw new Error(`hs() gives the same file name ${i.n} to "${seen[i.n]}" and "${i.t}"`);
    seen[i.n] = i.t;
  }
  return items;
}

try {
  const items = collectTexts(loadApp());
  process.stdout.write(items.map(i => i.n + '\t' + i.t + '\n').join(''));
  console.error(items.length + ' texts');
} catch (e) { console.error(e.message); process.exit(1) }
