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
// The first is the default: gpt-oss-120b wrote clearly better Persian than Llama 3.3 in tests, Llama is the
// fallback. gemma-3-12b-it answers 5018 "This account is not allowed to access" on this account, so it is last.
export const MODELS = [
  '@cf/openai/gpt-oss-120b',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  // Other models to compare from the admin picker.
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/zai-org/glm-4.7-flash',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/qwen/qwen3-30b-a3b-fp8',
  '@cf/google/gemma-3-12b-it',
];
const TASTE = 12; // messages in the free version's one taste of Parsa (trip chapter 1)
const LIMIT = { list: 100, member: 40, trial: 15, free: 3 }; // free: after the trial or subscription ended
const VOICE_BYTES = 1024 * 1024; // about a minute of compressed speech; recordings stop at 15 seconds
const CHECK_MODELS = ['@cf/openai/gpt-oss-120b', '@cf/meta/llama-3.3-70b-instruct-fp8-fast']; // checking trip replies
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
  { role: "a friendly real estate agent in Tehran",
    tasks: ["say you are looking for a small apartment", "ask how much the monthly rent is", "ask how many rooms it has or which floor it is on", "say you want it and thank them"] },
  { role: "a clerk at a currency exchange office in Tehran",
    tasks: ["say you want to change dollars", "ask the dollar exchange rate", "say how many dollars you want to change", "take the money and thank them"] },
  { role: "a salesperson in a mobile phone shop in Tehran",
    tasks: ["say you want a SIM card", "ask about internet (data) packages", "ask how much it costs", "pay and thank them"] },
  { role: "a kind doctor at a clinic in Tehran",
    tasks: ["say how you feel (fever, cough, pain...)", "say since when", "ask whether it is serious", "ask how to take the medicine and thank them"] },
  { role: "a friendly old man from Shiraz sitting in the garden of Hafez's tomb",
    tasks: ["greet them and say you have just arrived in Shiraz", "say the place is beautiful", "ask about a good place to eat", "thank them and say goodbye"] },
  { role: "Parsa, your Iranian friend, at his family home on Nowruz",
    tasks: ["wish them a happy Nowruz", "ask about the Haft-Sin table", "say how you celebrate holidays in your country", "wish them a happy new year"] },
  { role: "a kind servant (khadem) at the shrine of Imam Reza in Mashhad; the learner is an Arab pilgrim",
    tasks: ["greet you and ask where the entrance is", "ask where to leave their shoes", "ask what time the noon prayer is", "thank you and ask you to pray for them"] },
  { role: "the groom's mother welcoming guests at a wedding hall in Tehran; the learner is a university friend of the groom",
    tasks: ["greet you and congratulate you on the wedding", "give the gift", "say the hall or the wedding is beautiful", "wish the couple happiness"] },
  { role: "a bank clerk at a branch near the university in Tehran; the learner, a foreign student, wants to open an account",
    tasks: ["say they want to open an account", "say they have their passport with them", "ask when the bank card will be ready", "ask where to sign and thank you"] },
  { role: "a clerk at the passport and immigration office in Tehran; the learner, a foreign student, wants to extend their visa",
    tasks: ["say they want to extend their visa", "say why they want to stay (they study at the university)", "ask which documents they must bring", "ask when to come back and thank you"] },
  { role: "a gas station attendant on the road from Tehran to the Caspian Sea; the learner and a friend are driving north",
    tasks: ["ask you to fill the tank", "ask how far it is to the sea", "ask about a place to eat or rest nearby", "pay and thank you"] },
  { role: "Parsa's mother teaching the learner to cook ghormeh sabzi in her kitchen",
    tasks: ["say they want to learn to cook ghormeh sabzi", "ask what ingredients are needed", "ask how long it must cook", "thank her and say the food is delicious"] },
];


const RULES =
  'Write standard Persian as in a textbook, not colloquial spelling (ممنونم or متشکرم, می‌کنم, می‌خواهم; never میکونم or میخوام). ' +
  'Never put words from Turkish, English, Arabic or any other language into the Persian line. Use Persian letters ی and ک. ' +
  'Write explanations only in Arabic. Never correct the learner for typing Arabic letters (أ for ا, ي for ی, ك for ک, ة for ه): that is not a mistake. ';
