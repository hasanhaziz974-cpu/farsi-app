// Merging a learner's progress from two devices (used by functions/api/progress.js).
// Nothing learned on either device is lost: completed lessons, rules, conversations, readings, badges
// and saved sentences are combined; for each word or sentence the more advanced review state is kept;
// points and counters take the larger value; the streak comes from the device that studied last.
// A reset or a restored backup sets resetAt; the side with the later resetAt replaces the other.

// Settings and in-progress state that belong to one device and are never stored on the server.
export const DEVICE_FIELDS = ['rem', 'remDay', 'remAsk', 'free', 'tri', 'sfx', 'sv', 'plan', 'prem', 'syncT', 'fs', 'inst', 'instHide'];

const UNION = ['pass', 'gp', 'dp', 'rd', 'rpd', 'bd', 'snap', 'colp']; // colp: spoken-Persian lessons passed
// ss: sentence -> time saved; ssx: sentence -> time removed. The later of the two wins.
const MAX_EACH = ['sg', 'hist', 'ss', 'ssx', 'story']; // story: best stars of each short story
const MAX = ['xp', 'dgn', 'dcn', 'qc', 'place', 'placeAt', 'invn', 'gmb']; // gmb: best score in the one-minute race // invn: friends from the invite link already celebrated // place: level from the placement test

const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const time = (d) => (d ? Date.parse(d) || 0 : 0);

function reviewMerge(a, b) {
  const out = { ...obj(a) };
  for (const [k, y] of Object.entries(obj(b))) {
    const x = out[k];
    if (!x || (y.b || 0) > (x.b || 0) || ((y.b || 0) === (x.b || 0) && (y.d || 0) > (x.d || 0))) out[k] = y;
  }
  return out;
}

export function stripDevice(s) {
  const out = { ...obj(s) };
  for (const k of DEVICE_FIELDS) delete out[k];
  return out;
}

// State version 3 (index.html, migrateV3): three level-6 rules were inserted at index 34, so a copy saved by an
// app from before (v 2) has its rule numbers at 34 and above moved up by 3 before it is merged or sent back.
const upRule = (i) => (i >= 34 ? i + 3 : i);
const upEx = (id) => {
  const a = String(id).split('.');
  return a.length === 2 ? upRule(+a[0]) + '.' + a[1] : id;
};
export function upgrade(s) {
  const d = { ...obj(s) };
  if (d.v === 15) return upgrade16(d);
  if (d.v === 14) return upgrade15(d);
  if (d.v === 13) return upgrade14(d);
  if (d.v === 12) return upgrade13(d);
  if (d.v === 11) return upgrade12(d);
  if (d.v === 10) return upgrade11(d);
  if (d.v === 9) return upgrade10(d);
  if (d.v === 8) return upgrade9(d);
  if (d.v === 7) return upgrade8(d);
  if (d.v === 6) return upgrade7(d);
  if (d.v === 5) return upgrade6(d);
  if (d.v === 4) return upgrade5(d);
  if (d.v === 3) return upgrade4(d);
  if (d.v !== 2) return d;
  const gp = {};
  for (const [k, v] of Object.entries(obj(d.gp))) gp[upRule(+k)] = v;
  d.gp = gp;
  const unl = {};
  for (const [k, v] of Object.entries(obj(d.unl))) {
    const m = /^G(\d+)$/.exec(k);
    unl[m ? 'G' + upRule(+m[1]) : k] = v;
  }
  d.unl = unl;
  const mist = {};
  for (const [k, v] of Object.entries(obj(d.mist))) {
    if (v && v.k === 'g') {
      const x = { ...v, x: upEx(v.x) };
      mist['g:' + x.x] = x;
    } else mist[k] = v;
  }
  d.mist = mist;
  d.v = 3;
  return upgrade4(d);
}

