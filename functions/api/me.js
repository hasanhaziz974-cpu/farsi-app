// The signed-in learner's access, for the app's subscription card and the "trial ends soon" banner.
import { accessEmail, accessStatus, TRIAL_DAYS, CONTACT, payConfig } from '../../lib/trial.js';
import { readSession, needsRenewal, makeSession, sessionCookie } from '../../lib/auth.js';
import { isGift } from '../../lib/invite.js';

export async function onRequest({ request, env }) {
  const email = await accessEmail(request, env);
  if (!email || !env.TRIALS) return Response.json({ error: 'signin' }, { status: 401 });
  const st = await accessStatus(env.TRIALS, email, false);
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  // Renew the app's own session when it is close to expiring, so active learners stay signed in.
  const own = await readSession(request, env.TRIALS);
  if (own && needsRenewal(own)) headers.append('Set-Cookie', sessionCookie(await makeSession(env.TRIALS, email)));
  const gift = st.kind === 'member' && (await isGift(env.TRIALS, email, await env.TRIALS.get('allow:' + email)));
  return Response.json({ email, trialDays: TRIAL_DAYS, contact: CONTACT, ...st, ...(gift ? { gift } : {}), pay: await payConfig(env.TRIALS) }, { headers });
}
