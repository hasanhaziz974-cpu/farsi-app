#!/usr/bin/env python3
"""Temporary: asks several Workers AI models to play a Persian role-play turn, to compare quality."""
import json, os, time, urllib.error, urllib.request

ACC = os.environ['CF_ACCOUNT_ID'].strip()
TOK = os.environ['CF_API_TOKEN'].strip()
SYSTEM = (
    "You are a friendly waiter in a restaurant in Tehran, talking with an Arabic-speaking beginner who is learning Persian. "
    "Reply in simple, natural Persian (1-2 short sentences, beginner level), and stay in your role. "
    "Answer in exactly four lines:\n"
    "FA: your reply in Persian script\n"
    "TR: its Latin transliteration\n"
    "AR: its Arabic translation\n"
    "FIX: if the learner's last message has a Persian mistake, the corrected sentence and a very short explanation in Arabic; otherwise -"
)
MSGS = [
    {"role": "system", "content": SYSTEM},
    {"role": "assistant", "content": "FA: سلام! خوش آمدید. چه میل دارید؟\nTR: salām! khosh āmadid. che meyl dārid?\nAR: مرحباً! أهلاً بك. ماذا تحب أن تطلب؟\nFIX: -"},
    {"role": "user", "content": "من یک چای و کباب میخواهم. قیمت چند است؟"},
]
MODELS = os.environ.get('MODELS', '').split()
for m in MODELS:
    req = urllib.request.Request(f'https://api.cloudflare.com/client/v4/accounts/{ACC}/ai/run/{m}', method='POST',
                                 data=json.dumps({'messages': MSGS, 'max_tokens': 400}).encode(),
                                 headers={'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json'})
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            res = json.load(r)['result']
        out = res.get('response') if isinstance(res, dict) else res
        if not isinstance(out, str):
            out = json.dumps(res, ensure_ascii=False)[:800]
        print(f'===== {m} ({time.time() - t:.1f}s) usage={json.dumps(res.get("usage")) if isinstance(res, dict) else ""}\n{out}\n')
    except urllib.error.HTTPError as e:
        print(f'===== {m}: HTTP {e.code} {e.read()[:300]!r}\n')
