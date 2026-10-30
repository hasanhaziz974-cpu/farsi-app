#!/usr/bin/env python3
"""
Generates audio/<hash>.mp3 for every Persian text the app speaks, using edge-tts
(Microsoft's online neural voices, no account or key needed).

    pip install edge-tts
    python3 tools/gen_audio.py

Optional env: VOICE (default fa-IR-DilaraNeural), RATE (default -10%), FORCE=1 to regenerate all.
Existing files are kept, files no longer used are deleted, and audio/manifest.json is rewritten.
"""
import asyncio, json, os, subprocess, sys, time
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'audio'
VOICE = os.environ.get('VOICE') or 'fa-IR-DilaraNeural'
RATE = os.environ.get('RATE') or '-10%'
if RATE[0] not in '+-':
    RATE = '+' + RATE  # edge-tts needs a sign, e.g. +0%
FORCE = os.environ.get('FORCE') == '1'


def texts():
    out = subprocess.run(['node', str(ROOT / 'tools' / 'audio-texts.js')], check=True, capture_output=True, text=True).stdout
    return [tuple(line.split('\t', 1)) for line in out.splitlines() if line]


async def synth(text, path):
    tmp = path.with_suffix('.part')
    for attempt in range(6):
        try:
            await edge_tts.Communicate(text, VOICE, rate=RATE).save(str(tmp))
            if tmp.stat().st_size == 0:
                raise RuntimeError('empty audio')
            tmp.rename(path)
            return
        except Exception as e:
            if attempt == 5:
                raise RuntimeError(f'edge-tts failed for "{text}": {e}') from e
            await asyncio.sleep(2 ** attempt)


async def main():
    items = texts()
    OUT.mkdir(exist_ok=True)
    wanted = {n for n, _ in items}
    for f in OUT.iterdir():
        if f.suffix in ('.mp3', '.part') and f.name not in wanted:
            f.unlink()

    todo = [(n, t) for n, t in items if FORCE or not (OUT / n).exists()]
    print(f'{len(items)} texts, {len(todo)} to generate with {VOICE} at rate {RATE}', flush=True)
    done = 0
    queue = list(todo)

    async def worker():
        nonlocal done
        while queue:
            n, t = queue.pop()
            await synth(t, OUT / n)
            done += 1
            if done % 100 == 0:
                print(f'{done} done', flush=True)

    await asyncio.gather(*(worker() for _ in range(4)))

    files = [{'n': n, 's': (OUT / n).stat().st_size} for n, _ in items]
    (OUT / 'manifest.json').write_text(json.dumps({'version': int(time.time()), 'voice': VOICE, 'rate': RATE, 'files': files}))
    print(f"Done: {len(files)} files, {sum(f['s'] for f in files) / 1048576:.1f} MB")


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as e:
        print(e, file=sys.stderr)
        sys.exit(1)
