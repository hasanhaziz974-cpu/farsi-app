#!/usr/bin/env python3
"""
Sends the daily reminder notifications of the installed web app (run hourly by
.github/workflows/reminders.yml).

Learners turn the reminder on in the app, which stores "push:<email>" in the farsi-trials KV
namespace through functions/api/reminder.js: {sub, hour, tz, last, sent}. A learner is reminded
once per local day, at their chosen hour, unless they already studied that day ("last").

The push carries no data, so it needs no encryption: sw.js shows the notification text itself.
It is authorised with VAPID (RFC 8292): an ES256 key pair kept in KV under "vapid", created on
the first run. Subscriptions the push service reports as gone (404 or 410) are deleted.

Env: CF_API_TOKEN, CF_ACCOUNT_ID. Emails are never printed: Actions logs of this repository are public.
"""
import base64, datetime, json, os, sys, time, urllib.error, urllib.parse, urllib.request

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

API = 'https://api.cloudflare.com/client/v4'
KV_TITLE = 'farsi-trials'
CONTACT = 'mailto:languageparsa777@gmail.com'


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def cf(method, path, body=None, raw=False):
    data = None
    headers = {'Authorization': 'Bearer ' + os.environ['CF_API_TOKEN'].strip()}
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        headers['Content-Type'] = 'application/octet-stream' if raw else 'application/json'
    req = urllib.request.Request(API + path, method=method, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        text = r.read()
    return text if raw else json.loads(text)


def kv_path(account):
    spaces = cf('GET', f'/accounts/{account}/storage/kv/namespaces?per_page=100')['result']
    ns = next((n for n in spaces if n.get('title') == KV_TITLE), None)
    if not ns:
        print('::error::KV namespace farsi-trials not found; run "Sync web access" first.')
        sys.exit(1)
    return f'/accounts/{account}/storage/kv/namespaces/{ns["id"]}'


def kv_get(kv, key):
    try:
        return json.loads(cf('GET', f'{kv}/values/{urllib.parse.quote(key, safe="")}', raw=True))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def kv_put(kv, key, value):
    cf('PUT', f'{kv}/values/{urllib.parse.quote(key, safe="")}', json.dumps(value).encode(), raw=True)


def kv_delete(kv, key):
    cf('DELETE', f'{kv}/values/{urllib.parse.quote(key, safe="")}')


def kv_keys(kv, prefix):
    keys, cursor = [], ''
    while True:
        q = f'{kv}/keys?prefix={urllib.parse.quote(prefix)}&limit=1000' + (f'&cursor={cursor}' if cursor else '')
        res = cf('GET', q)
        keys += [k['name'] for k in res['result']]
        cursor = (res.get('result_info') or {}).get('cursor') or ''
        if not cursor:
            return keys


def vapid_key(kv):
    """The ES256 key pair, created and stored on first use. Returns (private key, public key base64url)."""
    stored = kv_get(kv, 'vapid')
    if stored:
        key = serialization.load_pem_private_key(stored['private'].encode(), password=None)
        return key, stored['public']
    key = ec.generate_private_key(ec.SECP256R1())
    public = b64url(key.public_key().public_bytes(serialization.Encoding.X962,
                                                  serialization.PublicFormat.UncompressedPoint))
    private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption()).decode()
    kv_put(kv, 'vapid', {'private': private, 'public': public})
    print('Created the reminder signing key.')
    return key, public


def vapid_header(key, public, endpoint):
    aud = '{0.scheme}://{0.netloc}'.format(urllib.parse.urlsplit(endpoint))
    head = b64url(json.dumps({'typ': 'JWT', 'alg': 'ES256'}).encode())
    claims = b64url(json.dumps({'aud': aud, 'exp': int(time.time()) + 12 * 3600, 'sub': CONTACT}).encode())
    r, s = decode_dss_signature(key.sign(f'{head}.{claims}'.encode(), ec.ECDSA(hashes.SHA256())))
    sig = b64url(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))
    return f'vapid t={head}.{claims}.{sig}, k={public}'


def push(key, public, sub):
    """Sends an empty push. Returns the HTTP status."""
    req = urllib.request.Request(sub['endpoint'], method='POST', data=b'', headers={
        'Authorization': vapid_header(key, public, sub['endpoint']),
        'TTL': str(4 * 3600),
        'Urgency': 'normal',
        'Content-Length': '0',
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except urllib.error.URLError:
        return 0


def main():
    account = os.environ['CF_ACCOUNT_ID'].strip()
    kv = kv_path(account)
    key, public = vapid_key(kv)
    now = datetime.datetime.now(datetime.timezone.utc)
    counts = {'reminders': 0, 'sent': 0, 'studied': 0, 'removed': 0, 'failed': 0}
    for name in kv_keys(kv, 'push:'):
        rec = kv_get(kv, name)
        if not rec or not rec.get('sub'):
            continue
        counts['reminders'] += 1
        local = now - datetime.timedelta(minutes=int(rec.get('tz') or 0))
        day = local.date().isoformat()
        if local.hour != int(rec.get('hour', -1)) or rec.get('sent') == day:
            continue
        if rec.get('last') == day:
            counts['studied'] += 1
            continue
        status = push(key, public, rec['sub'])
        if status in (200, 201, 202, 204):
            rec['sent'] = day
            kv_put(kv, name, rec)
            counts['sent'] += 1
        elif status in (404, 410):
            kv_delete(kv, name)  # the learner uninstalled or blocked notifications
            counts['removed'] += 1
        else:
            counts['failed'] += 1
            print(f'::warning::A push service answered {status}.')
    print('Reminders: {reminders} on, {sent} sent now, {studied} skipped (already studied today), '
          '{removed} removed (no longer subscribed), {failed} failed.'.format(**counts))


if __name__ == '__main__':
    main()