const FORMAT =
  'FA: your own reply, in your role, in Persian script. It answers the learner and moves the scene on; never repeat or correct the learner\'s sentence here\n' +
  'TR: its Latin transliteration (like: salām, khoshhālam, che mikhāhid?)\n' +
  'AR: its translation into Arabic\n' +
  "FIX: the learner's whole last message rewritten in correct Persian (the full sentence, not a list of changes), or only - if it had no mistake. Check every word's spelling " +
  "and wrong words (examples: «خوبم ممنون شما چمور» → FIX: خوبم، ممنون. شما چطورید؟; «من از عربی هستم» → FIX: من عرب هستم.). Never put your own reply here.\n" +
  'WHY: only if FIX is not -: a very short explanation in Arabic of the mistake (example: «چطور» تُكتب بالطاء)، otherwise -';

// Trip chapters are scripted (the character's lines are written in the app); the model only checks the
// learner's reply to the current task: does it do the task, and what is its correct form.
function checkSystem(c, k, line, voice) {
  const ch = CHAPTERS[c];
  return 'You are a kind teacher of Persian (Iran) for Arabic speakers. In a role-play, ' + ch.role +
    ` just said: «${line}». Now the learner should ${ch.tasks[k]}. The learner's reply follows. Judge only that reply. ` +
    'Arabic letters typed instead of Persian ones (أ for ا, ي for ی, ك for ک, ة for ه) are not mistakes. ' +
    (voice ? 'The reply was SPOKEN and turned into text by speech recognition, so its spelling may be wrong because of the ' +
      'recognition, not the learner: ignore spelling and word splitting, and judge only whether the right words and grammar were used; ' +
      'OK is yes if it sounds like a reply that does the task. ' : '') +
    'Answer in exactly these four lines and nothing else:\n' +
    'OK: yes if the reply does the task in Persian a listener would understand (small spelling mistakes are fine), otherwise no\n' +
    "FIX: the learner's whole reply rewritten in correct, natural Persian (the full sentence), or only - if it had no mistake. " +
    'Check every word letter by letter: a misspelled word (like بجاست for کجاست, چمور for چطور) is a mistake that needs FIX even when OK is yes\n' +
    'WHY: if FIX is not -, a very short explanation in Arabic of the mistake; otherwise -\n' +
    'TIP: if OK is no, one short sentence in Arabic telling the learner what to say; otherwise -';
}

export function parseCheck(text, said) {
  const out = { ok: '', fix: '', why: '', tip: '' };
  const clean = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*\*/g, '')
    .replace(/\s+(FIX|WHY|TIP)\s*[:：]/g, '\n$1:');
  let cur = null;
  for (const line of clean.split('\n')) {
    const m = line.match(/^\s*(OK|FIX|WHY|TIP)\s*[:：]\s*(.*)$/i);
    if (m) { cur = m[1].toLowerCase(); out[cur] = m[2].trim(); }
    else if (cur && line.trim()) out[cur] += ' ' + line.trim();
  }
  if (!out.ok) {
    // Some answers skip the labels and start with the verdict («NO الرد…»): the verdict, and an Arabic rest as the tip.
    const m = clean.trim().match(/^(yes|no|نعم|لا|بله|خیر)\b[\s:.\-–—،,]*([\s\S]*)$/i);
    if (!m) return null; // not an answer in the asked form
    out.ok = m[1];
    if (!out.tip && /[\u0600-\u06FF]/.test(m[2]) && !/[A-Za-z]/.test(m[2])) out.tip = m[2].split('\n')[0];
  }
  for (const k of Object.keys(out)) out[k] = out[k].replace(FOREIGN, ' ').replace(/\s{2,}/g, ' ').trim();
  const fix = correction(out.fix, out.why, said);
  const tip = out.tip && out.tip !== '-' && !/[A-Za-z]/.test(out.tip) ? out.tip.slice(0, 200) : '';
  return { ok: /^(yes|y|true|نعم|بله|آری)/i.test(out.ok), fix: fix.slice(0, 400), tip, dropped: !fix && out.fix && out.fix !== '-' ? out.fix : '' };
}

