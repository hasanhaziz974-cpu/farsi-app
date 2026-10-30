#!/usr/bin/env node
/*
 * Generates audio/<hash>.mp3 for every Persian text the app speaks, using Azure Text-to-Speech.
 * The file names use the app's own hs() so say() in index.html finds them.
 *
 *   node tools/gen-audio.js --list          print the texts and file names only (no key needed)
 *   AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=... node tools/gen-audio.js
 *
 * Optional env: AZURE_VOICE (default fa-IR-DilaraNeural), AZURE_RATE (default -10%), FORCE=1 to regenerate all.
 * Existing files are kept, files no longer used are deleted, and audio/manifest.json is rewritten.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'audio');

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

const xml = s => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function synth(text, { key, region, voice, rate }) {
  const ssml = `<speak version="1.0" xml:lang="fa-IR"><voice name="${voice}"><prosody rate="${rate}">${xml(text)}</prosody></voice></speak>`;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'farsi-app-audio',
      },
      body: ssml,
    });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if ((r.status === 429 || r.status >= 500) && attempt < 8) { await sleep(Math.min(60000, 2000 * 2 ** attempt)); continue }
    throw new Error(`Azure TTS ${r.status} for "${text}": ${await r.text()}`);
  }
}

async function main() {
  const items = collectTexts(loadApp());
  if (process.argv.includes('--list')) {
    items.forEach(i => console.log(i.n + '\t' + i.t));
    console.error(items.length + ' texts');
    return;
  }
  const opt = {
    key: process.env.AZURE_SPEECH_KEY, region: process.env.AZURE_SPEECH_REGION,
    voice: process.env.AZURE_VOICE || 'fa-IR-DilaraNeural', rate: process.env.AZURE_RATE || '-10%',
  };
  if (!opt.key || !opt.region) throw new Error('Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION');
  fs.mkdirSync(OUT, { recursive: true });

  const wanted = new Set(items.map(i => i.n));
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.mp3') && !wanted.has(f)) fs.unlinkSync(path.join(OUT, f));

  const todo = items.filter(i => process.env.FORCE === '1' || !fs.existsSync(path.join(OUT, i.n)));
  console.log(`${items.length} texts, ${todo.length} to generate with ${opt.voice}`);
  let done = 0;
  async function worker() {
    while (todo.length) {
      const i = todo.shift();
      fs.writeFileSync(path.join(OUT, i.n), await synth(i.t, opt));
      if (++done % 50 === 0) console.log(`${done} done`);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));

  const files = items.map(i => ({ n: i.n, s: fs.statSync(path.join(OUT, i.n)).size }));
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ version: Date.now(), voice: opt.voice, files }));
  console.log(`Done: ${files.length} files, ${(files.reduce((a, f) => a + f.s, 0) / 1048576).toFixed(1)} MB`);
}

main().catch(e => { console.error(e.message); process.exit(1) });
