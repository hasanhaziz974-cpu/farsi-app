// POST {email}: sends a 6-digit sign-in code to the email (see lib/auth.js).
// Refused for throwaway inboxes, within RESEND_SECONDS of the last code, after MAX_SENDS_PER_DAY codes
// to one email, and after MAX_MAILS_PER_DAY codes in all (the sending Gmail account's daily limit).
import { cleanEmail, isDisposable, newCode, codeHash, CODE_MINUTES, RESEND_SECONDS, MAX_SENDS_PER_DAY, MAX_MAILS_PER_DAY } from '../../../lib/auth.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request, env }) {
  const kv = env.TRIALS;
  if (!kv || !env.MAIL_URL || !env.MAIL_KEY) return json({ error: 'not_ready', msg: 'تسجيل الدخول غير جاهز بعد. حاول لاحقاً.' }, 503);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'origin' }, 403);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'body' }, 400); }
  const email = cleanEmail(body.email);
  if (!email) return json({ error: 'email', msg: 'اكتب بريداً إلكترونياً صحيحاً.' }, 400);
  if (isDisposable(email)) return json({ error: 'disposable', msg: 'هذا بريد مؤقت. استعمل بريدك الدائم، مثل Gmail.' }, 400);

  const day = new Date().toISOString().slice(0, 10);
  const key = 'code:' + email;
  const old = await kv.get(key, 'json');
  const sends = old && old.day === day ? old.n : 0;
  if (old && Date.now() - old.at < RESEND_SECONDS * 1000) {
    return json({ error: 'wait', msg: 'أُرسل رمز قبل قليل. انتظر دقيقة ثم اطلب رمزاً جديداً.', wait: Math.ceil((old.at + RESEND_SECONDS * 1000 - Date.now()) / 1000) }, 429);
  }
  if (sends >= MAX_SENDS_PER_DAY) return json({ error: 'limit', msg: 'طلبت رموزاً كثيرة اليوم. حاول غداً، أو استعمل آخر رمز وصلك.' }, 429);
  const total = Number(await kv.get('mails:' + day)) || 0;
  if (total >= MAX_MAILS_PER_DAY) return json({ error: 'busy', msg: 'وصلنا إلى حدّ الرسائل لهذا اليوم. حاول بعد ساعات.' }, 429);

  const code = newCode();
  const sent = await fetch(env.MAIL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: env.MAIL_KEY, to: email, code, minutes: CODE_MINUTES }),
    redirect: 'follow',
  }).then((r) => r.text()).catch(() => '');
  if (!/"ok"\s*:\s*true/.test(sent)) return json({ error: 'mail', msg: 'تعذّر إرسال الرمز الآن. حاول بعد قليل.' }, 502);

  await kv.put(key, JSON.stringify({ h: await codeHash(kv, email, code), at: Date.now(), tries: 0, day, n: sends + 1 }),
    { expirationTtl: 24 * 3600 });
  await kv.put('mails:' + day, String(total + 1), { expirationTtl: 3 * 24 * 3600 });
  return json({ ok: true, minutes: CODE_MINUTES });
}
