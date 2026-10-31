// Admin page at /admin: add, extend and remove people, and see who is on a trial.
// Only emails in the KV "admins" list (the first line of ACCESS_LIST, written by
// tools/sync_access.py) can open it. People are stored as "allow:<email>" entries,
// the same ones the trial check in _middleware.js reads.
import { TRIAL_DAYS, DAY, accessEmail, lastDay, today } from '../lib/trial.js';

const PERIODS = { week: ['أسبوع', 7], month: ['شهر', 30], quarter: ['3 أشهر', 90], forever: ['دائم', 0] };
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
.ok{color:var(--ok)}.end{color:var(--no)}form{margin:0}
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

async function act(kv, form) {
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

async function view(kv, msg) {
  const now = today();
  const allowed = (await entries(kv, 'allow:')).sort((a, b) => a.email.localeCompare(b.email));
  const allowedSet = new Set(allowed.map((a) => a.email));
  const trials = (await entries(kv, 'trial:'))
    .filter((t) => !allowedSet.has(t.email))
    .map((t) => ({ email: t.email, left: TRIAL_DAYS - Math.floor((Date.now() - Number(t.value)) / DAY) }))
    .sort((a, b) => b.left - a.left);

  const people = allowed.map(({ email, value }) => {
    const until = lastDay(value);
    const state = !until ? '<span class="ok">دائم</span>'
      : until >= now ? `<span class="ok">حتى ${ltr(until)}</span>` : `<span class="end">انتهى في ${ltr(until)}</span>`;
    return `<div class="card"><div class="p"><span class="e">${esc(email)}</span>${state}</div>
<form method="post" class="row"><input type="hidden" name="email" value="${esc(email)}">${periodSelect()}
<button name="action" value="add">تمديد</button><button name="action" value="remove" class="no">إيقاف</button></form></div>`;
  }).join('') || '<p class="mu">لا أحد بعد.</p>';

  const trialRows = trials.map(({ email, left }) => `<div class="card"><div class="p"><span class="e">${esc(email)}</span>${
    left > 0 ? `<span class="ok">باقٍ ${left} ${left === 1 ? 'يوم' : 'أيام'}</span>` : '<span class="end">انتهت التجربة</span>'}</div>
<form method="post" class="row"><input type="hidden" name="email" value="${esc(email)}">${periodSelect()}
<button name="action" value="add" class="alt">أضفه</button></form></div>`).join('') || '<p class="mu">لم يجرّب أحد بعد.</p>';

  return page(`<h1>إدارة المشتركين</h1><p class="mu">التغييرات تعمل خلال دقيقة تقريباً.</p>
${msg ? `<div class="msg">${esc(msg)}</div>` : ''}
<h2>إضافة شخص</h2><form method="post" class="card"><input type="email" name="email" placeholder="name@gmail.com" required>
<div class="row">${periodSelect()}<button name="action" value="add">إضافة</button></div>
<p class="mu">إن كان الشخص مضافاً، تُحسب المدة من آخر يوم له.</p></form>
<h2>المشتركون (${allowed.length})</h2>${people}
<h2>في الفترة التجريبية (${trials.length})</h2>${trialRows}`);
}

export async function onRequest({ request, env }) {
  const kv = env.TRIALS;
  const email = accessEmail(request);
  const admins = kv ? (await kv.get('admins', 'json')) || [] : [];
  if (!email || !admins.includes(email)) {
    return page('<h1>هذه الصفحة للمدير فقط</h1><p class="mu">سجّل الدخول بحساب المدير.</p>', 403);
  }

  const url = new URL(request.url);
  if (request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin) return page('<h1>طلب مرفوض</h1>', 403);
    const msg = await act(kv, await request.formData());
    return Response.redirect(`${url.origin}/admin?msg=${encodeURIComponent(msg)}`, 303);
  }
  return view(kv, url.searchParams.get('msg'));
}
