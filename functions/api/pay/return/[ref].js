// Where ZainCash sends the learner back after paying (or giving up): /api/pay/return/<ref>?token=…
// The order is settled by asking the gateway (lib/zaincash.js), then the learner goes back to the app.
// Public (functions/_middleware.js): it works even if the learner's sign-in ended while they were paying.
import { zcReady, settle } from '../../../../lib/zaincash.js';

export async function onRequest({ request, env, params }) {
  const origin = new URL(request.url).origin;
  let st = 'unknown';
  if (env.TRIALS && zcReady(env)) {
    try { st = await settle(env, env.TRIALS, String(params.ref || '')); } catch (e) { st = 'pending'; }
  }
  const to = st === 'paid' ? 'ok' : st === 'failed' ? 'fail' : st === 'pending' ? 'wait' : 'err';
  return Response.redirect(origin + '/?pay=' + to, 303);
}
