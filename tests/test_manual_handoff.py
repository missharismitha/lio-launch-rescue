"""Hand-off for sending by hand: only after approval, never sends, never claims delivery, address stays server-side."""
from app import main
from tests.test_workflow import action, workflow  # noqa: F401  (fixture re-exported for pytest)

TO = 'supplier@example.invalid'


def approved(workflow):
    assert action(workflow, 'draft').status_code == 200
    assert action(workflow, 'approve', {'approver': 'Test Reviewer'}).status_code == 200


def get_handoff(workflow):
    return workflow.client.get('/api/issues/game-card-shortage/handoff')


def test_handoff_is_refused_before_approval(workflow):
    assert get_handoff(workflow).status_code == 409
    action(workflow, 'draft')
    assert get_handoff(workflow).status_code == 409


def test_handoff_returns_the_approved_text_and_never_caches(workflow):
    approved(workflow)
    response = get_handoff(workflow)
    assert response.status_code == 200 and response.headers['cache-control'] == 'no-store'
    data = response.json()
    assert data['to'] == TO and data['subject'].startswith('[Lio game-card-shortage]') and 'not an order' in data['body']
    assert not workflow.sent


def test_the_address_never_appears_in_the_normal_public_response(workflow):
    approved(workflow)
    detail = workflow.client.get('/api/issues/game-card-shortage').text
    assert TO not in detail and 'supplier@' not in detail


def test_changed_evidence_voids_the_handoff(workflow):
    approved(workflow)
    workflow.issue['incoming'] = 14
    assert get_handoff(workflow).status_code == 409
    assert action(workflow, 'mark-sent', {'sent_by': 'Test Sender'}).status_code == 409


def test_mark_sent_needs_a_name_and_records_without_claiming_delivery(workflow):
    approved(workflow)
    assert action(workflow, 'mark-sent', {'sent_by': 'x'}).status_code == 422
    assert action(workflow, 'mark-sent', {}).status_code == 422
    response = action(workflow, 'mark-sent', {'sent_by': 'Test Sender'})
    assert response.status_code == 200
    case = response.json()['case']
    assert case['state'] == 'sent' and case['sent_at'] and case['sent_manually'] is True
    event = main.store.events('game-card-shortage')[0]
    assert event['kind'] == 'sent_manually' or 'by hand' in str(event)
    assert 'not confirmed' in str(event) and not workflow.sent


def test_sent_inquiry_cannot_be_handed_off_or_marked_again(workflow):
    approved(workflow)
    assert action(workflow, 'mark-sent', {'sent_by': 'Test Sender'}).status_code == 200
    assert get_handoff(workflow).status_code == 409
    assert action(workflow, 'mark-sent', {'sent_by': 'Test Sender'}).status_code == 409


def test_unapproved_draft_cannot_be_marked_sent(workflow):
    action(workflow, 'draft')
    assert action(workflow, 'mark-sent', {'sent_by': 'Test Sender'}).status_code == 409


def test_release_draft_address_comes_from_the_supplier_profile(workflow, tmp_path):
    folder = tmp_path / 'customer' / 'suppliers' / 'SUP-9_Held'
    folder.mkdir(parents=True)
    (folder / 'profile.csv').write_text('supplier_id,name,legal_name,contact_email\nSUP-9,Held Supplier,Held Supplier Ltd.,held@example.invalid\n',
                                        encoding='utf-8')
    action(workflow, 'draft')
    case = main.store.get(workflow.issue)
    case['draft'] = {'to': '', 'subject': 'Held shipment [Lio game-card-shortage]', 'body': 'Hello', 'manual_send': True}
    case['crew'] = {'source_fingerprint': case['source_fingerprint'], 'supplier_drafts': [{'supplier': 'Held Supplier Ltd.'}]}
    main.store.save('game-card-shortage', case)
    assert action(workflow, 'approve', {'approver': 'Test Reviewer'}).status_code == 200
    assert get_handoff(workflow).json()['to'] == 'held@example.invalid'


def test_unknown_release_supplier_gives_an_empty_address_not_a_guess(workflow):
    action(workflow, 'draft')
    case = main.store.get(workflow.issue)
    case['draft'] = {'to': '', 'subject': 'Held shipment [Lio game-card-shortage]', 'body': 'Hello', 'manual_send': True}
    case['crew'] = {'source_fingerprint': case['source_fingerprint'], 'supplier_drafts': [{'supplier': 'Nobody Ltd.'}]}
    main.store.save('game-card-shortage', case)
    assert action(workflow, 'approve', {'approver': 'Test Reviewer'}).status_code == 200
    assert get_handoff(workflow).json()['to'] == ''


def gmail_style_reply(subject='Re: [Lio game-card-shortage] Launch supply verification', sender='"Pat Supplier" <supplier@example.invalid>', html_only=False):
    from email.message import EmailMessage
    message = EmailMessage()
    message['From'], message['To'], message['Subject'] = sender, 'team@example.invalid', subject
    message['Message-ID'] = '<reply-1@example.invalid>'
    if html_only:
        message.set_content('<p>Available quantity: 5000</p>', subtype='html')
    else:
        message.set_content('Available quantity: 5000\nEarliest delivery: 2026-11-23\n\nOn Sat, the team wrote:\n> We need more units.')
        message.add_alternative('<p>Available quantity: 5000</p>', subtype='html')
    return message.as_bytes()


def import_eml(workflow, raw):
    return workflow.client.post('/api/issues/game-card-shortage/replies/import', content=raw, headers={'Content-Type': 'message/rfc822'})


def test_a_gmail_style_eml_reply_imports_and_still_needs_review(workflow):
    approved(workflow)
    assert action(workflow, 'mark-sent', {'sent_by': 'Test Sender'}).status_code == 200
    raw = gmail_style_reply()
    response = import_eml(workflow, raw)
    assert response.status_code == 200, response.text
    data = response.json()
    assert len(data['replies']) == 1 and data['case']['state'] == 'reply_review_required' and data['case']['approved'] is False
    again = import_eml(workflow, raw)  # the same downloaded file twice is deduplicated
    assert again.status_code == 200 and len(again.json()['replies']) == 1
    changed = import_eml(workflow, gmail_style_reply())  # same Message-ID, different bytes: refused, not merged
    assert changed.status_code == 400 and 'different content' in changed.json()['detail']


def test_eml_import_rejects_wrong_sender_missing_tag_and_html_only_with_a_clear_message(workflow):
    approved(workflow)
    wrong = import_eml(workflow, gmail_style_reply(sender='"Someone" <other@example.invalid>'))
    assert wrong.status_code == 400 and 'sender' in wrong.json()['detail'].lower()
    untagged = import_eml(workflow, gmail_style_reply(subject='Re: your inquiry'))
    assert untagged.status_code == 400 and 'case tag' in untagged.json()['detail']
    html = import_eml(workflow, gmail_style_reply(html_only=True))
    assert html.status_code == 400 and 'text/plain' in html.json()['detail']