const system = (s) =>
  `You are ${ROLES[s]}. You are talking with an Arabic-speaking beginner who is learning Persian. ` +
  'Stay in your role and speak only as yourself: never say the learner\'s lines or answer for them. ' +
  'Reply in simple, natural, correct modern Persian (Iran), 1 or 2 short sentences, ' +
  'beginner level, everyday words, and usually end with a short question that keeps the conversation going. ' +
  'Write standard Persian as in a textbook, not colloquial spelling (ممنونم or متشکرم, می‌کنم, می‌خواهم; never میکونم or میخوام). ' +
  'Never put words from Turkish, English, Arabic or any other language into the Persian line. Use Persian letters ی and ک. ' +
  'Write explanations only in Arabic. Never correct the learner for typing Arabic letters (أ for ا, ي for ی, ك for ک, ة for ه): that is not a mistake. ' +
  'Answer in exactly these five lines and nothing else:\n' +
  'FA: your own reply, in your role, in Persian script. It answers the learner and moves the conversation on; never repeat or correct the learner\'s sentence here\n' +
  'TR: its Latin transliteration (like: salām, khoshhālam, che mikhāhid?)\n' +
  'AR: its translation into Arabic\n' +
  "FIX: the learner's whole last message rewritten in correct Persian (the full sentence, not a list of changes), or only - if it had no mistake. Check every word's spelling " +
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
// "wrong → right" pairs (some models list the changed words instead of the sentence): applied to
// what the learner wrote, they give the corrected sentence. Returns it, or '' when nothing applies.
function fromPairs(fix, said) {
  let out = String(said), used = 0;
  for (const part of String(fix).split(/[،,;؛\n]|\s-\s/)) {
    const m = part.split(/\s*(?:→|->|=>|⟵|←)\s*/);
    if (m.length !== 2 || !m[0].trim() || !m[1].trim()) continue;
    const [a, b] = /←|⟵/.test(part) ? [m[1].trim(), m[0].trim()] : [m[0].trim(), m[1].trim()];
    const words = out.split(/(\s+|[.,،؟?!]+)/);
    const i = words.findIndex((w) => w && norm(w) === norm(a));
    if (i >= 0) { words[i] = b; out = words.join(''); used++; }
  }
  return used ? out : '';
}

export function correction(fix, why, said, reply = '') {
  let fa = String(fix || '').replace(/[\s,،\-–—]+$/, '').trim();
  if (said && /→|->|=>|←|⟵/.test(fa)) {
    const whole = fromPairs(fa, said);
    if (!whole) return '';
    if (!why || why === '-') why = fa.replace(/\s*(?:->|=>)\s*/g, ' → ');
    fa = whole;
  }
  if (!said || !fa || NO_FIX.test(fa) || /[A-Za-z]/.test(fa) || !/[\u0600-\u06FF]/.test(fa)) return '';
  const a = norm(said), b = norm(fa);
  // Either the whole sentence corrected, or only its wrong part corrected (close to one part of it).
  const whole = distance(a, b) <= Math.max(2, Math.round(0.4 * Math.max(a.length, b.length)));
  const part = b.length >= 4 && b.length < a.length && within(b, a) <= Math.max(1, Math.round(0.3 * b.length));
  if (a === b || a.includes(b) || !(whole || part)) return '';
  // The model sometimes puts a sentence of its own reply into the correction. A reply sentence that is
  // close to part of what the learner wrote is fine (the model may echo the corrected sentence).
  if (String(reply).split(/[.،,؟?!]/).map(norm).some((x) => x.length > 4 && b.includes(x) && !a.includes(x)
    && within(x, a) > Math.round(0.4 * x.length))) return '';
  const w = String(why || '').trim();
  return w && w !== '-' && !/[A-Za-z]/.test(w) && !NO_FIX.test(w) ? `${fa} — ${w}` : fa;
}

function parse(text, said) {
  const out = { fa: '', tr: '', ar: '', fix: '', why: '', done: '', next: '', hints: '' };
  let cur = null;
  // Some models put several labels on one line ("FA: … TR: …"): each label starts its own line.
  const clean = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*\*/g, '')
    .replace(/\s+(TR|AR|FIX|WHY|DONE|NEXT|HINTS)\s*[:：]/g, '\n$1:');
  for (const line of clean.split('\n')) {
    const m = line.match(/^\s*(FA|TR|AR|FIX|WHY|DONE|NEXT|HINTS)\s*[:：]\s*(.*)$/i);
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
  const next = Number((out.next.match(/\d+/) || [0])[0]) || 0;
  return { ...out, done, next: next >= 1 && next <= 6 ? next : 0, hints };
}

// The reply text, whatever shape the model answers in: {response}, the OpenAI chat shape
// {choices: [{message: {content}}]}, or the OpenAI Responses shape {output: [{content: [{text}]}]}.
function textOf(res) {
  if (typeof res === 'string') return res;
  if (!res) return '';
  let t = res.response ?? (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) ?? res.output_text;
  if (t == null && Array.isArray(res.output)) {
    t = res.output.filter((o) => o && o.type === 'message')
      .flatMap((o) => (Array.isArray(o.content) ? o.content : []).map((c) => (c && (c.text || '')) || '')).join('');
  }
  return t == null ? '' : typeof t === 'string' ? t : JSON.stringify(t);
}

