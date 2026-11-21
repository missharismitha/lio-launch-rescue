"""A rejected mailbox login must not be retried every poll: repeated failures can lock the account."""
import imaplib

from app import mailbox
from app.store import Store


def make_inbox(tmp_path):
    return mailbox.Inbox(Store(tmp_path / 'cases.sqlite3'), tmp_path / 'inbox')


def set_credentials(monkeypatch, password):
    for key, value in {'IMAP_HOST': 'imap.example.invalid', 'IMAP_USERNAME': 'team@example.invalid', 'IMAP_PASSWORD': password}.items():
        monkeypatch.setenv(key, value)


class RejectingServer:
    attempts = 0

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def login(self, user, password):
        RejectingServer.attempts += 1
        raise imaplib.IMAP4.error('[AUTHENTICATIONFAILED] Invalid credentials')


class AcceptingServer(RejectingServer):
    attempts = 0

    def login(self, user, password):
        AcceptingServer.attempts += 1
        return 'OK', [b'logged in']

    def select(self, *args, **kwargs):
        return 'OK', [b'0']

    def uid(self, *args, **kwargs):
        return 'OK', [b'']


def test_rejected_login_is_not_retried_until_credentials_change(tmp_path, monkeypatch):
    RejectingServer.attempts = 0
    monkeypatch.setattr(mailbox.imaplib, 'IMAP4_SSL', RejectingServer)
    set_credentials(monkeypatch, 'wrong-password')
    inbox = make_inbox(tmp_path)
    first = inbox.check([], lambda issue: '')
    assert RejectingServer.attempts == 1 and 'failed' in first['error']
    for _ in range(5):
        again = inbox.check([], lambda issue: '')
    assert RejectingServer.attempts == 1, 'must not hammer the mail server with a login it already refused'
    assert 'paused' in again['error'] and 'app password' in again['error']


def test_changed_credentials_are_tried_again(tmp_path, monkeypatch):
    RejectingServer.attempts = AcceptingServer.attempts = 0
    monkeypatch.setattr(mailbox.imaplib, 'IMAP4_SSL', RejectingServer)
    set_credentials(monkeypatch, 'wrong-password')
    inbox = make_inbox(tmp_path)
    inbox.check([], lambda issue: '')
    monkeypatch.setattr(mailbox.imaplib, 'IMAP4_SSL', AcceptingServer)
    set_credentials(monkeypatch, 'new-app-password')
    result = inbox.check([], lambda issue: '')
    assert AcceptingServer.attempts == 1 and result['error'] is None and result['last_success']


def test_network_errors_are_still_retried(tmp_path, monkeypatch):
    calls = []

    class Unreachable:
        def __init__(self, *args, **kwargs):
            calls.append(1)
            raise OSError('network down')
    monkeypatch.setattr(mailbox.imaplib, 'IMAP4_SSL', Unreachable)
    set_credentials(monkeypatch, 'some-password')
    inbox = make_inbox(tmp_path)
    inbox.check([], lambda issue: '')
    inbox.check([], lambda issue: '')
    assert len(calls) == 2, 'a transient network failure must not pause the checker'
