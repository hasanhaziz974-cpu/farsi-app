// Signs out of the app's own session, and of a Cloudflare Access session from before it, then shows
// the welcome page.
import { CLEAR_COOKIE } from '../lib/auth.js';

export async function onRequest({ request }) {
  const headers = new Headers({ Location: new URL('/welcome/', request.url).toString(), 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', CLEAR_COOKIE);
  headers.append('Set-Cookie', 'CF_Authorization=; Path=/; Max-Age=0; Secure; SameSite=Lax');
  return new Response(null, { status: 302, headers });
}