// State version 4 (index.html, migrateV4): four level-6 conversations were inserted at index 42, so conversation
// numbers at 42 and above move up by 4 (finished conversations, readings, role-plays, unlocks, notebook lines).
const upDlg = (i) => (i >= 42 ? i + 4 : i);
const upLine = (id) => {
  const a = String(id).split('.');
  return a.length === 2 ? upDlg(+a[0]) + '.' + a[1] : id;
};
function upgrade4(s) {
  const d = { ...obj(s) };
  if (d.v !== 3) return d;
  for (const k of ['dp', 'rd', 'rpd']) {
    const o = {};
    for (const [i, v] of Object.entries(obj(d[k]))) o[upDlg(+i)] = v;
    d[k] = o;
  }
  const unl = {};
  for (const [k, v] of Object.entries(obj(d.unl))) {
    const m = /^D(\d+)$/.exec(k);
    unl[m ? 'D' + upDlg(+m[1]) : k] = v;
  }
  d.unl = unl;
  const mist = {};
  for (const [k, v] of Object.entries(obj(d.mist))) {
    if (v && v.k === 'l') {
      const x = { ...v, x: upLine(v.x) };
      mist['l:' + x.x] = x;
    } else mist[k] = v;
  }
  d.mist = mist;
  d.v = 4;
  return upgrade5(d);
}

// State version 5 (index.html, migrateV5): one rule was added at the end of each of levels 2-5 (old indices
// 10, 16, 22, 28), so rule numbers move up by the number of those places at or below them.
const upRule5 = (i) => i + (i >= 10) + (i >= 16) + (i >= 22) + (i >= 28);
const upEx5 = (id) => {
  const a = String(id).split('.');
  return a.length === 2 ? upRule5(+a[0]) + '.' + a[1] : id;
};
function upgrade5(s) {
  const d = { ...obj(s) };
  if (d.v !== 4) return d;
  const gp = {};
  for (const [k, v] of Object.entries(obj(d.gp))) gp[upRule5(+k)] = v;
  d.gp = gp;
  const unl = {};
  for (const [k, v] of Object.entries(obj(d.unl))) {
    const m = /^G(\d+)$/.exec(k);
    unl[m ? 'G' + upRule5(+m[1]) : k] = v;
  }
  d.unl = unl;
  const mist = {};
  for (const [k, v] of Object.entries(obj(d.mist))) {
    if (v && v.k === 'g') {
      const x = { ...v, x: upEx5(v.x) };
      mist['g:' + x.x] = x;
    } else mist[k] = v;
  }
  d.mist = mist;
  d.v = 5;
  return upgrade6(d);
}

// State version 6 (index.html, migrateV6): one lesson was added at the end of each of levels 2-6 (old indices
// 16, 25, 33, 41, 49), so lesson numbers move up: passed lessons, stage scores, word reviews, unlocks, notebook words.
const upLes = (i) => i + (i >= 16) + (i >= 25) + (i >= 33) + (i >= 41) + (i >= 49);
const upWord = (id) => {
  const a = String(id).split('-');
  return a.length === 2 ? upLes(+a[0]) + '-' + a[1] : id;
};
function upgrade6(s) {
  const d = { ...obj(s) };
  if (d.v !== 5) return d;
  for (const k of ['pass', 'sg']) {
    const o = {};
    for (const [i, v] of Object.entries(obj(d[k]))) o[upLes(+i)] = v;
    d[k] = o;
  }
  const srs = {};
  for (const [id, v] of Object.entries(obj(d.srs))) srs[upWord(id)] = v;
  d.srs = srs;
  const unl = {};
  for (const [k, v] of Object.entries(obj(d.unl))) {
    const m = /^L(\d+)$/.exec(k);
    unl[m ? 'L' + upLes(+m[1]) : k] = v;
  }
  d.unl = unl;
  const mist = {};
  for (const [k, v] of Object.entries(obj(d.mist))) {
    if (v && v.k === 'w') {
      const x = { ...v, x: upWord(v.x) };
      mist['w:' + x.x] = x;
    } else mist[k] = v;
  }
  d.mist = mist;
  d.v = 6;
  return upgrade7(d);
}

