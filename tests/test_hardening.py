"""Review-driven hardening: no chat, stronger scrub, cookie/logout, docs off, startup guard."""
import hashlib
import hmac
import json

import pytest
from fastapi.testclient import TestClient

from test_workflow import workflow, action
from test_access_gate import CODE, clock, locked, login  # noqa: F401  (fixtures)
from app import access, main, public

URL = '/api/issues/game-card-shortage'


def test_chat_route_is_gone_and_detail_has_no_chat(workflow):
    assert workflow.client.post(URL + '/chat', json={'text': 'why?'}).status_code in (404, 405)
    detail = workflow.client.get(URL).json()
    assert 'chat' not in detail
    assert 'chat' not in public.public_detail({'id': 'x', 'chat': [{'text': 'PO-1'}]})


def test_real_shape_issue_leaks_no_identifiers(workflow):
    issue = workflow.issue
    issue['summary'] = 'PO 4500123456 and receipt GR-778899 were paraphrased from the DC-HAM contract.'
    issue['actions'] = ['Call about PO 4500123456', 'Check receipt GR-778899 at DC-HAM']
    issue['recovery'] = {'note': 'Ship PO 4500123456 to DC-HAM', 'receipt': 'GR-778899'}
    action(workflow, 'draft')
    overview = json.dumps(workflow.client.get('/api/overview').json())
    detail = workflow.client.get(URL).json()
    detail['case']['draft']['body'] = ''  # the draft body is the one place the plan allows facts
    blob = overview + json.dumps(detail)
    for token in ('4500123456', 'GR-778899', 'DC-HAM'):
        assert token not in blob


@pytest.mark.parametrize('text', [
    'Keep this. Mail pat@supplier.example about it. Also fine.',
    'Keep this. See https://example.com/x for it. Also fine.',
    'Keep this. See www.example.com/x for it. Also fine.',
    'Keep this. See [the file](https://example.com/x) for it. Also fine.',
    'Keep this. Open notice․pdf now. Also fine.',
    "Keep this. He said 'this is a long internal quote' today. Also fine.",
    'Keep this. Run `this is a long internal command` now. Also fine.',
])
def test_scrub_probes(text):
    out = public.scrub(text)
    assert 'Keep this.' in out and 'Also fine.' in out
    for bad in ('@', 'http', 'www', 'example', 'pdf', 'internal', 'file'):
        assert bad not in out


@pytest.mark.parametrize('ext', ['xls', 'xlsm', 'doc', 'ppt', 'pptx', 'json', 'xml', 'yaml', 'yml', 'msg', 'zip', 'rtf',
                                 'gif', 'tif', 'tiff', 'bmp', 'svg', 'log', 'tsv', 'dat', 'html', 'htm'])
def test_scrub_extra_extensions(ext):
    assert public.scrub(f'Keep this. Look at report.{ext} please. Done.') == 'Keep this. Done.'


def test_scrub_keeps_normal_apostrophes():
    text = "The Collector's edition won't slip. We don't expect a delay. Short 'two words' stays."
    assert public.scrub(text) == text
    assert public.scrub("It's the suppliers' call, and it's 'a long enough quote here' too.") == "It's the suppliers' call, and it's too."


def test_plan_b_and_steps_are_scrubbed():
    out = public.public_investigation({'text': '## Plan B options\n- **Use notice.pdf** — Mail a@b.example now.\n- **Ship** — Fly it.\n'})
    blob = json.dumps(out['options'])
    assert 'pdf' not in blob and '@' not in blob and 'Fly it.' in blob
    assert public.public_step('Looked at https://x.example/secret') == 'Checked a record'


@pytest.mark.parametrize('state', ['sending', 'delivery_unknown'])
def test_public_case_not_approved_while_sending_or_unconfirmed(state):
    case = {'state': state, 'source_fingerprint': 'f', 'approved_fingerprint': 'f'}
    assert public.public_case(case)['approved'] is False
    assert public.public_case({**case, 'state': 'approved'})['approved'] is True


