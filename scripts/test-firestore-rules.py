"""Test firestore.rules against the Firebase Rules API :test endpoint.

    GTOKEN=$(gcloud auth print-access-token) python3 scripts/test-firestore-rules.py

Nothing is deployed and no emulator is needed — the ruleset is uploaded as
SOURCE alongside the test cases and evaluated server-side, so this can be run
against the real project without touching the live rules. (The Firestore
emulator would need Java, which isn't installed on this machine.)

Every case asserts an explicit ALLOW or DENY. The DENY cases are the point: they
are what proves the permissive `allow read, write: if request.auth != null` hole
is actually closed, rather than just that the app still works.

`get()` calls in the rules are stubbed via functionMocks, so friend checks can be
exercised without any real documents existing.
"""
import json, os, sys, urllib.request, urllib.error

PROJECT = 'sunday-routine'
DB = '/databases/(default)/documents'
OWNER_EMAIL = 'baldaufdan@gmail.com'
ADMIN_UID = 'LnPlQY9qAKQq8oZ2GbvvI5VSvB83'

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RULES = open(os.path.join(REPO_ROOT, 'firestore.rules'), encoding='utf-8').read()


def token(secret):
    return {'Content-Type': 'application/json', 'expo-session': secret}


def auth(uid, email=None):
    tok = {'sub': uid, 'user_id': uid}
    if email:
        tok['email'] = email
    return {'uid': uid, 'token': tok}


READS = ('get', 'list')


def case(name, expect, path, method, a=None, data=None, mocks=None):
    """`data` is the document involved.

    Rules see an EXISTING document as `resource.data` and an incoming write
    payload as `request.resource.data`. The Rules API models those as two
    different places, so a read has to supply the top-level `resource` and a
    create has to supply `request.resource`. An update is evaluated against
    both, so it gets both.
    """
    req = {'path': DB + path, 'method': method}
    if a is not None:
        req['auth'] = a
    tc = {'expectation': expect, 'request': req, 'pathEncoding': 'PLAIN',
          'expressionReportLevel': 'NONE'}
    if data is not None:
        if method in READS:
            tc['resource'] = {'data': data}
        elif method == 'create':
            req['resource'] = {'data': data}
        else:  # update / delete — rules may reference either side
            req['resource'] = {'data': data}
            tc['resource'] = {'data': data}
    if mocks:
        tc['functionMocks'] = mocks
    return (name, tc)


def get_mock(uid, data):
    """Stub get(/databases/.../users/{uid}) so friend checks can be evaluated."""
    return {'function': 'get',
            'args': [{'exactValue': DB + '/users/' + uid}],
            'result': {'value': {'data': data}}}


OWNER = auth('owner1')
FRIEND = auth('friend1')
STRANGER = auth('stranger1')
ADMIN = auth('adminAcct', OWNER_EMAIL)

friends_mock = [get_mock('owner1', {'friends': ['friend1'], 'sharedAccess': ['friend1']})]
nofriends_mock = [get_mock('owner1', {'friends': [], 'sharedAccess': []})]

