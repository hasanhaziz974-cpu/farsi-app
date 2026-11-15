#!/usr/bin/env python3
"""
Deploys the daily reminder Worker (workers/reminders/index.js) to Cloudflare and gives it its
schedule: every 10 minutes. Run by .github/workflows/reminders-worker.yml.

The Worker is uploaded through the Cloudflare API (no wrangler), with the farsi-trials KV namespace
bound as TRIALS, the same namespace the app and functions/api/reminder.js use.

Env: CF_API_TOKEN (needs "Workers Scripts: Edit" and "Workers KV Storage: Read" on the account),
CF_ACCOUNT_ID, and optionally REMINDER_BUDGET: KV and fetch calls per run (45 suits the free plan's 50;
900 the Workers Paid plan's 1000).
"""
import json, os, sys, urllib.error, urllib.request, uuid

API = 'https://api.cloudflare.com/client/v4'
NAME = 'farsi-reminders'
KV_TITLE = 'farsi-trials'
CRON = '*/10 * * * *'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def call(method, path, data=None, ctype='application/json'):
    headers = {'Authorization': 'Bearer ' + os.environ['CF_API_TOKEN'].strip()}
    if data is not None:
        headers['Content-Type'] = ctype
    req = urllib.request.Request(API + path, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            errs = json.loads(e.read()).get('errors') or []
        except ValueError:
            errs = []
        msg = '; '.join(f"{x.get('code')}: {x.get('message')}" for x in errs) or str(e.code)
        hint = ' The API token needs the "Workers Scripts: Edit" permission.' if e.code in (401, 403) else ''
        print(f'::error::Cloudflare refused {method} {path.split("/")[-1]}: {msg}.{hint}')
        sys.exit(1)


def main():
    account = os.environ['CF_ACCOUNT_ID'].strip()
    spaces = call('GET', f'/accounts/{account}/storage/kv/namespaces?per_page=100')['result']
    ns = next((n for n in spaces if n.get('title') == KV_TITLE), None)
    if not ns:
        print('::error::KV namespace farsi-trials not found; run "Sync web access" first.')
        sys.exit(1)
    budget = os.environ.get('REMINDER_BUDGET', '').strip() or '45'
    meta = {
        'main_module': 'index.js',
        'compatibility_date': '2025-01-01',
        'bindings': [
            {'type': 'kv_namespace', 'name': 'TRIALS', 'namespace_id': ns['id']},
            {'type': 'plain_text', 'name': 'BUDGET', 'text': budget},
        ],
    }
    with open(os.path.join(ROOT, 'workers', 'reminders', 'index.js'), 'rb') as f:
        code = f.read()
    b = uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'
            + json.dumps(meta) + '\r\n'
            + f'--{b}\r\nContent-Disposition: form-data; name="index.js"; filename="index.js"\r\n'
            + 'Content-Type: application/javascript+module\r\n\r\n').encode() + code + f'\r\n--{b}--\r\n'.encode()
    call('PUT', f'/accounts/{account}/workers/scripts/{NAME}', body, f'multipart/form-data; boundary={b}')
    call('PUT', f'/accounts/{account}/workers/scripts/{NAME}/schedules', json.dumps([{'cron': CRON}]).encode())
    print(f'Deployed the reminder Worker "{NAME}": every 10 minutes, {budget} calls per run.')


if __name__ == '__main__':
    main()
