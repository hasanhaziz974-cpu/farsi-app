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
 * 4. links     lesson, rule, conversation, story and trip links point at things that exist; every rule,
 *              lesson and special-section lesson is linked
 *    levels    a level opens only when the lessons, rules and conversations of the level before are finished
 * 5. progress  a saved state from every older version (v2-v11) lands on the same rules and conversations,
 *              in the app (migrateV3-V5) and on the server (lib/progress.js)
 * 6. games     each mini-game runs to its result; today's dictation is graded by level, easiest first
 * 7. server    the server modules load; internal repository files are not served; ZainCash payments settle once
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
  ['letters', "go('letters')"], ['games', "go('games')"], ['memory', "go('games');startMem()"], ['sentence order', "go('games');startLG('ord')"], ['letter game', "go('games');startLG('name')"], ['spell', "go('games');startLG('spell')"],
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
    const p = await page(b, url, { state: { xp: 400, st: 3, last: '', srs: {}, v: 12, fs: fs_, prem: 1, pass: all(75), gp: all(55), dp: all(74), story: all(120), mist: { 'w:3-1': { k: 'w', x: '3-1', at: Date.now() - 864e5, b: 0, d: 0 } } } });
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
  const st = { xp: 50, st: 1, last: '', srs: {}, v: 12 };
  const p = await page(b, url, { state: st, me: { email: 'f@example.com', kind: 'member', ok: false } });
  const r = await p.evaluate(() => ({ lite: webLite(), L: [7, 8].map((i) => allowed('L', i)), G: [6, 7].map((i) => allowed('G', i)), D: [4, 5].map((i) => allowed('D', i)), stories: STORY.filter((s, i) => !stLock(i)).length, col: [0, 1].map((i) => !colLock(i)), trip: [0, 1].map((i) => !tripLock(i) || tripLock(i).indexOf('⭐') < 0) }));
  const want = { lite: true, L: [true, false], G: [true, false], D: [true, false], stories: 4, col: [true, false], trip: [true, false] };
  if (JSON.stringify(r) !== JSON.stringify(want)) fail('free', 'free version opens ' + JSON.stringify(r) + ', expected ' + JSON.stringify(want));
  await p.close();
  const q = await page(b, url, { state: st, me: { email: 's@example.com', kind: 'member', ok: true } });
  const s = await q.evaluate(() => ({ lite: webLite(), locked: STORY.filter((x, i) => stLock(i)).length + [0, 1, 3].filter((i) => colLock(i)).length }));
  if (s.lite || s.locked) fail('free', 'a subscriber sees locked content: ' + JSON.stringify(s));
  // Stories open with their level: a new subscriber reads level-1 stories only, and culture texts open with level 5.
  const lvl = await q.evaluate(() => { const open = (f) => STORY.filter((x, i) => f(x) && stLvOpen(i)).length; STV = null; stOpen(STORY.findIndex((x) => x.lv === 7)); return { l1: open((x) => x.lv === 1 && !x.c), later: open((x) => x.lv > 1 || x.c), opened: !!(STV && STV.i !== undefined) }; });
  if (!lvl.l1 || lvl.later || lvl.opened) fail('free', 'stories do not follow the level for a new subscriber: ' + JSON.stringify(lvl));
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
    // Nothing new without links: every rule is used by a lesson, every lesson has a story to read, and every
    // special-section lesson is shown on some lesson's page.
    GR.forEach((g, i) => { if (!lesFor('g', i).length) bad.push('rule «' + g.t + '» is linked from no lesson (LINK)'); });
    LES.forEach((l, i) => { if (!lesStories(i).length) bad.push('lesson «' + l.t + '» has no story (SLESM)'); });
    Object.keys(SEC).forEach((k) => SEC[k].d.forEach((c, i) => { if (!Object.values(SECL.les).some((a) => a.some((x) => x[0] === k && x[1] === i))) bad.push(SEC[k].t + ' «' + c.t + '» is shown on no lesson (SECL.les)'); }));
    // Culture texts (c) link the lessons of their topic, whatever the level; stories only lessons up to their level.
    STORY.forEach((s, i) => s.c || storyLes(i).forEach((l) => { if (lvOf(l) + 1 > s.lv) bad.push('story «' + s.ta + '» links lesson ' + (l + 1) + ' of a later level'); }));
    return bad;
  });
  r.forEach((x) => fail('links', x));
  // The server's role-play chapters (functions/api/chat.js) must be in the same order as the app's trip.
  const { CHAPTERS } = await import(path.join(ROOT, 'functions/api/chat.js'));
  const tasks = await p.evaluate(() => TRIP.map((t) => t.tasks.length));
  if (CHAPTERS.length !== tasks.length) fail('links', `the server has ${CHAPTERS.length} trip chapters, the app ${tasks.length}`);
  else CHAPTERS.forEach((c, i) => { if (c.tasks.length !== tasks[i]) fail('links', `trip chapter ${i + 1}: ${c.tasks.length} tasks on the server, ${tasks[i]} in the app`); });
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
    { v: 7, gp: {}, dp: {}, rules: [], convs: [], trip: { 5: { done: [0] }, 6: { done: [0, 1] }, 12: { stars: 2 }, 30: { stars: 3 }, 65: { stars: 1 } }, chapters: ["غداء مع عائلة پارسا", "في مترو طهران", "البحث عن شقة", "حقيبة لم تصل", "وداع پارسا"] },
    { v: 8, gp: { 4: 1, 5: 1, 8: 1 }, dp: {}, rules: ['الإضافة والصفة', 'المضارع', 'أدوات السؤال'], convs: [], pass: { 26: 1, 27: 1, 44: 1, 45: 1, 68: 1 }, srs: { '45-3': { b: 2, d: 1 } }, lessons: ['الفواكه والخضروات', 'المطبخ والطبخ', 'الدين والمناسبات الدينية', 'في المستشفى والعلاج', 'العلاقات والمشاعر الدقيقة'], word: 'في المستشفى والعلاج' },
    { v: 9, gp: {}, dp: { 15: 1, 16: 1, 31: 1, 32: 1, 49: 1, 50: 1, 67: 1 }, rules: [], convs: ['في محطة الحافلات', 'الوقت والموعد', 'عند الطبيب البيطري', 'في الملعب', 'تصليح الهاتف', 'في المخبز', 'نقاش عن تغيّر المناخ'] },
    { v: 10, gp: { 33: 1, 34: 1, 42: 1, 43: 1, 51: 1 }, dp: {}, rules: ['الفعل المتعدّي بـ«ـاندن»', 'الماضي الالتزامي', 'قبل أن وبعد أن: قبل از این‌که، بعد از این‌که', 'اسم الفاعل واسم المفعول', 'حروف الجر المركّبة'], convs: [], trip: { 38: { stars: 1 }, 39: { stars: 2 }, 45: { stars: 3 }, 62: { stars: 1 }, 63: { stars: 2 }, 69: { stars: 3 } }, chapters: ['في ملعب آزادي', 'عشاء الوداع', 'عند حافظ في شيراز', 'طلبية خاطئة', 'حفل التخرّج', 'وداع پارسا'] },
    { v: 11, gp: {}, dp: { 24: 1, 25: 1, 41: 1, 42: 1, 71: 1 }, rules: [], convs: ['عند الخياط', 'دعوة إلى عرس', 'زيارة مريض', 'عند الطبيب الاختصاصي', 'نقاش عن الأطفال والهاتف'], pass: { 36: 1, 37: 1, 55: 1, 56: 1, 71: 1 }, srs: { '56-2': { b: 2, d: 1 } }, lessons: ['أعمال البيت', 'الأخبار والإعلام', 'التاريخ والحضارة', 'السياحة والآثار', 'الطب التقليدي والأعشاب'], word: 'السياحة والآثار' },
  ];
  const { upgrade } = await import(path.join(ROOT, 'lib/progress.js'));
  const same = (a, b2) => JSON.stringify([...a].sort()) === JSON.stringify([...b2].sort());
  for (const c of cases) {
    const p = await page(b, url, { state: { xp: 10, st: 1, last: '', srs: c.srs || {}, v: c.v, gp: c.gp, dp: c.dp, pass: c.pass || {}, trip: c.trip || {} } });
    if (c.chapters) { const app = await p.evaluate(() => Object.keys(S.trip || {}).map((k) => TRIP[k] && TRIP[k].t)); const srv = upgrade({ v: c.v, xp: 1, srs: {}, trip: c.trip }); const st = await p.evaluate((d) => Object.keys(d).map((k) => TRIP[k] && TRIP[k].t), srv.trip); if (!same(app, c.chapters) || !same(st, c.chapters)) fail('progress', `v${c.v} trip chapters: app ${app.join(', ')} / server ${st.join(', ')}`); }
    const r = await p.evaluate(() => ({ v: S.v, rules: Object.keys(S.gp || {}).map((k) => GR[k] && GR[k].t), convs: Object.keys(S.dp || {}).map((k) => DLG[k] && DLG[k].t), lessons: Object.keys(S.pass || {}).map((k) => LES[k] && LES[k].t), word: Object.keys(S.srs || {}).map((id) => LES[+id.split('-')[0]] && LES[+id.split('-')[0]].t)[0] }));
    const sv = upgrade({ v: c.v, xp: 1, srs: c.srs || {}, gp: c.gp, dp: c.dp, pass: c.pass || {} });
    const serverLessons = await p.evaluate((d) => Object.keys(d).map((k) => LES[k] && LES[k].t), sv.pass);
    if (c.lessons && (!same(r.lessons, c.lessons) || !same(serverLessons, c.lessons))) fail('progress', `v${c.v} lessons: app ${r.lessons.join(', ')} / server ${serverLessons.join(', ')}`);
    if (c.word && r.word !== c.word) fail('progress', `v${c.v} word review lands in lesson «${r.word}»`);
    const serverRules = await p.evaluate((g) => Object.keys(g).map((k) => GR[k] && GR[k].t), sv.gp);
    const serverConvs = await p.evaluate((d) => Object.keys(d).map((k) => DLG[k] && DLG[k].t), sv.dp);
    if (r.v !== 12) fail('progress', `v${c.v} state ends at v${r.v} in the app`);
    if (!same(r.rules, c.rules)) fail('progress', `v${c.v} rules in the app: ${r.rules.join(', ')}`);
    if (!same(r.convs, c.convs)) fail('progress', `v${c.v} conversations in the app: ${r.convs.join(', ')}`);
    if (sv.v !== 12 || !same(serverRules, c.rules) || !same(serverConvs, c.convs)) fail('progress', `v${c.v} on the server: v${sv.v}, ${serverRules.join(', ')} / ${serverConvs.join(', ')}`);
    p.errs.forEach((e) => fail('progress', 'JS error ' + e));
    await p.close();
  }
}

