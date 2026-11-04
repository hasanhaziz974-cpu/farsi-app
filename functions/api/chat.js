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
// The first is the default. gemma-3-12b-it now answers 5018 "This account is not allowed to access"
// on this account, so it is last (an admin can still try it from the picker).
export const MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/qwen/qwen3-30b-a3b-fp8',
  '@cf/google/gemma-3-12b-it',
];
const LIMIT = { list: 100, member: 40, trial: 15, free: 3 }; // free: after the trial or subscription ended
const FREE_CHAPTER = 10; // messages a day in the free first chapter of the trip
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

// "Your trip to Iran": a story in chapters, each a scene with tasks the learner must do in Persian.
// The app (index.html, TRIP) has the same chapters with Arabic titles and tasks, in the same order.
export const CHAPTERS = [
  { role: 'an information desk employee at Imam Khomeini airport in Tehran; the learner, an Arab traveller, has just landed',
    tasks: ['greet you and say their name', 'say where they are from', 'ask where the taxis are', 'thank you and say goodbye'] },
  { role: 'a taxi driver at the airport; the learner is going to the Azadi hotel',
    tasks: ['greet you and say where they want to go', 'ask how much the fare is', 'ask you to stop or say they have arrived', 'pay and thank you'] },
  { role: 'a receptionist at the Azadi hotel in Tehran; the learner is checking in',
    tasks: ['greet you and say they have a reservation', 'give their name', 'ask which floor or room number it is', 'ask what time breakfast is'] },
  { role: 'a waiter in a traditional restaurant in Tehran; the learner comes for their first dinner in Iran',
    tasks: ['ask for a table', 'order a food', 'order a drink', 'ask for the bill'] },
  { role: 'a shopkeeper in the Tehran Grand Bazaar who sells scarves and souvenirs',
    tasks: ['greet you and say what they want to buy', 'ask the price', 'ask for a discount or say it is expensive', 'buy it and say goodbye'] },
  { role: "Parsa's mother, welcoming the learner to the family home for lunch",
    tasks: ['greet you politely', 'introduce themselves and their family', 'say the food is delicious', 'thank you for the invitation'] },
  { role: "a ticket clerk at a Tehran metro station",
    tasks: ["ask for a ticket", "ask which line or train goes to Azadi Square", "ask how many stations or where to get off", "thank you and say goodbye"] },
  { role: "a kind pharmacist in Tehran",
    tasks: ["say you do not feel well", "say what hurts", "ask for medicine and how to take it", "ask the price and thank them"] },
  { role: "a shop assistant in a clothes shop in Tehran",
    tasks: ["say what you want to buy", "ask for another colour or size", "ask to try it on", "buy it and pay"] },
  { role: "a ticket clerk at Tehran railway station",
    tasks: ["ask for a ticket to Isfahan", "say which day you want to travel", "ask when the train leaves or arrives", "ask the price and pay"] },
  { role: "a friendly tour guide in Naqsh-e Jahan Square in Isfahan",
    tasks: ["greet and say you are a tourist", "ask what a building or place is", "say the place is beautiful", "ask if you can take a photo, or ask them to take one"] },
  { role: "Parsa, your Iranian friend, saying goodbye before you fly home",
    tasks: ["say you are going back home", "say what you liked in Iran", "say you will come again or invite them to visit you", "thank them and say goodbye"] },
];

const LEVELS = [
  'The learner is a complete beginner: use very short sentences (3 to 6 words) and only the most common words.',
  'The learner knows basic everyday words: short simple sentences (up to 8 words).',
  'The learner is at an elementary level: simple natural sentences, a few new words are fine.',
];

const RULES =
  'Write standard Persian as in a textbook, not colloquial spelling (ممنونم or متشکرم, می‌کنم, می‌خواهم; never میکونم or میخوام). ' +
  'Never put words from Turkish, English, Arabic or any other language into the Persian line. Use Persian letters ی and ک. ' +
  'Write explanations only in Arabic. Never correct the learner for typing Arabic letters (أ for ا, ي for ی, ك for ک, ة for ه): that is not a mistake. ';
