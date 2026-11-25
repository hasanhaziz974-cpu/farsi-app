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
 *    gradation no text uses a grammar form before the level of its rule
 *    learner   a learner from the first day: the order things open, the review, the ranks
 *    crawl     every lesson, rule, conversation, story, section lesson, chapter and exam page opens cleanly
 * 5. progress  a saved state from every older version (v2-v17) lands on the same rules and conversations,
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
    V.forEach((v, i) => { if (!Array.isArray(v) || v.length < 8) return add('verb shape', i + 1); fa('verb ' + (i + 1), v[0]); tr('verb ' + (i + 1), v[1]); ar('verb ' + (i + 1), v[2]); if (!v[3] || !v[5]) add('verb without stems', v[0]); });
    const dupT = (k, arr, f) => { const s = {}; arr.forEach((x) => { const t = f(x); if (s[t]) add('two ' + k + ' with one title', t); s[t] = 1; }); };
    dupT('stories', STORY, (x) => x.t); dupT('conversations', DLG, (x) => x.t); dupT('lessons', LES, (x) => x.t); dupT('rules', GR, (x) => x.t); dupT('chapters', TRIP, (x) => x.t);
    PRV.forEach((x, i) => { fa('proverb ' + (i + 1), x[0]); ar('proverb ' + (i + 1), x[2]); });
    ANT.forEach((x, i) => { if (x.length !== 6) add('antonym shape', i + 1); fa('antonym ' + (i + 1), x[0]); fa('antonym ' + (i + 1), x[3]); });
    RID.forEach((x, i) => { if (x.length !== 5) add('riddle shape', i + 1); fa('riddle ' + (i + 1), x[0]); fa('riddle answer ' + (i + 1), x[3]); });
    LES.forEach((l) => { if (l.w.length < 6) add('lesson with fewer than 6 items', l.t); });
    const seen = {}, homographs = ['نه', 'در'];
    ALL.forEach((w) => { if (seen[w.fa] !== undefined && seen[w.fa] !== w.l && homographs.indexOf(w.fa) < 0) add('word in two lessons', w.fa); else seen[w.fa] = w.l; });
    return out;
  });
  for (const k in r) fail('content', k + ' (' + r[k].length + '): ' + r[k].slice(0, 5).join(' | '));
  p.errs.forEach((e) => fail('content', 'JS error ' + e));
  // The welcome page (welcome/index.html) quotes the app's counts; it must say the current numbers.
  const n = await p.evaluate(() => ({ les: LES.length, dlg: DLG.length, trip: TRIP.length, gr: GR.length, v: V.length, st: STORY.filter((s) => !s.c).length, cu: STORY.filter((s) => s.c).length }));
  const wel = fs.readFileSync(path.join(ROOT, 'welcome/index.html'), 'utf8');
  for (const [k, want] of [['lessons', n.les + ' درساً'], ['conversations', n.dlg + ' محادثة'], ['trip chapters', n.trip + ' فصلاً'], ['rules', n.gr + ' درساً في القواعد'], ['verbs', n.v + ' فعلاً'], ['stories', n.st + ' قص'], ['culture texts', n.cu + ' نصاً']]) if (!wel.includes(want)) fail('content', 'welcome page does not say «' + want + '» (' + k + ')');
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
    const p = await page(b, url, { state: { xp: 400, st: 3, last: '', srs: {}, v: 28, fs: fs_, prem: 1, pass: all(98), gp: all(84), dp: all(104), story: all(120), mist: { 'w:3-1': { k: 'w', x: '3-1', at: Date.now() - 864e5, b: 0, d: 0 } } } });
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
  const st = { xp: 50, st: 1, last: '', srs: {}, v: 28 };
  const p = await page(b, url, { state: st, me: { email: 'f@example.com', kind: 'member', ok: false } });
  const r = await p.evaluate(() => ({ lite: webLite(), L: [7, 8].map((i) => allowed('L', i)), G: [6, 7].map((i) => allowed('G', i)), D: [4, 5].map((i) => allowed('D', i)), stories: STORY.filter((s, i) => !stLock(i)).length, col: [0, 1].map((i) => !colLock(i)), trip: [0, 1].map((i) => !tripLock(i) || tripLock(i).indexOf('⭐') < 0) }));
  const want = { lite: true, L: [true, false], G: [true, false], D: [true, false], stories: 4, col: [true, false], trip: [false, false] };
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
    // Every rule and conversation is reachable from a lesson of its own level or an earlier one, and every lesson has a conversation.
    GR.forEach((g, i) => { if (!lesFor('g', i).some((l) => lvOf(l) <= lvOf(i, 'G'))) bad.push('rule «' + g.t + '» is linked only from lessons of later levels'); });
    DLG.forEach((d, i) => { if (!lesFor('d', i).some((l) => lvOf(l) <= lvOf(i, 'D'))) bad.push('conversation «' + d.t + '» is linked only from lessons of later levels'); });
    LINK.forEach((k, l) => { if (!k[1].length) bad.push('lesson «' + LES[l].t + '» links no conversation'); });
    // Each lesson page shows a rule and a conversation of its own level or an earlier one.
    LES.forEach((l, i) => { if (!lg(i).some((g) => lvOf(g, 'G') <= lvOf(i))) bad.push('lesson «' + l.t + '» shows no rule of its level'); if (!LINK[i][1].some((d) => lvOf(d, 'D') <= lvOf(i))) bad.push('lesson «' + l.t + '» shows no conversation of its level'); });
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
    { v: 7, gp: {}, dp: {}, rules: [], convs: [], trip: { 5: { done: [0] }, 6: { done: [0, 1] }, 12: { stars: 2 }, 30: { stars: 3 }, 65: { stars: 1 } }, chapters: ["غداء مع عائلة پارسا", "في مترو طهران", "البحث عن شقة", "حقيبة لم تصل", "وداع پارسا في بغداد"] },
    { v: 8, gp: { 4: 1, 5: 1, 8: 1 }, dp: {}, rules: ['الإضافة والصفة', 'المضارع', 'أدوات السؤال'], convs: [], pass: { 26: 1, 27: 1, 44: 1, 45: 1, 68: 1 }, srs: { '45-3': { b: 2, d: 1 } }, lessons: ['الفواكه والخضروات', 'المطبخ والطبخ', 'الدين والمناسبات الدينية', 'في المستشفى والعلاج', 'العلاقات والمشاعر الدقيقة'], word: 'في المستشفى والعلاج' },
    { v: 9, gp: {}, dp: { 15: 1, 16: 1, 31: 1, 32: 1, 49: 1, 50: 1, 67: 1 }, rules: [], convs: ['في محطة الحافلات', 'الوقت والموعد', 'عند الطبيب البيطري', 'في الملعب', 'تصليح الهاتف', 'في المخبز', 'نقاش عن تغيّر المناخ'] },
    { v: 10, gp: { 33: 1, 34: 1, 42: 1, 43: 1, 51: 1 }, dp: {}, rules: ['الفعل المتعدّي بـ«ـاندن»', 'الماضي الالتزامي', 'قبل أن وبعد أن: قبل از این‌که، بعد از این‌که', 'اسم الفاعل واسم المفعول', 'حروف الجر المركّبة'], convs: [], trip: { 38: { stars: 1 }, 39: { stars: 2 }, 45: { stars: 3 }, 62: { stars: 1 }, 63: { stars: 2 }, 69: { stars: 3 } }, chapters: ['في ملعب آزادي', 'عشاء الوداع', 'عند حافظ في شيراز', 'طلبية خاطئة', 'حفل التخرّج', 'وداع پارسا في بغداد'] },
    { v: 11, gp: {}, dp: { 24: 1, 25: 1, 41: 1, 42: 1, 71: 1 }, rules: [], convs: ['عند الخياط', 'دعوة إلى عرس', 'زيارة مريض', 'عند الطبيب الاختصاصي', 'نقاش عن الأطفال والهاتف'], pass: { 36: 1, 37: 1, 55: 1, 56: 1, 71: 1 }, srs: { '56-2': { b: 2, d: 1 } }, lessons: ['أعمال البيت', 'الأخبار والإعلام', 'التاريخ والحضارة', 'السياحة والآثار', 'الطب التقليدي والأعشاب'], word: 'السياحة والآثار' },
    { v: 12, gp: { 19: 1, 20: 1, 26: 1, 27: 1 }, dp: {}, rules: ['«ـی» للتنكير: کتابی، روزی', 'الماضي القريب (النقلي)', 'الجمل الزمنية: وقتی، هر وقت، تا وقتی', 'الجمل الموصولة: که'], convs: [], trip: { 20: { stars: 1 }, 21: { stars: 2 }, 27: { stars: 3 }, 28: { stars: 1 }, 72: { stars: 2 } }, chapters: ['في حديقة الحيوان', 'في حرم الإمام الرضا', 'تنظيف البيت قبل النوروز', 'في السوبرماركت', 'وداع پارسا في بغداد'] },
    { v: 13, gp: {}, dp: { 16: 1, 17: 1, 54: 1, 55: 1, 73: 1 }, rules: [], convs: ['في محل الصرافة', 'الوقت والموعد', 'في مركز الشرطة بعد حادث', 'في المخبز', 'نقاش عن الأطفال والهاتف'], pass: { 27: 1, 28: 1, 47: 1, 48: 1, 74: 1 }, srs: { '48-3': { b: 2, d: 1 } }, lessons: ['المطار والطيران', 'المطبخ والطبخ', 'الحاسوب والبرمجة', 'في المستشفى والعلاج', 'العمارة الإسلامية'], word: 'في المستشفى والعلاج' },
    { v: 14, gp: { 12: 1, 13: 1, 46: 1, 47: 1 }, dp: { 35: 1, 36: 1, 75: 1 }, rules: ['العدد والمعدود: «تا» و«نفر»', 'المستقبل', '«در حالی که»: بينما، في حين أنّ', 'اسم الفاعل واسم المفعول'], convs: ['شراء تذكرة قطار', 'في الملعب', 'نقاش عن الأطفال والهاتف'], pass: { 16: 1, 17: 1, 38: 1, 39: 1, 76: 1 }, srs: { '39-1': { b: 2, d: 1 } }, lessons: ['الأقارب', 'الأرقام 11 إلى 1000', 'وسائل التواصل الاجتماعي', 'الأخبار والإعلام', 'العمارة الإسلامية'], word: 'الأخبار والإعلام' },
    { v: 14, gp: {}, dp: {}, rules: [], convs: [], trip: { 11: { stars: 1 }, 12: { stars: 2 }, 48: { stars: 3 }, 49: { stars: 1 }, 74: { stars: 2 } }, chapters: ['في ساحة نقش جهان', 'وداع پارسا', 'الامتحان الشفهي', 'عند حافظ في شيراز', 'وداع پارسا في بغداد'] },
    { v: 15, gp: { 13: 1, 14: 1, 29: 1, 30: 1, 31: 1 }, dp: {}, rules: ['ظروف التكرار: همیشه، معمولاً، گاهی، هرگز', 'المستقبل', 'أفعال بحرف جر ثابت: فکر کردن به، منتظر بودن', 'الجمل الموصولة: که', 'الأعداد الترتيبية'], convs: [] },
    { v: 16, gp: { 30: 1, 31: 1, 37: 1, 38: 1 }, dp: { 26: 1, 27: 1, 45: 1, 46: 1 }, rules: ['أفعال بحرف جر ثابت: فکر کردن به، منتظر بودن', 'الأعداد الترتيبية', '«آن‌قدر… که»: لدرجة أنّ', 'الماضي الالتزامي'], convs: ['في محل التنظيف الجاف', 'دعوة إلى عرس', 'عند طبيب الأسنان', 'عند الطبيب الاختصاصي'], pass: { 29: 1, 30: 1, 61: 1, 62: 1 }, srs: { '62-2': { b: 2, d: 1 } }, lessons: ['العناية الشخصية', 'المطبخ والطبخ', 'الطيور والحشرات', 'السياحة والآثار'], word: 'السياحة والآثار' },
    { v: 16, gp: {}, dp: {}, rules: [], convs: [], trip: { 22: { stars: 1 }, 23: { stars: 2 }, 50: { stars: 3 }, 51: { stars: 1 } }, chapters: ['في مكتب البريد', 'في حرم الإمام الرضا', 'عرض تقديمي في الصف', 'عند حافظ في شيراز'] },
    { v: 17, gp: { 14: 1, 15: 1 }, dp: { 17: 1, 18: 1, 59: 1, 60: 1 }, rules: ['الجمل الموصولة: که', 'المستقبل'], convs: ['في محل الحلويات', 'الوقت والموعد', 'التبرّع بالدم', 'في المخبز'], pass: { 41: 1, 42: 1 }, srs: { '42-1': { b: 2, d: 1 } }, lessons: ['في السوبرماركت', 'الأخبار والإعلام'], word: 'الأخبار والإعلام' },
    { v: 17, gp: {}, dp: {}, rules: [], convs: [], trip: { 31: { stars: 1 }, 32: { stars: 2 }, 43: { stars: 3 }, 44: { stars: 1 } }, chapters: ['في المكتبة المركزية', 'في السوبرماركت', 'نزهة سيزده‌به‌در', 'عشاء الوداع'] },
    { v: 18, gp: { 24: 1, 25: 1, 51: 1, 52: 1 }, dp: { 38: 1, 39: 1, 81: 1 }, rules: ['الماضي القريب (النقلي)', 'الماضي البعيد', 'التعجّب: چه…! چقدر…! عجب…!', 'اسم الفاعل واسم المفعول'], convs: ['سيارة أجرة عبر التطبيق', 'في الملعب', 'نقاش عن العمل من البيت'], pass: { 17: 1, 18: 1, 53: 1, 54: 1 }, srs: { '54-1': { b: 2, d: 1 } }, lessons: ['الزكام والأمراض الخفيفة', 'الأرقام 11 إلى 1000', 'العمل التطوعي والخيري', 'في المستشفى والعلاج'], word: 'في المستشفى والعلاج' },
    { v: 18, gp: {}, dp: {}, rules: [], convs: [], trip: { 12: { stars: 1 }, 13: { stars: 2 }, 54: { stars: 3 }, 55: { stars: 1 } }, chapters: ['في محل الهدايا التذكارية', 'وداع پارسا', 'طلب منحة دراسية', 'عند حافظ في شيراز'] },
    { v: 19, gp: { 33: 1, 34: 1, 64: 1 }, dp: { 28: 1, 29: 1, 49: 1, 50: 1 }, rules: ['ياء النسبة: ایرانی، چوبی، طلایی', 'الأعداد الترتيبية', 'الأسلوب الوصفي في الكتابة: «رفته، آمده»'], convs: ['في محل القرطاسية', 'دعوة إلى عرس', 'في ورشة تصليح السيارات', 'عند الطبيب الاختصاصي'], pass: { 31: 1, 32: 1, 66: 1, 67: 1 }, srs: { '67-1': { b: 2, d: 1 } }, lessons: ['الأدوات المكتبية', 'المطبخ والطبخ', 'الطاقة والصناعة', 'السياحة والآثار'], word: 'السياحة والآثار' },
    { v: 19, gp: {}, dp: {}, rules: [], convs: [], trip: { 24: { stars: 1 }, 25: { stars: 2 }, 57: { stars: 3 }, 58: { stars: 1 } }, chapters: ['عند بائع الخضار', 'في حرم الإمام الرضا', 'عند حافظ في شيراز', 'على شاطئ بحر قزوين'] },
    { v: 20, gp: { 15: 1, 16: 1, 42: 1, 43: 1 }, dp: { 18: 1, 19: 1, 64: 1, 65: 1 }, rules: ['«کسی، چیزی، جایی»: أحد، شيء، مكان', 'المستقبل', 'التصغير: باغچه، دریاچه، عروسک', 'الماضي الالتزامي'], convs: ['في محل الأحذية', 'الوقت والموعد', 'اختيار التخصص الجامعي', 'في المخبز'], pass: { 44: 1, 45: 1, 86: 1 }, srs: { '45-1': { b: 2, d: 1 } }, lessons: ['الأثاث وغرف البيت', 'الأخبار والإعلام', 'الفلسفة والفكر'], word: 'الأخبار والإعلام' },
    { v: 20, gp: {}, dp: {}, rules: [], convs: [], trip: { 15: { stars: 1 }, 16: { stars: 2 }, 39: { stars: 3 }, 40: { stars: 1 } }, chapters: ['البحث عن بيت پارسا', 'البحث عن شقة', 'عيد ميلاد زميلة', 'وداع وعودة'] },
    { v: 21, gp: { 26: 1, 27: 1, 35: 1, 36: 1 }, dp: { 30: 1, 31: 1, 41: 1, 42: 1 }, rules: ['«دیگر»: آخر، بعد الآن، أيضاً', 'الماضي البعيد', 'اسم المصدر بـ«ـش»: آموزش، خواهش', 'الأعداد الترتيبية'], convs: ['التحضير لرحلة تخييم', 'دعوة إلى عرس', 'عند القصّاب', 'في الملعب'], pass: { 57: 1, 58: 1, 69: 1, 70: 1 }, srs: { '70-1': { b: 2, d: 1 } }, lessons: ['الإعلان والتسويق', 'في المستشفى والعلاج', 'المتاحف والمعارض', 'السياحة والآثار'], word: 'السياحة والآثار' },
    { v: 21, gp: {}, dp: {}, rules: [], convs: [], trip: { 35: { stars: 1 }, 36: { stars: 2 } }, chapters: ['في محل تصليح الحاسوب', 'في السوبرماركت'] },
    { v: 22, gp: { 28: 1, 29: 1, 47: 1, 48: 1 }, dp: { 56: 1, 57: 1 }, rules: ['«همین» و«همان»: هذا نفسه، ذلك نفسه', 'الماضي البعيد', '«مگر»: هل حقاً؟ وإلّا إذا', 'الماضي الالتزامي'], convs: ['في المتحف الوطني', 'عند الطبيب الاختصاصي'], pass: { 18: 1, 19: 1 }, srs: { '19-1': { b: 2, d: 1 } }, lessons: ['محلات الحيّ', 'الأرقام 11 إلى 1000'], word: 'الأرقام 11 إلى 1000' },
    { v: 22, gp: {}, dp: {}, rules: [], convs: [], trip: { 26: { stars: 1 }, 27: { stars: 2 }, 63: { stars: 3 }, 64: { stars: 1 } }, chapters: ['تخييم في جبال البرز', 'في حرم الإمام الرضا', 'في المتحف الوطني بطهران', 'على شاطئ بحر قزوين'] },
    { v: 23, gp: { 39: 1, 40: 1, 49: 1, 50: 1 }, dp: { 19: 1, 20: 1, 45: 1, 46: 1 }, rules: ['«مجبور بودن» و«لازم بودن»: مضطرّ، يلزم', 'الأعداد الترتيبية', 'الاقتراح: «بیا برویم»، «چطور است…؟»', 'الماضي الالتزامي'], convs: ['في محل الزهور', 'الوقت والموعد', 'شكوى من ضجيج الجيران', 'في الملعب'], pass: { 46: 1, 47: 1 }, srs: { '47-1': { b: 2, d: 1 } }, lessons: ['الأدوية والوصفة الطبية', 'الأخبار والإعلام'], word: 'الأخبار والإعلام' },
    { v: 23, gp: {}, dp: {}, rules: [], convs: [], trip: { 16: { stars: 1 }, 17: { stars: 2 }, 38: { stars: 3 }, 39: { stars: 1 } }, chapters: ['ورد لوالدة پارسا', 'البحث عن شقة', 'حفلة وداع في السكن الجامعي', 'في السوبرماركت'] },
    { v: 24, gp: { 29: 1, 30: 1, 63: 1, 64: 1 }, dp: { 33: 1, 34: 1, 60: 1, 61: 1 }, rules: ['«هست» و«نیست»: يوجد ولا يوجد', 'الماضي البعيد', '«در حالِ» و«قابلِ» مع المصدر', 'اسم الفاعل واسم المفعول'], convs: ['التحضير لحفلة عيد ميلاد', 'دعوة إلى عرس', 'نقاش عن الدراسة في الخارج', 'عند الطبيب الاختصاصي'], pass: { 60: 1, 61: 1, 73: 1, 74: 1 }, srs: { '74-1': { b: 2, d: 1 } }, lessons: ['اللياقة والنادي الرياضي', 'في المستشفى والعلاج', 'الذكاء الاصطناعي والأمن الرقمي', 'السياحة والآثار'], word: 'السياحة والآثار' },
    { v: 24, gp: {}, dp: {}, rules: [], convs: [], trip: { 28: { stars: 1 }, 29: { stars: 2 }, 67: { stars: 3 }, 68: { stars: 1 } }, chapters: ['شاي عند الجارة العجوز', 'في حرم الإمام الرضا', 'اجتماع المجموعة البحثية', 'على شاطئ بحر قزوين'] },
    { v: 25, gp: { 41: 1, 42: 1, 52: 1, 53: 1 }, dp: { 20: 1, 21: 1, 76: 1, 77: 1 }, rules: ['الكسور والنسب: نصف، ربع، درصد', 'الأعداد الترتيبية', '«هر چه… بیشتر، … بیشتر»: كلّما', 'الماضي الالتزامي'], convs: ['في محل الألعاب', 'الوقت والموعد', 'نقاش عن الهجرة والغربة', 'في المخبز'], pass: { 19: 1, 20: 1 }, srs: { '20-1': { b: 2, d: 1 } }, lessons: ['الأطفال والألعاب', 'الأرقام 11 إلى 1000'], word: 'الأرقام 11 إلى 1000' },
    { v: 25, gp: {}, dp: {}, rules: [], convs: [], trip: { 17: { stars: 1 }, 18: { stars: 2 }, 41: { stars: 3 }, 42: { stars: 1 } }, chapters: ['في المقهى التقليدي', 'البحث عن شقة', 'تسليم الشقة', 'في السوبرماركت'] },
    { v: 26, gp: { 30: 1, 31: 1, 54: 1, 55: 1 }, dp: { 35: 1, 36: 1, 63: 1, 64: 1 }, rules: ['«شدن» للتحوّل: خسته شدم، سرد شد', 'الماضي البعيد', '«به‌جای» و«به‌جز»: بدلاً من، ما عدا', 'الماضي الالتزامي'], convs: ['في محل غسيل السيارات', 'دعوة إلى عرس', 'زيارة مولود جديد', 'عند الطبيب الاختصاصي'], pass: { 20: 1, 21: 1 }, srs: { '21-1': { b: 2, d: 1 } }, lessons: ['العطلة ونهاية الأسبوع', 'الأرقام 11 إلى 1000'], word: 'الأرقام 11 إلى 1000' },
    { v: 26, gp: {}, dp: {}, rules: [], convs: [], trip: { 18: { stars: 1 }, 19: { stars: 2 }, 30: { stars: 3 }, 31: { stars: 1 } }, chapters: ['علبة گز للعائلة', 'البحث عن شقة', 'في السينما مع سينا', 'في حرم الإمام الرضا'] },
    { v: 27, gp: { 31: 1, 32: 1, 43: 1, 44: 1 }, dp: { 21: 1, 22: 1, 50: 1, 51: 1 }, rules: ['«پیش» و«بعد» مع المدّة: دو روز پیش، یک هفته بعد', 'الماضي البعيد', 'الطلب المهذّب: «ممکن است…؟»، «می‌شود…؟»', 'الأعداد الترتيبية'], convs: ['حجز طاولة بالهاتف', 'الوقت والموعد', 'في متجر الحيوانات الأليفة', 'في الملعب'], pass: { 77: 1, 78: 1 }, srs: { '78-1': { b: 2, d: 1 } }, lessons: ['الفضاء وعلم الفلك', 'السياحة والآثار'], word: 'السياحة والآثار' },
    { v: 27, gp: {}, dp: {}, rules: [], convs: [], trip: { 45: { stars: 1 }, 46: { stars: 2 }, 73: { stars: 3 }, 74: { stars: 1 } }, chapters: ['بيع الأثاث المستعمل', 'في السوبرماركت', 'ليلة في المرصد', 'على شاطئ بحر قزوين'] },
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
    if (r.v !== 28) fail('progress', `v${c.v} state ends at v${r.v} in the app`);
    if (!same(r.rules, c.rules)) fail('progress', `v${c.v} rules in the app: ${r.rules.join(', ')}`);
    if (!same(r.convs, c.convs)) fail('progress', `v${c.v} conversations in the app: ${r.convs.join(', ')}`);
    if (sv.v !== 28 || !same(serverRules, c.rules) || !same(serverConvs, c.convs)) fail('progress', `v${c.v} on the server: v${sv.v}, ${serverRules.join(', ')} / ${serverConvs.join(', ')}`);
    p.errs.forEach((e) => fail('progress', 'JS error ' + e));
    await p.close();
  }
}

