"""Optional shared access code: gate, cookie, rate limit. No network, no real mail."""
import pytest

from test_workflow import workflow, action
from app import access, main

CODE = 'correct horse battery'
URL = '/api/issues/game-card-shortage'


@pytest.fixture
def clock(monkeypatch):
    now = [1_800_000_000.0]
    monkeypatch.setattr(access, '_now', lambda: now[0])
    access.reset()
    yield now
    access.reset()


@pytest.fixture
def locked(workflow, monkeypatch, clock):
    monkeypatch.setenv('LIO_ACCESS_CODE', CODE)
    workflow.clock = clock
    return workflow


def login(w, code=CODE, **kwargs):
    return w.client.post('/api/login', json={'code': code}, **kwargs)


def test_gate_is_off_by_default(workflow, monkeypatch, clock):
    monkeypatch.delenv('LIO_ACCESS_CODE', raising=False)
    assert workflow.client.get('/api/overview').status_code == 200
    assert workflow.client.get('/login', follow_redirects=False).status_code == 303


def test_locked_api_and_pages_require_login(locked):
    assert locked.client.get('/api/overview').status_code == 401
    assert locked.client.get(URL).status_code == 401
    page = locked.client.get('/', follow_redirects=False)
    assert page.status_code == 303 and page.headers['location'] == '/login'
    assert locked.client.get('/login').status_code == 200
    assert locked.client.get('/api/health').status_code == 200
    assert locked.client.get('/static/login.css', follow_redirects=False).status_code == 200
    assert locked.client.get('/static/login.js', follow_redirects=False).status_code == 200
    assert locked.client.get('/static/assets/index-x.js', follow_redirects=False).status_code in (401, 303)
    assert locked.client.get('/static/index.html', follow_redirects=False).status_code in (401, 303)


def test_login_page_references_only_static_assets(locked):
    html = locked.client.get('/login').text
    assert '/static/login.js' in html and '/static/login.css' in html
    assert '<script>' not in html and 'Enter access code' in html and 'Open' in html


def test_wrong_code_gives_401_and_no_cookie(locked):
    response = login(locked, 'nope')
    assert response.status_code == 401 and 'set-cookie' not in response.headers
    assert locked.client.get('/api/overview').status_code == 401


def test_right_code_sets_strict_httponly_cookie_and_unlocks(locked):
    response = login(locked)
    assert response.status_code == 200
    cookie = response.headers['set-cookie'].lower()
    assert 'lio_session=' in cookie and 'httponly' in cookie and 'samesite=strict' in cookie and 'max-age=43200' in cookie
    assert 'secure' not in cookie
    assert locked.client.get('/api/overview').status_code == 200
    assert locked.client.get('/', follow_redirects=False).status_code == 200
    assert locked.client.get('/login', follow_redirects=False).status_code == 303


def test_mutations_blocked_without_cookie(locked):
    for suffix in ('draft', 'approve', 'send'):
        assert action(locked, suffix, {'approver': 'Test Reviewer'}).status_code == 401
    assert locked.client.post('/api/agent/run', json={}).status_code == 401
    assert locked.client.post('/api/refresh').status_code == 401
    assert locked.sent == []
    assert main.store.get(locked.issue)['draft'] is None


def test_tampered_and_expired_cookies_rejected(locked):
    login(locked)
    good = locked.client.cookies.get('lio_session')
    for bad in ('9999999999.' + 'a' * 64, good[:-1] + ('0' if good[-1] != '0' else '1'), 'garbage', '.', 'x.y'):
        locked.client.cookies.set('lio_session', bad)
        assert locked.client.get('/api/overview').status_code == 401
    locked.client.cookies.set('lio_session', good)
    assert locked.client.get('/api/overview').status_code == 200
    locked.clock[0] += 12 * 3600 + 1
    assert locked.client.get('/api/overview').status_code == 401


def test_cookie_from_another_code_is_rejected(locked, monkeypatch):
    login(locked)
    monkeypatch.setenv('LIO_ACCESS_CODE', 'a different code')
    assert locked.client.get('/api/overview').status_code == 401


def test_rate_limit_blocks_sixth_try_even_with_right_code(locked):
    for _ in range(5):
        assert login(locked, 'wrong').status_code == 401
    limited = login(locked)
    assert limited.status_code == 429 and 'set-cookie' not in limited.headers
    locked.clock[0] += 301
    assert login(locked).status_code == 200


def test_success_clears_ip_failures(locked):
    for _ in range(4):
        login(locked, 'wrong')
    assert login(locked).status_code == 200
    for _ in range(5):
        assert login(locked, 'wrong').status_code == 401
    assert login(locked, 'wrong').status_code == 429


def test_global_limiter_blocks_all_clients(locked):
    for n in range(30):
        access.attempt(f'10.0.0.{n}', 'wrong')
    assert access.attempt('10.9.9.9', CODE) == 'limited'
    assert login(locked).status_code == 429
    locked.clock[0] += 601
    assert login(locked).status_code == 200


def test_check_code_is_length_safe(monkeypatch):
    monkeypatch.setenv('LIO_ACCESS_CODE', CODE)
    assert access.check_code(CODE) and not access.check_code('') and not access.check_code(CODE + 'x')
    assert not access.check_code('x' * 5000) and not access.check_code(None)
    monkeypatch.delenv('LIO_ACCESS_CODE')
    assert not access.check_code('')


def test_forwarded_https_adds_secure_flag(locked):
    response = login(locked, headers={'x-forwarded-proto': 'https'})
    assert 'secure' in response.headers['set-cookie'].lower()


def test_cookie_secure_env_flag(locked, monkeypatch):
    monkeypatch.setenv('LIO_COOKIE_SECURE', 'true')
    assert 'secure' in login(locked).headers['set-cookie'].lower()


def test_logout_clears_cookie(locked):
    login(locked)
    response = locked.client.post('/api/logout')
    header = response.headers['set-cookie'].lower()
    assert response.status_code == 200 and 'lio_session=' in header and 'max-age=0' in header
    locked.client.cookies.clear()
    assert locked.client.get('/api/overview').status_code == 401


def test_evidence_blocked_without_cookie_even_when_flag_on(locked, monkeypatch):
    monkeypatch.setenv('LIO_EXPOSE_SOURCES', 'true')
    assert locked.client.get('/api/evidence', params={'path': 'a.pdf'}).status_code == 401
    login(locked)
    assert locked.client.get('/api/evidence', params={'path': '../a.pdf'}).status_code == 400


def test_gate_responses_carry_security_headers(locked):
    for response in (locked.client.get('/api/overview'), locked.client.get('/', follow_redirects=False)):
        assert response.headers['x-frame-options'] == 'DENY'
        assert 'frame-ancestors' in response.headers['content-security-policy']
        assert response.headers['cache-control'] == 'no-store'


def test_allowed_hosts_env_extends_trusted_hosts():
    hosts = [m for m in main.app.user_middleware if m.cls.__name__ == 'TrustedHostMiddleware']
    assert 'testserver' in hosts[0].kwargs['allowed_hosts']
