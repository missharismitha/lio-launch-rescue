"""Exercise the approval boundary with synthetic evidence and fake transport."""
from copy import deepcopy
from types import SimpleNamespace

from fastapi.testclient import TestClient
import pytest

from app import main
from app.store import Store


@pytest.fixture
def workflow(tmp_path, monkeypatch):
    issue = {
        'id': 'game-card-shortage', 'material_id': 'CMP-GAM-001',
        'title': 'Synthetic card shortage', 'summary': 'A synthetic supplier notice reduced supply.',
        'shortage': 37, 'required': 100, 'usable_stock': 50, 'incoming': 13,
        'evidence': [{'path': 'supplier/notice.pdf', 'label': 'Synthetic notice', 'excerpt': '13 units shipped.'}],
    }
    monkeypatch.setattr(main, 'snapshot', {'issues': [issue], 'warnings': []})
    monkeypatch.setattr(main, 'store', Store(tmp_path / 'cases.sqlite3'))
    monkeypatch.setattr(main.config, 'DATA_DIR', tmp_path / 'customer')
    monkeypatch.setattr(main.config, 'integrations', lambda: {'email_enabled': False, 'ai_enabled': False, 'portal_enabled': False})
    monkeypatch.setenv('LIO_GAME_CARD_RECIPIENT', 'supplier@example.invalid')
    for name, value in {'SMTP_HOST': 'example.invalid', 'SMTP_FROM': 'team@example.invalid',
                        'SMTP_USERNAME': 'test', 'SMTP_PASSWORD': 'test'}.items():
        monkeypatch.setenv(name, value)
    sent = []

    class FakeSMTP:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def starttls(self, **kwargs):
            pass

        def login(self, *args):
            pass

        def send_message(self, message):
            sent.append(message)

    monkeypatch.setattr(main.smtplib, 'SMTP', FakeSMTP)
    # Deliberately no TestClient context: fixture controls the snapshot and no background sync runs.
    client = TestClient(main.app)
    yield SimpleNamespace(client=client, issue=issue, sent=sent, monkeypatch=monkeypatch)
    client.close()


def action(workflow, suffix, body=None):
    return workflow.client.post('/api/issues/game-card-shortage/' + suffix, json=body or {})


def enable_email(workflow):
    workflow.monkeypatch.setattr(main.config, 'integrations', lambda: {'email_enabled': True})


def test_approval_requires_a_current_draft(workflow):
    response = action(workflow, 'approve', {'approver': 'Test Reviewer'})
    assert response.status_code == 409
    draft = action(workflow, 'draft')
    assert draft.status_code == 200
    case = draft.json()['case']
    assert case['state'] == 'drafted'
    assert 'to' not in case['draft'] and case['draft']['has_recipient'] is True
    assert main.store.get(workflow.issue)['draft']['to'] == 'supplier@example.invalid'
    assert '37' in case['draft']['body']
    assert 'not an order' in case['draft']['body']
    assert not workflow.sent
    approved = action(workflow, 'approve', {'approver': 'Test Reviewer', 'note': 'Inquiry only'})
    assert approved.json()['case']['state'] == 'approved'
    assert any(e['kind'] == 'approved' for e in approved.json()['events'])


def test_disabled_email_never_calls_transport(workflow):
    action(workflow, 'draft')
    action(workflow, 'approve', {'approver': 'Test Reviewer'})
    assert action(workflow, 'send').status_code == 409
    assert workflow.sent == []


def test_email_requires_approval_even_when_transport_enabled(workflow):
    enable_email(workflow)
    action(workflow, 'draft')
    assert action(workflow, 'send').status_code == 409
    assert workflow.sent == []


def test_changed_evidence_invalidates_previous_approval(workflow):
    enable_email(workflow)
    action(workflow, 'draft')
    approved = action(workflow, 'approve', {'approver': 'Test Reviewer'}).json()['case']
    approved['investigation'] = {'text': 'Old model advice', 'source_fingerprint': approved['source_fingerprint']}
    main.store.save(workflow.issue['id'], approved)
    workflow.issue['shortage'] = 99
    workflow.issue['evidence'][0]['excerpt'] = 'Shipment now cancelled.'
    detail = workflow.client.get('/api/issues/game-card-shortage').json()
    assert detail['case']['source_fingerprint'] != approved['approved_fingerprint']
    assert detail['case']['state'] == 'review_required'
    assert detail['case']['draft'] is None
    assert detail['case']['approved_fingerprint'] is None
    assert not detail['case'].get('investigation')
    assert action(workflow, 'send').status_code == 409
    assert workflow.sent == []


