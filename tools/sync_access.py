#!/usr/bin/env python3
"""
Keeps a Cloudflare Access policy's email list in sync with ACCESS_LIST, removing people
whose access date has passed and signing out anyone who was removed.

ACCESS_LIST holds one person per line: an email, then optionally the last day of access
(YYYY-MM-DD, UTC). A line without a date never expires. Blank lines and lines starting
with # are ignored. Example:

    owner@gmail.com
    ali@gmail.com 2026-11-07

When ACCESS_APP_DOMAIN is set (e.g. parsa-farsi.pages.dev), it also makes sure an Access
application protects that hostname with the policy, creating one if needed.

When TRIAL_PAGES_PROJECT is set (e.g. parsa-farsi), anyone may sign in with their email and
gets a free trial counted from their first visit (enforced by functions/_middleware.js).
For that the script keeps a "Trial" policy on the application, a KV namespace bound to the
Pages project as TRIALS, and the allowlist in KV, so people on ACCESS_LIST are never limited.

PUBLIC_PATHS (e.g. "welcome fonts") lists paths on ACCESS_APP_DOMAIN that open without
signing in, such as the welcome page. They get their own Access application with a bypass
policy, which Cloudflare applies before the application protecting the whole hostname.

LOGIN_HEADER and LOGIN_FOOTER, when set, are shown on the Cloudflare sign-in page where
visitors type their email.

Env: CF_API_TOKEN, CF_ACCOUNT_ID, ACCESS_LIST, ACCESS_POLICY_NAME (default "Farsi group"),
ACCESS_APP_DOMAIN, PUBLIC_PATHS, TRIAL_PAGES_PROJECT, LOGIN_HEADER, LOGIN_FOOTER.
Emails are never printed, because Actions logs of a public repository are public. For the
same reason ACCESS_LIST must be a secret: Actions prints variables passed to a step.
"""
import datetime, json, os, re, sys, urllib.error, urllib.request

API = os.environ.get('CF_API_BASE', 'https://api.cloudflare.com/client/v4')
OLD_OPEN_POLICY_NAME = 'Open to everyone (temporary)'
TRIAL_POLICY_NAME = 'Trial: anyone who signs in'
PUBLIC_POLICY_NAME = 'Public pages: no sign-in'
KV_TITLE = 'farsi-trials'
# How long a sign-in lasts before Cloudflare asks for the email again (its maximum is a month).
# Access periods are enforced on every page load by functions/_middleware.js, not by this.
SESSION = os.environ.get('ACCESS_SESSION') or '720h'


def fail(msg):
    print('::error::' + msg)
    sys.exit(1)


