"""Policy parsing and approver routing on synthetic text. Private data is not required."""
from pathlib import Path

import pytest

from app import policy as pol

POLICY_TEXT = """Acme PP-01 Approval policy
1. Purpose
This policy defines who may approve purchase orders.
2. Approval limits by value (per PO, in EUR)
Role
Limit per PO
Buyer
< 50,000
Category Lead
< 500,000
Head of Procurement
< 2,000,000
Chief Procurement Officer
< 5,000,000
CPO and CFO jointly
≥ 5,000,000
3. Receiving site
POs delivered to a site require a booked dock slot released by the site lead.
Site
Site lead
Deputy
DC-XYZ Town
Ada Lead
Bo Deputy
4. Air freight
Unplanned air freight up to EUR 200,000 per calendar month and category is approved by the responsible
Category Lead. Above that, approval by the CPO is required before booking.
5. New suppliers
Something else.
6. Exceptions
Exceptions must be documented and approved by the Head of Procurement.
"""

ORG_TEXT = """Acme Procurement organisation (v2, 2026-11-21)
Internal.
Cleo Chief
Chief Procurement Officer
Dr. Hana Head
Head of Procurement
Gus Games
Category Lead Game Media
TBD
Category Lead Collector's Items
Pia Print
Category Lead Print & Packaging
Also: Nils IT (IT Lead), Fred Finance (Chief Financial Officer)
"""

COLLECTORS = "Collector's Items"


def make_policy(org_text=ORG_TEXT):
    policy = pol.parse_policy_text(POLICY_TEXT)
    policy.org = pol.parse_org_text(org_text)
    policy.org['notes_vacant_categories'] = []
    return policy


def test_policy_parses_tiers_air_dock_exceptions():
    policy = pol.parse_policy_text(POLICY_TEXT)
    assert policy.ok, policy.problems
    assert [t['role'] for t in policy.tiers] == ['Buyer', 'Category Lead', 'Head of Procurement', 'CPO', 'CPO and CFO jointly']
    assert [t['upper_eur'] for t in policy.tiers] == [50000.0, 500000.0, 2000000.0, 5000000.0, None]
    assert policy.air_limit_eur == 200000.0
    assert (policy.air_below_key, policy.air_above_key) == ('category_lead', 'cpo')
    assert policy.exceptions_key == 'head_of_procurement'
    assert pol.dock_slot_owner(policy, 'DC-XYZ') == {'site': 'DC-XYZ', 'lead': 'Ada Lead', 'deputy': 'Bo Deputy'}
    assert pol.dock_slot_owner(policy, 'DC-NONE') is None


@pytest.mark.parametrize('value,role', [
    (49999, 'Buyer'), (50000, 'Category Lead'), (499999, 'Category Lead'), (500000, 'Head of Procurement'),
    (1999999, 'Head of Procurement'), (2000000, 'CPO'), (4999999, 'CPO'), (5000000, 'CPO and CFO jointly'),
    (9000000, 'CPO and CFO jointly')])
def test_tier_boundaries_are_exclusive_upper_bounds(value, role):
    answer = pol.required_approver(make_policy(), value, 'po', 'Game Media', as_of='2026-11-21')
    assert answer['role'] == role and answer['vacancy'] is False


def test_names_and_joint_approval():
    policy = make_policy()
    assert pol.required_approver(policy, 60000, 'po', 'Game Media')['name'] == 'Gus Games'
    assert pol.required_approver(policy, 600000, 'po')['name'] == 'Dr. Hana Head'
    joint = pol.required_approver(policy, 5000000, 'po')
    assert joint['name'] == 'Cleo Chief and Fred Finance' and joint['needs_cpo'] is True
    assert pol.required_approver(policy, 4999999, 'po')['needs_cpo'] is True
    assert pol.required_approver(policy, 100, 'po')['needs_cpo'] is False


def test_air_freight_limit_and_month_to_date():
    policy = make_policy()
    low = pol.required_approver(policy, 199000, 'air_freight', 'Game Media')
    assert low['role'] == 'Category Lead' and low['needs_cpo'] is False
    assert pol.required_approver(policy, 200000, 'air_freight', 'Game Media')['role'] == 'Category Lead'
    high = pol.required_approver(policy, 201000, 'air_freight', 'Game Media')
    assert high['role'] == 'CPO' and high['needs_cpo'] is True
    cumulative = pol.required_approver(policy, 60000, 'air_freight', 'Game Media', month_to_date_air_eur=150000)
    assert cumulative['role'] == 'CPO' and cumulative['needs_cpo'] is True
    within = pol.required_approver(policy, 60000, 'air_freight', 'Game Media', month_to_date_air_eur=100000)
    assert within['role'] == 'Category Lead'


def test_vacant_category_lead_routes_up_and_says_why():
    policy = make_policy()
    answer = pol.required_approver(policy, 60000, 'po', COLLECTORS, as_of='2026-11-21')
    assert answer['vacancy'] is True and answer['role'] == 'Head of Procurement' and answer['name'] == 'Dr. Hana Head'
    assert answer['route'] == ['Category Lead', 'Head of Procurement']
    assert 'vacant' in answer['why'].lower()
    air = pol.required_approver(policy, 1000, 'air_freight', COLLECTORS)
    assert air['vacancy'] is True and air['role'] == 'Head of Procurement'
    # a value that needs a higher tier anyway is not a vacancy
    assert pol.required_approver(policy, 600000, 'po', COLLECTORS)['vacancy'] is False


def test_lead_starting_later_is_vacant_until_start_date():
    policy = make_policy(ORG_TEXT.replace('TBD', 'New Lead (from 2026-11-23)'))
    before = pol.required_approver(policy, 60000, 'po', COLLECTORS, as_of='2026-11-22')
    after = pol.required_approver(policy, 60000, 'po', COLLECTORS, as_of='2026-11-23')
    assert before['vacancy'] is True and before['role'] == 'Head of Procurement'
    assert after['vacancy'] is False and after['name'] == 'New Lead'


def test_notes_vacancy_is_used_when_chart_is_silent():
    text = 'The Category Lead for Rare Things left in the summer. The position is open.'
    assert pol.parse_notes_vacancies(text) == ['Rare Things']
    policy = make_policy()
    policy.org['notes_vacant_categories'] = ['Rare Things']
    assert pol.required_approver(policy, 60000, 'po', 'Rare Things')['vacancy'] is True


def test_unknown_value_never_guesses():
    answer = pol.required_approver(make_policy(), None, 'po')
    assert answer['role'] is None and answer['route'] == []


@pytest.mark.parametrize('text', ['', 'nothing useful here', '2. Approval limits\nBuyer\n< 50,000\n'])
def test_garbage_text_is_not_ok(text):
    policy = pol.parse_policy_text(text)
    assert policy.ok is False and policy.problems
    with pytest.raises(pol.PolicyParseError):
        pol.required_approver(policy, 10, 'po')
    with pytest.raises(pol.PolicyParseError):
        pol.dock_slot_owner(policy)


def test_descending_limits_rejected():
    assert pol.parse_policy_text(POLICY_TEXT.replace('< 500,000', '< 40,000')).ok is False


def test_missing_data_dir_fails_closed(tmp_path):
    policy = pol.load_policy(tmp_path / 'absent')
    assert policy.ok is False and 'human review' in policy.problems[0]


REAL = Path(__file__).resolve().parent.parent / 'data' / 'soony-data'


@pytest.mark.skipif(not (REAL / 'soony/context').is_dir(), reason='private customer data not present')
def test_real_policy_parses():
    policy = pol.load_policy(REAL)
    assert policy.ok is True, policy.problems
