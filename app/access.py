"""Optional shared access code for public hosting. Off unless LIO_ACCESS_CODE is set."""
import hashlib
import hmac
import os
import secrets
import threading
import time

COOKIE = 'lio_session'
LIFETIME = 12 * 3600
IP_LIMIT, IP_WINDOW = 5, 300
MAX_IPS, MAX_REVOKED = 1000, 1000
_SALT = secrets.token_bytes(32)  # per process: cookies die on restart
GLOBAL_LIMIT, GLOBAL_WINDOW = 30, 600
PUBLIC = {'/login', '/api/login', '/api/health', '/static/login.css', '/static/login.js'}

_lock = threading.Lock()
_ip_failures = {}
_global_failures = []
_revoked = {}

LOGIN_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Launch Control</title>
<link rel="stylesheet" href="/static/login.css">
<script src="/static/login.js" defer></script>
</head>
<body>
<main class="login">
<h1>Launch Control</h1>
<form id="login-form" autocomplete="off">
<label for="code">Enter access code</label>
<input id="code" name="code" type="password" required autofocus>
<button class="btn" type="submit">Open</button>
<p id="login-error" role="alert"></p>
</form>
</main>
</body>
</html>
"""


def _now():
    return time.time()


def enabled():
    return bool(os.getenv('LIO_ACCESS_CODE'))


def _digest(value):
    return hashlib.sha256(value.encode('utf-8')).digest()


def _key():
    return hashlib.sha256(b'lio-session|' + _SALT + b'|' + os.getenv('LIO_ACCESS_CODE', '').encode('utf-8')).digest()


def _sign(expiry):
    return hmac.new(_key(), str(expiry).encode(), hashlib.sha256).hexdigest()


def make_cookie(now=None):
    expiry = int((_now() if now is None else now) + LIFETIME)
    return f'{expiry}.{_sign(expiry)}'


def _fingerprint(value):
    return hashlib.sha256(str(value).encode('utf-8', 'surrogatepass')).hexdigest()


def revoke(value):
    """Invalidate one cookie value until restart (bounded, oldest forgotten first)."""
    if not value:
        return
    with _lock:
        _revoked[_fingerprint(value)] = None
        while len(_revoked) > MAX_REVOKED:
            _revoked.pop(next(iter(_revoked)))


def valid_cookie(value):
    try:
        if not enabled() or not isinstance(value, str) or '.' not in value:
            return False
        expiry, _, signature = value.partition('.')
        if not (expiry.isascii() and expiry.isdigit() and signature.isascii()):
            return False
        if not hmac.compare_digest(signature.encode('ascii'), _sign(int(expiry)).encode('ascii')):
            return False
        if _fingerprint(value) in _revoked:
            return False
        return int(expiry) > _now()
    except Exception:
        return False


def check_code(code):
    expected = os.getenv('LIO_ACCESS_CODE', '')
    if not expected:
        return False
    return hmac.compare_digest(_digest(str(code or '')), _digest(expected))


def attempt(ip, code):
    """Return 'ok', 'bad' or 'limited'. A limited client's code is never checked."""
    now = _now()
    with _lock:
        recent = [t for t in _ip_failures.get(ip, []) if now - t < IP_WINDOW]
        _ip_failures.pop(ip, None)
        _ip_failures[ip] = recent
        if len(_ip_failures) > MAX_IPS:
            for key in [k for k, v in _ip_failures.items() if k != ip and (not v or now - v[-1] >= IP_WINDOW)]:
                del _ip_failures[key]
            while len(_ip_failures) > MAX_IPS:
                _ip_failures.pop(next(iter(_ip_failures)))
        _global_failures[:] = [t for t in _global_failures if now - t < GLOBAL_WINDOW]
        if len(recent) >= IP_LIMIT or len(_global_failures) >= GLOBAL_LIMIT:
            return 'limited'
        if check_code(code):
            _ip_failures.pop(ip, None)
            return 'ok'
        recent.append(now)
        _global_failures.append(now)
        return 'bad'


def reset():
    with _lock:
        _ip_failures.clear()
        _global_failures.clear()
        _revoked.clear()
