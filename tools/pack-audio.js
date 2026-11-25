#!/usr/bin/env node
/*
 * Packs the recorded pronunciation (audio/<hex>.mp3, one file per text: hs() in index.html) into 4,096 pack files for the site,
 * because Cloudflare Pages takes at most 20,000 files in a deployment (the audio alone is more).
 * Each pack holds the files whose name starts with the same 3 hex digits: audio/p/<3 hex>.bin =
 * [4 bytes: header length, big-endian][header: JSON {"<name>.mp3": [offset, length], …}][the files, one after another].
 * functions/_middleware.js answers /audio/<name>.mp3 from its pack, so the app's addresses do not change.
 * audio/manifest.json (the Android app's audio pack list) is copied as it is.
 *
 *   node tools/pack-audio.js audio www/audio      (the Cloudflare build command, tools/sync_access.py)
 */
const fs = require('fs'), path = require('path');

function pack(src, out) {
  const names = fs.readdirSync(src).filter((n) => /^[0-9a-f]{1,8}\.mp3$/.test(n)).sort();
  const groups = new Map();
  for (const n of names) {
    const k = n.slice(0, 3);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  }
  fs.mkdirSync(path.join(out, 'p'), { recursive: true });
  for (const [k, list] of groups) {
    const bodies = list.map((n) => fs.readFileSync(path.join(src, n)));
    const head = {};
    let off = 0;
    list.forEach((n, i) => { head[n] = [off, bodies[i].length]; off += bodies[i].length; });
    const h = Buffer.from(JSON.stringify(head));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(h.length);
    fs.writeFileSync(path.join(out, 'p', k + '.bin'), Buffer.concat([len, h, ...bodies]));
  }
  if (fs.existsSync(path.join(src, 'manifest.json'))) fs.copyFileSync(path.join(src, 'manifest.json'), path.join(out, 'manifest.json'));
  return { files: names.length, packs: groups.size };
}

if (require.main === module) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('usage: node tools/pack-audio.js <audio dir> <out dir>'); process.exit(2); }
  const r = pack(src, out);
  console.log(`Packed ${r.files} audio files into ${r.packs} packs in ${out}/p`);
}
module.exports = { pack };