// State version 7 (index.html, migrateV7): one conversation was added at the end of each of levels 1-4 (old indices
// 7, 14, 21, 28), so conversation numbers move up, as in upgrade4, and so do the covered conversations (cov).
const upDlg7 = (i) => i + (i >= 7) + (i >= 14) + (i >= 21) + (i >= 28);
const upLine7 = (id) => {
  const a = String(id).split('.');
  return a.length === 2 ? upDlg7(+a[0]) + '.' + a[1] : id;
};
function upgrade7(s) {
  const d = { ...obj(s) };
  if (d.v !== 6) return d;
  for (const k of ['dp', 'rd', 'rpd', 'cov']) {
    const o = {};
    for (const [i, v] of Object.entries(obj(d[k]))) o[upDlg7(+i)] = v;
    d[k] = o;
  }
  const unl = {};
  for (const [k, v] of Object.entries(obj(d.unl))) {
    const m = /^D(\d+)$/.exec(k);
    unl[m ? 'D' + upDlg7(+m[1]) : k] = v;
  }
  d.unl = unl;
  const mist = {};
  for (const [k, v] of Object.entries(obj(d.mist))) {
    if (v && v.k === 'l') {
      const x = { ...v, x: upLine7(v.x) };
      mist['l:' + x.x] = x;
    } else mist[k] = v;
  }
  d.mist = mist;
  d.v = 7;
  return upgrade8(d);
}

// State version 8 (index.html, migrateV8): one trip chapter was added at the end of each of levels 1-4 (old indices
// 6, 12, 18, 24), so saved chapters (trip) move up by the number of those places at or below them.
const upTrip = (i) => i + (i >= 6) + (i >= 12) + (i >= 18) + (i >= 24);
function upgrade8(s) {
  const d = { ...obj(s) };
  if (d.v !== 7) return d;
  const trip = {};
  for (const [i, v] of Object.entries(obj(d.trip))) trip[upTrip(+i)] = v;
  d.trip = trip;
  d.v = 8;
  return upgrade9(d);
}

// State version 9 (index.html, migrateV9): two rules at the end of level 1 (old index 5) and lessons at the end of
// levels 3 and 5 (old indices 27, 45). Rules at 5 and above move up by 2; lessons as in upgrade6.
const upR9 = (i) => (i >= 5 ? i + 2 : i);
const upL9 = (i) => i + (i >= 27) + (i >= 45);
function upgrade9(s) {
  const d = { ...obj(s) };
  if (d.v !== 8) return d;
  const move = (o, up) => { const n = {}; for (const [i, v] of Object.entries(obj(o))) n[up(+i)] = v; return n; };
  d.gp = move(d.gp, upR9);
  d.pass = move(d.pass, upL9);
  d.sg = move(d.sg, upL9);
  const srs = {};
  for (const [id, v] of Object.entries(obj(d.srs))) { const a = String(id).split('-'); srs[a.length === 2 ? upL9(+a[0]) + '-' + a[1] : id] = v; }
  d.srs = srs;
  const unl = {};
  for (const [k, v] of Object.entries(obj(d.unl))) { const g = /^G(\d+)$/.exec(k), l = /^L(\d+)$/.exec(k); unl[g ? 'G' + upR9(+g[1]) : l ? 'L' + upL9(+l[1]) : k] = v; }
  d.unl = unl;
  const mist = {};
  for (const [k, v] of Object.entries(obj(d.mist))) {
    if (v && v.k === 'g') { const a = String(v.x).split('.'); const x = { ...v, x: a.length === 2 ? upR9(+a[0]) + '.' + a[1] : v.x }; mist['g:' + x.x] = x; }
    else if (v && v.k === 'w') { const a = String(v.x).split('-'); const x = { ...v, x: a.length === 2 ? upL9(+a[0]) + '-' + a[1] : v.x }; mist['w:' + x.x] = x; }
    else mist[k] = v;
  }
  d.mist = mist;
  d.v = 9;
  return upgrade10(d);
}

