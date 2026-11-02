// Cloud copy of a learner's progress, kept under their sign-in email in KV as "prog:<email>" =
// {t, data}. The app sends its progress and gets back the merge of it with the stored copy
// (lib/progress.js), so the same email finds the same progress on any device. A write happens only
// when the merge changes the stored copy, to stay well inside the KV free plan's daily write limit.
import { accessEmail } from '../../lib/trial.js';
import { mergeProgress, stripDevice } from '../../lib/progress.js';

const MAX_BYTES = 1 << 20;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function onRequest({ request, env }) {
  const kv = env.TRIALS;
  const email = await accessEmail(request, env);
  if (!email || !kv) return json({ error: 'signin' }, 401);
  const key = 'prog:' + email;
  const stored = (await kv.get(key, 'json')) || { t: 0, data: null };

  if (request.method === 'GET') return json(stored);
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  // Same-origin only (sendBeacon may omit Origin; the sign-in cookie is not sent cross-site).
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'origin' }, 403);

  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ error: 'size' }, 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    return json({ error: 'body' }, 400);
  }
  const incoming = body && body.data;
  if (!incoming || typeof incoming !== 'object' || typeof incoming.srs !== 'object' || typeof incoming.xp !== 'number') {
    return json({ error: 'invalid' }, 400);
  }

  const merged = stored.data ? mergeProgress(stored.data, incoming) : stripDevice(incoming);
  if (stored.data && JSON.stringify(merged) === JSON.stringify(stored.data)) return json(stored);
  const out = { t: Date.now(), data: merged };
  await kv.put(key, JSON.stringify(out));
  return json(out);
}