def test_app_js_has_unconfirmed_delivery_branch():
    src = main.Path(main.__file__).parent.parent / 'frontend' / 'src'
    source = ''.join(p.read_text(encoding='utf-8') for p in src.rglob('*') if p.suffix in ('.ts', '.tsx') and 'test' not in p.parts)
    assert 'delivery_unknown' in source and 'Delivery not confirmed. Check sent mail.' in source


def test_non_ascii_cookie_is_simply_invalid(locked):
    response = locked.client.get('/api/overview', headers={'cookie': 'lio_session=é123.ébc'.encode('latin-1')})
    assert response.status_code == 401
    assert access.valid_cookie('٣.' + 'a' * 64) is False and access.valid_cookie('1.é') is False


def test_logout_revokes_the_old_cookie(locked):
    login(locked)
    old = locked.client.cookies.get('lio_session')
    assert locked.client.get('/api/overview').status_code == 200
    locked.client.post('/api/logout')
    locked.client.cookies.set('lio_session', old)
    assert locked.client.get('/api/overview').status_code == 401


def test_cookie_signed_with_only_the_code_is_rejected(locked):
    expiry = int(access._now() + 3600)
    key = hashlib.sha256(('lio-session|' + CODE).encode()).digest()
    forged = f'{expiry}.' + hmac.new(key, str(expiry).encode(), hashlib.sha256).hexdigest()
    locked.client.cookies.set('lio_session', forged)
    assert locked.client.get('/api/overview').status_code == 401


def test_revoked_set_is_bounded(locked, monkeypatch):
    monkeypatch.setattr(access, 'MAX_REVOKED', 5)
    for n in range(20):
        access.revoke(f'v{n}')
    assert len(access._revoked) == 5


def test_rate_limiter_memory_is_bounded(locked, monkeypatch):
    monkeypatch.setattr(access, 'MAX_IPS', 50)
    monkeypatch.setattr(access, 'GLOBAL_LIMIT', 10 ** 6)
    for n in range(200):
        access.attempt(f'10.1.{n // 250}.{n % 250}', 'wrong')
    assert len(access._ip_failures) <= 50


@pytest.mark.parametrize('path', ['/docs', '/redoc', '/openapi.json'])
def test_api_docs_are_disabled(workflow, path):
    assert workflow.client.get(path).status_code == 404


def test_agent_run_and_inbox_check_return_public_projection(workflow):
    workflow.monkeypatch.setattr(main, 'agent_cycle', lambda issue_id: None)
    workflow.monkeypatch.setattr(main, 'agent_status', {'running': False, 'state': 'ready', 'steps': [], 'last_run': None,
                                                        'error': None, 'secret': 'x'})
    run = workflow.client.post('/api/agent/run', json={})
    assert run.status_code == 202 and set(run.json()) == {'running', 'state', 'steps', 'error', 'last_run'}
    workflow.monkeypatch.setattr(main, 'check_inbox', lambda: {'last_error': 'IMAP user@example.invalid'})
    check = workflow.client.post('/api/inbox/check')
    assert set(check.json()) == {'running', 'state', 'steps', 'error', 'last_run'}
    assert 'example.invalid' not in check.text


def test_hosted_without_access_code_refuses_to_start(monkeypatch):
    monkeypatch.setenv('LIO_ALLOWED_HOSTS', 'lio.example.com')
    monkeypatch.delenv('LIO_ACCESS_CODE', raising=False)
    monkeypatch.setattr(main, 'refresh', lambda sync=False: None)
    with pytest.raises(RuntimeError):
        with TestClient(main.app):
            pass


def test_hosted_with_access_code_starts(monkeypatch):
    monkeypatch.setenv('LIO_ALLOWED_HOSTS', 'lio.example.com')
    monkeypatch.setenv('LIO_ACCESS_CODE', CODE)
    monkeypatch.setattr(main, 'refresh', lambda sync=False: None)
    with TestClient(main.app) as client:
        assert client.get('/api/health').status_code == 200