// State version 10 (index.html, migrateV10): one conversation at the end of each of levels 2, 4, 6 (old indices
// 16, 32, 50), moved like in upgrade7.
const upDlg10 = (i) => i + (i >= 16) + (i >= 32) + (i >= 50);
function upgrade10(s) {
  const d = { ...obj(s) };
  if (d.v !== 9) return d;
  for (const k of ['dp', 'rd', 'rpd', 'cov']) {
    const o = {};
    for (const [i, v] of Object.entries(obj(d[k]))) o[upDlg10(+i)] = v;
    d[k] = o;
  }
  const unl = {};
  for (const [k, v] of Object.entries(obj(d.unl))) { const m = /^D(\d+)$/.exec(k); unl[m ? 'D' + upDlg10(+m[1]) : k] = v; }
  d.unl = unl;
  const mist = {};
  for (const [k, v] of Object.entries(obj(d.mist))) {
    if (v && v.k === 'l') { const a = String(v.x).split('.'); const x = { ...v, x: a.length === 2 ? upDlg10(+a[0]) + '.' + a[1] : v.x }; mist['l:' + x.x] = x; }
    else mist[k] = v;
  }
  d.mist = mist;
  d.v = 10;
  return upgrade11(d);
}

// State version 11 (index.html, migrateV11): rules at the end of levels 5 and 6 (old indices 34, 43), and trip
// chapters before old chapters 39, 45 and 63.
const upR11 = (i) => i + (i >= 34) + (i >= 43);
const upT11 = (i) => i + (i >= 39) + (i >= 45) + (i >= 63);
function upgrade11(s) {
  const d = { ...obj(s) };
  if (d.v !== 10) return d;
  const move = (o, up) => { const n = {}; for (const [i, v] of Object.entries(obj(o))) n[up(+i)] = v; return n; };
  d.gp = move(d.gp, upR11);
  d.trip = move(d.trip, upT11);
  const unl = {};
  for (const [k, v] of Object.entries(obj(d.unl))) { const g = /^G(\d+)$/.exec(k); unl[g ? 'G' + upR11(+g[1]) : k] = v; }
  d.unl = unl;
  const mist = {};
  for (const [k, v] of Object.entries(obj(d.mist))) {
    if (v && v.k === 'g') { const a = String(v.x).split('.'); const x = { ...v, x: a.length === 2 ? upR11(+a[0]) + '.' + a[1] : v.x }; mist['g:' + x.x] = x; }
    else mist[k] = v;
  }
  d.mist = mist;
  d.v = 11;
  return upgrade12(d);
}

// State version 12 (index.html, migrateV12): lessons at the end of levels 4 and 6 (old indices 37, 56) and
// conversations at the end of levels 3 and 5 (old indices 25, 42).
const upL12 = (i) => i + (i >= 37) + (i >= 56);
const upD12 = (i) => i + (i >= 25) + (i >= 42);
function upgrade12(s) {
  const d = { ...obj(s) };
  if (d.v !== 11) return d;
  const move = (o, up) => { const n = {}; for (const [i, v] of Object.entries(obj(o))) n[up(+i)] = v; return n; };
  d.pass = move(d.pass, upL12);
  d.sg = move(d.sg, upL12);
  for (const k of ['dp', 'rd', 'rpd', 'cov']) d[k] = move(d[k], upD12);
  const srs = {};
  for (const [id, v] of Object.entries(obj(d.srs))) { const a = String(id).split('-'); srs[a.length === 2 ? upL12(+a[0]) + '-' + a[1] : id] = v; }
  d.srs = srs;
  const unl = {};
  for (const [k, v] of Object.entries(obj(d.unl))) { const l = /^L(\d+)$/.exec(k), g = /^D(\d+)$/.exec(k); unl[l ? 'L' + upL12(+l[1]) : g ? 'D' + upD12(+g[1]) : k] = v; }
  d.unl = unl;
  const mist = {};
  for (const [k, v] of Object.entries(obj(d.mist))) {
    if (v && v.k === 'w') { const a = String(v.x).split('-'); const x = { ...v, x: a.length === 2 ? upL12(+a[0]) + '-' + a[1] : v.x }; mist['w:' + x.x] = x; }
    else if (v && v.k === 'l') { const a = String(v.x).split('.'); const x = { ...v, x: a.length === 2 ? upD12(+a[0]) + '.' + a[1] : v.x }; mist['l:' + x.x] = x; }
    else mist[k] = v;
  }
  d.mist = mist;
  d.v = 12;
  return upgrade13(d);
}