// Asks one model. OpenAI's open models on Workers AI take the Responses input ({input, reasoning});
// if the chat form is refused, the same conversation is sent that way.
async function ask(env, m, messages, max) {
  try {
    // OpenAI's models think before answering, and the thinking counts towards max_tokens.
    const openai = m.startsWith('@cf/openai/');
    return textOf(await env.AI.run(m, openai ? { messages, max_tokens: 2000, reasoning_effort: 'low' }
      : { messages, max_tokens: max, temperature: 0.6 }));
  } catch (e) {
    if (!m.startsWith('@cf/openai/') || /neuron|quota|daily|4006/i.test(String(e && e.message))) throw e;
    return textOf(await env.AI.run(m, { input: messages, reasoning: { effort: 'low' } }));
  }
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

  const counted = async (obj) => {
    const n = used + 1;
    const cookie = `pc=${await signValue(kv, { e: email, d: today(), n })}; Path=/api/chat; Max-Age=172800; HttpOnly; Secure; SameSite=Lax`;
    return json({ ...obj, left: Math.max(0, limit - n) }, 200, { 'Set-Cookie': cookie });
  };

  // Talking with Parsa is for subscribers. The free version gets one taste: trip chapter 1 (c=0, text or voice),
  // TASTE messages in all, once per person (counted in KV as "taste:<email>").
  if (request.method === 'POST' && (st.kind === 'trial' || !st.ok) && !admin) {
    const voiceC = new URL(request.url).searchParams.get('c');
    let c0 = voiceC === '0';
    if (!/^audio\//.test(request.headers.get('Content-Type') || '')) {
      try { c0 = Number((await request.clone().json()).c) === 0; } catch (e) { c0 = false; }
    }
    if (!c0) return json({ error: 'free', msg: 'المحادثة مع پارسا للمشتركين. جرّب الفصل الأول مجاناً.' }, 403);
    const tasted = Number(await kv.get('taste:' + email)) || 0;
    if (tasted >= TASTE) return json({ error: 'free', msg: 'انتهت لمحتك المجانية مع پارسا. اشترك لتكمل الرحلة وتتكلّم معه كل يوم.' }, 403);
    await kv.put('taste:' + email, String(tasted + 1));
    limit = Math.max(limit, used + 1); // the taste is not held back by the daily free allowance
  }

  // Voice: the learner's recording (audio/webm or audio/mp4, at most VOICE_BYTES) is turned into Persian
  // text with Whisper; the app then scores the pronunciation and sends the text as the reply.
  // Without a subscription it works only in the free taste of chapter 1 (?c=0, checked above). It counts as one message.
  if (/^audio\//.test(request.headers.get('Content-Type') || '')) {
    if (used >= limit) return json({ error: 'limit', left: 0, free: !st.ok, msg: 'وصلت إلى حدّ اليوم. عُد غداً!' }, 429);
    const audio = new Uint8Array(await request.arrayBuffer());
    if (!audio.length || audio.length > VOICE_BYTES) return json({ error: 'audio', msg: 'التسجيل طويل أو فارغ. سجّل جملة قصيرة.' }, 400);
    let text = '', fail = '';
    try {
      let b64 = '';
      for (let i = 0; i < audio.length; i += 0x8000) b64 += String.fromCharCode.apply(null, audio.subarray(i, i + 0x8000));
      // The character's last line and the task's phrases, sent by the app, help Whisper with the expected words.
      let hint = '';
      try { hint = decodeURIComponent(request.headers.get('X-Hint') || ''); } catch (e) { hint = ''; }
      hint = hint.replace(/[^\u0600-\u06FF\u200c\s.,،؟?!]/g, '').slice(0, 300).trim();
      const r = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: btoa(b64), language: 'fa', vad_filter: true, ...(hint ? { initial_prompt: hint } : {}) });
      text = String((r && r.text) || '').trim();
    } catch (e) {
      fail = String(e && e.message).slice(0, 120);
      try { // the older model takes the bytes as a list of numbers
        const r = await env.AI.run('@cf/openai/whisper', { audio: [...audio] });
        text = String((r && r.text) || '').trim();
      } catch (e2) { fail += ' | ' + String(e2 && e2.message).slice(0, 120); }
    }
    text = text.replace(FOREIGN, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, MAX_CHARS);
    if (!text) return json({ error: 'voice', msg: 'لم أفهم التسجيل. تكلّم بوضوح وقرّب الهاتف ثم أعد المحاولة.', model: admin ? fail : undefined }, 422);
    return counted({ text });
  }

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'body' }, 400); }
  if (used >= limit) return json({ error: 'limit', left: 0, free: !st.ok, msg: st.ok ? `وصلت إلى حدّ اليوم (${limit} رسالة). عُد غداً لمحادثة جديدة!` : `انتهت رسائلك المجانية لليوم (${limit}). اشترك لتتحدث مع پارسا أكثر.` }, 429);
  const chapter = body.c != null;
  const c = Number(body.c), s = Number(body.s);
  if (chapter ? !Number.isInteger(c) || c < 0 || c >= CHAPTERS.length : !Number.isInteger(s) || s < 0 || s >= ROLES.length) {
    return json({ error: 'scenario' }, 400);
  }

  if (chapter) {
    const k = Number(body.k), said = String(body.said || '').trim().slice(0, MAX_CHARS), line = String(body.line || '').trim().slice(0, MAX_CHARS);
    if (!Number.isInteger(k) || k < 0 || k >= CHAPTERS[c].tasks.length || !said) return json({ error: 'check' }, 400);
    const messages = [{ role: 'system', content: checkSystem(c, k, line, !!body.voice) }, { role: 'user', content: said }];
    const first = admin && MODELS.includes(body.model) ? body.model : (env.CHECK_MODEL || CHECK_MODELS[0]);
    const order = [...new Set([first, ...CHECK_MODELS, ...MODELS])].slice(0, 3);
    const failed = [];
    for (const m of order) {
      try {
        const raw = await ask(env, m, messages, 250);
        const r = parseCheck(raw, said);
        if (r) {
          const { dropped, ...shown } = r;
          return counted({ ...shown, model: admin ? [m, ...failed, ...(dropped ? [`FIX hidden: ${dropped}`] : [])].join(' | ') : undefined });
        }
        failed.push(`${m.split('/').pop()}: no answer «${String(raw).replace(/\s+/g, ' ').slice(0, 80)}»`);
      } catch (e) {
        failed.push(`${m.split('/').pop()}: ${String(e && e.message).slice(0, 120)}`);
        if (/neuron|quota|daily|4006/i.test(String(e && e.message))) return json({ error: 'busy', msg: 'انتهى رصيد المحادثة لهذا اليوم. عُد غداً!' }, 503);
      }
    }
    return json({ error: 'ai', msg: 'تعذّر التحقق من جوابك الآن. حاول بعد قليل.', model: admin ? failed.join(' | ') : undefined }, 502);
  }
  const msgs = (Array.isArray(body.msgs) ? body.msgs : []).slice(-MAX_TURNS)
    .filter((m) => m && (m.r === 'u' || m.r === 'a') && typeof m.t === 'string' && m.t.trim())
    .map((m) => ({ r: m.r, t: m.t.trim().slice(0, MAX_CHARS) }));
  const messages = [{ role: 'system', content: system(s) }];
  if (!msgs.length || msgs[0].r !== 'u') messages.push({ role: 'user', content: '(Start the scene in your role with a short greeting and a question.)' });
  for (const m of msgs) messages.push({ role: m.r === 'u' ? 'user' : 'assistant', content: asText(m) });

  const first = admin && MODELS.includes(body.model) ? body.model : (env.CHAT_MODEL || MODELS[0]);
  const order = [first, ...MODELS.filter((m) => m !== first)];
  let reply = null, model = null;
  const failed = []; // admin only: why a model was skipped
  for (const m of order.slice(0, 3)) {
    try {
      const text = await ask(env, m, messages, 350);
      const said = msgs.length && msgs[msgs.length - 1].r === 'u' ? msgs[msgs.length - 1].t : '';
      if (text && text.trim()) { reply = parse(text, said); model = m; break; }
      failed.push(`${m.split('/').pop()}: empty`);
    } catch (e) {
      failed.push(`${m.split('/').pop()}: ${String(e && e.message).slice(0, 120)}`);
      if (/neuron|quota|daily|4006/i.test(String(e && e.message))) { // the account's free daily allocation is used up
        return json({ error: 'busy', msg: 'انتهى رصيد المحادثة لهذا اليوم. عُد غداً!' }, 503);
      }
    }
  }
  if (!reply) return json({ error: 'ai', msg: 'تعذّر الردّ الآن. حاول بعد قليل.' }, 502);
  const { dropped, ...shown } = reply;
  return counted({ ...shown, model: admin ? [model, ...failed, ...(dropped ? [`FIX hidden: ${dropped}`] : [])].join(' | ') : undefined });
}
