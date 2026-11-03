// AI conversation practice: the learner chats in Persian with a character (a waiter, a taxi driver...)
// played by a Cloudflare Workers AI model (binding AI, no key needed). Each reply comes back as Persian,
// transliteration, Arabic translation and, when the learner's Persian had a mistake, a correction.
// GET: {left, admin, models}. POST {s: scenario, msgs: [{r: 'u'|'a', t}], model?}: the next reply.
// Daily messages per person are counted in a signed cookie (no KV writes); the Workers AI daily
// allocation is the overall limit. Only the admin may choose the model (to compare them).
import { accessEmail, accessStatus, today } from '../../lib/trial.js';
import { signValue, readSigned } from '../../lib/auth.js';

// The first model is the default (chosen by comparing them on real chats); the rest are fallbacks
// and the admin's comparison list.
export const MODELS = [
  '@cf/google/gemma-3-12b-it',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/qwen/qwen3-30b-a3b-fp8',
];
const LIMIT = { list: 100, member: 40, trial: 15 };
const MAX_TURNS = 12, MAX_CHARS = 300;

// The character the model plays in each conversation (same order as the app's DLG), and a free chat.
const ROLES = [
  'a friendly Iranian you have just met at a gathering in Tehran',
  'a waiter in a restaurant in Tehran; the learner is a customer',
  'a shopkeeper in the Tehran bazaar; the learner wants to buy something',
  'a passer-by in a Tehran street; the learner asks you for directions',
  'a doctor in a clinic; the learner is a patient who feels unwell',
  'a hotel receptionist; the learner is checking in',
  'an airport employee at Imam Khomeini airport; the learner is a traveller',
  'a taxi driver in Tehran; the learner is your passenger',
  'a waiter in a café in Tehran',
  'a pharmacist; the learner needs medicine',
  'a seller in a clothes shop',
  'a bank clerk at a currency exchange desk',
  'a person answering the phone in an office',
  'a passenger on the Tehran metro; the learner asks which line to take',
  'a friend arranging a time and place to meet the learner',
  'an Iranian friend welcoming the learner into your home',
  'a new Iranian friend asking the learner about their family',
  'a colleague chatting about work and hobbies',
  'a neighbour chatting about the weather',
  'a hotel receptionist; the learner reports a problem with the room',
  'Parsa, a friendly Iranian tutor who chats about anything the learner likes',
];

const system = (s) =>
  `You are ${ROLES[s]}. You are talking with an Arabic-speaking beginner who is learning Persian. ` +
  'Stay in your role. Reply in simple, natural, correct modern Persian (Iran), 1 or 2 short sentences, ' +
  'beginner level, everyday words, and usually end with a short question that keeps the conversation going. ' +
  'Write standard Persian as in a textbook, not colloquial spelling (ممنونم or متشکرم, می‌کنم, می‌خواهم; never میکونم or میخوام). ' +
  'Never put words from Turkish, English, Arabic or any other language into the Persian line. Use Persian letters ی and ک. ' +
  'Answer in exactly these four lines and nothing else:\n' +
  'FA: your reply in Persian script\n' +
  'TR: its Latin transliteration (like: salām, khoshhālam, che mikhāhid?)\n' +
  'AR: its translation into Arabic\n' +
  "FIX: only if the learner's last message had a real Persian mistake: the corrected Persian sentence, then a very short explanation in Arabic. " +
  'If it was correct, or there is nothing to correct, write only - (never write that no correction is needed).';