// State version 13 (index.html, migrateV13): rules at the end of levels 3 and 4 (old indices 20, 27), and trip
// chapters before old chapters 21 and 28.
const upR13 = (i) => i + (i >= 20) + (i >= 27);
const upT13 = (i) => i + (i >= 21) + (i >= 28);
function upgrade13(s) {
  const d = { ...obj(s) };
  if (d.v !== 12) return d;
  const move = (o, up) => { const n = {}; for (const [i, v] of Object.entries(obj(o))) n[up(+i)] = v; return n; };
  d.gp = move(d.gp, upR13);
  d.trip = move(d.trip, upT13);
  const unl = {};
  for (const [k, v] of Object.entries(obj(d.unl))) { const g = /^G(\d+)$/.exec(k); unl[g ? 'G' + upR13(+g[1]) : k] = v; }
  d.unl = unl;
  const mist = {};
  for (const [k, v] of Object.entries(obj(d.mist))) {
    if (v && v.k === 'g') { const a = String(v.x).split('.'); const x = { ...v, x: a.length === 2 ? upR13(+a[0]) + '.' + a[1] : v.x }; mist['g:' + x.x] = x; }
    else mist[k] = v;
  }
  d.mist = mist;
  d.v = 13;
  return upgrade14(d);
}

// State version 14 (index.html, migrateV14): lessons at the end of levels 3 and 5 (old indices 28, 48) and
// conversations at the end of levels 2 and 6 (old indices 17, 55).
const upL14 = (i) => i + (i >= 28) + (i >= 48);
const upD14 = (i) => i + (i >= 17) + (i >= 55);
function upgrade14(s) {
  const d = { ...obj(s) };
  if (d.v !== 13) return d;
  const move = (o, up) => { const n = {}; for (const [i, v] of Object.entries(obj(o))) n[up(+i)] = v; return n; };
  d.pass = move(d.pass, upL14);
  d.sg = move(d.sg, upL14);
  for (const k of ['dp', 'rd', 'rpd', 'cov']) d[k] = move(d[k], upD14);
  const srs = {};
  for (const [id, v] of Object.entries(obj(d.srs))) { const a = String(id).split('-'); srs[a.length === 2 ? upL14(+a[0]) + '-' + a[1] : id] = v; }
  d.srs = srs;
  const unl = {};
  for (const [k, v] of Object.entries(obj(d.unl))) { const l = /^L(\d+)$/.exec(k), g = /^D(\d+)$/.exec(k); unl[l ? 'L' + upL14(+l[1]) : g ? 'D' + upD14(+g[1]) : k] = v; }
  d.unl = unl;
  const mist = {};
  for (const [k, v] of Object.entries(obj(d.mist))) {
    if (v && v.k === 'w') { const a = String(v.x).split('-'); const x = { ...v, x: a.length === 2 ? upL14(+a[0]) + '-' + a[1] : v.x }; mist['w:' + x.x] = x; }
    else if (v && v.k === 'l') { const a = String(v.x).split('.'); const x = { ...v, x: a.length === 2 ? upD14(+a[0]) + '.' + a[1] : v.x }; mist['l:' + x.x] = x; }
    else mist[k] = v;
  }
  d.mist = mist;
  d.v = 14;
  return upgrade15(d);
}