const FORMAT =
  'FA: your reply in Persian script\n' +
  'TR: its Latin transliteration (like: salām, khoshhālam, che mikhāhid?)\n' +
  'AR: its translation into Arabic\n' +
  "FIX: the learner's last message rewritten in correct Persian, or only - if it had no mistake. Check every word's spelling " +
  "and wrong words (examples: «خوبم ممنون شما چمور» → FIX: خوبم، ممنون. شما چطورید؟; «من از عربی هستم» → FIX: من عرب هستم.). Never put your own reply here.\n" +
  'WHY: only if FIX is not -: a very short explanation in Arabic of the mistake (example: «چطور» تُكتب بالطاء)، otherwise -';

function chapterSystem(c, done, known, level) {
  const ch = CHAPTERS[c];
  const left = ch.tasks.map((t, i) => (done.includes(i + 1) ? null : `${i + 1}) ${t}`)).filter(Boolean);
  return `You are ${ch.role}. You are talking with an Arabic-speaking learner of Persian. Stay in your role and in the scene. ` +
    `${LEVELS[level]} Reply in simple, natural, correct modern Persian (Iran), 1 or 2 short sentences. ` + RULES +
    `The learner's mission in this scene is to do these things in Persian: ${ch.tasks.map((t, i) => `${i + 1}) ${t}`).join('; ')}. ` +
    (left.length ? `Still to do: ${left.join('; ')}. Lead the conversation naturally so the learner can do them, but never do them for the learner. `
      : 'The learner has done every task: wrap up the scene warmly. ') +
    (known.length ? `Prefer words the learner already knows: ${known.join('، ')}. ` : '') +
    // The app shows hand-written phrases for each task as hints, so the model is not asked for any here.
    'Answer in exactly these six lines and nothing else:\n' + FORMAT + '\n' +
    "DONE: the numbers of the tasks the learner accomplished in their last message (in correct or understandable Persian), separated by commas, or - if none";
}

const system = (s) =>
  `You are ${ROLES[s]}. You are talking with an Arabic-speaking beginner who is learning Persian. ` +
  'Stay in your role. Reply in simple, natural, correct modern Persian (Iran), 1 or 2 short sentences, ' +
  'beginner level, everyday words, and usually end with a short question that keeps the conversation going. ' +
  'Write standard Persian as in a textbook, not colloquial spelling (ممنونم or متشکرم, می‌کنم, می‌خواهم; never میکونم or میخوام). ' +
  'Never put words from Turkish, English, Arabic or any other language into the Persian line. Use Persian letters ی and ک. ' +
  'Write explanations only in Arabic. Never correct the learner for typing Arabic letters (أ for ا, ي for ی, ك for ک, ة for ه): that is not a mistake. ' +
  'Answer in exactly these five lines and nothing else:\n' +
  'FA: your reply in Persian script\n' +
  'TR: its Latin transliteration (like: salām, khoshhālam, che mikhāhid?)\n' +
  'AR: its translation into Arabic\n' +
  "FIX: the learner's last message rewritten in correct Persian, or only - if it had no mistake. Check every word's spelling " +
  "and wrong words (examples: «خوبم ممنون شما چمور» → FIX: خوبم، ممنون. شما چطورید؟; «من از عربی هستم» → FIX: من عرب هستم.). Never put your own reply here.\n" +
  'WHY: only if FIX is not -: a very short explanation in Arabic of the mistake (example: «چطور» تُكتب بالطاء)، otherwise -';

// A FIX line that only says the message was fine, or repeats it unchanged, is not a correction.
// Only the start of the line is checked: an explanation like «الكلمة الصحيحة هي چطور» is a real correction.
const NO_FIX = /^\s*(لا حاجة|لا يوجد|لا أخطاء|بدون أخطاء|(جملتك |الجملة )?صحيحة|صحيح|ممتاز|no (mistake|correction)|nothing to correct|(it|the sentence|your sentence) is correct)/i;
// Arabic and Persian spellings of the same letter (أ/ا, ي/ی, ك/ک, ة/ه) are not mistakes.
const norm = (t) => String(t).replace(/[\u200c\u064B-\u0652\s.,،؟?!:«»"'\-–—]/g, '')
  .replace(/[أإٱ]/g, 'ا').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه');
// Letters of scripts the app never uses (Korean, Chinese, Japanese, Cyrillic, Greek, Hebrew, Indic, Thai)
// sometimes leak into a model's answer; they are removed with any label they carry ("설명:").
const FOREIGN = /[\u0370-\u03FF\u0400-\u052F\u0590-\u05FF\u0900-\u0DFF\u0E00-\u0FFF\u1100-\u11FF\u3040-\u30FF\u3130-\u318F\u3400-\u9FFF\uAC00-\uD7AF]+\s*[:：]?\s*/g;

// Edit distance, to check that a correction is the learner's sentence with a few changes and not something else.
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

// Smallest edit distance between x and any part of t.
function within(x, t) {
  let prev = new Array(t.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= t.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === t[j - 1] ? 0 : 1));
    prev = row;
  }
  return Math.min(...prev);
}