// A level opens only when the lessons, rules and conversations of the one before are finished; stories and trip
// chapters are optional.
async function levels(b, url) {
  const p = await page(b, url, { state: { xp: 10, st: 1, last: '', srs: {}, v: 28, prem: 1 } });
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
  // End-of-phase exams: 40 questions from every level of the phase; open only when all its levels are done; 80% earns the certificate.
  const ph = await p.evaluate(() => {
    const out = {}; S.pass = {}; S.gp = {}; S.dp = {}; S.skip = {}; S.exam = {}; S.phx = {}; window.confirm = () => true;
    for (const n of [1, 2]) {
      const q = phQs(n), lv = phLv(n), locked = phState(n).indexOf('🔒') === 0;
      lv.forEach((k) => { S.skip[k] = { ok: true }; });
      const open = phState(n) === ''; phStart(n); const started = !!(EX && EX.ph === n);
      EX.qs.forEach((x, i) => { x.ok = i % 10 !== 0; }); EX.i = EX.qs.length - 1; exNext(); const pass = !!(S.phx[n] && S.phx[n].ok);
      const cert = exView().includes('شهادة إتمام المرحلة');
      EX = null; S.skip = {};
      out[n] = { len: q.length, ans: q.every((x) => x.a && x.sk), levels: lv.length, locked, open, started, pass, cert };
    }
    S.phx = {}; return out;
  });
  for (const n of [1, 2]) { const x = ph[n];
    if (x.len !== 40 || !x.ans) fail('levels', `phase ${n} exam: ${x.len} questions, all with answers: ${x.ans}`);
    if (!x.locked || !x.open || !x.started) fail('levels', `phase ${n} exam lock: ${JSON.stringify(x)}`);
    if (!x.pass || !x.cert) fail('levels', `phase ${n} exam at 90% does not give the certificate: ${JSON.stringify(x)}`);
  }
  if (ph[1].levels !== 7 || ph[2].levels < 10) fail('levels', 'phase exams cover the wrong levels: ' + ph[1].levels + ', ' + ph[2].levels);
  if (sk.before) fail('levels', 'level 2 is open before the skip exam');
  if (sk.n < 30) fail('levels', 'the skip exam has only ' + sk.n + ' questions');
  if (sk.failed || !sk.wait) fail('levels', 'a skip exam under 85% opened level 2 or allowed a retry at once');
  if (!sk.passed.every(Boolean)) fail('levels', 'a passed skip exam did not open level 2: ' + JSON.stringify(sk.passed));
  if (sk.lv3) fail('levels', 'a skip exam of level 1 opened level 3');
  if (sk.place[0] !== 4 || sk.place[1] !== 8 || !sk.opened5) fail('levels', 'the placement test with every answer right should place in level 5 with 8 questions per level: ' + JSON.stringify(sk));
  p.errs.forEach((e) => fail('levels', 'JS error ' + e));
  await p.close();
}

