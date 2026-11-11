// Admin page at /admin: add, extend and remove people, and see who is on a trial.
// Only emails in the KV "admins" list (the first line of ACCESS_LIST, written by
// tools/sync_access.py) can open it. People are stored as "allow:<email>" entries,
// the same ones the trial check in _middleware.js reads.
import { DAY, accessEmail, lastDay, today, PLAN_IDS, PAY_METHODS } from '../lib/trial.js';
import { invitedCount } from '../lib/invite.js';

const PERIODS = { week: ['أسبوع', 7], month: ['شهر', 30], quarter: ['3 أشهر', 90], half: ['6 أشهر', 180], year: ['سنة', 365], forever: ['دائم', 0] };
const FOREVER = 'دائم';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ltr = (s) => '\u2066' + s + '\u2069'; // keeps dates and emails left-to-right inside Arabic text
const addDays = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);

function page(body, status = 200) {
  return new Response(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>إدارة المشتركين</title>
<style>
:root{--bg:#EEF4F3;--sf:#fff;--tx:#14263A;--mu:#5B7083;--pr:#12807F;--ok:#2E9B5F;--no:#C94B4B;--bd:#D5E2E0;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0E1A24;--sf:#16293A;--tx:#E8F1F0;--mu:#93A8B6;--pr:#3FB8B5;--ok:#4CC27F;--no:#E26D6D;--bd:#264054;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.6 Tahoma,Arial,sans-serif}
main{max-width:560px;margin:0 auto;padding:16px}h1{font-size:22px;margin:8px 0 4px}h2{font-size:17px;margin:22px 0 8px}
.card{background:var(--sf);border:1px solid var(--bd);border-radius:14px;padding:14px;margin-bottom:10px}
.mu{color:var(--mu);font-size:14px}.msg{background:var(--pr);color:#fff;border-radius:12px;padding:10px 14px;margin:10px 0}
input,select,button{font:inherit;border-radius:10px;border:1px solid var(--bd);padding:10px;background:var(--sf);color:var(--tx)}
input[type=email]{width:100%;direction:ltr;text-align:left}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
button{background:var(--pr);color:#fff;border:0;cursor:pointer}button.no{background:var(--no)}button.alt{background:transparent;color:var(--pr);border:1px solid var(--pr)}
.p{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}.e{direction:ltr;font-weight:600;word-break:break-all}
.ok{color:var(--ok)}.end{color:var(--no)}.soon{color:#C77C0E;font-weight:600}form{margin:0}\n.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0}.stats div{background:var(--sf);border:1px solid var(--bd);border-radius:12px;padding:8px;text-align:center}.stats b{display:block;font-size:22px;color:var(--pr)}.stats span{font-size:12px;color:var(--mu)}@media(max-width:380px){.stats{grid-template-columns:repeat(2,1fr)}}\ninput[type=search]{width:100%;direction:ltr;text-align:left;margin-top:12px}details{margin-top:8px}summary{cursor:pointer;color:var(--mu);padding:8px 0}
</style></head><body><main>${body}</main></body></html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function entries(kv, prefix) {
  const out = [];
  let cursor;
  do {
    const res = await kv.list({ prefix, cursor });
    for (const k of res.keys) out.push({ email: k.name.slice(prefix.length), value: await kv.get(k.name) });
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  return out;
}

function periodSelect() {
  return `<select name="period">${Object.entries(PERIODS).map(([k, [label]]) =>
    `<option value="${k}"${k === 'month' ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
}

// The subscription offer: prices per plan, payment numbers and the WhatsApp number for receipts.
async function savePay(kv, form) {
  const clip = (v, n) => String(v || '').trim().slice(0, n);
  const prices = {}, methods = {};
  for (const [id] of PLAN_IDS) { const v = clip(form.get('price_' + id), 40); if (v) prices[id] = v; }
  for (const [id] of PAY_METHODS) { const v = clip(form.get('pay_' + id), 80); if (v) methods[id] = v; }
  const whatsapp = clip(form.get('whatsapp'), 20).replace(/[^0-9]/g, '').replace(/^00/, '').replace(/^0(7\d{9})$/, '964$1');
  if (form.get('whatsapp') && !/^\d{10,15}$/.test(whatsapp)) return 'رقم الواتساب غير صحيح. اكتبه مثل 07701234567 أو 9647701234567.';
  await kv.put('paycfg', JSON.stringify({ prices, methods, whatsapp, note: clip(form.get('note'), 300) }));
  return Object.keys(prices).length && Object.keys(methods).length && whatsapp
    ? 'حُفظت إعدادات الاشتراك، وصارت صفحة «اشترك» تظهر للمشتركين.'
    : 'حُفظت. لتظهر صفحة «اشترك» للمشتركين يلزم سعر واحد على الأقل، وطريقة دفع، ورقم واتساب.';
}

function payForm(c) {
  const p = c.prices || {}, m = c.methods || {};
  return `<h2>💳 إعدادات الاشتراك</h2><form method="post" class="card"><input type="hidden" name="action" value="paycfg">
<p class="mu" style="margin-top:0">تظهر في صفحة «اشترك» داخل التطبيق وفي صفحة انتهاء التجربة. اترك الخانة فارغة لإخفائها.</p>
<b>الأسعار</b>${PLAN_IDS.map(([id, label]) => `<div class="row"><span style="min-width:70px">${label}</span><input name="price_${id}" value="${esc(p[id] || '')}" placeholder="مثل: 5,000 دينار" style="flex:1"></div>`).join('')}
<b style="display:block;margin-top:12px">طرق الدفع (الرقم أو الحساب)</b>${PAY_METHODS.map(([id, label]) => `<div class="row"><span style="min-width:70px">${label}</span><input name="pay_${id}" value="${esc(m[id] || '')}" placeholder="${id === 'other' ? 'الاسم والرقم' : 'الرقم'}" style="flex:1;direction:ltr"></div>`).join('')}
<b style="display:block;margin-top:12px">واتساب لاستقبال الإيصالات</b><div class="row"><input name="whatsapp" value="${esc(c.whatsapp || '')}" placeholder="07701234567" style="flex:1;direction:ltr"></div>
<b style="display:block;margin-top:12px">ملاحظة (اختيارية)</b><div class="row"><input name="note" value="${esc(c.note || '')}" placeholder="مثل: يُفعَّل الاشتراك خلال ساعات" style="flex:1"></div>
<div class="row"><button>حفظ</button></div></form>`;
}

async function act(kv, form) {
  if (form.get('action') === 'paycfg') return savePay(kv, form);
  const email = String(form.get('email') || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'اكتب بريداً صحيحاً.';
  const key = 'allow:' + email;
  if (form.get('action') === 'remove') {
    await kv.delete(key);
    return `أُوقف ${ltr(email)}. يُمنع من الدخول خلال دقيقة.`;
  }
  const period = PERIODS[form.get('period')];
  if (!period) return 'اختر مدة.';
  if (!period[1]) {
    await kv.put(key, FOREVER);
    return `أُضيف ${ltr(email)} بلا تاريخ انتهاء.`;
  }
  const current = await kv.get(key);
  const end = current === null ? null : lastDay(current);
  const from = end && end > today() ? end : today();
  const until = addDays(from, period[1]);
  await kv.put(key, until);
  return `${ltr(email)} يستطيع الدخول حتى ${ltr(until)}.`;
}

// Active period: highlighted when it ends within a week, so it can be renewed in time.
function soon(until, now) {
  const left = Math.round((Date.parse(until) - Date.parse(now)) / DAY) + 1;
  return left <= 7
    ? `<span class="soon">حتى ${ltr(until)} · ${left === 1 ? 'آخر يوم' : left === 2 ? 'يومان' : left + ' أيام'}</span>`
    : `<span class="ok">حتى ${ltr(until)}</span>`;
}

// What a learner has done, from the cloud copy of their progress (functions/api/progress.js):
// lessons finished, points and the last day they studied. Empty for people who never synced.
async function learning(kv, email) {
  const p = await kv.get('prog:' + email, 'json');
  const d = p && p.data;
  if (!d) return null;
  const last = Date.parse(d.last || '') || 0;
  return { lessons: Object.keys(d.pass || {}).length, xp: Number(d.xp) || 0, words: Object.keys(d.srs || {}).length, last, saved: Number(p.t) || 0 };
}

// 📊 Today's use against the free limits. Nothing here adds writes to KV (its free limit is 1,000 writes a day):
// sign-in mails are already counted, active learners come from the time of their last progress save, and
// the exact AI and KV figures are on Cloudflare's own usage pages (linked).
function usage(mails, active) {
  const bar = (n, max) => { const p = Math.min(100, Math.round(n / max * 100));
    return `<div style="height:8px;background:var(--bd);border-radius:6px;overflow:hidden;margin:4px 0 10px"><i style="display:block;height:100%;width:${p}%;background:${p >= 80 ? 'var(--no)' : p >= 50 ? '#C77C0E' : 'var(--ok)'}"></i></div>`; };
  const link = (to, t) => `<a href="https://dash.cloudflare.com/?to=/:account/${to}" target="_blank" rel="noopener">${t}</a>`;
  return `<h2>📊 استهلاك اليوم</h2><div class="card">
<div>✉️ رسائل رمز الدخول: <b>${mails}</b> من 90 (حد Gmail اليومي)</div>${bar(mails, 90)}
<div>💾 متعلّمون حفظوا تقدّمهم اليوم: <b>${active}</b> من نحو 200 (كل متعلّم نشط يحفظ بضع مرات، وحد الحفظ المجاني 1,000 عملية يومياً)</div>${bar(active, 200)}
<div>🤖 الذكاء الاصطناعي والصوت: الحد المجاني 10,000 وحدة يومياً، نحو 200 إلى 250 تصحيحاً أو رداً. ${link('ai/workers-ai', 'الاستهلاك الدقيق في Cloudflare')}</div>
<div style="margin-top:8px">🗄️ عمليات حفظ التقدّم الدقيقة: ${link('workers/kv/namespaces', 'في Cloudflare')}</div>
<p class="mu" style="margin:10px 0 0">إذا اقترب شريط من الأحمر، أو كثر ظهور «انتهى رصيد المحادثة لهذا اليوم»، ففعّل باقة Workers المدفوعة (5 دولارات شهرياً) من ${link('workers/plans', 'Cloudflare')}.</p></div>`;
}

function learnLine(l) {
  if (!l) return '<div class="mu">لم يبدأ التعلّم بعد</div>';
  const ago = l.last ? Math.floor((Date.now() - l.last) / DAY) : null;
  const when = ago === null ? '' : ago <= 0 ? 'اليوم' : ago === 1 ? 'أمس' : ago === 2 ? 'قبل يومين' : ago <= 10 ? `قبل ${ago} أيام` : `قبل ${ago} يوماً`;
  return `<div class="mu">📘 ${l.lessons} ${l.lessons >= 3 && l.lessons <= 10 ? 'دروس' : 'درس'} · 📚 ${l.words} كلمة · ⭐ ${l.xp}${when ? ` · <span class="${ago <= 2 ? 'ok' : ''}">آخر نشاط ${when}</span>` : ''}</div>`;
}

async function view(kv, msg) {
  const now = today();
  const allowed = (await entries(kv, 'allow:')).sort((a, b) => a.email.localeCompare(b.email));
  const allowedSet = new Set(allowed.map((a) => a.email));
  const trials = (await entries(kv, 'trial:'))
    .filter((t) => !allowedSet.has(t.email))
    .map((t) => ({ email: t.email, since: new Date(Number(t.value) || 0).toISOString().slice(0, 10) }));
  const learn = {};
  const invited = {};
  await Promise.all([...allowed, ...trials].map(async (x) => { learn[x.email] = await learning(kv, x.email); invited[x.email] = await invitedCount(kv, x.email); }));
  const inv = (e) => (invited[e] ? `<div class="mu">🎁 دعا ${invited[e]} ${invited[e] >= 3 && invited[e] <= 10 ? 'أصدقاء' : 'صديقاً'}</div>` : '');
  const week = Object.values(learn).filter((l) => l && Date.now() - l.last < 7 * DAY).length;
  const reminders = (await kv.list({ prefix: 'push:' })).keys.length;
  const mailsToday = Number(await kv.get('mails:' + new Date().toISOString().slice(0, 10))) || 0;
  const activeMembers = allowed.filter(({ value }) => { const u = lastDay(value); return !u || u >= now; }).length;

  const people = allowed.map(({ email, value }) => {
    const until = lastDay(value);
    const state = !until ? '<span class="ok">دائم</span>'
      : until >= now ? soon(until, now) : `<span class="end">انتهى في ${ltr(until)}</span>`;
    return `<div class="card"><div class="p"><span class="e">${esc(email)}</span>${state}</div>${learnLine(learn[email])}${inv(email)}
<form method="post" class="row"><input type="hidden" name="email" value="${esc(email)}">${periodSelect()}
<button name="action" value="add">تمديد</button><button name="action" value="remove" class="no">إيقاف</button></form></div>`;
  }).join('') || '<p class="mu">لا أحد بعد.</p>';

  const trialCard = ({ email, since }) => `<div class="card"><div class="p"><span class="e">${esc(email)}</span><span class="mu">سجّل ${ltr(since)}</span></div>${learnLine(learn[email])}${inv(email)}
<form method="post" class="row"><input type="hidden" name="email" value="${esc(email)}">${periodSelect()}
<button name="action" value="add" class="alt">أضفه</button></form></div>`;
  // Free users (no subscription), the most recently active first; those not seen for 30 days are folded.
  const score = (t) => { const l = learn[t.email]; return l ? l.last : 0; };
  const byLast = trials.sort((a, b) => score(b) - score(a) || b.since.localeCompare(a.since));
  const recent = byLast.filter((t) => Date.now() - score(t) < 30 * DAY || t.since >= new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10));
  const quiet = byLast.filter((t) => !recent.includes(t));
  const trialRows = (recent.map(trialCard).join('') || '<p class="mu">لا أحد بعد.</p>')
    + (quiet.length ? `<details><summary>لم يتعلّموا منذ شهر (${quiet.length}) · يمكنك مراسلتهم</summary>${quiet.map(trialCard).join('')}</details>` : '');

  const pay = (await kv.get('paycfg', 'json')) || {};
  return page(`<h1>إدارة المشتركين</h1><p class="mu">التغييرات تعمل خلال دقيقة تقريباً. · <a href="/logout">خروج</a></p>
${msg ? `<div class="msg">${esc(msg)}</div>` : ''}
<div class="stats"><div><b>${activeMembers}</b><span>مشترك</span></div><div><b>${trials.length}</b><span>مجانيون</span></div><div><b>${week}</b><span>تعلّموا هذا الأسبوع</span></div><div><b>${reminders}</b><span>فعّلوا التذكير</span></div></div>
${usage(mailsToday, Object.values(learn).filter((l) => l && l.saved >= Date.parse(new Date().toISOString().slice(0, 10))).length)}
<h2>إضافة شخص</h2><form method="post" class="card"><input type="email" name="email" placeholder="name@gmail.com" required>
<div class="row">${periodSelect()}<button name="action" value="add">إضافة</button></div>
<p class="mu">إن كان الشخص مضافاً، تُحسب المدة من آخر يوم له.</p></form>
${allowed.length + trials.length > 8 ? '<input type="search" id="q" placeholder="ابحث ببريد…" oninput="flt(this.value)">' : ''}
<h2>المشتركون (${allowed.length})</h2>${people}
<h2>المستخدمون المجانيون (${trials.length})</h2>${trialRows}
${payForm(pay)}
<script>function flt(q){q=q.trim().toLowerCase();document.querySelectorAll('.card').forEach(function(c){var e=c.querySelector('.e');if(e)c.style.display=!q||e.textContent.toLowerCase().indexOf(q)>=0?'':'none'});document.querySelectorAll('details').forEach(function(d){if(q)d.open=true})}</script>`);
}

export async function onRequest({ request, env }) {
  const kv = env.TRIALS;
  const email = await accessEmail(request, env);
  const admins = kv ? (await kv.get('admins', 'json')) || [] : [];
  if (!email || !admins.includes(email)) {
    return page(`<h1>هذه الصفحة للمدير فقط</h1>
<p>أنت مسجّل الدخول بالبريد: <span class="e">${esc(email || 'غير معروف')}</span></p>
<p class="mu">إن كان هذا ليس بريد المدير، اخرج ثم ادخل ببريد المدير.</p>
<p><a href="/logout"><button type="button">تسجيل الخروج</button></a></p>`, 403);
  }

  const url = new URL(request.url);
  if (request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin) return page('<h1>طلب مرفوض</h1>', 403);
    const msg = await act(kv, await request.formData());
    return Response.redirect(`${url.origin}/admin?msg=${encodeURIComponent(msg)}`, 303);
  }
  return view(kv, url.searchParams.get('msg'));
}
