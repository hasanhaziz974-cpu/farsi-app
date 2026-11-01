// Makes the Google Play images in store/: six 1080x1920 phone screenshots, the
// 1024x500 feature graphic and the 512x512 icon. It opens index.html in the
// pre-installed Playwright Chromium with some sample progress, so the screens look used.
// Run from the repository root: node tools/store-images.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'store');
const url = (f) => 'file://' + path.join(root, f);

(async () => {
  fs.mkdirSync(path.join(out, 'screenshots'), { recursive: true });
  const browser = await chromium.launch();

  const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 });
  await page.goto(url('index.html'));
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const now = Date.now();
    S.xp = 340; S.st = 6; S.last = new Date().toDateString(); S.dgn = 5;
    ALL.slice(0, 40).forEach((w, i) => { S.srs[w.id] = { b: 1 + (i % 5), d: now + (i % 3) * 864e5 }; });
    save(); go('home');
  });
  const shot = async (name) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, 'screenshots', name + '.png') });
  };
  await shot('1-lessons');
  await page.locator('#main button, #main .row').first().click();
  await shot('2-lesson');
  await page.evaluate(() => go('letters'));
  await shot('3-letters');
  await page.evaluate(() => go('talk'));
  await page.locator('#main .row, #main button', { hasText: 'التعارف' }).first().click();
  await shot('4-dialogue');
  await page.evaluate(() => go('review'));
  await shot('5-review');
  await page.evaluate(() => go('games'));
  await shot('6-games');

  const banner = await browser.newPage({ viewport: { width: 1024, height: 500 } });
  await banner.setContent(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>
@font-face{font-family:V;src:url(${url('fonts/Vazirmatn-ExtraBold.woff2')});font-weight:800}
@font-face{font-family:V;src:url(${url('fonts/Vazirmatn-Regular.woff2')});font-weight:400}
html,body{margin:0;width:1024px;height:500px;overflow:hidden}
body{background:linear-gradient(135deg,#12807F,#0B5E5E);font-family:V;color:#fff;display:flex;align-items:center;gap:56px;padding:0 72px;box-sizing:border-box}
img{width:250px;height:250px;border-radius:56px;box-shadow:0 18px 40px rgba(0,0,0,.25)}
h1{font-size:76px;font-weight:800;margin:0;line-height:1.15}
p{font-size:31px;margin:14px 0 0;opacity:.92}
.fa{font-size:30px;margin-top:22px;background:rgba(255,255,255,.15);display:inline-block;padding:6px 22px;border-radius:40px}
</style></head><body><img src="${url('icon-only.png')}"><div><h1>الفارسية من الصفر</h1>
<p>دروس وصوت ومحادثات للمتحدثين بالعربية</p><div class="fa">سلام! فارسی یاد بگیریم</div></div></body></html>`);
  await banner.waitForTimeout(500);
  await banner.screenshot({ path: path.join(out, 'feature-graphic.png') });

  const icon = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await icon.setContent(`<body style="margin:0"><img src="${url('icon-only.png')}" width="512" height="512" style="display:block">`);
  await icon.waitForTimeout(300);
  await icon.screenshot({ path: path.join(out, 'icon-512.png') });

  await browser.close();
  console.log('Wrote the images to store/');
})();
