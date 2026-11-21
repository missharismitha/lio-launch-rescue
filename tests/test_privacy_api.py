"""The browser never receives source documents, file names, paths or excerpts."""
import json
import re
from pathlib import Path

from test_workflow import workflow, action, enable_email
from app import main, labels, public

URL = '/api/issues/game-card-shortage'
# 'tool_calls' (agent counts) and 'summary' (code-composed trace sentence) are now part of the public agent contract;
# their values are still scanned for files, paths and addresses by assert_clean, and raw investigation traces stay forbidden below.
FORBIDDEN_KEYS = {'evidence', 'path', 'excerpt', 'sha256', 'text', 'model'}
FILE_RE = re.compile(r'\.(pdf|csv|xlsx|docx|png|jpe?g|md|txt|eml)\b', re.I)
INVESTIGATION = (
    '## Verdict\nNo, the cards will not all arrive in time. See `notice.pdf` for details.\n\n'
    '## Recommended action\nAsk the supplier to ship the balance by air. The memo says "the internal priority rule is binding for all editions".\n\n'
    '## Plan B options\n'
    '- **Air freight the balance** — Ask the supplier to fly the remaining cards to Hamburg this week.\n'
    '- **Ship half now** — Split the balance so part arrives before the deadline.\n'
    '- **Use another supplier for a very long short title that goes past forty characters** — Unconfirmed alternative.\n'
    '- **Fourth option** — Must be dropped.\n\n'
    '## What I verified\n- Stock is 50 (suppliers/X/notice.pdf)\n\n'
    '## Message to supplier\nPlease confirm.\n')


def seed(workflow, tmp_path=None):
    issue = workflow.issue
    issue['evidence'][0]['excerpt'] = 'SECRET-EXCERPT'
    issue['shipments'] = [{'po_number': 'PO-123', 'reference': 'WB-999', 'ordered': 100, 'shipped': 50,
                           'balance': 50, 'balance_eta': '2030-11-24'}]
    issue['supplier'] = {'name': 'Synthetic Supplier', 'contact_name': 'Pat', 'contact_email': 'secret@example.invalid'}
    issue['allocation'] = {'rule': 'Internal rule text', 'lines': [{'product_id': 'P1', 'name': 'Std', 'needed': 5, 'covered': 1, 'short': 4}]}
    main.snapshot['warnings'] = ['Conflicting advice in suppliers/X/notice.pdf']
    case = main.store.get(issue)
    case['investigation'] = {'text': INVESTIGATION, 'model': 'secret-model', 'at': '2030-01-01T00:00:00+00:00',
                             'tool_calls': [{'name': 'Read', 'arguments': {'file_path': 'suppliers/X/notice.pdf'}}],
                             'source_fingerprint': case['source_fingerprint']}
    main.store.save(issue['id'], case)
    main.store.event(issue['id'], 'agent_tool', 'Agent: Read suppliers/x/notice.pdf')
    main.store.event(issue['id'], 'approved', 'Approver wrote SECRET-NOTE here')
    main.store.event(issue['id'], 'detected', 'A synthetic supplier notice reduced supply.')
    main.agent_status.update(steps=[{'at': 'x', 'message': 'Agent: Read suppliers/x/notice.pdf'},
                                    {'at': 'y', 'message': 'Read notice.pdf'}, {'at': 'z', 'message': 'Searched all documents for "secret"'}])


def keys_of(value):
    if isinstance(value, dict):
        for k, v in value.items():
            yield k
            yield from keys_of(v)
    elif isinstance(value, list):
        for v in value:
            yield from keys_of(v)


def assert_clean(payload, allow_draft_body=False):
    payload = json.loads(json.dumps(payload))
    assert not (set(keys_of(payload)) & FORBIDDEN_KEYS)
    if allow_draft_body:
        draft = (payload.get('case') or {}).get('draft')
        if draft:
            draft['body'] = ''
    blob = json.dumps(payload)
    for token in ('SECRET-EXCERPT', 'SECRET-NOTE', 'secret-model', 'notice.pdf', 'supplier/', 'suppliers/', 'secret@example', 'Internal rule'):
        assert token not in blob
    assert not FILE_RE.search(blob)


def test_evidence_is_404_by_default_even_for_real_files(workflow, tmp_path):
    workflow.monkeypatch.delenv('LIO_EXPOSE_SOURCES', raising=False)
    folder = tmp_path / 'customer' / 'suppliers'
    folder.mkdir(parents=True)
    (folder / 'notice.pdf').write_bytes(b'%PDF-1.4 synthetic')
    assert workflow.client.get('/api/evidence', params={'path': 'suppliers/notice.pdf'}).status_code == 404
    workflow.monkeypatch.setenv('LIO_EXPOSE_SOURCES', 'false')
    assert workflow.client.get('/api/evidence', params={'path': 'suppliers/notice.pdf'}).status_code == 404