// Gradation: a text does not use a grammar form before the level of the rule that teaches it (lessons, conversations,
// stories and trip chapters). Set phrases a learner hears before the rule are listed in GRAD_OK.
const GRAD_OK = ['ممنون که آمدید', 'خوشحالم که'];
async function gradation(b, url) {
  const p = await page(b, url);
  const r = await p.evaluate((ok) => {
    const E = '(?=[\\s.،؛؟?!:»]|$)', B = '(?:^|(?<=[\\s«]))';
    const F = [
      ['present perfect', B + '(?!خانواد|آماده|ساده|پیاده|زیاده|یازده|دوازده|سیزده|چهارده|پانزده|شانزده|هفده|هجده|نوزده|ده )\\S+(ده|ته|یده|اده)‌(ام|ای|ایم|اید|اند)' + E + '|' + B + '(?!خانواد|آماده|ساده|پیاده|زیاده|یازده|دوازده|سیزده|چهارده|پانزده|شانزده|هفده|هجده|نوزده|ده )\\S+(ده|ته|یده|اده) است' + E, 'الماضي القريب (النقلي)'],
      ['past perfect', B + '(?!خانواد|آماده|ساده|پیاده|زیاده|یازده|دوازده|سیزده|چهارده|پانزده|شانزده|هفده|هجده|نوزده|ده )\\S+(ده|ته|یده|اده) (بود|بودم|بودی|بودیم|بودید|بودند)' + E, 'الماضي البعيد'],
      ['subjunctive', B + '(باید|نباید|می‌خواهم|می‌خواهی|می‌خواهد|می‌توانم|می‌توانی|می‌تواند) ب\\S+', 'المضارع الالتزامي'],
      ['future', B + 'خواه(م|ی|د|یم|ید|ند) ', 'المستقبل'],
      ['conditional', B + 'اگر' + E, 'الشرط: اگر'],
      ['که', ' که ', 'الجمل الموصولة: که'],
      ['کاش', B + 'کاش' + E, 'التمنّي: کاش'],
      ['imperative', B + '(بیا|برو|بگو|بخور|بنشین|ببین|بکن|بگیر|بده|نکن|نرو|نگو|بیایید|بروید|بگویید|بنشینید|ببینید|بگیرید|بدهید|نکنید)' + E, 'الأمر والنهي'],
      ['comparative', B + '(\\S+‌تر|\\S+‌ترین|بهتر|بیشتر|کمتر|بهترین|بیشترین|کمترین)' + E, 'المقارنة والتفضيل'],
      ['passive', B + '(?!خسته|آماده|ساده|زنده|خانواده|پیاده|بسته |برنده)\\S+(ده|ته) (شد|شدم|شدی|شدیم|شدید|شدند|شده|می‌شود|می‌شوند|نمی‌شود)' + E, 'المبني للمجهول'],
      ['subjunctive', B + '(شاید|نباید|نمی‌توانم|نمی‌توانی|نمی‌تواند|می‌توانیم|می‌توانید|می‌توانند|می‌خواهیم|می‌خواهید|می‌خواهند|نمی‌خواهم|بهتر است|لازم است) ب\\S+', 'المضارع الالتزامي'],
      ['«داشتن» progressive', B + '(داشت|داشتم|داشتی|داشتیم|داشتید|داشتند|دارم|داری|دارد|داریم|دارید|دارند) می‌', '«داشتن» للحدث الجاري'],
      ['«باید می‌»', B + 'باید می‌', '«باید می‌رفتم»: كان يجب، لا بدّ أنّه'],
      ['«با این‌که»', B + 'با این‌که', '«با این‌که»: رغم أنّ'],
      ['«در حالی که»', 'در حالی که', '«در حالی که»: بينما، في حين أنّ'],
      ['«آن‌قدر… که»', B + 'آن‌قدر', '«آن‌قدر… که»: لدرجة أنّ'],
      ['«مگر»', B + 'مگر' + E, '«مگر»: هل حقاً؟ وإلّا إذا'],
      ['«قبل از این‌که»', '(قبل|بعد) از این‌که', 'قبل أن وبعد أن: قبل از این‌که، بعد از این‌که'],
    ].map(([n, re, t]) => [n, new RegExp(re), GR.findIndex((g) => g.t === t)]);
    const bad = [];
    F.forEach(([n, , gi]) => { if (gi < 0) bad.push('rule for ' + n + ' not found'); });
    const chk = (where, k, txt) => { if (ok.some((o) => txt.indexOf(o) >= 0)) return; F.forEach(([n, re, gi]) => { if (gi >= 0 && k < lvOf(gi, 'G') && re.test(txt)) bad.push(`${n} in ${where} (level ${k + 1}, rule in level ${lvOf(gi, 'G') + 1}): ${txt.slice(0, 50)}`); }); };
    LES.forEach((l, i) => l.w.forEach((w) => chk('lesson «' + l.t + '»', lvOf(i), w[0])));
    DLG.forEach((d, i) => d.l.forEach((l) => chk('conversation «' + d.t + '»', lvOf(i, 'D'), l[0])));
    STORY.forEach((s) => { if (!s.c) s.s.forEach((l) => chk('story «' + s.ta + '»', s.lv - 1, l[0])); });
    TRIP.forEach((c, i) => c.ln.forEach((l) => chk('chapter «' + c.t + '»', lvOf(i, 'T'), l[0])));
    TRIP.forEach((c, i) => c.say.forEach((t) => t.forEach((x) => chk('learner phrases of «' + c.t + '»', lvOf(i, 'T'), x[0]))));
    RD.forEach((r, i) => r.s.forEach((l) => chk('reading of «' + DLG[i].t + '»', lvOf(i, 'D'), l[0])));
    return bad;
  }, GRAD_OK);
  r.forEach((x) => fail('gradation', x));
  p.errs.forEach((e) => fail('gradation', 'JS error ' + e));
  await p.close();
}