CASES = [
    # --- the hole being closed -------------------------------------------
    case('stranger GETs another user doc', 'DENY',
         '/users/owner1', 'get', STRANGER, mocks=nofriends_mock),
    case('stranger WRITES another user doc', 'DENY',
         '/users/owner1', 'update', STRANGER, data={'x': 1}),
    case('stranger reads another user habitLog year', 'DENY',
         '/users/owner1/habitLog/2026', 'get', STRANGER),
    case('stranger reads another user dailyLog', 'DENY',
         '/users/owner1/data/dailyLog', 'get', STRANGER),
    case('stranger LISTs users', 'DENY', '/users/owner1', 'list', STRANGER),
    case('unauthenticated reads a user doc', 'DENY', '/users/owner1', 'get', None),
    case('unauthenticated writes a user doc', 'DENY',
         '/users/owner1', 'update', None, data={'x': 1}),

    # --- owner still works ------------------------------------------------
    case('owner GETs own doc', 'ALLOW', '/users/owner1', 'get', OWNER),
    case('owner updates own doc', 'ALLOW', '/users/owner1', 'update', OWNER, data={'x': 1}),
    case('owner reads own habitLog year', 'ALLOW', '/users/owner1/habitLog/2026', 'get', OWNER),
    case('owner writes own habitLogAuto year', 'ALLOW',
         '/users/owner1/habitLogAuto/2026', 'update', OWNER, data={'marks': '{}'}),
    case('owner reads own workouts', 'ALLOW', '/users/owner1/workouts/w1', 'get', OWNER),
    case('owner reads own backups', 'ALLOW', '/users/owner1/backups/b1', 'get', OWNER),

    # --- friend features still work ---------------------------------------
    case('friend GETs friend user doc', 'ALLOW',
         '/users/owner1', 'get', FRIEND, mocks=friends_mock),
    case('friend reads shared recipes doc', 'ALLOW',
         '/users/owner1/data/recipes', 'get', FRIEND, mocks=friends_mock),
    case('friend reads a meal image', 'ALLOW',
         '/users/owner1/mealImages/r1', 'get', FRIEND, mocks=friends_mock),
    case('non-friend reads shared recipes doc', 'DENY',
         '/users/owner1/data/recipes', 'get', STRANGER, mocks=nofriends_mock),
    case('friend CANNOT write friend user doc', 'DENY',
         '/users/owner1', 'update', FRIEND, data={'x': 1}, mocks=friends_mock),
    case('friend CANNOT read friend habitLog', 'DENY',
         '/users/owner1/habitLog/2026', 'get', FRIEND, mocks=friends_mock),

    # --- admin -------------------------------------------------------------
    case('admin LISTs users', 'ALLOW', '/users/owner1', 'list', ADMIN),
    case('admin GETs any user doc', 'ALLOW', '/users/owner1', 'get', ADMIN),

    # --- admin-published docs every client reads ---------------------------
    # The blanket read of the admin USER doc is deliberately gone: the three
    # things that needed it moved into their own docs, so the grant is scoped
    # to exactly those. The whole document — habits, weight log, restaurants —
    # is no longer readable by every signed-in account.
    case('signed-in user CANNOT read the whole admin user doc', 'DENY',
         '/users/' + ADMIN_UID, 'get', STRANGER),
    case('signed-in user reads the shared ingredient DB', 'ALLOW',
         '/users/' + ADMIN_UID + '/data/ingredients', 'get', STRANGER),
    case('signed-in user reads the published app defaults', 'ALLOW',
         '/users/' + ADMIN_UID + '/data/appDefaults', 'get', STRANGER),
    case('signed-in user reads the discover recipe library', 'ALLOW',
         '/users/' + ADMIN_UID + '/data/recipes', 'get', STRANGER),
    case('the same grant does NOT extend to another user', 'DENY',
         '/users/friend1/data/ingredients', 'get', STRANGER),
    case('signed-in user CANNOT write the admin user doc', 'DENY',
         '/users/' + ADMIN_UID, 'update', STRANGER, data={'x': 1}),

    # --- lookup indexes ----------------------------------------------------
    case('signed-in reads a username row', 'ALLOW', '/usernames/dan', 'get', OWNER),
    case('claim a username row for yourself', 'ALLOW',
         '/usernames/dan', 'create', OWNER, data={'uid': 'owner1'}),
    case('claim a username row for someone else', 'DENY',
         '/usernames/dan', 'create', STRANGER, data={'uid': 'owner1'}),
    case('claim an email row for yourself', 'ALLOW',
         '/userEmails/a@b.com', 'create', OWNER, data={'uid': 'owner1'}),
    case('claim an email row for someone else', 'DENY',
         '/userEmails/a@b.com', 'create', STRANGER, data={'uid': 'owner1'}),

    # --- friend requests / direct shares -----------------------------------
    case('recipient reads a friend request', 'ALLOW', '/friendRequests/fr1', 'get',
         FRIEND, data={'from': 'owner1', 'to': 'friend1'}),
    case('third party reads a friend request', 'DENY', '/friendRequests/fr1', 'get',
         STRANGER, data={'from': 'owner1', 'to': 'friend1'}),
    case('sender creates a friend request', 'ALLOW', '/friendRequests/fr1', 'create',
         OWNER, data={'from': 'owner1', 'to': 'friend1'}),
    case('forging a friend request from someone else', 'DENY',
         '/friendRequests/fr1', 'create', STRANGER,
         data={'from': 'owner1', 'to': 'friend1'}),
    case('recipient reads a shared recipe', 'ALLOW', '/sharedRecipes/s1', 'get',
         FRIEND, data={'from': 'owner1', 'to': 'friend1'}),
    case('third party reads a shared recipe', 'DENY', '/sharedRecipes/s1', 'get',
         STRANGER, data={'from': 'owner1', 'to': 'friend1'}),
    case('third party reads a shared meal', 'DENY', '/sharedMeals/s1', 'get',
         STRANGER, data={'from': 'owner1', 'to': 'friend1'}),

    # --- share links -------------------------------------------------------
    # The payload here is the one BOTH clients actually send — recipe +
    # createdBy + createdAt. The first version of these cases invented an
    # `ownerUid` field to match the rule, so they passed against a rule that
    # denied every real share. Test data for a rule that gates on a field name
    # has to be copied from the writer, never from the rule.
    case('anyone with the link reads it', 'ALLOW', '/sharedLinks/tok123', 'get', None),
    case('nobody can enumerate share links', 'DENY', '/sharedLinks/tok123', 'list', OWNER),
    case('creating a link for yourself', 'ALLOW', '/sharedLinks/tok123', 'create',
         OWNER, data={'recipe': {'title': 'Soup'}, 'createdBy': 'owner1',
                      'createdAt': '2026-08-10T00:00:00.000Z'}),
    case('creating a link in someone else name', 'DENY', '/sharedLinks/tok123',
         'create', STRANGER, data={'recipe': {'title': 'Soup'}, 'createdBy': 'owner1'}),
    case('a link with no owner field at all', 'DENY', '/sharedLinks/tok123',
         'create', OWNER, data={'recipe': {'title': 'Soup'}}),
    case('the creator revokes their own link', 'ALLOW', '/sharedLinks/tok123',
         'delete', OWNER, data={'recipe': {'title': 'Soup'}, 'createdBy': 'owner1'}),
    case('a stranger cannot revoke your link', 'DENY', '/sharedLinks/tok123',
         'delete', STRANGER, data={'recipe': {'title': 'Soup'}, 'createdBy': 'owner1'}),

    # --- eating out --------------------------------------------------------
    case('signed-in reads eating-out ratings', 'ALLOW', '/eatingOutRatings/r1', 'get', FRIEND),
    case('rating as yourself', 'ALLOW', '/eatingOutRatings/r1', 'create',
         FRIEND, data={'authorUid': 'friend1', 'ownerUid': 'owner1'}),
    case('rating in someone else name', 'DENY', '/eatingOutRatings/r1', 'create',
         STRANGER, data={'authorUid': 'friend1', 'ownerUid': 'owner1'}),
    case('unauthenticated reads ratings', 'DENY', '/eatingOutRatings/r1', 'get', None),
    case('comment as yourself', 'ALLOW', '/eatingOutComments/c1', 'create',
         FRIEND, data={'authorUid': 'friend1', 'ownerUid': 'owner1'}),
    case('comment in someone else name', 'DENY', '/eatingOutComments/c1', 'create',
         STRANGER, data={'authorUid': 'friend1', 'ownerUid': 'owner1'}),

    # --- pre-signup handoff ------------------------------------------------
    case('admin stages a pending setup', 'ALLOW', '/pendingSetups/x@y.com', 'update',
         ADMIN, data={'recipes': []}),
    case('stranger reads a pending setup', 'DENY', '/pendingSetups/x@y.com', 'get', STRANGER),
    case('the addressee reads their pending setup', 'ALLOW',
         '/pendingSetups/x@y.com', 'get', auth('newbie', 'x@y.com')),
]