// State version 15 (index.html, migrateV15): rules (old indices 13, 47), trip chapters (before old 12, 49),
// lessons (old 17, 39) and a conversation (old 36).
const upR15 = (i) => i + (i >= 13) + (i >= 47);
const upT15 = (i) => i + (i >= 12) + (i >= 49);
const upL15 = (i) => i + (i >= 17) + (i >= 39);
const upD15 = (i) => i + (i >= 36);
function upgrade15(s) {
  const d = { ...obj(s) };
  if (d.v !== 14) return d;
  const move = (o, up) => { const n = {}; for (const [i, v] of Object.entries(obj(o))) n[up(+i)] = v; return n; };
  d.gp = move(d.gp, upR15);
  d.trip = move(d.trip, upT15);
  d.pass = move(d.pass, upL15);
  d.sg = move(d.sg, upL15);
  for (const k of ['dp', 'rd', 'rpd', 'cov']) d[k] = move(d[k], upD15);
  const srs = {};
  for (const [id, v] of Object.entries(obj(d.srs))) { const a = String(id).split('-'); srs[a.length === 2 ? upL15(+a[0]) + '-' + a[1] : id] = v; }
  d.srs = srs;
  const unl = {};
  for (const [k, v] of Object.entries(obj(d.unl))) { const g = /^G(\d+)$/.exec(k), l = /^L(\d+)$/.exec(k), x = /^D(\d+)$/.exec(k); unl[g ? 'G' + upR15(+g[1]) : l ? 'L' + upL15(+l[1]) : x ? 'D' + upD15(+x[1]) : k] = v; }
  d.unl = unl;
  const mist = {};
  for (const [k, v] of Object.entries(obj(d.mist))) {
    if (v && v.k === 'g') { const a = String(v.x).split('.'); const x = { ...v, x: a.length === 2 ? upR15(+a[0]) + '.' + a[1] : v.x }; mist['g:' + x.x] = x; }
    else if (v && v.k === 'w') { const a = String(v.x).split('-'); const x = { ...v, x: a.length === 2 ? upL15(+a[0]) + '-' + a[1] : v.x }; mist['w:' + x.x] = x; }
    else if (v && v.k === 'l') { const a = String(v.x).split('.'); const x = { ...v, x: a.length === 2 ? upD15(+a[0]) + '.' + a[1] : v.x }; mist['l:' + x.x] = x; }
    else mist[k] = v;
  }
  d.mist = mist;
  d.v = 15;
  return upgrade16(d);
}

// State version 16 (index.html, migrateV16): the rule «که» moved from old index 30 to 14.
const upR16 = (i) => (i === 30 ? 14 : i >= 14 && i < 30 ? i + 1 : i);
function upgrade16(s) {
  const d = { ...obj(s) };
  if (d.v !== 15) return d;
  const gp = {};
  for (const [i, v] of Object.entries(obj(d.gp))) gp[upR16(+i)] = v;
  d.gp = gp;
  const unl = {};
  for (const [k, v] of Object.entries(obj(d.unl))) { const g = /^G(\d+)$/.exec(k); unl[g ? 'G' + upR16(+g[1]) : k] = v; }
  d.unl = unl;
  const mist = {};
  for (const [k, v] of Object.entries(obj(d.mist))) {
    if (v && v.k === 'g') { const a = String(v.x).split('.'); const x = { ...v, x: a.length === 2 ? upR16(+a[0]) + '.' + a[1] : v.x }; mist['g:' + x.x] = x; }
    else mist[k] = v;
  }
  d.mist = mist;
  d.v = 16;
  return d;
}