// A learner from the first day: every level's lessons, rules and conversations open one by one, the next level only
// after them; the review holds only words of started lessons, at most RVCAP a day, with choices of the card's shape;
// the rank follows the points.
async function learner(b, url) {
  const p = await page(b, url, { state: { xp: 0, st: 0, last: '', srs: {}, v: 28, prem: 1, plSkip: true } });
  const r = await p.evaluate(() => {
    const bad = [];
    S.pass = {}; S.gp = {}; S.dp = {}; S.sg = {}; S.srs = {}; S.trip = {}; S.story = {}; S.skip = {}; S.exam = {}; S.place = 0; S.rvd = null;
    const tracks = [['L', 'pass', unlocked], ['G', 'gp', gOpen], ['D', 'dp', dOpen]];
    for (let k = 0; k < LVL.length; k++) {
      const x = LVL[k];
      for (const [G, key, open] of tracks) for (let i = x[G][0]; i < x[G][1]; i++) {
        if (!open(i)) { bad.push(`level ${k + 1}: ${G}${i} closed when its turn came`); break; }
        if (i + 1 < x[G][1] && open(i + 1) && !S[key][i + 1]) { bad.push(`level ${k + 1}: ${G}${i + 1} open before ${G}${i}`); break; }
        S[key][i] = 1;
        if (G === 'L') { S.sg[i] = 5; LES[i].w.forEach((w, j) => { S.srs[i + '-' + j] = { b: 1, d: 0 }; }); }
        if (k + 1 < LVL.length && i === x[G][1] - 1 && G !== 'D') {
          const nx = LVL[k + 1], first = [unlocked(nx.L[0]), gOpen(nx.G[0]), dOpen(nx.D[0])];
          if (first.some(Boolean)) bad.push(`level ${k + 2} opens before level ${k + 1} is finished: ` + JSON.stringify(first));
        }
      }
      if (k + 1 < LVL.length) { const nx = LVL[k + 1]; if (!unlocked(nx.L[0]) || !gOpen(nx.G[0]) || !dOpen(nx.D[0])) bad.push(`level ${k + 2} stays closed after level ${k + 1}`); }
      if (k === 0) {
        const q = queue();
        if (q.q.length !== Math.min(RVCAP, LVL[0].L[1] * 10) && q.q.length !== RVCAP) bad.push('review after level 1 holds ' + q.q.length + ' cards');
        if (q.q.some((w) => w.l >= LVL[0].L[1])) bad.push('review shows a word of a lesson not started');
        q.q.slice(0, 10).forEach((w) => makeRC({ w, retry: false }).o.forEach((o) => { if (isSen(o) !== isSen(w)) bad.push('review choices mix words and sentences: ' + w.fa); }));
      }
    }
    if (lvl(0) !== 0 || lvl(LV[LV.length - 1]) !== LV.length - 1 || lvl(1000) >= LV.length / 2) bad.push('ranks do not follow the points');
    return bad;
  });
  r.forEach((x) => fail('learner', x));
  p.errs.forEach((e) => fail('learner', 'JS error ' + e));
  await p.close();
}