def main():
    state = json.load(open(os.path.expanduser('~/.expo/state.json')))
    secret = (state.get('auth') or {}).get('sessionSecret')
    gcloud_token = os.environ.get('GTOKEN', '').strip()
    if not gcloud_token:
        print('need GTOKEN env var (gcloud auth print-access-token)')
        return 2

    body = {
        'source': {'files': [{'name': 'firestore.rules', 'content': RULES}]},
        'testSuite': {'testCases': [tc for (_n, tc) in CASES]},
    }
    req = urllib.request.Request(
        'https://firebaserules.googleapis.com/v1/projects/%s:test' % PROJECT,
        data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json',
                 'Authorization': 'Bearer ' + gcloud_token,
                 'x-goog-user-project': PROJECT,
                 'User-Agent': 'firebase-cli/13.0.0'})
    try:
        res = json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        print('HTTP', e.code)
        print(e.read()[:3000].decode(errors='replace'))
        return 1

    issues = res.get('issues') or []
    if issues:
        print('=== RULESET COMPILE ISSUES ===')
        for i in issues:
            print(' ', i.get('severity'), i.get('description'),
                  (i.get('sourcePosition') or {}).get('line'))
        print()

    results = res.get('testResults') or []
    if not results:
        print('no test results returned:')
        print(json.dumps(res)[:2000])
        return 1

    failures = []
    for (name, _tc), r in zip(CASES, results):
        state_ = r.get('state')
        if state_ != 'SUCCESS':
            failures.append((name, state_, r.get('errorPosition')))

    print('=== %d/%d cases behaved as specified ===' % (len(results) - len(failures), len(results)))
    if failures:
        print()
        print('FAILURES (rule did not match the expectation):')
        for name, st, pos in failures:
            print('  %-52s %s %s' % (name, st, pos or ''))
        return 1
    print('every allow/deny expectation held')
    return 0


if __name__ == '__main__':
    sys.exit(main())
