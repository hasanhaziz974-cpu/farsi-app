#!/usr/bin/env python3
"""
Keeps a Cloudflare Access policy's email list in sync with ACCESS_LIST, removing people
whose access date has passed and signing out anyone who was removed.

ACCESS_LIST holds one person per line: an email, then optionally the last day of access
(YYYY-MM-DD, UTC). A line without a date never expires. Blank lines and lines starting
with # are ignored. Example:

    owner@gmail.com
    ali@gmail.com 2026-11-07

Env: CF_API_TOKEN, CF_ACCOUNT_ID, ACCESS_LIST, ACCESS_POLICY_NAME (default "Farsi group").
Emails are never printed, because Actions logs of a public repository are public. For the
same reason ACCESS_LIST must be a secret: Actions prints variables passed to a step.
"""
import datetime, json, os, re, sys, urllib.error, urllib.request

API = os.environ.get('CF_API_BASE', 'https://api.cloudflare.com/client/v4')


def fail(msg):
    print('::error::' + msg)
    sys.exit(1)


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Authorization': 'Bearer ' + os.environ['CF_API_TOKEN'].strip(), 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)['result']
    except urllib.error.HTTPError as e:
        try:
            errs = '; '.join(x.get('message', '') for x in json.load(e).get('errors', []))
        except Exception:
            errs = ''
        hint = ' Check that CF_ACCOUNT_ID is the account ID.' if e.code == 404 else ''
        fail(f'Cloudflare API {method} {path.split("?")[0]} failed ({e.code}) {errs}{hint}')
    except urllib.error.URLError as e:
        fail(f'Could not reach the Cloudflare API: {e.reason}')


def parse(text, today):
    keep, expired = [], 0
    for n, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parts = re.split(r'[\s,]+', line)
        if len(parts) > 2 or '@' not in parts[0]:
            fail(f'ACCESS_LIST line {n} is not "email" or "email YYYY-MM-DD"')
        email = parts[0].lower()
        if len(parts) == 2:
            try:
                last_day = datetime.date.fromisoformat(parts[1])
            except ValueError:
                fail(f'ACCESS_LIST line {n} has a date that is not YYYY-MM-DD')
            if last_day < today:
                expired += 1
                continue
        if email not in keep:
            keep.append(email)
    return keep, expired


def main():
    for k in ('CF_API_TOKEN', 'CF_ACCOUNT_ID', 'ACCESS_LIST'):
        if not os.environ.get(k, '').strip():
            fail(f'Add the repository secret {k} first')
    if re.search(r'\s', os.environ['CF_API_TOKEN'].strip()):
        fail('The CF_API_TOKEN secret has more than one line or a space in it. Save it again with only the token.')
    account = os.environ['CF_ACCOUNT_ID'].strip()
    if not re.fullmatch(r'[0-9a-f]{32}', account):
        fail('The CF_ACCOUNT_ID secret is not a 32-character account ID. Save it again with only the ID.')
    wanted_name = (os.environ.get('ACCESS_POLICY_NAME') or 'Farsi group').strip().rstrip('.').lower()

    keep, expired = parse(os.environ['ACCESS_LIST'], datetime.datetime.now(datetime.timezone.utc).date())
    if not keep:
        fail('No active emails in ACCESS_LIST; refusing to lock everyone out. Keep at least your own email without a date.')

    policies = call('GET', f'/accounts/{account}/access/policies?per_page=100')
    match = [p for p in policies if p.get('name', '').strip().rstrip('.').lower() == wanted_name]
    if len(match) != 1:
        fail(f'Expected one Access policy named "{wanted_name}", found {len(match)}')
    policy = match[0]

    before = {r['email']['email'].lower() for r in policy.get('include', []) if 'email' in r}
    removed = sorted(before - set(keep))

    body = {'name': policy['name'], 'decision': policy['decision'], 'include': [{'email': {'email': e}} for e in keep]}
    for k in ('exclude', 'require', 'session_duration', 'approval_required', 'approval_groups',
              'isolation_required', 'purpose_justification_required', 'purpose_justification_prompt'):
        if policy.get(k) not in (None, []):
            body[k] = policy[k]
    call('PUT', f'/accounts/{account}/access/policies/{policy["id"]}', body)

    for e in removed:
        call('POST', f'/accounts/{account}/access/organizations/revoke_user', {'email': e})

    print(f'Access list synced: {len(keep)} allowed, {expired} expired in the list, '
          f'{len(removed)} removed and signed out, {len(set(keep) - before)} newly added.')


if __name__ == '__main__':
    main()