export function mergeProgress(stored, incoming) {
  const a = upgrade(stripDevice(stored)), b = upgrade(stripDevice(incoming));
  if ((b.resetAt || 0) > (a.resetAt || 0)) return b;
  if ((a.resetAt || 0) > (b.resetAt || 0)) return a;
  const out = { ...a, ...b };
  for (const k of UNION) out[k] = { ...obj(a[k]), ...obj(b[k]) };
  for (const k of MAX_EACH) {
    const m = { ...obj(a[k]) };
    for (const [i, v] of Object.entries(obj(b[k]))) m[i] = Math.max(Number(m[i]) || 0, Number(v) || 0);
    out[k] = m;
  }
  for (const k of MAX) out[k] = Math.max(Number(a[k]) || 0, Number(b[k]) || 0);
  out.srs = reviewMerge(a.srs, b.srs);
  // Today's review count (index.html, rvToday): the higher count of the same day, so the daily limit holds on every device.
  const ra = obj(a.rvd), rb = obj(b.rvd);
  if (ra.d || rb.d) out.rvd = ra.d === rb.d ? { d: ra.d, n: Math.max(ra.n || 0, rb.n || 0), x: Math.max(ra.x || 0, rb.x || 0) } : (String(ra.d || '') > String(rb.d || '') ? ra : rb);
  out.ssr = reviewMerge(a.ssr, b.ssr);
  out.mist = reviewMerge(a.mist, b.mist);
  const exam = { ...obj(a.exam) }; // end-of-level exams: the best result and a pass stay
  for (const [k, y] of Object.entries(obj(b.exam))) {
    const x = obj(exam[k]);
    exam[k] = { p: Math.max(Number(x.p) || 0, Number(y.p) || 0), ok: !!(x.ok || y.ok), at: Math.max(Number(x.at) || 0, Number(y.at) || 0) };
  }
  out.exam = exam;
  const skip = { ...obj(a.skip) }; // skip exams («أعرف هذا المستوى»): the same, a pass stays
  for (const [k, y] of Object.entries(obj(b.skip))) {
    const x = obj(skip[k]);
    skip[k] = { p: Math.max(Number(x.p) || 0, Number(y.p) || 0), ok: !!(x.ok || y.ok), at: Math.max(Number(x.at) || 0, Number(y.at) || 0) };
  }
  out.skip = skip; // 📕 my mistakes: the further reviewed (or removed, b=99) wins
  for (const id of Object.keys(out.ss)) if ((out.ssx[id] || 0) > out.ss[id]) delete out.ss[id];
  for (const id of Object.keys(out.ssr)) if (!out.ss[id]) delete out.ssr[id];
  const cov = { ...obj(a.cov) };
  for (const [i, d] of Object.entries(obj(b.cov))) cov[i] = cov[i] ? Math.min(cov[i], d) : d;
  out.cov = cov;
  const latest = time(a.last) > time(b.last) ? a : b;
  out.last = latest.last || '';
  out.st = latest.st || 0;
  out.frz = latest.frz || 0; // streak protection days, from the device that studied last
  out.dc = time(a.dc) > time(b.dc) ? a.dc : b.dc;
  if (a.dg && b.dg && a.dg.d === b.dg.d) out.dg = { d: a.dg.d, x: Math.max(a.dg.x || 0, b.dg.x || 0), ok: a.dg.ok || b.dg.ok };
  else out.dg = time(a.dg && a.dg.d) > time(b.dg && b.dg.d) ? a.dg : b.dg;
  // Trip chapters: tasks done on either device are kept, with the better stars and the later finish.
  const trip = {};
  for (const i of new Set([...Object.keys(obj(a.trip)), ...Object.keys(obj(b.trip))])) {
    const x = obj(obj(a.trip)[i]), y = obj(obj(b.trip)[i]);
    // rs: when a finished chapter was started again (its tasks start empty); the later replay wins.
    const list = (v) => (Array.isArray(v.done) ? v.done : []);
    const rx = Number(x.rs) || 0, ry = Number(y.rs) || 0;
    const done = rx === ry ? [...list(x), ...list(y)] : list(rx > ry ? x : y);
    const t = { done: [...new Set(done)].sort() };
    if (Math.max(rx, ry)) t.rs = Math.max(rx, ry);
    const stars = Math.max(Number(x.stars) || 0, Number(y.stars) || 0), at = Math.max(Number(x.at) || 0, Number(y.at) || 0);
    if (stars) t.stars = stars;
    if (at) t.at = at;
    trip[i] = t;
  }
  out.trip = trip;
  out.fw = a.fw || b.fw;
  out.pf = a.pf || b.pf;
  return out;
}
