"""Synthetic end-to-end reply processing, no live email or provider calls."""
from email.message import EmailMessage
from datetime import datetime
import pytest
from test_workflow import workflow
from app import main
from app.mailbox import candidates
from app.recovery import aware, packing_hours, scenario
from tests.test_policy import make_policy


def email(sender='supplier@example.invalid', tag='game-card-shortage', message_id='<reply-1@example.invalid>', body=None):
    message = EmailMessage()
    message['From'] = sender
    message['Subject'] = f'Re: [Lio {tag}] Supply verification'
    message['Message-ID'] = message_id
    message.set_content(body or 'Available quantity: 40\nWarehouse arrival: 2030-11-24T10:00:00+01:00\nTotal cost EUR: 1200.50\n')
    return message.as_bytes()


def ingest(w, raw=None):
    return w.client.post('/api/issues/game-card-shortage/replies/import', content=raw or email(), headers={'Content-Type': 'message/rfc822'})


def review(w, message_id, **changes):
    payload = {'message_id': message_id, 'reviewer': 'Test Reviewer', 'quantity': 40,
               'arrival_at': '2030-11-24T10:00:00+01:00', 'cost_eur': 1200.50, 'note': 'Checked original supplier message and transport assumptions.'}
    payload.update(changes)
    return w.client.post('/api/issues/game-card-shortage/replies/review', json=payload)


def test_reply_to_reviewed_offer_keeps_stock_unchanged(workflow):
    main.snapshot.update(products=[{'id': 'FG-TEST', 'name': 'Synthetic edition', 'remaining': 100, 'rate_per_hour': 10}], launch_date='2030-11-24')
    workflow.issue['affected_products'] = ['FG-TEST']
    response = ingest(workflow)
    assert response.status_code == 200
    detail = response.json()
    assert detail['case']['state'] == 'reply_review_required'
    reply = detail['replies'][0]
    assert set(reply) == {'id', 'received_at', 'source_fingerprint', 'simulated'}
    assert reply['simulated'] is False
    stored = main.current_inbox().list('game-card-shortage')[0]
    assert stored['identity_verified'] is False
    assert stored['candidates']['quantity'] == 40
    assert detail['usable_stock'] == 50
    updated = review(workflow, reply['id'])
    assert updated.status_code == 200
    detail = updated.json()
    assert detail['shortage'] == 37
    offer = main.store.get(workflow.issue)['recovery_offer']
    assert 'recovery_offer' not in detail['case']
    assert offer['component_gap_after_offer'] == 0
    assert offer['packing_scenarios'][0]['maximum_additional_units'] == 37
    assert detail['case']['state'] == 'offer_reviewed'
    assert workflow.sent == []


def test_reply_deduplicates_and_rejects_changed_message_id(workflow):
    assert ingest(workflow).status_code == 200
    assert len(ingest(workflow).json()['replies']) == 1
    assert ingest(workflow, email(body='Changed content')).status_code == 400


@pytest.mark.parametrize('raw', [email(sender='other@example.invalid'), email(tag='other-case')])
def test_sender_and_case_tag_required(workflow, raw):
    assert ingest(workflow, raw).status_code == 400
    assert not main.current_inbox().list('game-card-shortage')


def test_old_evidence_reply_cannot_be_applied(workflow):
    reply = ingest(workflow).json()['replies'][0]
    workflow.issue['shortage'] = 70
    assert review(workflow, reply['id']).status_code == 409


def test_naive_timezone_rejected(workflow):
    main.snapshot.update(products=[], launch_date='2030-11-24')
    reply = ingest(workflow).json()['replies'][0]
    assert review(workflow, reply['id'], arrival_at='2030-11-24T10:00:00').status_code == 422


def test_unconfigured_sender_rejects_import(workflow):
    workflow.monkeypatch.delenv('LIO_GAME_CARD_RECIPIENT')
    assert ingest(workflow).status_code == 400


def test_candidates_ignore_quoted_and_unlabelled_claims():
    assert candidates('We might have 50,000 units.\n> Available quantity: 50,000\n') == {}
    assert candidates('Available quantity: 23\nOn Monday someone wrote:\nAvailable quantity: 900')['quantity'] == 23


def test_shift_calculator_excludes_night_and_past_hours():
    assert packing_hours(aware('2030-11-23T21:00+01:00'), aware('2030-11-24T20:00+01:00')) == 15
    issue = {'shortage': 1000, 'affected_products': ['CE']}
    products = [{'id': 'CE', 'name': 'CE', 'remaining': 2000, 'rate_per_hour': 100}]
    plan = scenario(issue, products, '2030-11-24', 1000, '2030-11-23T10:00+01:00', 50000,
                    as_of=aware('2030-11-24T19:00+01:00'), policy=make_policy())
    assert plan['packing_scenarios'][0]['maximum_additional_units'] == 100
    assert plan['value_approver'] == 'Category Lead'          # from the (synthetic) approval policy
    unknown = scenario(issue, products, '2030-11-24', 1000, '2030-11-23T10:00+01:00', 50000, as_of=aware('2030-11-24T19:00+01:00'))
    assert unknown['value_approver'] == 'Approver to be confirmed by a person'
    assert 'PP-07' not in str(plan['constraints'])
    late = scenario(issue, products, '2030-11-24', 1000, '2030-11-24T21:00+01:00', 100,
                    as_of=aware('2030-11-23T12:00+01:00'))
    assert late['component_gap_after_offer'] == 1000
    assert late['packing_scenarios'][0]['maximum_additional_units'] == 0


def test_no_reply_or_review_can_send_a_message(workflow):
    ingest(workflow)
    assert workflow.client.post('/api/issues/game-card-shortage/send', json={}).status_code == 409
    assert workflow.sent == []


def test_reply_cannot_reset_a_sent_case_into_duplicate_sending(workflow):
    case = main.store.get(workflow.issue)
    case.update(state='sent', sent_at='2030-11-20T12:00:00+00:00')
    main.store.save(workflow.issue['id'], case)
    ingest(workflow)
    assert workflow.client.post('/api/issues/game-card-shortage/draft', json={}).status_code == 409
    assert workflow.client.post('/api/issues/game-card-shortage/send', json={}).status_code == 409
    assert workflow.sent == []


def test_source_change_preserves_ambiguous_delivery_guard(workflow):
    case = main.store.get(workflow.issue)
    case.update(state='delivery_unknown')
    main.store.save(workflow.issue['id'], case)
    workflow.issue['shortage'] = 500
    assert workflow.client.post('/api/issues/game-card-shortage/draft', json={}).status_code == 409


def test_simulated_header_is_flagged_and_profile_contact_is_expected_sender(workflow, monkeypatch):
    monkeypatch.delenv('LIO_GAME_CARD_RECIPIENT', raising=False)       # no override: fall back to the profile contact
    workflow.issue['supplier'] = {'name': 'Synthetic supplier', 'contact_email': 'contact@example.invalid'}
    raw = email(sender='contact@example.invalid').replace(b'Subject:', b'X-Lio-Simulated: yes\r\nSubject:', 1)
    response = ingest(workflow, raw)
    assert response.status_code == 200
    assert response.json()['replies'][0]['simulated'] is True
    # A sender that is not the profile contact is still refused.
    other = ingest(workflow, email(sender='someone@example.invalid', message_id='<other@example.invalid>'))
    assert other.status_code == 400
