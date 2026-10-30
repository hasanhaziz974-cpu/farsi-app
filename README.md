# farsi-app
Learn Persian app

## الصوت
تُولَّد ملفات الصوت بأداة edge-tts (أصوات Microsoft العصبية، بلا حساب ولا مفتاح). الأداة غير رسمية وقد تتوقف عن العمل.
1. شغّل من تبويب Actions سكربت **Generate audio**، واختر الصوت والسرعة. سيحفظ الملفات في مجلد `audio/`.
2. شغّل **Build Android AAB** كالمعتاد، وسيضم الملفات للتطبيق.

لعرض النصوص وأسماء ملفاتها: `node tools/audio-texts.js`