// Every page of the content opens without "undefined", "NaN" or text wider than a phone.
async function crawl(b, url) {
  const p = await page(b, url, { state: { xp: 10, st: 1, last: '', srs: {}, v: 28, prem: 1, plSkip: true } });
  const r = await p.evaluate(() => {
    OPEN = true;
    const out = [], chk = (n) => { const m = document.getElementById('main'), t = m ? m.innerText : ''; const x = /undefined|NaN|\[object/.exec(t); if (x) out.push(n + ': …' + t.slice(Math.max(0, x.index - 25), x.index + 20) + '…'); if (document.documentElement.scrollWidth > innerWidth + 2) out.push(n + ': wider than the screen (' + document.documentElement.scrollWidth + ')'); };
    const run = (n, f) => { try { f(); chk(n); } catch (e) { out.push(n + ': ' + e.message); } };
    LES.forEach((l, i) => run('lesson ' + (i + 1), () => { go('home'); sub = i; render(); }));
    GR.forEach((g, i) => run('rule ' + (i + 1), () => { go('gram'); G = i; render(); }));
    DLG.forEach((d, i) => { run('conversation ' + (i + 1), () => { go('talk'); RV = false; D = i; render(); }); run('reading ' + (i + 1), () => { RV = true; render(); }); RV = false; });
    STORY.forEach((s, i) => run('story ' + (i + 1), () => { go('talk'); stOpen(i); }));
    Object.keys(SEC).forEach((s) => SEC[s].d.forEach((c, i) => run(s + ' ' + (i + 1), () => { CS = s; CL = i; go('col'); })));
    TRIP.forEach((c, i) => run('chapter ' + (i + 1), () => { go('talk'); aiOpen(); aiChapter(i); }));
    V.forEach((v, i) => { if (i % 5 === 0) run('verb ' + (i + 1), () => { go('verbs'); CV = i; render(); }); });
    for (let k = 0; k < LVL.length; k++) run('level exam ' + (k + 1), () => { go('me'); EX = { k, qs: exQs(k), i: 0, a: null, sc: {}, res: null }; render(); });
    return out;
  });
  r.slice(0, 20).forEach((x) => fail('crawl', x));
  if (r.length > 20) fail('crawl', (r.length - 20) + ' more');
  p.errs.forEach((e) => fail('crawl', 'JS error ' + e));
  await p.close();
}

async function games(b, url) {
  const p = await page(b, url, { state: { xp: 10, st: 1, last: '', srs: {}, v: 28, pass: all(20) } });
  for (const m of ['prv', 'ant', 'lis', 'tf', 'rid']) {
    const ok = await p.evaluate((m) => { go('games'); gmStart(m); for (let i = 0; i < 40 && !GM.fin; i++) { const q = GM.qs[GM.i]; gmPick(q.o.indexOf(q.a)); gmNext(); } return GM.fin && GM.sc === GM.qs.length; }, m);
    if (!ok) fail('games', m + ' did not finish with every answer right');
  }
  const ord = await p.evaluate(() => { go('games'); startLG('ord'); if (LG.qs.length < 3) return 'only ' + LG.qs.length + ' sentences'; for (const q of LG.qs) { q.cs.forEach((c) => { const x = q.t.find((y) => y.c === c && q.p.indexOf(y) < 0); spTap(x.i); }); if (!q.done || q.p.map((x) => x.c).join(' ') !== q.w.fa) return 'sentence not built: ' + q.w.fa; lgNext(); } return LG.fin && LG.sc === LG.qs.length ? '' : 'no result'; });
  if (ord) fail('games', 'sentence order: ' + ord);
  // Daily review: the wrong choices of a word card are words, of a sentence card sentences.
  const mixed = await p.evaluate(() => { const bad = []; ALL.forEach((w, i) => { if (i % 7) return; const r = makeRC({ w, retry: false }); r.o.forEach((o) => { if (isSen(o) !== isSen(w)) bad.push(w.fa + ' / ' + o.fa); }); }); return bad.slice(0, 3); });
  if (mixed.length) fail('games', 'review choices mix words and sentences: ' + mixed.join(' | '));
  // Daily review shows only words met in a lesson, never new ones.
  const fresh = await p.evaluate(() => { const keep = S.srs; S.srs = {}; const n = queue().q.length; S.srs = keep; return n; });
  if (fresh) fail('games', 'the daily review offers ' + fresh + ' new words with nothing studied');
  const unseen = await p.evaluate(() => { const keep = [S.srs, S.pass, S.sg]; S.pass = { 0: 1 }; S.sg = { 0: 5 }; S.srs = { [LES[0].w.length ? '0-0' : 'x']: { b: 1, d: 0 }, '5-0': { b: 1, d: 0 } }; const ids = queue().q.map((w) => w.id); [S.srs, S.pass, S.sg] = keep; return ids; });
  if (unseen.join() !== '0-0') fail('games', 'the daily review shows words of a lesson not started: ' + unseen.join());
  // Lesson stages and the daily challenge: wrong choices of the card's shape too.
  const stageMix = await p.evaluate(() => { const bad = []; for (let l = 0; l < 20; l++) for (const g of [0, 2, 4]) { startStage(l, g, true); Q.qs.forEach((q) => q.o.forEach((o) => { if (isSen(o) !== isSen(q.w)) bad.push(LES[l].t + ': ' + q.w.fa + ' / ' + o.fa); })); } Q = null; return bad.slice(0, 3); });
  if (stageMix.length) fail('games', 'lesson choices mix words and sentences: ' + stageMix.join(' | '));
  // Daily review: at most RVCAP cards a day, then a message and 10 more on request.
  const cap = await p.evaluate(() => { const keep = [S.srs, S.pass, S.sg, S.rvd]; S.pass = {}; S.sg = {}; S.srs = {}; ALL.slice(0, 120).forEach((w) => { S.sg[w.l] = 1; S.srs[w.id] = { b: 1, d: 0 }; }); S.rvd = null; const a = queue().q.length; for (let i = 0; i < RVCAP; i++) rvCount(); const b = queue().q.length, all = queue().all; go('review'); RC = null; render(); const msg = document.querySelector('#main').textContent.indexOf('أنهيت مراجعة اليوم') >= 0; const r = rvToday(); r.x = 10; S.rvd = r; const c = queue().q.length; [S.srs, S.pass, S.sg, S.rvd] = keep; RC = null; return [a, b, all, msg, c]; });
  if (cap[0] !== 30 || cap[1] !== 0 || cap[2] !== 120 || !cap[3] || cap[4] !== 10) fail('games', 'daily review limit: ' + JSON.stringify(cap));
  // «أكمل المثل» and «چیستان»: every item has a level, and a learner in level 2 meets none above it.
  const fit = await p.evaluate(() => { const bad = []; prvPool().forEach((x) => { if (!PRVLV[x.fa]) bad.push('no level: ' + x.fa); }); RID.forEach((x) => { if (!RIDLV[x[3]]) bad.push('no level: ' + x[3]); });
    const keep = [S.pass, S.gp, S.dp, S.skip]; S.skip = { 0: { ok: 1 } }; const m = gmLv(); if (m !== 2) bad.push('open level ' + m);
    for (let r = 0; r < 5; r++) { gmStart('prv'); GM.qs.forEach((q) => { if (PRVLV[q.fa] > 2) bad.push('level ' + PRVLV[q.fa] + ' proverb: ' + q.fa); }); gmStart('rid'); GM.qs.forEach((q) => { if (RIDLV[q.a] > 2) bad.push('level ' + RIDLV[q.a] + ' riddle: ' + q.a); }); }
    [S.pass, S.gp, S.dp, S.skip] = keep; GM = null; return [...new Set(bad)].slice(0, 5); });
  if (fit.length) fail('games', 'proverbs and riddles by level: ' + fit.join(' | '));
  // Phase 2 (levels with ph:2): one locked heading and no titles until level 7 is done, then its content shows.
  const ph2 = await p.evaluate(() => {
    const k = ph2K(), first = LES[LVL[k].L[0]].t, seen = () => [...document.querySelectorAll('button')].some((b) => b.offsetParent && b.innerText.includes(first));
    const keep = [S.pass, S.gp, S.dp]; go('home'); const lockedOk = !ph2Open() && document.body.innerText.includes('المرحلة الثانية') && !seen() && !tripMap().includes(TRIP[TRIP10].t);
    const all = (n) => Object.fromEntries([...Array(n).keys()].map((i) => [i, 1])); S.pass = all(LVL[k - 1].L[1]); S.gp = all(LVL[k - 1].G[1]); S.dp = all(LVL[k - 1].D[1]);
    go('home'); const openOk = ph2Open() && seen() && tripMap().includes(TRIP[TRIP10].t);
    [S.pass, S.gp, S.dp] = keep; go('home'); return [lockedOk, openOk]; });
  if (!ph2[0] || !ph2[1]) fail('games', 'phase 2 lock: ' + JSON.stringify(ph2));
  // Ranks: as many names as thresholds, rising, and the top one far beyond a beginner's points.
  const ranks = await p.evaluate(() => [LV.length === LT.length, LV.every((x, i) => !i || x > LV[i - 1]), LV[LV.length - 1] >= 40000, lvl(0), lvl(2500) < LV.length - 1]);
  if (!ranks.every((x, i) => (i === 3 ? x === 0 : x))) fail('games', 'ranks table: ' + JSON.stringify(ranks));
  // The admin's lock button appears only for the admin.
  const adm = await p.evaluate(() => { const keep = ME; ME = { kind: 'member', ok: true, email: 'a@b.c' }; const a = adminBox(); ME = { kind: 'member', ok: true, email: 'a@b.c', admin: true }; const b = adminBox(); ME = keep; return [a === '', b.indexOf('open=all') >= 0]; });
  if (!adm[0] || !adm[1]) fail('games', 'admin lock button: ' + JSON.stringify(adm));
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
    const p = await page(b, url, { state: Object.assign({ xp: 10, st: 1, last: '', srs: {}, v: 28, prem: 1 }, st) });
    const r = await p.evaluate(() => dtPick(5).map((q) => [q.lv, dtN(q.fa).length]));
    if (r.length !== 5) fail('dictation', `${name}: ${r.length} sentences`);
    if (r.some(([lv, n]) => lv > maxLv || n > maxWords)) fail('dictation', `${name}: sentence above the level or too long ${JSON.stringify(r)}`);
    if (r.some((x, i) => i && x[1] < r[i - 1][1])) fail('dictation', `${name}: not from easiest to hardest ${JSON.stringify(r)}`);
    // A plain space where the half-space belongs is not a mistake (می گویند, کتاب ها, بزرگ تر).
    const sp = await p.evaluate(() => [['به فارسی چه می‌گویند؟', 'به فارسی چه می گویند'], ['کتاب‌ها را نمی‌خواهم', 'کتاب ها را نمی خواهم'], ['این بزرگ‌ترین شهر است', 'این بزرگ ترین شهر است']].map(([e, g]) => dtMark(e, g).st.every(Boolean)));
    if (!sp.every(Boolean)) fail('dictation', `${name}: a space instead of the half-space counted as wrong ${JSON.stringify(sp)}`);
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
  await inviteGift();
}

// Parsa is for paid subscribers only: an invite gift (and the free version) is refused, chapter 1 included.
// A paid subscriber with the same kind of access ('member') is not stopped.
async function inviteGift() {
  const store = new Map(), kv = { get: async (k, ty) => { const v = store.has(k) ? store.get(k) : null; return v !== null && ty === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { store.set(k, String(v)); }, delete: async (k) => { store.delete(k); } };
  const { makeSession, sessionCookie } = await import(path.join(ROOT, 'lib/auth.js'));
  const { onRequest } = await import(path.join(ROOT, 'functions/api/chat.js'));
  const day = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  const env = { TRIALS: kv, AI: { run: async () => { throw new Error('no AI in tests'); } } };
  const ask = async (email, c) => {
    const cookie = sessionCookie(await makeSession(kv, email)).split(';')[0];
    return onRequest({ env, request: new Request('https://site.dev/api/chat', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://site.dev', 'Content-Type': 'application/json' }, body: JSON.stringify({ s: 0, c, msgs: [{ r: 'u', t: 'سلام' }] }) }) });
  };
  store.set('allow:gift@x.iq', day); store.set('invg:gift@x.iq', day); store.set('allow:paid@x.iq', day);
  const g = await ask('gift@x.iq', 3), p = await ask('paid@x.iq', 3), t = await ask('gift@x.iq', 0);
  if (g.status !== 403) fail('server', 'invite gift: Parsa chapter 4 answers ' + g.status + ', expected 403 (subscribers only)');
  if (p.status === 403) fail('server', 'a paid subscriber is refused Parsa chapter 4');
  if (t.status !== 403) fail('server', 'invite gift: Parsa chapter 1 answers ' + t.status + ', expected 403 (no free taste)');
  // Parsa's daily count lives in KV, so a learner without the cookie (cleared) still has 12 used of 12.
  store.set('pc:paid@x.iq:' + new Date().toISOString().slice(0, 10), '12');
  const cookie = sessionCookie(await makeSession(kv, 'paid@x.iq')).split(';')[0];
  const left = await (await onRequest({ env, request: new Request('https://site.dev/api/chat', { headers: { Cookie: cookie } }) })).json();
  if (left.left !== 0 || left.limit !== 12) fail('server', 'Parsa daily limit without the cookie: ' + JSON.stringify(left));
  const over = await ask('paid@x.iq', 3);
  if (over.status !== 429) fail('server', 'Parsa: message 13 of the day answers ' + over.status + ', expected 429');
  // The gift goes to the inviter only, for the first 3 friends; the new learner gets nothing.
  const { applyInvite, inviteCode, INVITE_DAYS } = await import(path.join(ROOT, 'lib/invite.js'));
  const code = await inviteCode(kv, 'host@x.iq'), ends = [];
  for (const f of ['f1@x.iq', 'f2@x.iq', 'f3@x.iq', 'f4@x.iq']) { await applyInvite(kv, f, code); ends.push(store.get('allow:host@x.iq')); }
  const days = (d) => Math.round((Date.parse(d) - Date.parse(new Date().toISOString().slice(0, 10))) / 864e5) + 1;
  if (['f1@x.iq', 'f2@x.iq', 'f3@x.iq', 'f4@x.iq'].some((f) => store.has('allow:' + f))) fail('server', 'invite: the new learner got a gift');
  if (ends.map(days).join() !== [1, 2, 3, 3].map((n) => n * INVITE_DAYS).join()) fail('server', 'invite: the inviter got ' + ends.map(days) + ' days after 4 friends, expected 3 gifts of ' + INVITE_DAYS);
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
  const steps = [['content', content], ['screens', screens], ['free', free], ['links', links], ['levels', levels], ['gradation', gradation], ['learner', learner], ['crawl', crawl], ['progress', progress], ['games', games], ['dictation', dictation], ['server', server], ['audio', audio]];
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
