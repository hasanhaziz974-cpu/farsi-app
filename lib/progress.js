// Merging a learner's progress from two devices (used by functions/api/progress.js).
// Nothing learned on either device is lost: completed lessons, rules, conversations, readings, badges
// and saved sentences are combined; for each word or sentence the more advanced review state is kept;
// points and counters take the larger value; the streak comes from the device that studied last.
// A reset or a restored backup sets resetAt; the side with the later resetAt replaces the other.

// Settings and in-progress state that belong to one device and are never stored on the server.
export const DEVICE_FIELDS = ['rem', 'remDay', 'remAsk', 'free', 'sfx', 'sv', 'plan', 'prem', 'syncT'];

const UNION = ['pass', 'gp', 'dp', 'rd', 'rpd', 'bd', 'snap'];
// ss: sentence -> time saved; ssx: sentence -> time removed. The later of the two wins.
const MAX_EACH = ['sg', 'hist', 'ss', 'ssx', 'story']; // story: best stars of each short story
const MAX = ['xp', 'dgn', 'dcn', 'qc'];

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

export function mergeProgress(stored, incoming) {
  const a = stripDevice(stored), b = stripDevice(incoming);
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
  out.ssr = reviewMerge(a.ssr, b.ssr);
  out.mist = reviewMerge(a.mist, b.mist); // 📕 my mistakes: the further reviewed (or removed, b=99) wins
  for (const id of Object.keys(out.ss)) if ((out.ssx[id] || 0) > out.ss[id]) delete out.ss[id];
  for (const id of Object.keys(out.ssr)) if (!out.ss[id]) delete out.ssr[id];
  const cov = { ...obj(a.cov) };
  for (const [i, d] of Object.entries(obj(b.cov))) cov[i] = cov[i] ? Math.min(cov[i], d) : d;
  out.cov = cov;
  const latest = time(a.last) > time(b.last) ? a : b;
  out.last = latest.last || '';
  out.st = latest.st || 0;
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
