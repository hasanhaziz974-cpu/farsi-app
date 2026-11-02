// The signed-in learner's access, for the app's subscription card and the "trial ends soon" banner.
import { accessEmail, accessStatus, TRIAL_DAYS, CONTACT } from '../../lib/trial.js';

export async function onRequest({ request, env }) {
  const email = await accessEmail(request);
  if (!email || !env.TRIALS) return Response.json({ error: 'signin' }, { status: 401 });
  const st = await accessStatus(env.TRIALS, email, false);
  return Response.json({ email, trialDays: TRIAL_DAYS, contact: CONTACT, ...st },
    { headers: { 'Cache-Control': 'no-store' } });
}