// A FIX line that only says the message was fine, or repeats it unchanged, is not a correction.
const NO_FIX = /لا حاجة|لا يوجد (خطأ|أخطاء)|لا أخطاء|بدون أخطاء|صحيحة|صحيح تماماً|جملتك صحيحة|no (mistake|correction)|is correct|nothing to correct/i;
const norm = (t) => String(t).replace(/[\u200c\s.,،؟?!:«»"'\-–—]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');

function parse(text, said) {
  const out = { fa: '', tr: '', ar: '', fix: '' };
  let cur = null;
  const clean = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*\*/g, '');
  for (const line of clean.split('\n')) {
    const m = line.match(/^\s*(FA|TR|AR|FIX)\s*[:：]\s*(.*)$/i);
    if (m) { cur = m[1].toLowerCase(); out[cur] = m[2].trim(); }
    else if (cur && line.trim()) out[cur] += ' ' + line.trim();
  }
  if (!out.fa) out.fa = clean.trim().split('\n')[0] || '';
  out.fix = out.fix.replace(/[\s,،\-–—]+$/, '').trim();
  if (!out.fix || NO_FIX.test(out.fix) || (said && norm(out.fix) === norm(said))) out.fix = '';
  for (const k of Object.keys(out)) out[k] = out[k].slice(0, 400);
  return out;
}

const asText = (m) => (m.r === 'a' ? `FA: ${m.t}` : m.t);
const json = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

async function counter(request, kv, email) {
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)pc=([A-Za-z0-9_.-]+)/);
  const v = m ? await readSigned(kv, m[1]) : null;
  return v && v.e === email && v.d === today() ? v.n : 0;
}

export async function onRequest({ request, env }) {
  const kv = env.TRIALS;
  const email = await accessEmail(request, env);
  if (!email || !kv) return json({ error: 'signin' }, 401);
  const st = await accessStatus(kv, email, false);
  if (!st.ok) return json({ error: 'ended', msg: 'انتهت مدة دخولك. جدّد اشتراكك لتتابع المحادثة.' }, 403);
  const admin = ((await kv.get('admins', 'json')) || []).includes(email);
  const limit = LIMIT[st.kind] || LIMIT.trial;
  const used = await counter(request, kv, email);

  if (request.method === 'GET') return json({ left: Math.max(0, limit - used), limit, admin, models: admin ? MODELS : [] });
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'origin' }, 403);
  if (!env.AI) return json({ error: 'not_ready', msg: 'المحادثة غير جاهزة بعد. حاول لاحقاً.' }, 503);
  if (used >= limit) return json({ error: 'limit', left: 0, msg: `وصلت إلى حدّ اليوم (${limit} رسالة). عُد غداً لمحادثة جديدة!` }, 429);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'body' }, 400); }
  const s = Number(body.s);
  if (!Number.isInteger(s) || s < 0 || s >= ROLES.length) return json({ error: 'scenario' }, 400);
  const msgs = (Array.isArray(body.msgs) ? body.msgs : []).slice(-MAX_TURNS)
    .filter((m) => m && (m.r === 'u' || m.r === 'a') && typeof m.t === 'string' && m.t.trim())
    .map((m) => ({ r: m.r, t: m.t.trim().slice(0, MAX_CHARS) }));
  const messages = [{ role: 'system', content: system(s) }];
  if (!msgs.length || msgs[0].r !== 'u') messages.push({ role: 'user', content: '(Start the conversation in your role with a short greeting and a question.)' });
  for (const m of msgs) messages.push({ role: m.r === 'u' ? 'user' : 'assistant', content: asText(m) });

  const first = admin && MODELS.includes(body.model) ? body.model : (env.CHAT_MODEL || MODELS[0]);
  const order = [first, ...MODELS.filter((m) => m !== first)];
  let reply = null, model = null;
  for (const m of order.slice(0, 3)) {
    try {
      const res = await env.AI.run(m, { messages, max_tokens: 350, temperature: 0.6 });
      const text = typeof res === 'string' ? res : res && res.response;
      const said = msgs.length && msgs[msgs.length - 1].r === 'u' ? msgs[msgs.length - 1].t : '';
      if (text && text.trim()) { reply = parse(text, said); model = m; break; }
    } catch (e) {
      if (/neuron|limit|quota|429|capacity/i.test(String(e && e.message))) {
        return json({ error: 'busy', msg: 'انتهى رصيد المحادثة لهذا اليوم. عُد غداً!' }, 503);
      }
    }
  }
  if (!reply) return json({ error: 'ai', msg: 'تعذّر الردّ الآن. حاول بعد قليل.' }, 502);
  const n = used + 1;
  const cookie = `pc=${await signValue(kv, { e: email, d: today(), n })}; Path=/api/chat; Max-Age=172800; HttpOnly; Secure; SameSite=Lax`;
  return json({ ...reply, left: Math.max(0, limit - n), model: admin ? model : undefined }, 200, { 'Set-Cookie': cookie });
}