// A correction is shown only when it is Persian, differs from what the learner wrote, and is close to it.
export function correction(fix, why, said, reply = '') {
  const fa = String(fix || '').replace(/[\s,،\-–—]+$/, '').trim();
  if (!said || !fa || NO_FIX.test(fa) || /[A-Za-z]/.test(fa) || !/[\u0600-\u06FF]/.test(fa)) return '';
  const a = norm(said), b = norm(fa);
  if (a === b || distance(a, b) > Math.max(2, Math.round(0.4 * Math.max(a.length, b.length)))) return '';
  // The model sometimes puts a sentence of its own reply into the correction. A reply sentence that is
  // close to part of what the learner wrote is fine (the model may echo the corrected sentence).
  if (String(reply).split(/[.،,؟?!]/).map(norm).some((x) => x.length > 4 && b.includes(x) && !a.includes(x)
    && within(x, a) > Math.round(0.4 * x.length))) return '';
  const w = String(why || '').trim();
  return w && w !== '-' && !/[A-Za-z]/.test(w) && !NO_FIX.test(w) ? `${fa} — ${w}` : fa;
}

function parse(text, said) {
  const out = { fa: '', tr: '', ar: '', fix: '', why: '', done: '', hints: '' };
  let cur = null;
  const clean = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*\*/g, '');
  for (const line of clean.split('\n')) {
    const m = line.match(/^\s*(FA|TR|AR|FIX|WHY|DONE|HINTS)\s*[:：]\s*(.*)$/i);
    if (m) { cur = m[1].toLowerCase(); out[cur] = m[2].trim(); }
    else if (cur && line.trim()) out[cur] += ' ' + line.trim();
  }
  if (!out.fa) out.fa = clean.trim().split('\n')[0] || '';
  for (const k of Object.keys(out)) out[k] = out[k].replace(FOREIGN, ' ').replace(/\s{2,}/g, ' ').trim();
  const raw = out.fix && out.fix !== '-' ? out.fix : '';
  out.fix = correction(out.fix, out.why, said, out.fa);
  out.dropped = !out.fix && raw ? raw : ''; // shown to the admin only, to judge the models
  delete out.why;
  for (const k of Object.keys(out)) out[k] = out[k].slice(0, 400);
  const done = [...new Set((out.done.match(/\d+/g) || []).map(Number).filter((n) => n >= 1 && n <= 6))];
  const hints = out.hints.split('|').map((h) => {
    const [fa, ar] = h.split('=').map((x) => (x || '').trim());
    // A meaning with Persian-only letters (پ چ ژ گ ک ی) is Persian, not an Arabic translation: it is left out.
    const meaning = ar && !/[پچژگکیA-Za-z]/.test(ar) ? ar : '';
    return fa && /[\u0600-\u06FF]/.test(fa) && !/[A-Za-z]/.test(fa) ? { fa: fa.slice(0, 120), ar: meaning.slice(0, 120) } : null;
  }).filter(Boolean).slice(0, 3);
  return { ...out, done, hints };
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

  const admin = ((await kv.get('admins', 'json')) || []).includes(email);
  let limit = st.ok ? LIMIT[st.kind] || LIMIT.trial : LIMIT.free;
  const used = await counter(request, kv, email);

  if (request.method === 'GET') return json({ left: Math.max(0, limit - used), limit, free: !st.ok, admin, models: admin ? MODELS : [] });
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'origin' }, 403);
  if (!env.AI) return json({ error: 'not_ready', msg: 'المحادثة غير جاهزة بعد. حاول لاحقاً.' }, 503);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'body' }, 400); }
  // The free first chapter needs about six messages (the opening and four tasks), more than the free daily
  // chat allowance, so without a subscription it gets its own larger allowance.
  if (!st.ok && body.c === 0) limit = Math.max(limit, FREE_CHAPTER);
  if (used >= limit) return json({ error: 'limit', left: 0, free: !st.ok, msg: st.ok ? `وصلت إلى حدّ اليوم (${limit} رسالة). عُد غداً لمحادثة جديدة!` : `انتهت رسائلك المجانية لليوم (${limit}). اشترك لتتحدث مع پارسا أكثر.` }, 429);
  const chapter = body.c != null;
  const c = Number(body.c), s = Number(body.s);
  if (chapter ? !Number.isInteger(c) || c < 0 || c >= CHAPTERS.length : !Number.isInteger(s) || s < 0 || s >= ROLES.length) {
    return json({ error: 'scenario' }, 400);
  }
  if (chapter && c > 0 && !st.ok) return json({ error: 'free', msg: 'هذا الفصل للمشتركين. الفصل الأول مجاني.' }, 403);
  const done = (Array.isArray(body.done) ? body.done : []).map(Number).filter((n) => n >= 1 && n <= 6);
  const known = (Array.isArray(body.known) ? body.known : []).filter((w) => typeof w === 'string' && /[\u0600-\u06FF]/.test(w))
    .map((w) => w.trim().slice(0, 30)).slice(0, 60);
  const level = Math.max(0, Math.min(2, Number(body.level) || 0));
  const msgs = (Array.isArray(body.msgs) ? body.msgs : []).slice(-MAX_TURNS)
    .filter((m) => m && (m.r === 'u' || m.r === 'a') && typeof m.t === 'string' && m.t.trim())
    .map((m) => ({ r: m.r, t: m.t.trim().slice(0, MAX_CHARS) }));
  const messages = [{ role: 'system', content: chapter ? chapterSystem(c, done, known, level) : system(s) }];
  if (!msgs.length || msgs[0].r !== 'u') messages.push({ role: 'user', content: '(Start the scene in your role with a short greeting and a question.)' });
  for (const m of msgs) messages.push({ role: m.r === 'u' ? 'user' : 'assistant', content: asText(m) });

  const first = admin && MODELS.includes(body.model) ? body.model : (env.CHAT_MODEL || MODELS[0]);
  const order = [first, ...MODELS.filter((m) => m !== first)];
  let reply = null, model = null;
  const failed = []; // admin only: why a model was skipped
  for (const m of order.slice(0, 3)) {
    try {
      const res = await env.AI.run(m, { messages, max_tokens: chapter ? 450 : 350, temperature: 0.6 });
      // Most models answer {response}; some answer in the OpenAI shape {choices: [{message: {content}}]}.
      let text = typeof res === 'string' ? res : res && (res.response ?? (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content));
      if (text && typeof text !== 'string') text = JSON.stringify(text);
      const said = msgs.length && msgs[msgs.length - 1].r === 'u' ? msgs[msgs.length - 1].t : '';
      if (text && text.trim()) { reply = parse(text, said); model = m; break; }
      failed.push(`${m.split('/').pop()}: empty`);
    } catch (e) {
      failed.push(`${m.split('/').pop()}: ${String(e && e.message).slice(0, 120)}`);
      if (/neuron|limit|quota|429|capacity/i.test(String(e && e.message))) {
        return json({ error: 'busy', msg: 'انتهى رصيد المحادثة لهذا اليوم. عُد غداً!' }, 503);
      }
    }
  }
  if (!reply) return json({ error: 'ai', msg: 'تعذّر الردّ الآن. حاول بعد قليل.' }, 502);
  const n = used + 1;
  const cookie = `pc=${await signValue(kv, { e: email, d: today(), n })}; Path=/api/chat; Max-Age=172800; HttpOnly; Secure; SameSite=Lax`;
  const { dropped, ...shown } = reply;
  return json({ ...shown, left: Math.max(0, limit - n), model: admin ? [model, ...failed, ...(dropped ? [`FIX hidden: ${dropped}`] : [])].join(' | ') : undefined }, 200, { 'Set-Cookie': cookie });
}
