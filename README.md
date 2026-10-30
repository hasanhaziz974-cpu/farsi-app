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
  - المتغير `ACCESS_LIST`: شخص في كل سطر، البريد ثم آخر يوم دخول (اختياري)، مثل `ali@gmail.com 2026-11-07`. السطر بلا تاريخ لا ينتهي، فأبقِ بريدك بلا تاريخ.
- سكربت **Sync web access** يعمل يومياً، ويمكن تشغيله فوراً بعد تعديل القائمة. يحذف من انتهى تاريخه ويُخرجه من الموقع.