def call(method, path, body=None, allow=()):
    req = urllib.request.Request(API + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Authorization': 'Bearer ' + os.environ['CF_API_TOKEN'].strip(), 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)['result']
    except urllib.error.HTTPError as e:
        if e.code in allow:
            return None
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
    body['session_duration'] = SESSION
    for k in ('exclude', 'require', 'approval_required', 'approval_groups',
              'isolation_required', 'purpose_justification_required', 'purpose_justification_prompt'):
        if policy.get(k) not in (None, []):
            body[k] = policy[k]
    call('PUT', f'/accounts/{account}/access/policies/{policy["id"]}', body)

    for e in removed:
        call('POST', f'/accounts/{account}/access/organizations/revoke_user', {'email': e})

    print(f'Access list synced: {len(keep)} allowed, {expired} expired in the list, '
          f'{len(removed)} removed and signed out, {len(set(keep) - before)} newly added.')

    project = (os.environ.get('TRIAL_PAGES_PROJECT') or '').strip()
    if project:
        trials(account, project, keep)
    domain = (os.environ.get('ACCESS_APP_DOMAIN') or '').strip().lower()
    if domain:
        protect(account, domain, policy, bool(project))
        public(account, domain, (os.environ.get('PUBLIC_PATHS') or '').split())

    header, footer = (os.environ.get('LOGIN_HEADER') or '').strip(), (os.environ.get('LOGIN_FOOTER') or '').strip()
    if header or footer:
        try:
            login_page(account, header, footer)
        except SystemExit:
            print('::warning::Could not update the sign-in page message; access was still synced.')


def login_page(account, header, footer):
    org = call('GET', f'/accounts/{account}/access/organizations')
    design = dict(org.get('login_design') or {})
    if design.get('header_text') == header and design.get('footer_text') == footer:
        return
    design = {k: v for k, v in design.items() if v}
    design.update(header_text=header, footer_text=footer)
    body = {'name': org['name'], 'auth_domain': org['auth_domain'], 'login_design': design}
    call('PUT', f'/accounts/{account}/access/organizations', body)
    print('Updated the message on the sign-in page.')

def app_hosts(app):
    hosts = {(app.get('domain') or '').lower()}
    hosts.update(h.lower() for h in app.get('self_hosted_domains') or [])
    hosts.update((d.get('uri') or '').lower() for d in app.get('destinations') or [] if d.get('type', 'public') == 'public')
    return {h.rstrip('/') for h in hosts if h}


def set_app_policies(account, app, ids):
    body = {k: v for k, v in app.items() if k not in ('id', 'uid', 'aud', 'created_at', 'updated_at', 'policies', 'scim_config')}
    if body.get('destinations'):
        body.pop('self_hosted_domains', None)
    body['policies'] = [{'id': i, 'precedence': n + 1} for n, i in enumerate(ids)]
    call('PUT', f'/accounts/{account}/access/apps/{app["id"]}', body)


def named_policy(account, name):
    found = [p for p in call('GET', f'/accounts/{account}/access/policies?per_page=100') if p.get('name') == name]
    return found[0] if found else None


def trials(account, project, keep):
    spaces = call('GET', f'/accounts/{account}/storage/kv/namespaces?per_page=100')
    ns = next((n for n in spaces if n.get('title') == KV_TITLE), None) or \
        call('POST', f'/accounts/{account}/storage/kv/namespaces', {'title': KV_TITLE})
    kv = f'/accounts/{account}/storage/kv/namespaces/{ns["id"]}'
    call('PUT', f'{kv}/values/allowlist', keep)
    call('PUT', f'{kv}/values/admins', keep[:1])  # the first line of ACCESS_LIST can open /admin

    proj = call('GET', f'/accounts/{account}/pages/projects/{project}')
    configs = proj.get('deployment_configs') or {}
    bound = ((configs.get('production') or {}).get('kv_namespaces') or {}).get('TRIALS', {}).get('namespace_id')
    if bound != ns['id']:
        binding = {'kv_namespaces': {'TRIALS': {'namespace_id': ns['id']}}}
        call('PATCH', f'/accounts/{account}/pages/projects/{project}',
             {'deployment_configs': {'production': binding, 'preview': binding}})
        # 304 means Cloudflare is already building the latest commit; the next push redeploys anyway.
        started = call('POST', f'/accounts/{account}/pages/projects/{project}/deployments', allow=(304,))
        print('Linked the trial storage to the site' +
              (' and started a new deployment.' if started is not None else '; it takes effect with the next deployment.'))

    started = len(call('GET', f'{kv}/keys?prefix=trial:&limit=1000'))
    print(f'Trial: {started} people have signed in for a trial so far.')


def protect(account, domain, policy, trial_on):
    old_open = named_policy(account, OLD_OPEN_POLICY_NAME)
    trial = named_policy(account, TRIAL_POLICY_NAME)
    if trial_on and not trial:
        trial = call('POST', f'/accounts/{account}/access/policies', {
            'name': TRIAL_POLICY_NAME, 'decision': 'allow', 'include': [{'everyone': {}}],
            'session_duration': SESSION})
    elif trial_on and trial.get('session_duration') != SESSION:
        call('PUT', f'/accounts/{account}/access/policies/{trial["id"]}', {
            'name': TRIAL_POLICY_NAME, 'decision': 'allow', 'include': trial.get('include') or [{'everyone': {}}],
            'session_duration': SESSION})

    apps = call('GET', f'/accounts/{account}/access/apps?per_page=100')
    app = next((a for a in apps if a.get('type') == 'self_hosted' and domain in app_hosts(a)), None)
    wanted = [policy['id']] + ([trial['id']] if trial_on else [])
    if app is None:
        call('POST', f'/accounts/{account}/access/apps', {
            'type': 'self_hosted', 'name': domain, 'domain': domain,
            'destinations': [{'type': 'public', 'uri': domain}],
            'session_duration': SESSION,
            'app_launcher_visible': False,
            'policies': [{'id': i, 'precedence': n + 1} for n, i in enumerate(wanted)],
        })
        print(f'Created an Access application protecting {domain}.')
    else:
        managed = {policy['id']} | {p['id'] for p in (old_open, trial) if p}
        ids = [p['id'] for p in app.get('policies') or []]
        wanted += [i for i in ids if i not in managed]
        if wanted != ids or app.get('session_duration') != SESSION:
            app['session_duration'] = SESSION
            set_app_policies(account, app, wanted)

    for p in (old_open, None if trial_on else trial):
        if p:
            call('DELETE', f'/accounts/{account}/access/policies/{p["id"]}')
    print(f'{domain}: ' + ('anyone can sign in for a trial; the list has no limit.' if trial_on
                           else 'only the list can sign in.'))

def public(account, domain, paths):
    """Lets anyone open domain/<path> for each path, without the sign-in page."""
    name = f'{domain} (public pages)'
    apps = call('GET', f'/accounts/{account}/access/apps?per_page=100')
    app = next((a for a in apps if a.get('name') == name), None)
    pol = named_policy(account, PUBLIC_POLICY_NAME)
    if not paths:
        if app:
            call('DELETE', f'/accounts/{account}/access/apps/{app["id"]}')
            print('Removed the public pages; the whole site needs signing in again.')
        if pol:
            call('DELETE', f'/accounts/{account}/access/policies/{pol["id"]}')
        return
    if not pol:
        pol = call('POST', f'/accounts/{account}/access/policies', {
            'name': PUBLIC_POLICY_NAME, 'decision': 'bypass', 'include': [{'everyone': {}}]})
    uris = [f'{domain}/{p.strip("/")}' for p in paths]
    body = {
        'type': 'self_hosted', 'name': name, 'domain': uris[0],
        'destinations': [{'type': 'public', 'uri': u} for u in uris],
        'app_launcher_visible': False,
        'policies': [{'id': pol['id'], 'precedence': 1}],
    }
    current = sorted((d.get('uri') or '').lower() for d in (app or {}).get('destinations') or [])
    if app is None:
        call('POST', f'/accounts/{account}/access/apps', body)
    elif current != sorted(u.lower() for u in uris) or [p['id'] for p in app.get('policies') or []] != [pol['id']]:
        call('PUT', f'/accounts/{account}/access/apps/{app["id"]}', body)
    else:
        print('Public pages unchanged: ' + ', '.join('/' + p.strip('/') for p in paths))
        return
    print('Open without signing in: ' + ', '.join('https://' + u for u in uris))


if __name__ == '__main__':
    main()
