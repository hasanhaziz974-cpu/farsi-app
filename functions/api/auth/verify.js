// POST {email, code}: checks the code and starts a session (sets the "ps" cookie).
import { cleanEmail, codeHash, makeSession, sessionCookie, CODE_MINUTES, MAX_TRIES } from '../../../lib/auth.js';

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export async function onRequestPost({ request, env }) {
  const kv = env.TRIALS;
  if (!kv) return json({ error: 'not_ready' }, 503);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'origin' }, 403);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'body' }, 400); }
  const email = cleanEmail(body.email), code = String(body.code || '').replace(/\D/g, '');
  if (!email || code.length !== 6) return json({ error: 'code', msg: 'اكتب الرمز المكوّن من 6 أرقام.' }, 400);

  const key = 'code:' + email;
  const rec = await kv.get(key, 'json');
  if (!rec || !rec.h || Date.now() - rec.at > CODE_MINUTES * 60e3) return json({ error: 'expired', msg: 'انتهت صلاحية الرمز. اطلب رمزاً جديداً.' }, 400);
  if (rec.tries >= MAX_TRIES) return json({ error: 'tries', msg: 'محاولات خاطئة كثيرة. اطلب رمزاً جديداً.' }, 400);
  if ((await codeHash(kv, email, code)) !== rec.h) {
    rec.tries++;
    await kv.put(key, JSON.stringify(rec), { expirationTtl: 24 * 3600 });
    return json({ error: 'wrong', msg: 'الرمز غير صحيح.', left: MAX_TRIES - rec.tries }, 400);
  }
  // Used: keep the daily send count but drop the code.
  await kv.put(key, JSON.stringify({ at: rec.at, tries: 0, day: rec.day, n: rec.n }), { expirationTtl: 24 * 3600 });
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(await makeSession(kv, email)) });
}
