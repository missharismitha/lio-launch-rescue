"""Durable cases and action history, including approval invalidation."""
import hashlib
import json
import sqlite3
from pathlib import Path
from app.sync import now


def fingerprint(issue: dict) -> str:
    return hashlib.sha256(json.dumps(issue, sort_keys=True, default=str).encode()).hexdigest()


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, issue_id TEXT, at TEXT, kind TEXT, message TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS conversation (id INTEGER PRIMARY KEY, issue_id TEXT, at TEXT, role TEXT, text TEXT, mode TEXT, source_fingerprint TEXT)')

    def connect(self):
        return sqlite3.connect(self.path, timeout=10)

    def event(self, issue_id, kind, message):
        with self.connect() as db:
            db.execute('INSERT INTO events(issue_id,at,kind,message) VALUES(?,?,?,?)', (issue_id, now(), kind, message))

    def save(self, issue_id, case):
        with self.connect() as db:
            db.execute('INSERT INTO cases VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
                       (issue_id, json.dumps(case)))

    def get(self, issue: dict) -> dict:
        with self.connect() as db:
            row = db.execute('SELECT payload FROM cases WHERE id=?', (issue['id'],)).fetchone()
        case = json.loads(row[0]) if row else {'state': 'detected', 'draft': None, 'approver': None,
                                             'approval_note': None, 'approved_fingerprint': None, 'sent_at': None}
        current = fingerprint(issue)
        if case.get('source_fingerprint') != current:
            if row:
                if case['state'] in ('sending', 'delivery_unknown'):
                    case['delivery_status'] = case['state']
                self.event(issue['id'], 'source_changed', 'Evidence changed. Previous approval invalidated; regenerate and review the inquiry.')
                case.update(state='review_required', draft=None, approver=None, approved_fingerprint=None, investigation=None, recovery_offer=None)
            else:
                self.event(issue['id'], 'detected', issue['summary'])
            case['source_fingerprint'] = current
            self.save(issue['id'], case)
        return case

    def events(self, issue_id):
        with self.connect() as db:
            db.row_factory = sqlite3.Row
            return [dict(r) for r in db.execute('SELECT at,kind,message FROM events WHERE issue_id=? ORDER BY id DESC', (issue_id,))]

    def chat(self, issue_id):
        with self.connect() as db:
            db.row_factory = sqlite3.Row
            rows = list(db.execute('SELECT at,role,text,mode,source_fingerprint FROM conversation WHERE issue_id=? ORDER BY id DESC LIMIT 40', (issue_id,)))
            return [dict(row) for row in reversed(rows)]

    def chat_turn(self, issue_id, question, answer, mode, source_fingerprint):
        with self.connect() as db:
            db.executemany('INSERT INTO conversation(issue_id,at,role,text,mode,source_fingerprint) VALUES(?,?,?,?,?,?)',
                           [(issue_id, now(), 'user', question, mode, source_fingerprint),
                            (issue_id, now(), 'assistant', answer, mode, source_fingerprint)])
