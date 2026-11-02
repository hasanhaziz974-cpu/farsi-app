/**
 * Sends the app's sign-in codes from your Gmail address (Google Apps Script web app).
 *
 * Setup (once, from the Google account that should send the codes):
 *   1. https://script.google.com → New project. Replace the code with this file and save.
 *   2. Project Settings (gear) → Script properties → Add: name KEY, value: a long secret you
 *      make up (the same value goes into the GitHub secret MAIL_KEY).
 *   3. Deploy → New deployment → type "Web app": Execute as "Me", Who has access "Anyone".
 *      Authorise it, then copy the Web app URL into the GitHub secret MAIL_URL.
 *
 * functions/api/auth/start.js posts {key, to, code, minutes}; only that fixed message is sent,
 * so the script cannot be used to send anything else. A consumer Gmail account can send
 * about 100 emails a day; the app stops at 90.
 */
function doPost(e) {
  var out = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  try {
    var d = JSON.parse(e.postData.contents);
    var key = PropertiesService.getScriptProperties().getProperty('KEY');
    if (!key || d.key !== key) return out({ ok: false, error: 'key' });
    var to = String(d.to || ''), code = String(d.code || '');
    if (!/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(to) || !/^\d{6}$/.test(code)) return out({ ok: false, error: 'input' });
    var minutes = Number(d.minutes) || 10;
    var html =
      '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:460px;margin:auto;text-align:center;color:#14263A">' +
      '<h2 style="color:#12807F;margin:0 0 6px">الفارسية من الصفر</h2>' +
      '<p>رمز الدخول الخاص بك:</p>' +
      '<div style="font-size:34px;font-weight:bold;letter-spacing:8px;direction:ltr;background:#EEF4F3;border-radius:12px;padding:14px;margin:10px 0">' + code + '</div>' +
      '<p style="color:#5B7083">صالح لمدة ' + minutes + ' دقائق. لا تعطِ هذا الرمز لأحد.</p>' +
      '<p style="color:#5B7083;font-size:13px">إن لم تطلب الدخول فتجاهل هذه الرسالة.</p></div>';
    MailApp.sendEmail({
      to: to,
      subject: 'رمز الدخول: ' + code + ' · الفارسية من الصفر',
      htmlBody: html,
      body: 'رمز الدخول إلى «الفارسية من الصفر»: ' + code + '\nصالح لمدة ' + minutes + ' دقائق.',
      name: 'الفارسية من الصفر',
    });
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}
