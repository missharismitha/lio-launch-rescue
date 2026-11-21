"""Supplier and escalation drafts: supplier-safe facts only, internal approver routing, nothing sent."""
import re

from app import actions, public
from tests.test_policy import make_policy

ISSUE = {'id': 'game-card-shortage', 'material_id': 'CMP-1', 'title': 'Synthetic card shortage', 'shortage': 600,
         'supplier': {'name': 'Synthetic Supplier', 'contact_name': 'Pat'},
         'shipments': [{'po_number': 'PO-1', 'reference': 'WB-1', 'ordered': 1000, 'shipped': 400, 'balance': 600, 'balance_eta': '2026-11-25'}]}
OPTION = {'title': 'Fly it in', 'mode': 'air', 'quantity': 600, 'total_eur': 4200.0, 'copies_gained': 600,
          'assumptions': ['Freight of 2 EUR per unit by air is an assumption, to be confirmed.'], 'unknown': []}
BRIEF = {'recommendation': 'Ask Synthetic Supplier for 600 units by air.', 'deadline_label': 'Sun 20:00', 'verify_next': ['Confirm the arrival time']}
VALUE = {'headline_eur': 80920.0, 'label': 'product cost, not price'}
CPO = {'role': 'CPO', 'name': 'Cleo Chief', 'vacancy': False, 'why': 'Air freight is above the monthly limit.', 'route': ['CPO'], 'needs_cpo': True}
FILE_RE = re.compile(r'\.(pdf|csv|xlsx|docx|png|jpe?g|md|txt|eml)\b|@|suppliers/|soony/', re.I)


def test_supplier_draft_has_only_supplier_facing_facts():
    draft = actions.supplier_draft({**ISSUE, 'shortage': 600}, OPTION, '2026-11-22', 'to@example.invalid', 'game-card-shortage')
    body = draft['body']
    assert '600 remaining' in body and 'WB-1' in body and 'ahead of launch on 2026-11-22' in body
    assert 'please quote 600 units by air freight' in body and 'not an order' in body
    for token in ('EUR', 'CPO', 'Collector', 'priority', 'approver', 'memo', 'stock', '4,200', 'assumption'):
        assert token not in body
    assert draft['to'] == 'to@example.invalid' and draft['subject'].startswith('[Lio game-card-shortage]')


def test_supplier_draft_without_option_matches_the_legacy_text():
    body = actions.supplier_draft(ISSUE)['body']
    assert 'We need about 600 more units to reach Hamburg and be usable before launch. Could you confirm:' in body
    assert 'please quote' not in body


def test_escalation_names_the_approver_and_injects_numbers():
    draft = actions.escalation_draft(ISSUE, BRIEF, OPTION, CPO, VALUE, make_policy(), hours_left=22.5)
    assert draft['to_role'] == 'CPO' and draft['to_name'] == 'Cleo Chief'
    assert draft['subject'] == 'Decision needed within the hour: Synthetic card shortage'
    body = draft['body']
    assert 'Cost against copies gained: EUR 4,200 for 600 copies, about EUR 7 per copy gained.' in body
    assert 'Copies gained: 600.' in body and 'Deadline: Sun 20:00.' in body and 'Packing hours left: 22.5 h.' in body
    assert 'Why you: Air freight is above the monthly limit.' in body and 'assumption' in body and 'Confirm the arrival time' in body
    assert 'not sent by the application' in body
    assert {n['label'] for n in draft['numbers']} >= {'copies gained', 'cost in EUR', 'cost per copy gained in EUR'}
    assert not FILE_RE.search(body)


def test_escalation_with_unknown_price_says_so_and_never_invents_a_number():
    draft = actions.escalation_draft(ISSUE, BRIEF, {**OPTION, 'total_eur': None, 'copies_gained': None}, CPO, VALUE)
    body = draft['body']
    assert 'price unknown, assumption needed' in body and 'Cost against copies gained: cannot be worked out yet' in body
    assert 'Cost: EUR' not in body and 'per copy gained' not in body
    assert next(n for n in draft['numbers'] if n['label'] == 'cost in EUR')['value'] is None


def test_escalation_without_a_known_approver_needs_human_review():
    draft = actions.escalation_draft(ISSUE, BRIEF, OPTION, {'role': None, 'name': None, 'why': None}, VALUE)
    assert draft['to_role'] == actions.APPROVER_UNKNOWN and draft['approver_known'] is False
    assert 'human review' in draft['body']


def test_vacancy_route_is_in_the_message():
    approver = {'role': 'Head of Procurement', 'name': 'Dr. Hana Head', 'vacancy': True, 'why': 'The Category Lead is vacant.',
                'route': ['Category Lead', 'Head of Procurement'], 'needs_cpo': False}
    body = actions.escalation_draft(ISSUE, BRIEF, OPTION, approver, VALUE)['body']
    assert 'Route: Category Lead then Head of Procurement.' in body and 'vacant' in body


def test_pick_approver_takes_the_stricter_of_air_and_value():
    policy = make_policy()
    option = {'approver': {'role': 'Category Lead', 'name': 'Gus Games', 'vacancy': False, 'why': 'air', 'route': ['Category Lead'],
                           'needs_cpo': False, 'value_approver': {'role': 'Head of Procurement', 'name': 'Dr. Hana Head'}}}
    assert actions.pick_approver(option, policy)['role'] == 'Head of Procurement'
    option['approver']['value_approver'] = {'role': 'Buyer', 'name': None}
    assert actions.pick_approver(option, policy)['role'] == 'Category Lead'
    assert actions.pick_approver({}, policy)['role'] is None


def test_flag_unknown_records_an_owner_and_dedupes():
    questions = []
    first = actions.flag_unknown(questions, 'Confirm the freight rate', 'Buyer')
    actions.flag_unknown(questions, 'Confirm the freight rate', 'Buyer')
    actions.flag_unknown(questions, '', 'Buyer')
    actions.flag_unknown(questions, 'Who signs?', None)
    assert questions == [first, {'question': 'Who signs?', 'owner_role': actions.APPROVER_UNKNOWN}] and first['owner_role'] == 'Buyer'


def test_escalation_public_view_is_clean_and_unapproved_by_default():
    draft = actions.escalation_draft(ISSUE, BRIEF, OPTION, CPO, VALUE)
    shown = public.public_crew({'crew': {'escalation': draft}, 'source_fingerprint': 'f'}, 'f')['escalation']
    assert shown['approved'] is False and shown['to_role'] == 'CPO' and shown['body']