// A level opens only when the lessons, rules and conversations of the one before are finished; stories and trip
// chapters are optional.
async function levels(b, url) {
  const p = await page(b, url, { state: { xp: 10, st: 1, last: '', srs: {}, v: 12, prem: 1 } });
  const r = await p.evaluate(() => {
    const x = LVL[0], fill = (o, a) => { for (let i = a[0]; i < a[1]; i++) o[i] = 1; return o; };
    S.pass = fill({}, x.L); S.gp = fill({}, x.G); S.dp = fill({}, x.D); S.trip = {}; for (let i = x.T[0]; i < x.T[1]; i++) S.trip[i] = { stars: 3 };
    S.story = {}; STORY.forEach((s, i) => { if (s.lv === 1 && !s.c) S.story[i] = 1; });
    const open = () => [unlocked(LVL[1].L[0]), gOpen(LVL[1].G[0]), dOpen(LVL[1].D[0]), tripLock(LVL[1].T[0]).indexOf('المستوى') < 0, stLvOpen(STORY.findIndex((s) => s.lv === 2 && !s.c))];
    const full = open();
    delete S.story[STORY.findIndex((s) => s.lv === 1 && !s.c)]; const trip0 = S.trip; S.trip = {};
    const missing = open();
    S.story[STORY.findIndex((s) => s.lv === 1 && !s.c)] = 1; S.trip = trip0; delete S.gp[x.G[1] - 1];
    return { full, missing, rule: open(), msg: lvLockMsg('L', LVL[1].L[0]), inside: unlocked(1) };
  });
  if (!r.full.every(Boolean)) fail('levels', 'level 2 stays locked with level 1 finished: ' + JSON.stringify(r.full));
  if (!r.missing.every(Boolean)) fail('levels', 'level 2 stays locked with a level 1 story unread and no trip chapter done (both are optional): ' + JSON.stringify(r.missing));
  if (r.rule.some(Boolean)) fail('levels', 'level 2 opens with a level 1 rule not passed: ' + JSON.stringify(r.rule));
  if (!/المستوى 1/.test(r.msg)) fail('levels', 'the lock message does not name level 1: ' + r.msg);
  if (!r.inside) fail('levels', 'lesson 2 does not open after lesson 1');
  // Skip exam: 30 questions from level 1; 85% opens level 2 without finishing level 1. Placement: up to level 5.
  const sk = await p.evaluate(() => {
    S.pass = {}; S.gp = {}; S.dp = {}; S.skip = {}; S.exam = {}; window.confirm = () => true;
    const before = unlocked(LVL[1].L[0]); skStart(0); const n = EX.qs.length;
    EX.qs.forEach((q) => { q.ok = true; }); EX.qs.slice(0, 5).forEach((q) => { q.ok = false; }); EX.i = EX.qs.length - 1; exNext();
    const failed = unlocked(LVL[1].L[0]), wait = skWait(0) > 0; EX = null; S.skip = {};
    skStart(0); EX.qs.forEach((q) => { q.ok = true; }); EX.i = EX.qs.length - 1; exNext();
    const passed = [unlocked(LVL[1].L[0]), gOpen(LVL[1].G[0]), dOpen(LVL[1].D[0])], lv3 = unlocked(LVL[2].L[0]); EX = null;
    PC = null; pcStart(); let guard = 0; while (PC.res == null && guard++ < 100) { pcAns(PC.qs[PC.i].a); pcNext(); }
    const place = [PC.res, PC.qs.length]; PC = null;
    return { before, n, failed, wait, passed, lv3, place, opened5: unlocked(LVL[4].L[0]) };
  });
  if (sk.before) fail('levels', 'level 2 is open before the skip exam');
  if (sk.n < 30) fail('levels', 'the skip exam has only ' + sk.n + ' questions');
  if (sk.failed || !sk.wait) fail('levels', 'a skip exam under 85% opened level 2 or allowed a retry at once');
  if (!sk.passed.every(Boolean)) fail('levels', 'a passed skip exam did not open level 2: ' + JSON.stringify(sk.passed));
  if (sk.lv3) fail('levels', 'a skip exam of level 1 opened level 3');
  if (sk.place[0] !== 4 || sk.place[1] !== 8 || !sk.opened5) fail('levels', 'the placement test with every answer right should place in level 5 with 8 questions per level: ' + JSON.stringify(sk));
  p.errs.forEach((e) => fail('levels', 'JS error ' + e));
  await p.close();
}

