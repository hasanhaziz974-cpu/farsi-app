// Daily reminder settings for the installed web app. Each signed-in learner has one KV entry,
// "push:<email>" = {sub, hour, tz, last, sent}: the browser's push subscription, the local hour to
// remind at, the browser's UTC offset (getTimezoneOffset, minutes), the last local day they studied
// and the last local day a reminder went out. The same record is kept as the key's metadata, so the
// reminder Worker (workers/reminders/index.js, every 10 minutes) lists learners without reading each value.
// The VAPID key pair is in KV under "vapid"; the Worker creates it if missing.
import { accessEmail } from '../../lib/trial.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Same as meta() in workers/reminders/index.js: the record as metadata (1024 bytes at most).
const meta = (rec) => JSON.stringify(rec).length <= 1000 ? rec
  : { sub: { endpoint: rec.sub.endpoint }, hour: rec.hour, tz: rec.tz, last: rec.last, sent: rec.sent, big: 1 };
const save = (kv, key, rec) => kv.put(key, JSON.stringify(rec), { metadata: meta(rec) });

export async function onRequest({ request, env }) {
  const kv = env.TRIALS;
  const email = await accessEmail(request, env);
  if (!email || !kv) return json({ error: 'signin' }, 401);
  const key = 'push:' + email;

  if (request.method === 'GET') {
    const vapid = await kv.get('vapid', 'json');
    const rec = await kv.get(key, 'json');
    return json({ publicKey: vapid ? vapid.public : null, on: !!rec, hour: rec ? rec.hour : null });
  }
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'origin' }, 403);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'body' }, 400);
  }

  if (body.action === 'off') {
    await kv.delete(key);
    return json({ on: false });
  }

  if (body.action === 'save') {
    const sub = body.sub || {};
    const hour = Number(body.hour);
    const tz = Number(body.tz);
    if (typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys ||
        !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isFinite(tz) || Math.abs(tz) > 840) {
      return json({ error: 'invalid' }, 400);
    }
    const old = (await kv.get(key, 'json')) || {};
    await save(kv, key, {
      sub: { endpoint: sub.endpoint, keys: sub.keys }, hour, tz,
      last: old.last || '', sent: old.sent || '',
    });
    return json({ on: true, hour });
  }

  if (body.action === 'studied') {
    const rec = await kv.get(key, 'json');
    if (rec && DAY_RE.test(String(body.day)) && rec.last !== body.day) {
      rec.last = body.day;
      await save(kv, key, rec);
    }
    return json({ ok: true });
  }

  return json({ error: 'action' }, 400);
}
