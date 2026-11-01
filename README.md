# farsi-app
Learn Persian app

## الصوت
تُولَّد ملفات الصوت بأداة edge-tts (أصوات Microsoft العصبية، بلا حساب ولا مفتاح). الأداة غير رسمية وقد تتوقف عن العمل.
1. شغّل من تبويب Actions سكربت **Generate audio**، واختر الصوت والسرعة. سيحفظ الملفات في مجلد `audio/`.
2. شغّل **Build Android AAB** كالمعتاد، وسيضم الملفات للتطبيق.

لعرض النصوص وأسماء ملفاتها: `node tools/audio-texts.js`

## نسخة الويب والتحكم في الدخول
الموقع على Cloudflare Pages ومحمي بـCloudflare Access بقاعدة اسمها `Farsi group`.
- في GitHub: Settings ← Secrets and variables ← Actions:
  - الأسرار `CF_API_TOKEN` و`CF_ACCOUNT_ID`.
  - السر `ACCESS_LIST` (سرّ وليس متغيراً، حتى لا تظهر عناوين البريد في السجلات العامة): شخص في كل سطر، البريد ثم آخر يوم دخول (اختياري)، مثل `ali@gmail.com 2026-11-07`. السطر بلا تاريخ لا ينتهي، فأبقِ بريدك بلا تاريخ.
- **فترة تجريبية:** أي شخص يستطيع الدخول ببريده، ويحصل على 7 أيام من أول زيارة، ثم تظهر له رسالة انتهاء التجربة. من في `ACCESS_LIST` لا تنتهي مدته. المدة في `functions/_middleware.js` (`TRIAL_DAYS`). لإلغاء التجربة احذف سطر `TRIAL_PAGES_PROJECT` من `.github/workflows/access.yml`.
- **تثبيت نسخة الويب كتطبيق:** `pwa/manifest.webmanifest` وأيقوناته و`sw.js` تجعل Chrome يعرض «تثبيت التطبيق». يفتح بملء الشاشة، والصفحة والصوت الذي سُمع يعملان دون إنترنت. ملفات الموقع التي تُنشر مذكورة في `BUILD_COMMAND` داخل `tools/sync_access.py`.
- **التذكير اليومي:** يفعّله المتعلّم من «تقدّمي» في نسخة الويب ويختار الساعة. الإعدادات في KV عبر `functions/api/reminder.js`، والإرسال كل ساعة من `.github/workflows/reminders.yml` (`tools/send_reminders.py`)، ونص الإشعار في `sw.js`. لا يصل في يوم درس فيه المتعلّم.
- **صفحة الترحيب:** `parsa-farsi.pages.dev/welcome` تفتح للجميع دون تسجيل دخول، وهي الرابط الذي يُنشر. ملفاتها في `welcome/`، والمسارات العامة في `PUBLIC_PATHS` داخل `.github/workflows/access.yml`.
- **الدخول بحساب Facebook أو Google:** يظهر بجانب الرمز عند إضافة السرّين `FACEBOOK_APP_ID` و`FACEBOOK_APP_SECRET` (من Meta for Developers ← App settings ← Basic)، أو `GOOGLE_CLIENT_ID` و`GOOGLE_CLIENT_SECRET` (Google Cloud غير متاح في العراق). عنوان الرجوع (Redirect URI) يطبعه سكربت **Sync web access** في سجله.
- **صفحة الإدارة (الأسهل):** افتح `parsa-farsi.pages.dev/admin` ببريدك (أول سطر في `ACCESS_LIST`) لإضافة الأشخاص وتمديدهم وإيقافهم ورؤية من في الفترة التجريبية.
- **إضافة شخص من Cloudflare (الأسهل):** في Storage & Databases ← KV ← farsi-trials أضف مدخلاً: المفتاح `allow:البريد` بحروف صغيرة، والقيمة آخر يوم دخول مثل `2026-11-15` أو `دائم`. يعمل خلال دقيقة، ولإيقاف الشخص احذف المدخل.
- سكربت **Sync web access** يعمل يومياً، ويمكن تشغيله فوراً بعد تعديل القائمة. يحذف من انتهى تاريخه ويُخرجه من الموقع.

## الإصدار والمكتبات
- رقم الإصدار الظاهر للمستخدم يُبنى تلقائياً: أول رقمين من `version` في `package.json` ثم رقم البناء، مثل `1.0.12`. لإصدار جديد مثل `1.1` غيّر `version` إلى `1.1.0`.
- إصدارات Capacitor مثبّتة في `package.json` و`package-lock.json`، فلا يتغير البناء فجأة عند صدور إصدار جديد. لتحديثها عدّل الأرقام عمداً واختبر البناء.