async function games(b, url) {
  const p = await page(b, url, { state: { xp: 10, st: 1, last: '', srs: {}, v: 12, pass: all(20) } });
  for (const m of ['prv', 'ant', 'lis', 'tf', 'rid']) {
    const ok = await p.evaluate((m) => { go('games'); gmStart(m); for (let i = 0; i < 40 && !GM.fin; i++) { const q = GM.qs[GM.i]; gmPick(q.o.indexOf(q.a)); gmNext(); } return GM.fin && GM.sc === GM.qs.length; }, m);
    if (!ok) fail('games', m + ' did not finish with every answer right');
  }
  const ord = await p.evaluate(() => { go('games'); startLG('ord'); if (LG.qs.length < 3) return 'only ' + LG.qs.length + ' sentences'; for (const q of LG.qs) { q.cs.forEach((c) => { const x = q.t.find((y) => y.c === c && q.p.indexOf(y) < 0); spTap(x.i); }); if (!q.done || q.p.map((x) => x.c).join(' ') !== q.w.fa) return 'sentence not built: ' + q.w.fa; lgNext(); } return LG.fin && LG.sc === LG.qs.length ? '' : 'no result'; });
  if (ord) fail('games', 'sentence order: ' + ord);
  // Role-play by voice: what the learner says is matched against the three choices (the server's text is simulated).
  const rp = await p.evaluate(() => {
    go('talk'); D = 0; S.prem = 1; startRP('A'); RP.v = true; const L = DLG[0].l; render();
    const view = document.querySelector('#main').textContent.indexOf('قل ردّك') >= 0;
    const wrong = RP.o.find((o) => o !== L[0]); rpHeard(wrong[0]); const afterWrong = RP.i;
    rpHeard('چیزی نامفهوم'); const afterNoise = RP.i;
    rpHeard(L[0][0]); const afterRight = RP.i;
    RP = null; return { view, afterWrong, afterNoise, afterRight };
  });
  if (!rp.view || rp.afterWrong !== 0 || rp.afterNoise !== 0 || rp.afterRight !== 1) fail('games', 'role-play by voice: ' + JSON.stringify(rp));
  const tm = await p.evaluate(async () => { go('games'); gmStart('tm'); const q = GM.qs[0]; gmPick(q.o.indexOf(q.a)); await new Promise((r) => setTimeout(r, 400)); GM.end = Date.now() - 1; await new Promise((r) => setTimeout(r, 500)); return GM.fin && GM.sc === 1 && S.gmb >= 1; });
  if (!tm) fail('games', 'the one-minute race did not end with its score');
  p.errs.forEach((e) => fail('games', 'JS error ' + e));
  await p.close();
}