def test_evidence_with_flag_is_still_confined(workflow, tmp_path):
    folder = tmp_path / 'customer' / 'suppliers'
    folder.mkdir(parents=True)
    (folder / 'notice.pdf').write_bytes(b'%PDF-1.4 synthetic')
    workflow.monkeypatch.setenv('LIO_EXPOSE_SOURCES', 'true')
    assert workflow.client.get('/api/evidence', params={'path': 'suppliers/notice.pdf'}).status_code == 200
    assert workflow.client.get('/api/evidence', params={'path': '../notice.pdf'}).status_code == 400


def test_overview_and_detail_expose_no_documents(workflow):
    seed(workflow)
    action(workflow, 'draft')
    overview = workflow.client.get('/api/overview').json()
    detail = workflow.client.get(URL).json()
    assert_clean(overview)
    assert_clean(detail, allow_draft_body=True)
    assert 'warnings' not in overview and 'inbox' not in overview
    assert set(overview['agent']) == {'running', 'state', 'steps', 'error', 'last_run'}
    assert overview['agent']['steps'] and all(s['message'] in labels.GENERIC for s in overview['agent']['steps'])


def test_po_and_waybill_only_inside_draft_body(workflow):
    seed(workflow)
    detail = action(workflow, 'draft').json()
    draft = detail['case']['draft']
    assert 'to' not in draft and set(draft) == {'subject', 'body', 'has_recipient', 'manual_send'}
    assert 'PO-123' in draft['body'] and 'WB-999' in draft['body']
    draft_free = json.loads(json.dumps(detail))
    draft_free['case']['draft']['body'] = ''
    blob = json.dumps(draft_free)
    assert 'PO-123' not in blob and 'WB-999' not in blob
    assert detail['shipments'] == [{'ordered': 100, 'shipped': 50, 'balance': 50, 'balance_eta': '2030-11-24'}]
    assert detail['supplier'] == {'name': 'Synthetic Supplier'}
    assert detail['allocation'] == {'lines': [{'product_id': 'P1', 'name': 'Std', 'short': 4}]}


def test_every_post_response_is_clean(workflow):
    seed(workflow)
    workflow.monkeypatch.setattr(main, 'refresh', lambda sync=False: main.overview())
    for response in (action(workflow, 'draft'), action(workflow, 'approve', {'approver': 'Test Reviewer', 'note': 'SECRET-NOTE'}),
                     workflow.client.post('/api/refresh')):
        assert response.status_code == 200
        assert_clean(response.json(), allow_draft_body=True)


def test_public_investigation_shape():
    result = public.public_investigation({'text': INVESTIGATION, 'model': 'm', 'tool_calls': [1], 'at': 'T'})
    assert set(result) == {'verdict', 'action', 'options', 'at'} and result['at'] == 'T'
    blob = json.dumps(result)
    assert 'notice.pdf' not in blob and '`' not in blob and 'internal priority' not in blob
    assert 'Stock is 50' not in blob and 'What I verified' not in blob
    assert len(result['options']) == 3
    assert all(len(o['title']) <= 40 and len(o['detail']) <= 90 for o in result['options'])
    assert result['options'][0] == {'title': 'Air freight the balance', 'detail': 'Ask the supplier to fly the remaining cards to Hamburg this week.'}
    assert len(result['verdict']) <= 160 and len(result['action']) <= 200


def test_public_investigation_is_robust():
    assert public.public_investigation(None) is None
    assert public.public_investigation({}) == {'verdict': '', 'action': '', 'options': [], 'at': None}
    legacy = public.public_investigation({'text': 'Intro.\nRecommended next action: Call the supplier today.'})
    assert legacy['action'] == 'Call the supplier today.' and legacy['options'] == []


def test_scrub_removes_files_paths_quotes_and_backticks():
    text = 'Keep this. Read `suppliers/X/notice.pdf` now. He said "this is a long internal quote text" ok. Short "two words" stays.'
    out = public.scrub(text)
    assert 'notice' not in out and 'internal quote' not in out and '`' not in out
    assert 'Keep this.' in out and '"two words"' in out
    assert public.scrub('word ' * 100, 40).endswith('…') and len(public.scrub('word ' * 100, 40)) <= 40


def test_events_are_generic_and_hide_notes(workflow):
    seed(workflow)
    events = workflow.client.get(URL).json()['events']
    kinds = {e['kind'] for e in events}
    assert 'detected' not in kinds
    messages = {e['message'] for e in events}
    assert 'Checked a record' in messages and 'Approved' in messages
    assert all(set(e) == {'at', 'kind', 'message'} for e in events)
    assert 'SECRET-NOTE' not in json.dumps(events)


