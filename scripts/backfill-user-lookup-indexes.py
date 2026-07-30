"""Backfill userEmails/{email} and usernames/{username} from existing users.

    GTOKEN=$(gcloud auth print-access-token) python3 scripts/backfill-user-lookup-indexes.py --dry-run
    GTOKEN=$(gcloud auth print-access-token) python3 scripts/backfill-user-lookup-indexes.py --apply

Friend search resolves through these index rows instead of querying /users,
which the Firestore rules no longer allow. Both apps write a user's row on
sign-in, so this only exists to cover everyone who hasn't signed in since — run
it once before deploying the rules, or email search silently returns "user not
found" for them until they next open the app.

Uses the Firestore REST API as the project owner, which bypasses security rules.
Writes are MERGES of three fields (uid, displayName, username/email) — an
existing row is updated, never replaced, so a row a client already wrote is not
clobbered.
"""
import json, os, sys, urllib.request, urllib.error

PROJECT = 'sunday-routine'
BASE = ('https://firestore.googleapis.com/v1/projects/%s/databases/(default)/documents'
        % PROJECT)
TOKEN = os.environ.get('GTOKEN', '').strip()


def api(method, url, body=None):
    req = urllib.request.Request(url, method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={'Content-Type': 'application/json',
                                          'Authorization': 'Bearer ' + TOKEN,
                                          'x-goog-user-project': PROJECT,
                                          'User-Agent': 'firebase-cli/13.0.0'})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        raise SystemExit('HTTP %s on %s\n%s'
                         % (e.code, url, e.read()[:800].decode(errors='replace')))


def sval(fields, name):
    """Read a string field out of a Firestore REST document."""
    v = (fields or {}).get(name) or {}
    return (v.get('stringValue') or '').strip()


def list_users():
    users, token = [], None
    while True:
        url = BASE + '/users?pageSize=300'
        if token:
            url += '&pageToken=' + token
        page = api('GET', url)
        for d in page.get('documents', []):
            users.append((d['name'].rsplit('/', 1)[-1], d.get('fields') or {}))
        token = page.get('nextPageToken')
        if not token:
            break
    return users


def write_row(collection, doc_id, row, apply_it):
    if not apply_it:
        return
    # updateMask makes this a merge rather than a replace.
    mask = '&'.join('updateMask.fieldPaths=' + k for k in row)
    url = '%s/%s/%s?%s' % (BASE, collection, urllib.parse.quote(doc_id, safe=''), mask)
    api('PATCH', url, {'fields': {k: {'stringValue': v} for k, v in row.items()}})


def main():
    if not TOKEN:
        raise SystemExit('need GTOKEN (gcloud auth print-access-token)')
    apply_it = '--apply' in sys.argv
    if not apply_it and '--dry-run' not in sys.argv:
        raise SystemExit('pass --dry-run or --apply')

    users = list_users()
    emails = usernames = skipped = 0
    for uid, f in users:
        email = sval(f, 'email').lower()
        username = sval(f, 'username').lower()
        display = sval(f, 'displayName')
        if not email and not username:
            skipped += 1
            continue
        row = {'uid': uid, 'displayName': display, 'username': username}
        if email:
            write_row('userEmails', email, dict(row, email=email), apply_it)
            emails += 1
        if username:
            write_row('usernames', username, dict(row, email=email), apply_it)
            usernames += 1

    print('%s %d user(s): %d email row(s), %d username row(s), %d with neither'
          % ('WROTE' if apply_it else 'WOULD WRITE', len(users), emails, usernames, skipped))


if __name__ == '__main__':
    import urllib.parse  # noqa: E402  (used by write_row)
    main()