def test_unchanged_evidence_keeps_approval_and_duplicate_send_is_blocked(workflow):
    enable_email(workflow)
    action(workflow, 'draft')
    action(workflow, 'approve', {'approver': 'Test Reviewer'})
    main.snapshot['issues'][0] = deepcopy(workflow.issue)
    assert workflow.client.get('/api/issues/game-card-shortage').json()['case']['state'] == 'approved'
    sent = action(workflow, 'send')
    assert sent.status_code == 200
    assert sent.json()['case']['state'] == 'sent'
    assert sent.json()['case']['sent_at']
    assert len(workflow.sent) == 1
    assert action(workflow, 'send').status_code == 409
    assert action(workflow, 'draft').status_code == 409
    assert len(workflow.sent) == 1


def test_changed_recipient_requires_new_review(workflow):
    enable_email(workflow)
    action(workflow, 'draft')
    action(workflow, 'approve', {'approver': 'Test Reviewer'})
    workflow.monkeypatch.setenv('LIO_GAME_CARD_RECIPIENT', 'different@example.invalid')
    assert action(workflow, 'send').status_code == 409
    assert not workflow.sent


def test_transport_failure_blocks_automatic_retry(workflow):
    enable_email(workflow)
    action(workflow, 'draft')
    action(workflow, 'approve', {'approver': 'Test Reviewer'})

    def fail(*args, **kwargs):
        raise OSError('simulated connection failure')

    workflow.monkeypatch.setattr(main.smtplib, 'SMTP', fail)
    assert action(workflow, 'send').status_code == 502
    assert workflow.client.get('/api/issues/game-card-shortage').json()['case']['state'] == 'delivery_unknown'
    assert action(workflow, 'send').status_code == 409
    assert action(workflow, 'draft').status_code == 409


def test_local_mutations_reject_foreign_origin(workflow):
    response = workflow.client.post('/api/issues/game-card-shortage/draft', json={},
                                    headers={'origin': 'https://unrelated.example.invalid'})
    assert response.status_code == 403


@pytest.mark.parametrize('path', ['../secret.txt', '/secret.txt', 'C:/secret.txt', 'folder\\secret.txt'])
def test_evidence_path_cannot_escape_customer_root(workflow, path):
    workflow.monkeypatch.setenv('LIO_EXPOSE_SOURCES', 'true')
    response = workflow.client.get('/api/evidence', params={'path': path})
    assert response.status_code == 400


def test_unknown_issue_does_not_create_case(workflow):
    assert workflow.client.post('/api/issues/missing/draft', json={}).status_code == 404


def test_approval_and_history_survive_store_reopening(workflow):
    action(workflow, 'draft')
    action(workflow, 'approve', {'approver': 'Test Reviewer'})
    previous = main.store
    workflow.monkeypatch.setattr(main, 'store', Store(previous.path))
    detail = workflow.client.get('/api/issues/game-card-shortage').json()
    assert detail['case']['state'] == 'approved'
    assert detail['case']['approver'] == 'Test Reviewer'
    assert {event['kind'] for event in detail['events']} >= {'drafted', 'approved'}
    assert {e['kind'] for e in main.store.events(workflow.issue['id'])} >= {'detected', 'drafted', 'approved'}


def test_investigation_disabled_gate_makes_no_model_call(workflow):
    def forbidden(*args, **kwargs):
        pytest.fail('Disabled AI must not call investigator')

    workflow.monkeypatch.setattr(main.investigator, 'run', forbidden)
    assert action(workflow, 'investigate').status_code == 409


def test_failed_investigation_does_not_save_completed_result(workflow):
    workflow.monkeypatch.setattr(main.config, 'integrations', lambda: {'ai_enabled': True})

    def incomplete(*args, **kwargs):
        raise ValueError('Model investigation was incomplete. No completed result was saved.')

    workflow.monkeypatch.setattr(main.investigator, 'run', incomplete)
    assert action(workflow, 'investigate').status_code == 502
    detail = workflow.client.get('/api/issues/game-card-shortage').json()
    assert not detail['case'].get('investigation')
    assert not any(event['kind'] == 'investigated' for event in detail['events'])
