# farsi-app
Learn Persian app

## الصوت (Azure)
1. أنشئ مورد **Speech** في Azure (الخطة المجانية F0 تكفي: ٥٠٠ ألف حرف شهرياً، والتطبيق يحتاج حوالي ١٠٠ ألف).
2. أضف في GitHub (Settings ← Secrets and variables ← Actions) السرّين `AZURE_SPEECH_KEY` و`AZURE_SPEECH_REGION` (مثل `westeurope`).
3. شغّل من تبويب Actions سكربت **Generate audio (Azure)**، واختر الصوت والسرعة. سيحفظ الملفات في مجلد `audio/`.
4. شغّل **Build Android AAB** كالمعتاد، وسيضم الملفات للتطبيق.

لمعاينة النصوص دون مفتاح: `node tools/gen-audio.js --list`
