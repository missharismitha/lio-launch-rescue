"""Read-only inbox ingestion. Matching sender headers are not identity proof.

Messages become reviewable evidence, never inventory or purchase commitments.
"""
import hashlib
import imaplib
import json
import os
import re
import ssl
import threading
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses
from pathlib import Path
from app.sync import now

MAX_MESSAGE = 2 * 1024 * 1024


def candidates(body: str) -> dict:
    # Strict labelled fields only: arbitrary prose and quoted old replies are not facts.
    fresh = re.split(r'(?im)^On .+wrote:|^-{2,}\s*Original Message', body)[0]
    fresh = '\n'.join(line for line in fresh.splitlines() if not line.lstrip().startswith('>'))
    result = {}
    for key, label, pattern in [
        ('quantity', 'Available quantity', r'([\d,]+)'),
        ('arrival_at', 'Warehouse arrival', r'(\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d))'),
        ('cost_eur', 'Total cost EUR', r'([\d,]+(?:\.\d{1,2})?)'),
    ]:
        found = re.search(r'(?im)^\s*' + label + r'\s*:\s*' + pattern + r'\s*$', fresh)
        if found:
            value = found[1]
            result[key] = value if key == 'arrival_at' else float(value.replace(',', ''))
    return result


class Inbox:
    def __init__(self, store, directory: Path):
        self.store, self.directory = store, directory
        self.lock = threading.RLock()
        self.status = {'last_checked': None, 'last_success': None, 'error': None}
        self.rejected_login = None  # fingerprint of credentials the server refused: no retries until they change
        with store.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS messages (digest TEXT PRIMARY KEY, message_id TEXT, issue_id TEXT, payload TEXT NOT NULL)')

    def list(self, issue_id):
        with self.store.connect() as db:
            return [json.loads(row[0]) for row in db.execute('SELECT payload FROM messages WHERE issue_id=? ORDER BY rowid DESC', (issue_id,))]

    def ingest(self, raw: bytes, issue: dict, expected_sender: str, transport='manual import'):
        with self.lock:
            return self._ingest(raw, issue, expected_sender, transport)

    def _ingest(self, raw: bytes, issue: dict, expected_sender: str, transport):
        if not raw or len(raw) > MAX_MESSAGE:
            raise ValueError('Email must be between 1 byte and 2 MB')
        if not expected_sender:
            raise ValueError('Configure a verified supplier recipient before ingesting its replies')
        message = BytesParser(policy=policy.default).parsebytes(raw)
        senders = getaddresses(message.get_all('From', []))
        if len(senders) != 1 or senders[0][1].casefold() != expected_sender.casefold():
            raise ValueError('Reply sender does not match the configured supplier address')
        subject = str(message.get('Subject', ''))
        if '[Lio ' + issue['id'] + ']' not in subject:
            raise ValueError('Reply subject must contain the exact case tag from the inquiry')
        message_id = str(message.get('Message-ID', '')).strip()
        digest = hashlib.sha256(raw).hexdigest()
        with self.store.connect() as db:
            duplicate = db.execute('SELECT digest,payload FROM messages WHERE digest=? OR (message_id=? AND message_id<>\'\')', (digest, message_id)).fetchone()
        if duplicate:
            if duplicate[0] != digest:
                raise ValueError('Message-ID already exists with different content; review the original email')
            return json.loads(duplicate[1]), False
        part = message.get_body(preferencelist=('plain',))
        if part is None:
            raise ValueError('Email requires a text/plain body; HTML-only messages need a plain-text export')
        body = part.get_content()
        record = {'id': digest, 'message_id': message_id, 'issue_id': issue['id'], 'sender': senders[0][1],
                  'subject': subject, 'body': body[:30000], 'received_at': now(), 'transport': transport,
                  'sender_header_matched': True, 'identity_verified': False, 'candidates': candidates(body),
                  'simulated': str(message.get('X-Lio-Simulated', '')).strip().casefold() == 'yes',
                  'review_status': 'pending', 'source_fingerprint': issue.get('_fingerprint')}
        self.directory.mkdir(parents=True, exist_ok=True)
        (self.directory / (digest + '.eml')).write_bytes(raw)
        with self.store.connect() as db:
            db.execute('INSERT INTO messages VALUES(?,?,?,?)', (digest, message_id, issue['id'], json.dumps(record)))
        self.store.event(issue['id'], 'reply_received', 'Supplier-header-matched reply ingested. Claims require review; stock unchanged.')
        return record, True

    def check(self, issues, recipient_for):
        self.status['last_checked'] = now()
        if not all(os.getenv(k) for k in ('IMAP_HOST', 'IMAP_USERNAME', 'IMAP_PASSWORD')):
            self.status['error'] = 'IMAP is not configured. Import an exported .eml reply locally instead.'
            return self.status.copy()
        login = hashlib.sha256('|'.join(os.environ[k] for k in ('IMAP_HOST', 'IMAP_USERNAME', 'IMAP_PASSWORD')).encode()).hexdigest()
        if self.rejected_login == login:
            self.status['error'] = ('The mail server rejected this login. Retrying is paused so the account is not locked. '
                                    'Fix IMAP_USERNAME and IMAP_PASSWORD (an app password is needed) and restart.')
            return self.status.copy()
        try:
            with imaplib.IMAP4_SSL(os.environ['IMAP_HOST'], int(os.getenv('IMAP_PORT', '993')), ssl_context=ssl.create_default_context()) as client:
                try:
                    client.login(os.environ['IMAP_USERNAME'], os.environ['IMAP_PASSWORD'])
                except imaplib.IMAP4.error:
                    self.rejected_login = login
                    raise
                status, _ = client.select(os.getenv('IMAP_FOLDER', 'INBOX'), readonly=True)
                if status != 'OK':
                    raise ValueError('Inbox selection failed')
                status, rows = client.uid('search', None, 'ALL')
                if status != 'OK':
                    raise ValueError('Inbox search failed')
                for uid in rows[0].split()[-50:]:
                    status, sizes = client.uid('fetch', uid, '(RFC822.SIZE)')
                    size_text = b' '.join(x for x in sizes if isinstance(x, bytes))
                    size = re.search(rb'RFC822.SIZE (\d+)', size_text)
                    if status != 'OK' or not size or int(size[1]) > MAX_MESSAGE:
                        continue
                    status, payload = client.uid('fetch', uid, '(BODY.PEEK[])')
                    if status != 'OK':
                        continue
                    for item in payload:
                        if not isinstance(item, tuple) or not isinstance(item[1], bytes):
                            continue
                        for issue in issues:
                            try:
                                _, created = self.ingest(item[1], issue, recipient_for(issue), 'IMAP read-only')
                                if created:
                                    original = {k: v for k, v in issue.items() if k != '_fingerprint'}
                                    case = self.store.get(original)
                                    case.update(state='reply_review_required', approved_fingerprint=None)
                                    self.store.save(issue['id'], case)
                                break
                            except ValueError:
                                continue
            self.status.update(last_success=now(), error=None)
        except (OSError, ValueError, imaplib.IMAP4.error):
            self.status['error'] = 'Inbox check failed; verify IMAP settings. No messages were changed.'
        return self.status.copy()