// Today's dictation is graded: within the learner's level and length, easiest first.
async function dictation(b, url) {
  for (const [name, st, maxLv, maxWords] of [['beginner', { pass: all(2) }, 0, 4], ['level 7', { pass: all(71), gp: all(52), dp: all(67) }, 6, 9]]) {
    const p = await page(b, url, { state: Object.assign({ xp: 10, st: 1, last: '', srs: {}, v: 12, prem: 1 }, st) });
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
  await zaincash();
}

// ZainCash online payment against a simulated gateway and KV: a paid order extends the subscription once; a wrong
// amount, another learner's reference or a failed payment does not.
async function zaincash() {
  const store = new Map(), kv = { get: async (k, ty) => { const v = store.has(k) ? store.get(k) : null; return v !== null && ty === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { store.set(k, String(v)); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
  const env = { TRIALS: kv, ZC_CLIENT_ID: 'id', ZC_CLIENT_SECRET: 'secret' };
  let status = 'SUCCESS', paidValue = 5000; const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (u, o = {}) => {
    calls.push(String(u));
    if (String(u).startsWith('https://bad.example')) return Response.json({ error: 'invalid_client' }, { status: 401 });
    if (String(u).endsWith('/oauth2/token')) return Response.json({ access_token: 'tok', expires_in: 86399 });
    if (String(u).endsWith('/transaction/init')) { const b = JSON.parse(o.body); return Response.json({ status: 'SUCCESS', transactionDetails: { transactionId: 'tx-' + b.externalReferenceId, externalReferenceId: b.externalReferenceId }, redirectUrl: 'https://pg-api-uat.zaincash.iq/transaction/pay?id=1' }); }
    const m = /inquiry\/tx-(.+)$/.exec(String(u));
    if (m) return Response.json({ status, transactionDetails: { transactionId: 'tx-' + m[1], externalReferenceId: m[1], amount: { value: paidValue, currency: 'IQD' } } });
    return new Response('no', { status: 404 });
  };
  try {
    const { createPayment, settle, amountOf, testConnection } = await import(path.join(ROOT, 'lib/zaincash.js'));
    if (amountOf('5,000 دينار') !== 5000 || amountOf('٢٥٠٠٠ د.ع') !== 25000) fail('server', 'ZainCash: prices are not read as amounts');
    const a = await createPayment(env, kv, { email: 'a@x.iq', plan: 'month', amount: 5000, origin: 'https://site.dev' });
    if (!a.url || !a.ref) fail('server', 'ZainCash: no payment page');
    const r1 = await settle(env, kv, a.ref), until1 = store.get('allow:a@x.iq'), r2 = await settle(env, kv, a.ref), until2 = store.get('allow:a@x.iq');
    if (r1 !== 'paid' || !until1 || until1 !== until2) fail('server', `ZainCash: a paid month gave ${r1} ${until1} then ${until2}`);
    paidValue = 1;
    const b = await createPayment(env, kv, { email: 'b@x.iq', plan: 'month', amount: 5000, origin: 'https://site.dev' });
    if ((await settle(env, kv, b.ref)) === 'paid' || store.has('allow:b@x.iq')) fail('server', 'ZainCash: a payment of another amount opened a subscription');
    status = 'FAILED'; paidValue = 5000;
    const c = await createPayment(env, kv, { email: 'c@x.iq', plan: 'year', amount: 5000, origin: 'https://site.dev' });
    if ((await settle(env, kv, c.ref)) !== 'failed' || store.has('allow:c@x.iq')) fail('server', 'ZainCash: a failed payment opened a subscription');
    if ((await settle(env, kv, 'not-a-ref')) !== 'unknown') fail('server', 'ZainCash: a made-up reference was not refused');
    if (!(await testConnection(env, kv)).ok) fail('server', 'ZainCash: the connection check failed with good keys');
    const bad = await testConnection({ ...env, ZC_BASE: 'https://bad.example' }, kv);
    if (bad.ok || bad.status !== '401') fail('server', 'ZainCash: the connection check did not report refused keys: ' + JSON.stringify(bad));
    if (calls.filter((u) => u.endsWith('/oauth2/token')).length !== 3) fail('server', 'ZainCash: the access token was not reused');
    const ret = await import(path.join(ROOT, 'functions/api/pay/return/[ref].js'));
    status = 'SUCCESS';
    const d = await createPayment(env, kv, { email: 'd@x.iq', plan: 'month', amount: 5000, origin: 'https://site.dev' });
    const res = await ret.onRequest({ request: new Request('https://site.dev/api/pay/return/' + d.ref + '?token=x'), env, params: { ref: d.ref } });
    if (!/\/\?pay=ok$/.test(res.headers.get('Location') || '') || !store.has('allow:d@x.iq')) fail('server', 'ZainCash: the return address did not settle the payment: ' + res.headers.get('Location'));
    const { onRequest: mw } = await import(path.join(ROOT, 'functions/_middleware.js'));
    const pub = await mw({ request: new Request('https://site.dev/api/pay/return/' + d.ref), env: {}, next: async () => new Response(null, { status: 303, headers: { Location: '/?pay=ok' } }) });
    if (pub.status !== 303) fail('server', 'ZainCash: the return address needs a sign-in (' + pub.status + ')');
  } finally { global.fetch = realFetch; }
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
  const steps = [['content', content], ['screens', screens], ['free', free], ['links', links], ['levels', levels], ['progress', progress], ['games', games], ['dictation', dictation], ['server', server], ['audio', audio]];
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
