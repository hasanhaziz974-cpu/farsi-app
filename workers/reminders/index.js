// Daily reminders of the installed web app, sent by a Cloudflare Worker on a cron schedule
// (every 10 minutes, set by tools/deploy_reminders.py). It replaced tools/send_reminders.py on
// GitHub Actions, which now stops by itself while this Worker is running ("reminders:worker").
//
// Learners turn the reminder on in the app; functions/api/reminder.js stores "push:<email>" in the
// farsi-trials KV namespace (binding TRIALS) = {sub, hour, tz, last, sent}, and the same record as the
// key's metadata, so one list call reads a thousand learners without reading each value. A learner is
// reminded once per local day at the chosen hour, unless they already studied that day ("last").
//
// The push carries no data, so it needs no encryption: sw.js chooses the text. It is authorised
// with VAPID (RFC 8292), an ES256 key pair in KV under "vapid" ({private: PKCS8 PEM, public:
// base64url}), the same key the Python script used; it is created here if missing.
// Push services that answer 404 or 410 no longer know the subscription, so its record is deleted.
//
// Each run does at most BUDGET KV and fetch calls (env var BUDGET, default 45: the free plan allows 50
// per run). Learners left over are reached by the next run, ten minutes later, within the same hour.
// On the Workers Paid plan set BUDGET to 900 (tools/deploy_reminders.py: REMINDER_BUDGET).

const CONTACT = 'mailto:languageparsa777@gmail.com';
const te = new TextEncoder();

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pemToBuf(pem) {
  const bin = atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function bufToPem(buf) {
  const s = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return '-----BEGIN PRIVATE KEY-----\n' + s.match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n';
}

// The record as key metadata (KV allows 1024 bytes). A subscription too long for it keeps only the
// endpoint there, with big: 1, and its full record is read from the value when it is due.
export function meta(rec) {
  if (JSON.stringify(rec).length <= 1000) return rec;
  return { sub: { endpoint: rec.sub.endpoint }, hour: rec.hour, tz: rec.tz, last: rec.last, sent: rec.sent, big: 1 };
}

// Is this learner's reminder due at `now` (ms)? tz is the browser's getTimezoneOffset (minutes).
export function due(m, now) {
  const local = new Date(now - (Number(m.tz) || 0) * 60000);
  const day = local.toISOString().slice(0, 10);
  const hourNow = local.getUTCHours() === Number(m.hour);
  return { day, send: hourNow && m.sent !== day && m.last !== day };
}

async function vapid(kv) {
  const v = await kv.get('vapid', 'json');
  if (v) {
    const key = await crypto.subtle.importKey('pkcs8', pemToBuf(v.private), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    return { key, pub: v.public };
  }
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
  const priv = bufToPem(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  await kv.put('vapid', JSON.stringify({ private: priv, public: pub }));
  return { key: kp.privateKey, pub };
}

export async function vapidHeader(v, endpoint, cache = {}) {
  const aud = new URL(endpoint).origin;
  if (cache[aud]) return cache[aud];
  const head = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACT })));
  const sig = b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, te.encode(head + '.' + claims)));
  return (cache[aud] = `vapid t=${head}.${claims}.${sig}, k=${v.pub}`);
}

export async function run(env, now = Date.now(), fetcher = fetch) {
  const kv = env.TRIALS;
  let budget = Number(env.BUDGET) || 45;
  const spend = () => budget-- > 0;
  const counts = { on: 0, due: 0, sent: 0, removed: 0, failed: 0, later: 0 };
  spend(); await kv.put('reminders:worker', String(now)); // tells the old GitHub script to stand down
  spend(); const v = await vapid(kv);
  const cache = {}, todo = [];
  let cursor;
  do {
    if (!spend()) break;
    const page = await kv.list({ prefix: 'push:', cursor });
    cursor = page.list_complete ? null : page.cursor;
    for (const k of page.keys) {
      let m = k.metadata;
      if (!m || !m.sub) { // a record written before metadata was added: copy it into the metadata once
        if (budget < 2) { counts.later++; continue; }
        spend(); const rec = await kv.get(k.name, 'json');
        if (!rec || !rec.sub) continue;
        m = meta(rec);
        spend(); await kv.put(k.name, JSON.stringify(rec), { metadata: m });
      }
      counts.on++;
      const d = due(m, now);
      if (d.send) todo.push({ name: k.name, m, day: d.day });
    }
  } while (cursor);
  counts.due = todo.length;
  for (const t of todo) {
    if (budget < (t.m.big ? 3 : 2)) { counts.later++; continue; }
    spend();
    let status = 0;
    try {
      const res = await fetcher(t.m.sub.endpoint, {
        method: 'POST',
        headers: { Authorization: await vapidHeader(v, t.m.sub.endpoint, cache), TTL: String(4 * 3600), Urgency: 'normal' },
        body: '',
      });
      status = res.status;
    } catch (e) { status = 0; }
    if (status >= 200 && status < 300) {
      if (t.m.big) spend();
      const rec = t.m.big ? await kv.get(t.name, 'json') : { ...t.m };
      if (!rec) continue;
      rec.sent = t.day;
      spend(); await kv.put(t.name, JSON.stringify(rec), { metadata: meta(rec) });
      counts.sent++;
    } else if (status === 404 || status === 410) {
      spend(); await kv.delete(t.name);
      counts.removed++;
    } else counts.failed++;
  }
  // Counts only: emails never reach the logs.
  console.log(`Reminders: ${counts.on} on, ${counts.due} due, ${counts.sent} sent, ${counts.removed} removed, ${counts.failed} failed, ${counts.later} left for the next run.`);
  return counts;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  async fetch() {
    return new Response('farsi reminders', { headers: { 'Content-Type': 'text/plain' } });
  },
};