def test_step_labels_are_generic():
    for name, args in [('Read', {'file_path': 'suppliers/X/contracts/secret.pdf'}), ('Grep', {'pattern': 'SECRET'}),
                       ('Glob', {'pattern': '**/*.pdf'}), ('search_documents', {'query': 'SECRET'}),
                       ('read_document', {'path': 'soony/erp/stock_snapshot.csv'}), ('get_current_issue', {}),
                       ('Read', {'file_path': 'policies/approval.pdf'}), ('Read', {'file_path': 'soony/context/launch_plan.xlsx'}),
                       ('Read', {'file_path': 'suppliers/X/notice.pdf'}), ('Mystery', {'x': 'SECRET'})]:
        label = labels.step_label(name, args)
        assert label in labels.GENERIC
    assert labels.step_label('Read', {'file_path': 'suppliers/X/notice.pdf'}) == 'Read a supplier notice'
    assert labels.step_label('Read', {'file_path': 'suppliers/X/contracts/c.pdf'}) == 'Checked a supplier contract'


def test_ui_source_has_no_document_links():
    # The built bundle carries React internals, so it is only scanned for document-link text.
    static = Path(main.__file__).parent / 'static'
    built = ''.join(p.read_text(encoding='utf-8') for p in static.rglob('*') if p.suffix in ('.js', '.html', '.css') and 'vendor' not in p.parts)
    for token in ('/api/evidence', 'Where this comes from'):
        assert token not in built
    src = Path(main.__file__).parent.parent / 'frontend' / 'src'
    source = ''.join(p.read_text(encoding='utf-8') for p in src.rglob('*') if p.suffix in ('.ts', '.tsx', '.css') and 'test' not in p.parts)
    assert source
    for token in ('dangerouslySetInnerHTML', 'innerHTML', '"Open"', '.sources', '/api/evidence'):
        assert token not in source
    assert not re.search(r'(amber|orange|violet|purple|periwinkle)', source, re.I)
    assert not re.search(r'#8b8dff|#4a4dd1', source, re.I)
    assert not re.search(r'#8b8dff|#4a4dd1', built, re.I)


def test_security_headers_on_api_ui_and_login(workflow):
    for path in ('/api/overview', '/', '/login'):
        response = workflow.client.get(path, follow_redirects=False)
        assert response.headers['x-content-type-options'] == 'nosniff'
        assert response.headers['x-frame-options'] == 'DENY'
        assert response.headers['referrer-policy'] == 'no-referrer'
        assert response.headers['cache-control'] == 'no-store'
        assert 'camera=()' in response.headers['permissions-policy']
        assert "frame-ancestors 'none'" in response.headers['content-security-policy']
        assert "script-src 'self'" in response.headers['content-security-policy']


def test_approval_gate_unchanged_through_public_projection(workflow):
    seed(workflow)
    enable_email(workflow)
    assert action(workflow, 'send').status_code == 409                       # nothing drafted
    drafted = action(workflow, 'draft').json()
    assert drafted['case']['approved'] is False
    assert action(workflow, 'send').status_code == 409                       # drafted, not approved
    approved = action(workflow, 'approve', {'approver': 'Test Reviewer'}).json()
    assert approved['case']['approved'] is True and approved['case']['approver'] == 'Test Reviewer'
    assert workflow.sent == []
    sent = action(workflow, 'send')
    assert sent.status_code == 200 and sent.json()['case']['state'] == 'sent'
    assert len(workflow.sent) == 1


def test_email_off_blocks_send_after_approval(workflow):
    action(workflow, 'draft')
    action(workflow, 'approve', {'approver': 'Test Reviewer'})
    assert action(workflow, 'send').status_code == 409 and workflow.sent == []


def test_stale_source_clears_public_approved_flag(workflow):
    action(workflow, 'draft')
    assert action(workflow, 'approve', {'approver': 'Test Reviewer'}).json()['case']['approved'] is True
    workflow.issue['shortage'] = 99
    case = workflow.client.get(URL).json()['case']
    assert case['approved'] is False and case['draft'] is None


def test_headings_with_echoed_prompt_hints_still_parse():
    from app import public
    text = ('## Verdict (will Soony make Sunday: yes/no/unknown, one sentence)\n\nNo, the gap stays open.\n\n'
            '## Recommended action (one sentence)\n\nAsk the supplier today.\n\n'
            '## Plan B options (max 3)\n\n- **Protect first edition** — Give it the cards first.\n')
    out = public.public_investigation({'text': text, 'at': 'x'})
    assert out['verdict'] == 'No, the gap stays open.'
    assert out['action'] == 'Ask the supplier today.'
    assert out['options'][0]['title'] == 'Protect first edition'
