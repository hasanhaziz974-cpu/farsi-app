// Reports from the app, shown on /admin:
// - type "err": a JavaScript error a learner's app hit (message and screen only, nothing personal), kept as
//   "err:<hash of message>" = {m, w, n, first, last}; the same error only counts once a minute, so a loop
//   cannot use up the KV free plan's daily writes.
// - type "fb": a learner's note from «💬 لديك ملاحظة؟», kept as "fb:<time>:<random>" = {t, w, e, at} with the
//   sign-in email, at most 10 a day per learner.
import { accessEmail } from '../../lib/trial.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const clip = (v, n) => String(v || '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n);

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function onRequest({ request, env }) {
  const kv = env.TRIALS;
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  const email = await accessEmail(request, env);
  if (!email || !kv) return json({ error: 'signin' }, 401);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'origin' }, 403);
  const text = await request.text();
  if (text.length > 4000) return json({ error: 'size' }, 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    return json({ error: 'body' }, 400);
  }
  const now = Date.now();
  if (body && body.type === 'err') {
    const m = clip(body.m, 300);
    if (!m) return json({ error: 'empty' }, 400);
    const key = 'err:' + hash(m);
    const old = (await kv.get(key, 'json')) || { m, n: 0, first: now, last: 0 };
    if (now - old.last < 60e3) return json({ ok: true });
    await kv.put(key, JSON.stringify({ m, w: clip(body.w, 80), n: old.n + 1, first: old.first, last: now }));
    return json({ ok: true });
  }
  if (body && body.type === 'fb') {
    const t = clip(body.t, 1000);
    if (t.length < 3) return json({ error: 'empty' }, 400);
    const day = new Date(now).toISOString().slice(0, 10);
    const countKey = 'fbn:' + email + ':' + day;
    const count = Number(await kv.get(countKey)) || 0;
    if (count >= 10) return json({ error: 'limit' }, 429);
    await kv.put(countKey, String(count + 1), { expirationTtl: 2 * 86400 });
    await kv.put('fb:' + now + ':' + Math.random().toString(36).slice(2, 7), JSON.stringify({ t, w: clip(body.w, 120), e: email, at: now }));
    return json({ ok: true });
  }
  return json({ error: 'type' }, 400);
}
