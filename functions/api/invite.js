// GET: the signed-in learner's invite link and how many friends signed up with it (lib/invite.js).
import { accessEmail } from '../../lib/trial.js';
import { inviteCode, invitedCount, INVITE_DAYS, INVITE_MAX } from '../../lib/invite.js';

export async function onRequestGet({ request, env }) {
  const kv = env.TRIALS;
  const email = await accessEmail(request, env);
  if (!email || !kv) return Response.json({ error: 'signin' }, { status: 401 });
  const code = await inviteCode(kv, email);
  const n = await invitedCount(kv, email);
  const allow = await kv.get('allow:' + email);
  const forever = ((await kv.get('allowlist', 'json')) || []).includes(email) || (allow !== null && !/^\s*[\d٠-٩۰-۹]{4}-/.test(allow));
  return Response.json({ link: new URL('/welcome/?r=' + code, request.url).toString(), days: INVITE_DAYS, max: INVITE_MAX, n: Math.min(n, INVITE_MAX), forever },
    { headers: { 'Cache-Control': 'no-store' } });
}
