// "Invite a friend": every learner has a personal link (/welcome/?r=<code>). When someone new signs up
// with it, the new learner's trial and the inviter's access both get INVITE_DAYS more days, for up to
// INVITE_MAX friends per inviter. Only a brand-new trial counts (functions/_middleware.js calls
// applyInvite once, when the trial starts), and the same person (also through Gmail dots or +tags)
// counts once. KV: "invc:<email>" -> code, "inv:<code>" -> email, "invn:<email>" -> {who: [emails]}.
import { TRIAL_DAYS, DAY, lastDay, today } from './trial.js';

export const INVITE_DAYS = 7;
export const INVITE_MAX = 5;
const CODE = /^[a-z0-9]{8}$/;

export async function inviteCode(kv, email) {
  const have = await kv.get('invc:' + email);
  if (have) return have;
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const code = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => abc[b % abc.length]).join('');
  await kv.put('inv:' + code, email);
  await kv.put('invc:' + email, code);
  return code;
}

export async function invitedCount(kv, email) {
  const rec = await kv.get('invn:' + email, 'json');
  return rec && Array.isArray(rec.who) ? rec.who.length : 0;
}

// One person, however the address is written: Gmail ignores dots and anything after "+".
function canon(email) {
  const [u, d] = email.split('@');
  return /^(gmail|googlemail)\.com$/.test(d) ? u.split('+')[0].replace(/\./g, '') + '@gmail.com' : email;
}

const addDays = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);

async function extend(kv, email) {
  if (((await kv.get('allowlist', 'json')) || []).includes(email)) return;
  const allow = await kv.get('allow:' + email);
  if (allow !== null) {
    const until = lastDay(allow);
    if (until) await kv.put('allow:' + email, addDays(until > today() ? until : today(), INVITE_DAYS));
    return; // no end date: nothing to add
  }
  const start = Number(await kv.get('trial:' + email));
  if (!start) return;
  const end = Math.max(start + TRIAL_DAYS * DAY, Date.now()) + INVITE_DAYS * DAY;
  await kv.put('trial:' + email, String(end - TRIAL_DAYS * DAY));
}

// Called once, when `email` has just started its trial; `code` comes from the "pr" cookie.
export async function applyInvite(kv, email, code) {
  if (!CODE.test(code || '')) return false;
  const from = await kv.get('inv:' + code);
  if (!from || canon(from) === canon(email)) return false;
  const rec = (await kv.get('invn:' + from, 'json')) || { who: [] };
  if (!Array.isArray(rec.who)) rec.who = [];
  if (rec.who.some((w) => canon(w) === canon(email))) return false;
  rec.who.push(email);
  await kv.put('invn:' + from, JSON.stringify(rec));
  const start = Number(await kv.get('trial:' + email));
  if (start) await kv.put('trial:' + email, String(start + INVITE_DAYS * DAY));
  if (rec.who.length <= INVITE_MAX) await extend(kv, from);
  return true;
}
