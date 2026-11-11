// Sign in with Facebook (alongside the emailed code). Needs FACEBOOK_APP_ID and FACEBOOK_APP_SECRET as Pages
// secrets (tools/sync_access.py copies them from the GitHub secrets), and in the Facebook app this address as
// a valid OAuth redirect URI: https://<site>/api/auth/facebook
//   GET ?check=1       -> {on: true|false}: whether the button should show
//   GET (no code)      -> to Facebook's sign-in dialog, with a random state kept in a short cookie
//   GET ?code&state    -> Facebook sends the learner back: the code is exchanged for their email, a session
//                         starts ("ps" cookie, lib/auth.js) and they go to the app (or to ?next).
// Learners whose Facebook account has no email are sent back to the login page to use the emailed code.
import { cleanEmail, makeSession, sessionCookie } from '../../../lib/auth.js';

const GRAPH = 'https://graph.facebook.com/v19.0';

function back(url, msg) {
  return Response.redirect(new URL('/login/?fb=' + encodeURIComponent(msg), url).toString(), 302);
}
const cookie = (name, value, age) => `${name}=${value}; Max-Age=${age}; Path=/api/auth/facebook; HttpOnly; Secure; SameSite=Lax`;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id = (env.FACEBOOK_APP_ID || '').trim(), secret = (env.FACEBOOK_APP_SECRET || '').trim();
  if (url.searchParams.get('check')) return Response.json({ on: !!(id && secret && env.TRIALS) }, { headers: { 'Cache-Control': 'no-store' } });
  if (!id || !secret || !env.TRIALS) return back(url, 'off');
  const redirect = url.origin + '/api/auth/facebook';

  const code = url.searchParams.get('code');
  if (!code) {
    if (url.searchParams.get('error')) return back(url, 'cancel');
    const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const next = url.searchParams.get('next') || '/';
    const go = new URL('https://www.facebook.com/v19.0/dialog/oauth');
    go.search = new URLSearchParams({ client_id: id, redirect_uri: redirect, state, scope: 'email', response_type: 'code' }).toString();
    const h = new Headers({ Location: go.toString(), 'Cache-Control': 'no-store' });
    h.append('Set-Cookie', cookie('fbs', state, 600));
    h.append('Set-Cookie', cookie('fbn', encodeURIComponent(/^\/(?!\/)/.test(next) ? next : '/'), 600));
    return new Response(null, { status: 302, headers: h });
  }

  const jar = request.headers.get('Cookie') || '';
  const got = (n) => (jar.match(new RegExp('(?:^|;\\s*)' + n + '=([^;]+)')) || [])[1] || '';
  if (!got('fbs') || got('fbs') !== url.searchParams.get('state')) return back(url, 'state');

  try {
    const tok = await (await fetch(GRAPH + '/oauth/access_token?' + new URLSearchParams({ client_id: id, client_secret: secret, redirect_uri: redirect, code }))).json();
    if (!tok.access_token) return back(url, 'token');
    const me = await (await fetch(GRAPH + '/me?' + new URLSearchParams({ fields: 'id,email', access_token: tok.access_token }))).json();
    const email = cleanEmail(me.email);
    if (!email) return back(url, 'noemail');
    const h = new Headers({ Location: new URL(decodeURIComponent(got('fbn') || '%2F'), url.origin).toString(), 'Cache-Control': 'no-store' });
    h.append('Set-Cookie', sessionCookie(await makeSession(env.TRIALS, email)));
    h.append('Set-Cookie', cookie('fbs', '', 0));
    h.append('Set-Cookie', cookie('fbn', '', 0));
    return new Response(null, { status: 302, headers: h });
  } catch (e) {
    return back(url, 'token');
  }
}
