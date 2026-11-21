"""Review round 2 fixes: recommended flag and headline, terms-change routing, manual-send drafts, draft approval hash, scan linking."""
from app import crew, holds, main, pricing, public
from tests.test_crew import FULL, make_data, make_issue, model_text, run, seed_world
from tests.test_crew_fix import hold_world
from tests.test_holds import make_files
from tests.test_policy import make_policy
from test_workflow import action, enable_email, workflow  # noqa: F401


def test_exactly_one_option_is_recommended_and_it_is_the_top_option(tmp_path):
    result = run(tmp_path, data=hold_world(tmp_path))
    flags = [o['recommended'] for o in result['options']]
    assert flags.count(True) == 1 and result['options'][0]['recommended'] is True and result['options'][0]['kind'] == 'release'
    shown = public.public_crew({'crew': result, 'source_fingerprint': 'x'})
    assert [o['recommended'] for o in shown['options']] == flags


def test_headline_is_short_composed_and_clean(tmp_path):
    release = run(tmp_path / 'a', data=hold_world(tmp_path / 'a'))['brief']
    assert release['headline'] == 'Release the Synthetic Supplier Ltd. hold' and len(release['headline'].split()) <= 12
    assert len(release['recommendation']) > len(release['headline'])
    only_allocation = run(tmp_path / 'b', data=make_data(tmp_path / 'b'), investigation={'text': model_text([
        {'title': 'Allocate to Collector first', 'mode': 'stock', 'quantity': 100}])})['brief']
    assert only_allocation['headline'] == 'Allocate by CPO priority and escalate'
    shown = public.public_crew({'crew': {'brief': release, 'options': []}})['brief']
    assert shown['headline'] == release['headline']


def test_terms_change_goes_to_the_exceptions_role_and_names_both_roles(tmp_path):
    result = run(tmp_path, data=hold_world(tmp_path))
    first = result['options'][0]
    assert first['approver']['role'] == 'Head of Procurement' and first['approver']['name'] == 'Dr. Hana Head'
    assert first['approver']['freight_approver']['role'] == 'Category Lead' and first['approver']['terms_approver']['role'] == 'Head of Procurement'
    assert first['approver']['note'] == 'Terms change; freight within Category Lead limit'
    assert result['brief']['approver']['role'] == 'Head of Procurement' and result['escalation']['to_role'] == 'Head of Procurement'
    body = result['escalation']['body']
    assert 'Terms change approval: Head of Procurement (Dr. Hana Head).' in body and 'Air freight approval: Category Lead (Gus Games).' in body
    shown = public.public_crew({'crew': result, 'source_fingerprint': 'x'})['options'][0]['approver']
    assert shown['note'] and shown['freight_approver']['role'] == 'Category Lead'


def test_freight_above_the_monthly_limit_outranks_the_terms_approver(tmp_path):
    over = {**FULL, 'air_freight_month_to_date_eur': {'value': 199000}}
    first = run(tmp_path, data=hold_world(tmp_path), assumptions=over)['options'][0]
    assert first['approver']['role'] == 'CPO' and first['approver']['terms_approver']['role'] == 'Head of Procurement'
    assert first['approver']['note'].startswith('Terms change goes to Head of Procurement')


def test_exceptions_role_falls_through_a_vacancy():
    policy = make_policy()
    policy.exceptions_key = 'category_lead'
    answer = crew.terms_approver(policy, "Collector's Items", '2026-11-21')           # no lead for this category in the synthetic org
    assert answer['role'] == 'Head of Procurement' and answer['vacancy'] is True and answer['name'] == 'Dr. Hana Head'
    policy.ok = False
    assert crew.terms_approver(policy, 'Game Media', '2026-11-21') is None


def hold_case(workflow, tmp_path):
    issue = seed_world(workflow, tmp_path)
    issue['material_id'] = 'CMP-1'
    hold_world(tmp_path / 'customer')
    enable_email(workflow)
    main.refresh_crew('game-card-shortage')
    return issue


def test_release_draft_is_manual_send_with_the_plain_subject_first(workflow, tmp_path):
    hold_case(workflow, tmp_path)
    case = action(workflow, 'draft').json()['case']
    draft = case['draft']
    assert draft['manual_send'] is True and draft['has_recipient'] is False
    assert draft['subject'].startswith('Held shipment') and draft['subject'].endswith('[Lio game-card-shortage]')
    assert action(workflow, 'approve', {'approver': 'Pat Planner'}).status_code == 200
    assert action(workflow, 'send').status_code == 409 and workflow.sent == []


def test_editing_the_draft_after_approval_withdraws_the_approval(workflow, tmp_path):
    hold_case(workflow, tmp_path)
    action(workflow, 'draft')
    assert action(workflow, 'approve', {'approver': 'Pat Planner'}).json()['case']['approved'] is True
    stored = main.store.get(workflow.issue)
    stored['draft']['body'] += '\nEdited after approval.'
    main.store.save('game-card-shortage', stored)
    assert workflow.client.get('/api/issues/game-card-shortage').json()['case']['approved'] is False
    assert action(workflow, 'send').status_code == 409
    assert action(workflow, 'approve', {'approver': 'Pat Planner'}).json()['case']['approved'] is True


def test_scan_is_linked_to_a_material_only_by_the_order_in_its_file_name(tmp_path):
    root = make_files(tmp_path, text=None)
    folder = root / 'suppliers/SUP-1_Synthetic_Supplier/order_confirmations'
    (folder / 'OA_4500000001.pdf').write_bytes(b'%PDF scan')
    (folder / 'packing_list_scan.pdf').write_bytes(b'%PDF scan')
    found = holds.find_holds(root, ['CMP-1'], reader=lambda path: '')
    by_material = sorted((h['material_id'] or '') for h in found)
    assert by_material == ['', 'CMP-1'] and all(h['needs_review'] for h in found)
    shown = public.public_holds(found)
    assert all(h['required_action'] == 'A person must read a scanned supplier confirmation' for h in shown)
    assert 'material_id' not in shown[0]
