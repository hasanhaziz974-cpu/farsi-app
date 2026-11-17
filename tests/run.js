#!/usr/bin/env node
/*
 * The app's automatic checks, run by .github/workflows/tests.yml on every pull request and push to main,
 * and locally with:   node tests/run.js      (needs Playwright with Chromium: npm i -g playwright)
 *
 * 1. content   every lesson, rule, conversation, reading, story, trip chapter and special-section lesson
 *              is complete and well formed; Persian has no Arabic ي/ك; level ranges cover everything
 * 2. screens   every main screen opens without a JavaScript error, "undefined", or sideways overflow
 * 3. free      the free version opens exactly level 1's lessons and rules, 4 stories, 5 conversations and
 *              one lesson per special section; a subscriber opens everything
 * 4. links     lesson, rule, conversation, story and trip links point at things that exist
 * 5. progress  a saved state from every older version (v2-v6) lands on the same rules and conversations,
 *              in the app (migrateV3-V5) and on the server (lib/progress.js)
 * 6. games     each mini-game runs to its result; today's dictation is graded by level, easiest first
 * 7. server    the server modules load; internal repository files are not served
 * 8. audio     every Persian text has its audio file (a warning only: the audio is generated after a push)
 * Exits with 1 when a check fails, so GitHub shows a red ❌ before merging.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const fails = [], warns = [];
const fail = (check, msg) => fails.push(check + ': ' + msg);
const all = (n) => { const o = {}; for (let i = 0; i < n; i++) o[i] = 1; return o; };

function serve() {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, () => ok(srv)));
}

async function page(b, url, { state, me, viewport } = {}) {
  const p = await b.newPage({ viewport: viewport || { width: 360, height: 760 } });
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  p.on('dialog', (d) => d.dismiss());
  await p.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: r.request().url().includes('/api/me') && me ? JSON.stringify(me) : '{}' }));
  if (state) await p.addInitScript((s) => { if (!sessionStorage.t) { sessionStorage.t = 1; localStorage.setItem('fa-app', JSON.stringify(s)); } }, state);
  await p.goto(url + '/index.html');
  await p.waitForTimeout(me ? 1200 : 500);
  return p;
}

async function content(b, url) {
  const p = await page(b, url);
  const r = await p.evaluate(() => {
    const out = {}, add = (k, v) => (out[k] = out[k] || []).push(v);
    const fa = (w, t) => { if (typeof t !== 'string' || !t.trim()) return add('empty Persian', w); if (/[يك]/.test(t)) add('Arabic ي/ك in Persian', w + ': ' + t.slice(0, 40)); if (/ {2,}/.test(t)) add('double space', w); if (/(^|\s)(می|نمی) [آ-ی]/.test(t)) add('می without half-space', w + ': ' + t.slice(0, 40)); if (/[A-Za-z]/.test(t)) add('Latin in Persian', w + ': ' + t.slice(0, 40)); };
    const tr = (w, t) => { if (typeof t !== 'string' || !t.trim()) add('empty transliteration', w); else if (/[ء-ي]/.test(t)) add('Arabic in transliteration', w); };
    const ar = (w, t) => { if (typeof t !== 'string' || !t.trim()) add('empty Arabic', w); };
    [['lesson', LES], ['conversation', DLG], ['rule', GR], ['story', STORY], ['chapter', TRIP]].forEach(([k, arr]) => arr.forEach((x, i) => { if (!x.t || !String(x.t).trim()) add('missing title', k + ' ' + (i + 1)); }));
    LES.forEach((l, i) => l.w.forEach((w, j) => { fa('lesson ' + (i + 1) + '.' + j, w[0]); tr('lesson ' + (i + 1) + '.' + j, w[1]); ar('lesson ' + (i + 1) + '.' + j, w[2]); }));
    GR.forEach((g, i) => { if (!g.t || !g.s || !g.n || !g.e || g.e.length < 3) add('rule shape', i + 1); g.e.forEach((e, j) => { fa('rule ' + (i + 1) + '.' + j, e[0]); tr('rule ' + (i + 1) + '.' + j, e[1]); ar('rule ' + (i + 1) + '.' + j, e[2]); }); });
    DLG.forEach((d, i) => d.l.forEach((l, j) => { fa('conversation ' + (i + 1) + '.' + j, l[0]); tr('conversation ' + (i + 1) + '.' + j, l[1]); ar('conversation ' + (i + 1) + '.' + j, l[2]); }));
    if (RD.length !== DLG.length) add('readings', RD.length + ' readings for ' + DLG.length + ' conversations');
    RD.forEach((x, i) => { x.s.forEach((l, j) => fa('reading ' + (i + 1) + '.' + j, l[0])); if (!(x.a >= 0 && x.a < x.o.length)) add('reading answer', i + 1); if (new Set(x.o).size !== x.o.length) add('reading options repeat', i + 1); });
    STORY.forEach((s, i) => { if (!s.t || !s.ta || !s.lv || !s.s || !s.q) add('story shape', i); s.s.forEach((l, j) => { fa('story «' + s.ta + '».' + j, l[0]); tr('story «' + s.ta + '».' + j, l[1]); ar('story «' + s.ta + '».' + j, l[2]); });
      s.q.forEach((q, k) => { if (!(q[2] >= 0 && q[2] < q[1].length)) add('story answer', s.ta + ' q' + k); if (new Set(q[1]).size !== q[1].length) add('story options repeat', s.ta + ' q' + k); });
      s.s.forEach((l) => l[0].split(/\s+/).forEach((w) => { w = w.replace(/[.,،؛؟?!:«»]/g, ''); if (w && !GLS[w]) add('story word without meaning (GLS)', s.ta + ': ' + w); })); });
    TRIP.forEach((t, i) => { if (t.tasks.length !== 4 || t.say.length !== 4 || t.ln.length !== 5) add('trip chapter shape', i + 1); t.ln.forEach((l, j) => { fa('chapter ' + (i + 1) + '.' + j, l[0]); tr('chapter ' + (i + 1) + '.' + j, l[1]); }); t.say.forEach((ps, k) => ps.forEach((x, m) => fa('chapter ' + (i + 1) + ' phrase ' + k + '.' + m, x[0]))); });
    Object.keys(SEC).forEach((s) => SEC[s].d.forEach((c, i) => { if (!c.t || !c.n || !c.e || c.e.length < 3) add('section lesson shape', s + i); c.e.forEach((e, j) => { fa(s + ' ' + (i + 1) + '.' + j, e[1]); tr(s + ' ' + (i + 1) + '.' + j, e[2]); ar(s + ' ' + (i + 1) + '.' + j, e[3]); }); }));
    ['L', 'G', 'T', 'D'].forEach((k) => { const total = { L: LES.length, G: GR.length, T: TRIP.length, D: DLG.length }[k]; let at = 0; LVL.forEach((x, n) => { if (x[k][0] !== at) add('level ranges', k + ' of level ' + (n + 1) + ' starts at ' + x[k][0] + ', expected ' + at); at = x[k][1]; }); if (at !== total) add('level ranges', k + ' ends at ' + at + ' of ' + total); });
    const seen = {}, homographs = ['نه', 'در'];
    ALL.forEach((w) => { if (seen[w.fa] !== undefined && seen[w.fa] !== w.l && homographs.indexOf(w.fa) < 0) add('word in two lessons', w.fa); else seen[w.fa] = w.l; });
    return out;
  });
  for (const k in r) fail('content', k + ' (' + r[k].length + '): ' + r[k].slice(0, 5).join(' | '));
  p.errs.forEach((e) => fail('content', 'JS error ' + e));
  await p.close();
}

const SCREENS = [
  ['home', "go('home')"], ['lesson', "go('home');sub=0;render()"],
  ...[0, 1, 2, 3, 4].map((g) => ['lesson stage ' + (g + 1), `go('home');startStage(3,${g})`]),
  ['letters', "go('letters')"], ['games', "go('games')"], ['memory', "go('games');startMem()"], ['letter game', "go('games');startLG('name')"], ['spell', "go('games');startLG('spell')"],
  ...['prv', 'ant', 'lis', 'tf', 'rid', 'tm'].map((m) => ['game ' + m, `go('games');gmStart('${m}')`]), ['daily challenge', "go('home');startDaily()"],
  ['dictionary', "DQ='سلام';go('dict')"], ['rules', "go('gram')"], ['rule', "go('gram');G=34;render()"], ['rule quiz', "go('gram');G=34;render();startGQ()"], ['word order', "go('gram');G=10;render();wbStart(10)"],
  ['verbs', "go('verbs')"], ['verb', "go('verbs');CV=3;render()"], ['verb quiz', "go('verbs');startCQ(true)"],
  ['talk', "go('talk')"], ['conversation list', "go('talk');DLV=true;render()"], ['conversation', "go('talk');D=44;render()"], ['listening', "go('talk');D=44;render();startLQ()"], ['reading', "go('talk');D=44;RV=true;RQ=null;render()"], ['role-play', "go('talk');D=44;render();startRP('A')"], ['dictation', "go('talk');dtStart('d',44)"],
  ['stories', "go('talk');STV={};render()"], ['story', "go('talk');stOpen(70)"], ['story questions', "go('talk');stOpen(70);STV.q={n:0,ok:0,a:null};render()"], ['culture text', "go('talk');stOpen(56)"],
  ['trip map', "go('talk');aiOpen()"], ['trip chapter', "go('talk');aiOpen();aiChapter(64)"],
  ['review', "go('review')"], ['daily dictation', "go('review');dtStart('day')"], ['mistakes', "go('review');MV={};render()"],
  ['progress', "go('me')"], ['settings', "go('me');SETV=true;render()"], ['level exam', "go('me');exStart(2)"], ['placement', "go('home');pcStart()"],
  ...['col', 'ar', 'soc', 'mis', 'poem'].flatMap((s) => [[s + ' list', `CS='${s}';go('col')`], [s + ' lesson', `CS='${s}';go('col');CL=1;render()`], [s + ' quiz', `CS='${s}';go('col');CL=1;render();colStart()`]]),
];

async function screens(b, url) {
  for (const [fs_, label] of [[0, 'normal text'], [2, 'largest text']]) {
    const p = await page(b, url, { state: { xp: 400, st: 3, last: '', srs: {}, v: 7, fs: fs_, prem: 1, pass: all(69), gp: all(50), dp: all(68), story: all(120), mist: { 'w:3-1': { k: 'w', x: '3-1', at: Date.now() - 864e5, b: 0, d: 0 } } } });
    for (const [name, code] of SCREENS) {
      p.errs = [];
      try { await p.evaluate((c) => eval(c), code); } catch (e) { fail('screens', `${name} (${label}): ${e.message.split('\n')[0]}`); continue; }
      await p.waitForTimeout(80);
      const r = await p.evaluate(() => {
        const over = document.documentElement.scrollWidth - document.documentElement.clientWidth, txt = document.getElementById('main').innerText;
        const wide = [...document.querySelectorAll('#main *')].filter((el) => { const q = el.getBoundingClientRect(); return q.width > 0 && (q.right > innerWidth + 1 || q.left < -1); }).length;
        return { over, wide, len: txt.length, undef: /undefined|NaN|\[object Object\]/.test(txt) };
      });
      if (p.errs.length) fail('screens', `${name} (${label}): JS error ${p.errs[0]}`);
      if (r.over > 0 || r.wide) fail('screens', `${name} (${label}): spills sideways`);
      if (r.undef) fail('screens', `${name} (${label}): shows undefined/NaN`);
      if (r.len < 20) fail('screens', `${name} (${label}): almost empty`);
      await p.evaluate(() => { if (typeof GM === 'object' && GM && GM.tick) clearInterval(GM.tick); GM = null; });
    }
    await p.close();
  }
}

async function free(b, url) {
  const st = { xp: 50, st: 1, last: '', srs: {}, v: 7 };
  const p = await page(b, url, { state: st, me: { email: 'f@example.com', kind: 'member', ok: false } });
  const r = await p.evaluate(() => ({ lite: webLite(), L: [7, 8].map((i) => allowed('L', i)), G: [4, 5].map((i) => allowed('G', i)), D: [4, 5].map((i) => allowed('D', i)), stories: STORY.filter((s, i) => !stLock(i)).length, col: [0, 1].map((i) => !colLock(i)), trip: [0, 1].map((i) => !tripLock(i) || tripLock(i).indexOf('⭐') < 0) }));
  const want = { lite: true, L: [true, false], G: [true, false], D: [true, false], stories: 4, col: [true, false], trip: [true, false] };
  if (JSON.stringify(r) !== JSON.stringify(want)) fail('free', 'free version opens ' + JSON.stringify(r) + ', expected ' + JSON.stringify(want));
  await p.close();
  const q = await page(b, url, { state: st, me: { email: 's@example.com', kind: 'member', ok: true } });
  const s = await q.evaluate(() => ({ lite: webLite(), locked: STORY.filter((x, i) => stLock(i)).length + [0, 1, 3].filter((i) => colLock(i)).length }));
  if (s.lite || s.locked) fail('free', 'a subscriber sees locked content: ' + JSON.stringify(s));
  [...p.errs, ...q.errs].forEach((e) => fail('free', 'JS error ' + e));
  await q.close();
}

async function links(b, url) {
  const p = await page(b, url);
  const r = await p.evaluate(() => {
    const bad = [];
    if (LINK.length !== LES.length) bad.push('LINK has ' + LINK.length + ' entries for ' + LES.length + ' lessons');
    LINK.forEach((k, l) => { lg(l).forEach((g) => { if (!GR[g]) bad.push('lesson ' + (l + 1) + ' → missing rule ' + g); }); k[1].forEach((d) => { if (!DLG[d]) bad.push('lesson ' + (l + 1) + ' → missing conversation ' + d); }); if (!lg(l).length && !k[1].length) bad.push('lesson ' + (l + 1) + ' links to nothing'); });
    TRIP.forEach((t, i) => { if (t.req >= LES.length) bad.push('chapter ' + (i + 1) + ' needs missing lesson ' + t.req); else if (t.req >= 0 && lvOf(t.req) > lvOf(i, 'T')) bad.push('chapter ' + (i + 1) + ' needs a lesson of a later level'); });
    Object.keys(SECL.les).forEach((l) => SECL.les[l].forEach((x) => { if (!SEC[x[0]] || !SEC[x[0]].d[x[1]]) bad.push('special-section link ' + l + ' ' + x); }));
    Object.keys(SLESM).forEach((t) => { if (!STORY.some((s) => s.t === t)) bad.push('SLESM names a missing story ' + t); });
    // Culture texts (c) link the lessons of their topic, whatever the level; stories only lessons up to their level.
    STORY.forEach((s, i) => s.c || storyLes(i).forEach((l) => { if (lvOf(l) + 1 > s.lv) bad.push('story «' + s.ta + '» links lesson ' + (l + 1) + ' of a later level'); }));
    return bad;
  });
  r.forEach((x) => fail('links', x));
  p.errs.forEach((e) => fail('links', 'JS error ' + e));
  await p.close();
}

// Saved progress from older versions. Each entry: a saved state, and the titles its passed rules and finished
// conversations must have after loading. Indices are as they were in that version.
async function progress(b, url) {
  const cases = [
    { v: 2, gp: { 33: 1, 34: 1, 39: 1 }, dp: { 41: 1, 42: 1 }, rules: ['«هر» و«هیچ»', 'اسم الفاعل واسم المفعول', 'لغة الاحترام: بنده، تشریف، فرمودن'], convs: ['عن حافظ والشعر', 'في المخبز'] },
    { v: 3, gp: { 10: 1, 34: 1 }, dp: { 42: 1, 53: 1 }, rules: ['المستقبل', '«با این‌که»: رغم أنّ'], convs: ['في المخبز', 'عند المحامي'] },
    { v: 4, gp: { 9: 1, 10: 1, 16: 1, 28: 1 }, dp: { 46: 1 }, rules: ['حروف الجر', 'المستقبل', 'الماضي القريب (النقلي)', 'الماضي الالتزامي'], convs: ['في المخبز'] },
    { v: 5, gp: {}, dp: {}, rules: [], convs: [], pass: { 15: 1, 16: 1, 25: 1, 48: 1, 63: 1 }, srs: { '16-2': { b: 2, d: 1 } }, lessons: ['البيت والأشياء', 'الأرقام 11 إلى 1000', 'المطبخ والطبخ', 'الفن والسينما والموسيقى', 'العلاقات والمشاعر الدقيقة'], word: 'الأرقام 11 إلى 1000' },
    { v: 6, gp: {}, dp: { 6: 1, 7: 1, 20: 1, 63: 1 }, rules: [], convs: ['في المطار', 'في التاكسي', 'تهنئة العيد', 'نقاش عن تغيّر المناخ'] },
  ];
  const { upgrade } = await import(path.join(ROOT, 'lib/progress.js'));
  const same = (a, b2) => JSON.stringify([...a].sort()) === JSON.stringify([...b2].sort());
  for (const c of cases) {
    const p = await page(b, url, { state: { xp: 10, st: 1, last: '', srs: c.srs || {}, v: c.v, gp: c.gp, dp: c.dp, pass: c.pass || {} } });
    const r = await p.evaluate(() => ({ v: S.v, rules: Object.keys(S.gp || {}).map((k) => GR[k] && GR[k].t), convs: Object.keys(S.dp || {}).map((k) => DLG[k] && DLG[k].t), lessons: Object.keys(S.pass || {}).map((k) => LES[k] && LES[k].t), word: Object.keys(S.srs || {}).map((id) => LES[+id.split('-')[0]] && LES[+id.split('-')[0]].t)[0] }));
    const sv = upgrade({ v: c.v, xp: 1, srs: c.srs || {}, gp: c.gp, dp: c.dp, pass: c.pass || {} });
    const serverLessons = await p.evaluate((d) => Object.keys(d).map((k) => LES[k] && LES[k].t), sv.pass);
    if (c.lessons && (!same(r.lessons, c.lessons) || !same(serverLessons, c.lessons))) fail('progress', `v${c.v} lessons: app ${r.lessons.join(', ')} / server ${serverLessons.join(', ')}`);
    if (c.word && r.word !== c.word) fail('progress', `v${c.v} word review lands in lesson «${r.word}»`);
    const serverRules = await p.evaluate((g) => Object.keys(g).map((k) => GR[k] && GR[k].t), sv.gp);
    const serverConvs = await p.evaluate((d) => Object.keys(d).map((k) => DLG[k] && DLG[k].t), sv.dp);
    if (r.v !== 7) fail('progress', `v${c.v} state ends at v${r.v} in the app`);
    if (!same(r.rules, c.rules)) fail('progress', `v${c.v} rules in the app: ${r.rules.join(', ')}`);
    if (!same(r.convs, c.convs)) fail('progress', `v${c.v} conversations in the app: ${r.convs.join(', ')}`);
    if (sv.v !== 7 || !same(serverRules, c.rules) || !same(serverConvs, c.convs)) fail('progress', `v${c.v} on the server: v${sv.v}, ${serverRules.join(', ')} / ${serverConvs.join(', ')}`);
    p.errs.forEach((e) => fail('progress', 'JS error ' + e));
    await p.close();
  }
}

async function games(b, url) {
  const p = await page(b, url, { state: { xp: 10, st: 1, last: '', srs: {}, v: 7, pass: all(20) } });
  for (const m of ['prv', 'ant', 'lis', 'tf', 'rid']) {
    const ok = await p.evaluate((m) => { go('games'); gmStart(m); for (let i = 0; i < 40 && !GM.fin; i++) { const q = GM.qs[GM.i]; gmPick(q.o.indexOf(q.a)); gmNext(); } return GM.fin && GM.sc === GM.qs.length; }, m);
    if (!ok) fail('games', m + ' did not finish with every answer right');
  }
  const tm = await p.evaluate(async () => { go('games'); gmStart('tm'); const q = GM.qs[0]; gmPick(q.o.indexOf(q.a)); await new Promise((r) => setTimeout(r, 400)); GM.end = Date.now() - 1; await new Promise((r) => setTimeout(r, 500)); return GM.fin && GM.sc === 1 && S.gmb >= 1; });
  if (!tm) fail('games', 'the one-minute race did not end with its score');
  p.errs.forEach((e) => fail('games', 'JS error ' + e));
  await p.close();
}

// Today's dictation is graded: within the learner's level and length, easiest first.
async function dictation(b, url) {
  for (const [name, st, maxLv, maxWords] of [['beginner', { pass: all(2) }, 0, 4], ['level 7', { pass: all(68), gp: all(50), dp: all(67) }, 6, 9]]) {
    const p = await page(b, url, { state: Object.assign({ xp: 10, st: 1, last: '', srs: {}, v: 7, prem: 1 }, st) });
    const r = await p.evaluate(() => dtPick(5).map((q) => [q.lv, dtN(q.fa).length]));
    if (r.length !== 5) fail('dictation', `${name}: ${r.length} sentences`);
    if (r.some(([lv, n]) => lv > maxLv || n > maxWords)) fail('dictation', `${name}: sentence above the level or too long ${JSON.stringify(r)}`);
    if (r.some((x, i) => i && x[1] < r[i - 1][1])) fail('dictation', `${name}: not from easiest to hardest ${JSON.stringify(r)}`);
    p.errs.forEach((e) => fail('dictation', 'JS error ' + e));
    await p.close();
  }
}

async function server() {
  for (const f of ['functions/_middleware.js', 'functions/admin.js', 'functions/logout.js', ...fs.readdirSync(path.join(ROOT, 'functions/api')).filter((x) => x.endsWith('.js')).map((x) => 'functions/api/' + x), ...fs.readdirSync(path.join(ROOT, 'functions/api/auth')).map((x) => 'functions/api/auth/' + x)]) {
    try { await import(path.join(ROOT, f)); } catch (e) { fail('server', f + ' does not load: ' + e.message); }
  }
  const { onRequest } = await import(path.join(ROOT, 'functions/_middleware.js'));
  const next = async () => new Response('<html data-public>ok</html>', { headers: { 'Content-Type': 'text/html' } });
  for (const [p, want] of [['/README.md', 404], ['/tools/sync_access.py', 404], ['/lib/trial.js', 404], ['/workers/reminders/index.js', 404], ['/store/listing.md', 404], ['/package.json', 404], ['/welcome/', 200], ['/welcome/privacy.html', 200], ['/audio/x.mp3', 200]]) {
    const r = await onRequest({ request: new Request('https://example.dev' + p), env: {}, next });
    if (r.status !== want) fail('server', `${p} answers ${r.status}, expected ${want}`);
  }
}

function audio() {
  const { execFileSync } = require('child_process');
  const out = execFileSync(process.execPath, [path.join(ROOT, 'tools/audio-texts.js')], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
  const missing = out.split('\n').filter(Boolean).map((l) => l.split('\t')).filter(([f]) => !fs.existsSync(path.join(ROOT, 'audio', f)));
  if (missing.length) warns.push(`audio: ${missing.length} texts have no audio file yet (run Generate audio): ${missing.slice(0, 3).map((x) => x[1]).join(' | ')}`);
}

(async () => {
  // "localhost" counts as the site for webApp(), like https://, so the signed-in features and the free version run.
  const srv = await serve(), url = 'http://localhost:' + srv.address().port, b = await chromium.launch();
  const steps = [['content', content], ['screens', screens], ['free', free], ['links', links], ['progress', progress], ['games', games], ['dictation', dictation], ['server', server], ['audio', audio]];
  for (const [name, fn] of steps) {
    const n = fails.length, t = Date.now();
    try { await fn(b, url); } catch (e) { fail(name, 'crashed: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e)); }
    console.log((fails.length > n ? '❌ ' : '✅ ') + name + ' (' + ((Date.now() - t) / 1000).toFixed(1) + 's)');
  }
  await b.close(); srv.close();
  warns.forEach((w) => console.log('⚠️  ' + w));
  if (fails.length) { console.log('\n' + fails.length + ' problem(s):'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
  console.log('\nAll checks passed.');
})();
