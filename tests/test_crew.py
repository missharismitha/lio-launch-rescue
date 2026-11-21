"""Agent crew on synthetic data: order, vocabulary, degradation, deterministic mode, routing, no sends."""
import json
import re
from datetime import datetime
from types import SimpleNamespace

import pytest

from app import actions, crew, labels, pricing, public, verify
from app import policy as pol
from app.recovery import BERLIN
from tests.test_policy import make_policy

PO_HEADER = 'po_number,po_line,supplier_id,material_id,plant,quantity,unit_price,currency,order_date,requested_date,promised_date,actual_delivery_date,status,buyer,incoterm,note\n'
NOW = datetime(2026, 11, 21, 8, 0, tzinfo=BERLIN)       # Saturday morning, synthetic
FULL = {'fx_to_eur': {'USD': 0.5}, 'freight_eur_per_unit_by_mode': {'air': 2.0, 'sea': 0.1, 'road': 0.5}}
ROLE_ORDER = ['Reconciler', 'Investigator', 'Allocation Planner', 'Pricer', 'Policy Officer', 'Approver-Router',
              'Checker', 'Drafter', 'Checker']


def make_data(tmp_path, category='Game Media', price='10.0'):
    erp = tmp_path / 'soony/erp'
    erp.mkdir(parents=True, exist_ok=True)
    line = f'1,1,SUP-1,CMP-1,DC,1000,{price},USD,2026-09-01,2026-11-21,2026-11-21,,open,B,FOB,\n' if price else ''
    (erp / 'purchase_orders_2025H2-2026.csv').write_text(PO_HEADER + line, encoding='utf-8')
    master = tmp_path / 'soony/master'
    master.mkdir(parents=True, exist_ok=True)
    (master / 'components.csv').write_text(f'component_id,description,category\nCMP-1,Card,"{category}"\n', encoding='utf-8')
    return tmp_path


def make_issue():
    return {'id': 'game-card-shortage', 'material_id': 'CMP-1', 'title': 'Synthetic card shortage', 'summary': 'Synthetic.',
            'shortage': 600, 'required': 1000, 'usable_stock': 300, 'incoming': 100,
            'supplier': {'name': 'Synthetic Supplier', 'contact_name': 'Pat'},
            'shipments': [{'po_number': '1', 'reference': 'WB-1', 'ordered': 1000, 'shipped': 400, 'balance': 600, 'balance_eta': '2026-11-25'}],
            'allocation': {'rule': 'internal', 'lines': [
                {'product_id': 'P-CE', 'name': 'Collector', 'needed': 100, 'covered': 100, 'short': 0},
                {'product_id': 'P-STD', 'name': 'Standard', 'needed': 900, 'covered': 300, 'short': 600}]},
            'affected_products': ['P-CE', 'P-STD'],
            'evidence': [{'path': 'suppliers/X/notice.pdf', 'label': 'Notice', 'excerpt': 'SECRET-EXCERPT'}]}


def make_products():
    return [{'id': 'P-CE', 'name': 'Collector', 'target': 200, 'packed': 100, 'remaining': 100, 'rate_per_hour': 50, 'hours_available': 20},
            {'id': 'P-STD', 'name': 'Standard', 'target': 1000, 'packed': 100, 'remaining': 900, 'rate_per_hour': 100, 'hours_available': 20}]


def model_text(options):
    return ('## Verdict\nNo.\n\n## Recommended action\nAsk the supplier.\n\n## Plan B options\n- **x** — y\n\n'
            '```json\n' + json.dumps({'options': options}) + '\n```\n')


def run(tmp_path, issue=None, assumptions=FULL, policy=None, data=None, investigation=None, investigate=None, hours=20, now=NOW):
    data = data or make_data(tmp_path)
    return crew.run('game-card-shortage', issue or make_issue(), make_products(), hours, data, tmp_path / 'state',
                    investigation=investigation, investigate=investigate, policy=policy or make_policy(), assumptions=assumptions,
                    now=now, launch='2026-11-22')


def model_entry(result):
    return [e for e in result['trace'] if e['agent'] == 'Investigator'][-1]


def test_crew_order_and_fixed_trace_vocabulary(tmp_path):
    result = run(tmp_path)
    agents = [e['agent'] for e in result['trace']]
    collapsed = [a for i, a in enumerate(agents) if i == 0 or a != agents[i - 1]]
    assert collapsed[:6] == ROLE_ORDER[:6]
    assert agents.index('Drafter') > agents.index('Approver-Router') and agents[-1] == 'Checker'
    for entry in result['trace']:
        assert entry['agent'] in labels.TRACE_AGENTS and entry['outcome'] in labels.TRACE_OUTCOMES
        assert entry['autonomy'] in labels.TRACE_AUTONOMY and entry['action'] in labels.TRACE_ACTIONS[entry['agent']]
        assert entry['at']
    assert {e['autonomy'] for e in result['trace']} == {'auto', 'draft', 'approval', 'never'}
    assert crew.AUTONOMY_LADDER == {'read': 'auto', 'compute': 'auto', 'draft': 'draft', 'send': 'approval', 'spend': 'approval',
                                    'book': 'never', 'pay': 'never'}


def test_deterministic_mode_builds_options_prices_brief_and_both_drafts(tmp_path):
    result = run(tmp_path)
    assert result['mode'] == 'deterministic'
    investigator = model_entry(result)
    assert investigator['action'] == 'Built recovery options from the records (no model)' and investigator['outcome'] == 'done'
    air = result['options'][0]
    assert air['mode'] == 'air' and air['quantity'] == 600 and air['supplier'] == 'Synthetic Supplier'
    assert air['price_eur'] == 4200.0                    # 600 * 10 USD * 0.5 + 600 * 2 freight
    assert air['eta'] is None and air['feasible'] == 'unknown' and air['copies_gained'] is None
    assert result['options'][-1]['title'] == crew.ALLOCATE_TITLE              # nothing feasible: allocate and escalate
    assert result['brief']['recommendation'] and result['brief']['confidence'] in ('low', 'medium', 'high')
    assert result['supplier_draft']['body'] and result['escalation']['body']
    assert result['value']['headline_eur'] is None or result['value']['headline_eur'] >= 0
    assert result['numbers_verified'] is True


def test_unknown_price_stays_null_and_never_a_number(tmp_path):
    result = run(tmp_path, data=make_data(tmp_path, price=''))
    air = result['options'][0]
    assert air['price_eur'] is None and air['total_eur'] is None
    assert any('Unit price' in u for u in air['unknown'])
    body = result['escalation']['body']
    assert 'price unknown, assumption needed' in body or 'Goods cost: not known yet.' in body
    assert 'Cost: EUR' not in body and 'Total cost' not in body
    shown = public.public_crew({'crew': result, 'source_fingerprint': 'x'})['options'][0]
    assert shown['price_eur'] is None


def test_role_failure_degrades_and_later_roles_still_run(tmp_path, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError('synthetic failure')
    monkeypatch.setattr(pricing, 'price_option', boom)
    monkeypatch.setattr(crew.value_mod, 'value_at_stake', boom)
    result = run(tmp_path)
    by = [(e['agent'], e['action'], e['outcome']) for e in result['trace']]
    assert ('Pricer', 'Priced and ranked the options', 'fell back') in by
    assert ('Pricer', 'Worked out the value at stake', 'fell back') in by
    assert any(a == 'Drafter' and o == 'done' for a, _, o in by)
    assert result['options'] and all(o['price_eur'] is None for o in result['options'])
    assert result['escalation'] and result['brief']
    assert result['value']['headline_eur'] is None


def test_every_role_failing_still_returns_a_result(tmp_path, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError('synthetic failure')
    for name in ('reconciler', 'investigator_role', 'planner', 'pricer', 'value_role', 'policy_officer', 'router', 'checker_options',
                 'drafter', 'drafter_supplier', 'drafter_escalation', 'checker_final', 'conflicts_role'):
        monkeypatch.setattr(crew, name, boom)
    result = run(tmp_path)
    assert len(result['trace']) >= 10 and result['brief'] and result['supplier_draft']
    assert 'fell back' in {e['outcome'] for e in result['trace']}


def test_policy_unreadable_says_approver_unknown_needs_human_review(tmp_path):
    bad = pol.Policy(ok=False, problems=['unreadable'])
    result = run(tmp_path, policy=bad)
    officer = next(e for e in result['trace'] if e['agent'] == 'Policy Officer')
    assert officer['outcome'] == 'needs human review'
    assert all(o['approver'] is None for o in result['options'])
    assert result['escalation']['to_role'] == actions.APPROVER_UNKNOWN
    assert 'human review' in result['escalation']['body']


def test_model_options_are_validated_and_priced(tmp_path):
    text = model_text([
        {'title': 'Fly 600 in', 'detail': 'Supplier flies the balance.', 'quantity': 600, 'mode': 'air', 'eta': '2026-11-21T20:00+01:00', 'supplier': 'Synthetic Supplier'},
        {'title': 'bad quantity', 'quantity': 0, 'mode': 'air', 'eta': None},
        {'title': 'bad mode', 'quantity': 5, 'mode': 'teleport', 'eta': None},
        {'title': 'too many', 'quantity': 999999, 'mode': 'air', 'eta': None},
        {'title': 'bad eta', 'quantity': 5, 'mode': 'air', 'eta': 'tomorrow-ish'}])
    result = run(tmp_path, investigation={'text': text})
    assert result['mode'] == 'model' and len(result['options']) == 2 and result['options'][-1]['kind'] == 'allocation'
    option = result['options'][0]
    assert option['feasible'] == 'yes' and option['price_eur'] == 4200.0 and option['eta_label'] == 'Sat 20:00'
    assert model_entry(result)['action'] == 'Looked for recovery options with the model'
    # copies gained comes from the same packing math as the what-if
    base = crew.ships(make_issue(), make_products(), 20, 0.0, 0)
    arrive = crew.packing_hours(NOW, datetime(2026, 11, 21, 20, 0, tzinfo=BERLIN))
    after = crew.ships(make_issue(), make_products(), 20, arrive, 600)
    assert option['copies_gained'] == after['copies_ship'] - base['copies_ship'] and option['copies_gained'] > 0
    assert result['brief']['copies_gained'] == option['copies_gained']


def test_invalid_or_missing_model_block_falls_back_to_rules_and_says_so(tmp_path):
    result = run(tmp_path, investigation={'text': '## Verdict\nNo.\n```json\n{not json\n```'})
    entry = model_entry(result)
    assert result['mode'] == 'deterministic' and entry['outcome'] == 'fell back'
    assert entry['action'] == 'Used rule-based options instead of the model' and result['options']


def test_model_call_failure_is_traced_and_rules_take_over(tmp_path):
    def failing():
        raise RuntimeError('model unavailable')
    result = run(tmp_path, investigate=failing)
    entry = model_entry(result)
    assert entry['outcome'] == 'fell back' and result['options'][0]['quantity'] == 600


def test_model_wording_with_unverified_numbers_is_replaced(tmp_path):
    text = model_text([{'title': 'Ship 12,345 units now', 'detail': 'Costs EUR 999,999 in total.', 'quantity': 600, 'mode': 'air',
                        'eta': '2026-11-21T20:00+01:00', 'supplier': 'Synthetic Supplier'}])
    result = run(tmp_path, investigation={'text': text})
    option = result['options'][0]
    assert '12,345' not in option['title'] and '999,999' not in option['detail']
    assert option['title'] == 'Ship 600 units by air'
    assert result['numbers_verified'] is False


def test_model_wording_with_file_names_or_emails_is_replaced(tmp_path):
    text = model_text([{'title': 'See notice.pdf', 'detail': 'Mail boss@example.invalid about suppliers/X/notice.pdf', 'quantity': 600,
                        'mode': 'air', 'eta': None, 'supplier': 'Synthetic Supplier'}])
    option = run(tmp_path, investigation={'text': text})['options'][0]
    assert option['title'] == 'Ship 600 units by air' and 'example' not in option['detail'] and '.pdf' not in option['detail']


def test_draft_with_mismatching_number_is_rejected_and_replaced(tmp_path, monkeypatch):
    real = actions.escalation_draft

    def tampered(*args, **kwargs):
        draft = real(*args, **kwargs)
        draft['body'] += '\nCost: EUR 999,999.'
        return draft
    monkeypatch.setattr(actions, 'escalation_draft', tampered)
    result = run(tmp_path)
    assert '999,999' not in result['escalation']['body'] and result['numbers_verified'] is False
    assert result['escalation']['to_role'] and 'human review' in result['escalation']['body']
    final = [e for e in result['trace'] if e['action'] == 'Checked every number against the records'][0]
    assert final['outcome'] == 'needs human review'


def test_supplier_draft_with_mismatching_number_is_replaced(tmp_path, monkeypatch):
    real = actions.supplier_draft

    def tampered(*args, **kwargs):
        draft = real(*args, **kwargs)
        draft['body'] += '\nWe need 77,777 more.'
        return draft
    monkeypatch.setattr(actions, 'supplier_draft', tampered)
    result = run(tmp_path)
    assert '77,777' not in result['supplier_draft']['body'] and result['numbers_verified'] is False


def test_escalation_routes_up_when_category_lead_is_vacant(tmp_path):
    data = make_data(tmp_path, category="Collector's Items")        # the synthetic org chart has no lead for this category
    result = run(tmp_path, data=data, investigation={'text': model_text([
        {'title': 'Fly it in', 'quantity': 600, 'mode': 'air', 'eta': '2026-11-21T20:00+01:00', 'supplier': 'Synthetic Supplier'}])})
    escalation = result['escalation']
    assert escalation['to_role'] == 'Head of Procurement' and escalation['to_name'] == 'Dr. Hana Head'
    assert 'vacant' in escalation['body'].lower() and 'Route:' in escalation['body']
    assert result['options'][0]['approver']['vacancy'] is True
    assert result['brief']['approver']['vacancy'] is True


def test_air_freight_above_monthly_limit_goes_to_the_cpo_and_names_a_role(tmp_path):
    rich = {**FULL, 'freight_eur_per_unit_by_mode': {'air': 500.0}}      # 600 units: 300,000 > the synthetic 200,000 limit
    result = run(tmp_path, assumptions=rich, investigation={'text': model_text([
        {'title': 'Fly it in', 'quantity': 600, 'mode': 'air', 'eta': '2026-11-21T20:00+01:00', 'supplier': 'Synthetic Supplier'}])})
    escalation = result['escalation']
    assert escalation['to_role'] == 'CPO' and escalation['to_name'] == 'Cleo Chief'
    assert escalation['subject'] == 'Decision needed within the hour: Synthetic card shortage'
    for needed in ('Total cost: EUR 303,000', 'Copies gained', 'Deadline: Sun'):
        assert needed in escalation['body']
    assert 'assumption' in escalation['body'].lower()


def test_stock_option_without_evidence_is_not_free_and_not_feasible(tmp_path):
    result = run(tmp_path, investigation={'text': model_text([
        {'title': 'Use owned stock', 'quantity': 50, 'mode': 'stock', 'eta': None, 'supplier': None}])})
    option = result['options'][0]
    assert option['kind'] == 'verify' and option['price_eur'] is None and option['feasible'] == 'na'
    assert option['copies_gained'] is None


def test_rerun_is_idempotent_on_options(tmp_path):
    first, second = run(tmp_path), run(tmp_path)
    assert [o['title'] for o in first['options']] == [o['title'] for o in second['options']]


def test_alt_supplier_option_from_inbound_shipment(tmp_path):
    data = make_data(tmp_path)
    (data / 'soony/erp/open_shipments.csv').write_text(
        'shipment_id,carrier_id,mode,reference,supplier_id,po_numbers,material_ids,route_id,origin,destination,via,dest_site,etd,eta,status\n'
        'S1,C,sea,R1,SUP-2,9,CMP-1,R,A,B,,DC,2026-11-01,2026-11-26,in_transit\n'
        'S2,C,sea,R2,SUP-1,1,CMP-1,R,A,B,,DC,2026-11-01,2026-11-26,in_transit\n', encoding='utf-8')
    result = run(tmp_path, data=data)
    titles = [o['title'] for o in result['options']]
    assert 'Ask another supplier for stock' in titles and titles.count('Ask another supplier for stock') == 1
    assert all('SUP-' not in json.dumps(o) for o in result['options'])


# ------------------------------------------------------------------ application hooks (no real sends)

from test_workflow import workflow, action  # noqa: E402
from app import main  # noqa: E402


def seed_world(workflow, tmp_path):
    issue = workflow.issue
    issue.update({k: v for k, v in make_issue().items() if k not in ('id', 'title', 'material_id', 'summary')})
    make_data(tmp_path / 'customer')
    workflow.monkeypatch.setitem(main.snapshot, 'products', make_products())
    workflow.monkeypatch.setitem(main.snapshot, 'pack_status', {'hours_left': 20, 'as_of': 'Saturday 08:00'})
    workflow.monkeypatch.setitem(main.snapshot, 'launch_date', '2026-11-22')
    workflow.monkeypatch.setattr(crew, 'cached_policy', lambda data_dir, ttl=60: make_policy())
    return issue


class NoNetwork:
    calls = 0

    def __call__(self, *args, **kwargs):
        NoNetwork.calls += 1
        raise AssertionError('no network or mail in tests')


@pytest.fixture
def silent(monkeypatch):
    import smtplib
    import urllib.request
    NoNetwork.calls = 0
    monkeypatch.setattr(smtplib, 'SMTP', NoNetwork())
    monkeypatch.setattr(urllib.request, 'urlopen', NoNetwork())
    yield NoNetwork


def test_agent_cycle_runs_crew_without_model_and_sends_nothing(workflow, tmp_path, silent):
    seed_world(workflow, tmp_path)
    workflow.monkeypatch.setattr(main, 'agent_status', {'running': True, 'steps': [], 'state': 'investigating', 'error': None})
    workflow.monkeypatch.setattr(main, 'refresh', lambda **kwargs: main.overview())
    workflow.monkeypatch.setattr(main.config, 'integrations', lambda: {'ai_enabled': False, 'inbox_enabled': False, 'email_enabled': False})
    main.agent_cycle('game-card-shortage')
    case = main.store.get(workflow.issue)
    assert case['crew']['mode'] == 'deterministic' and case['crew']['options'] and case['state'] == 'drafted'
    assert case['draft']['body']
    phrases = [s['message'] for s in main.agent_status['steps']]
    assert set(phrases) <= labels.AGENT_PHASES and phrases[-1] == 'Ready for your review'
    assert workflow.sent == [] and silent.calls == 0


def test_agent_cycle_model_failure_degrades_to_rules(workflow, tmp_path, silent):
    seed_world(workflow, tmp_path)
    workflow.monkeypatch.setattr(main, 'agent_status', {'running': True, 'steps': [], 'state': 'investigating', 'error': None})
    workflow.monkeypatch.setattr(main, 'refresh', lambda **kwargs: main.overview())
    workflow.monkeypatch.setattr(main.config, 'integrations', lambda: {'ai_enabled': True, 'inbox_enabled': False, 'email_enabled': False})

    def down(*args, **kwargs):
        raise ValueError('synthetic model outage')
    workflow.monkeypatch.setattr(main.investigator, 'run', down)
    main.agent_cycle('game-card-shortage')
    assert main.agent_status['state'] == 'awaiting_human_review'
    case = main.store.get(workflow.issue)
    entry = [e for e in case['crew']['trace'] if e['agent'] == 'Investigator'][-1]
    assert entry['outcome'] == 'fell back' and case['crew']['options']
    assert workflow.sent == []


def test_investigate_route_feeds_model_options_into_the_crew(workflow, tmp_path, silent):
    seed_world(workflow, tmp_path)
    workflow.monkeypatch.setattr(main.config, 'integrations', lambda: {'ai_enabled': True, 'email_enabled': False, 'portal_enabled': False})
    text = model_text([{'title': 'Fly it in', 'quantity': 600, 'mode': 'air', 'eta': '2026-11-21T20:00+01:00', 'supplier': 'Synthetic Supplier'}])
    workflow.monkeypatch.setattr(main.investigator, 'run', lambda *a, **k: {'text': text, 'model': 'm', 'at': 'x', 'tool_calls': []})
    detail = action(workflow, 'investigate').json()
    assert detail['options'] and detail['options'][0]['feasible'] in ('yes', 'late', 'unknown')
    assert main.store.get(workflow.issue)['crew']['mode'] == 'model'


def test_escalation_needs_named_approval_and_is_never_sent(workflow, tmp_path, silent):
    seed_world(workflow, tmp_path)
    assert action(workflow, 'escalation/approve', {'approver': 'Pat Planner'}).status_code == 409          # nothing to approve yet
    main.refresh_crew('game-card-shortage')
    detail = workflow.client.get('/api/issues/game-card-shortage').json()
    assert detail['escalation']['approved'] is False
    assert action(workflow, 'escalation/approve', {'approver': ''}).status_code == 422
    assert action(workflow, 'escalation/approve', {}).status_code == 422
    done = action(workflow, 'escalation/approve', {'approver': 'Pat Planner', 'note': 'ok'})
    assert done.status_code == 200 and done.json()['escalation']['approved'] is True
    assert 'Pat Planner' not in json.dumps(done.json()['escalation'])
    assert [e for e in done.json()['events'] if e['kind'] == 'escalation_approved'][0]['message'] == 'Escalation approved'
    assert workflow.sent == [] and silent.calls == 0
    # the application has no way to send it: the supplier send route stays gated
    assert action(workflow, 'send').status_code == 409


def test_escalation_approval_is_invalidated_when_sources_change(workflow, tmp_path, silent):
    issue = seed_world(workflow, tmp_path)
    main.refresh_crew('game-card-shortage')
    assert action(workflow, 'escalation/approve', {'approver': 'Pat Planner'}).json()['escalation']['approved'] is True
    issue['shortage'] += 5                                           # evidence changes
    detail = workflow.client.get('/api/issues/game-card-shortage').json()
    assert detail['escalation'] is None and detail['options'] == [] and detail['numbers_verified'] is False
    assert action(workflow, 'escalation/approve', {'approver': 'Pat Planner'}).status_code == 409
    main.refresh_crew('game-card-shortage')
    assert workflow.client.get('/api/issues/game-card-shortage').json()['escalation']['approved'] is False


def test_rerun_with_different_escalation_text_drops_the_approval(workflow, tmp_path, silent):
    seed_world(workflow, tmp_path)
    main.refresh_crew('game-card-shortage')
    action(workflow, 'escalation/approve', {'approver': 'Pat Planner'})
    case = main.store.get(workflow.issue)
    case['crew']['escalation']['body'] += '\nChanged after approval.'
    main.store.save('game-card-shortage', case)
    assert workflow.client.get('/api/issues/game-card-shortage').json()['escalation']['approved'] is False


def test_whatif_route_validation_and_boundaries(workflow, tmp_path):
    seed_world(workflow, tmp_path)
    url = 'whatif'
    for bad in ({}, {'arrive_in_hours': -0.1}, {'arrive_in_hours': 72.01}, {'arrive_in_hours': 'soon'}, {'arrive_in_hours': True},
                {'arrive_in_hours': None}, {'arrive_in_hours': [1]}):
        assert action(workflow, url, bad).status_code == 422, bad
    shown = {}
    for hours in (0, 0.5, 19.99, 20, 20.5, 72):
        reply = action(workflow, url, {'arrive_in_hours': hours})
        assert reply.status_code == 200, hours
        shown[hours] = reply.json()
        assert set(shown[hours]) == {'copies_ship', 'copies_short', 'hours_left', 'label'}
    # engine math at the boundaries
    issue, products = workflow.issue, make_products()
    for hours, body in shown.items():
        expected = crew.ships(issue, products, 20, float(hours), issue['shortage'])
        assert body['copies_ship'] == expected['copies_ship'] and body['copies_short'] == expected['copies_short']
    assert shown[0]['copies_ship'] >= shown[19.99]['copies_ship'] >= shown[20]['copies_ship']
    assert shown[20]['copies_ship'] == shown[72]['copies_ship']                 # arrival at/after the last packing hour adds nothing
    assert shown[0]['hours_left'] == 20 and shown[0]['label'] == 'now'
    assert action(workflow, url, {'arrive_in_hours': 3}).json()['label'].startswith('in 3 h')


def test_whatif_route_errors(workflow, tmp_path):
    assert action(workflow, 'whatif', {'arrive_in_hours': 1}).status_code == 409            # no packing hours known
    seed_world(workflow, tmp_path)
    assert workflow.client.post('/api/issues/nope/whatif', json={'arrive_in_hours': 1}).status_code == 404
    workflow.issue['allocation'] = {'lines': [{'product_id': 'P-STD', 'name': 'Standard', 'needed': 1, 'covered': 1, 'short': 0}]}
    assert action(workflow, 'whatif', {'arrive_in_hours': 1}).status_code == 409           # nothing is short


def test_new_routes_require_the_access_cookie(workflow, tmp_path, monkeypatch):
    seed_world(workflow, tmp_path)
    monkeypatch.setenv('LIO_ACCESS_CODE', 'synthetic-code')
    assert action(workflow, 'whatif', {'arrive_in_hours': 1}).status_code == 401
    assert action(workflow, 'escalation/approve', {'approver': 'Pat Planner'}).status_code == 401


FILE_RE = re.compile(r'\.(pdf|csv|xlsx|docx|png|jpe?g|md|txt|eml|json)\b', re.I)


def strings_of(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for k, v in value.items():
            yield k
            yield from strings_of(v)
    elif isinstance(value, list):
        for v in value:
            yield from strings_of(v)


def test_public_json_is_free_of_files_paths_and_addresses(workflow, tmp_path, silent):
    issue = seed_world(workflow, tmp_path)
    issue['evidence'][0]['excerpt'] = 'SECRET-EXCERPT'
    issue['supplier'] = {'name': 'Synthetic Supplier', 'contact_name': 'Pat', 'contact_email': 'secret@example.invalid'}
    text = model_text([{'title': 'Fly it in (see suppliers/X/notice.pdf)', 'detail': 'Write to secret@example.invalid', 'quantity': 600,
                        'mode': 'air', 'eta': '2026-11-21T20:00+01:00', 'supplier': 'C:/Users/x/notice.pdf'}])
    workflow.monkeypatch.setattr(main.config, 'integrations', lambda: {'ai_enabled': True, 'email_enabled': False, 'portal_enabled': False})
    workflow.monkeypatch.setattr(main.investigator, 'run', lambda *a, **k: {'text': text, 'model': 'm', 'at': 'x', 'tool_calls': []})
    action(workflow, 'investigate')
    action(workflow, 'escalation/approve', {'approver': 'Pat Planner'})
    action(workflow, 'draft')
    payloads = [workflow.client.get('/api/overview').json(), workflow.client.get('/api/issues/game-card-shortage').json(),
                action(workflow, 'whatif', {'arrive_in_hours': 4}).json()]
    for payload in payloads:
        if isinstance(payload.get('case'), dict) and payload['case'].get('draft'):
            payload['case']['draft'] = None          # the supplier draft is the reviewed outgoing text, checked in its own tests
        payload['supplier_drafts'] = []
        for text_ in strings_of(payload):
            assert not FILE_RE.search(text_), text_
            for token in ('suppliers/', 'soony/', '@', 'SECRET-EXCERPT', 'C:\\', 'C:/', '/data', 'SUP-', 'CMP-', 'WB-1'):
                assert token not in text_, (token, text_)
    detail = payloads[1]
    assert set(detail) >= {'options', 'brief', 'value', 'trace', 'escalation', 'numbers_verified', 'conflicts', 'case', 'events'}
    assert set(detail['escalation']) == {'to_role', 'subject', 'body', 'approved'}
    for option in detail['options']:
        assert set(option) == {'title', 'detail', 'price_eur', 'eta', 'copies_gained', 'approver', 'feasible', 'kind', 'arrival_known',
                               'copies_gained_source', 'potential_units', 'recommended', 'price_basis'}
        assert option['approver'] is None or set(option['approver']) <= {'role', 'vacancy', 'provisional'}
    assert set(detail['trace'][0]) == {'agent', 'action', 'outcome', 'autonomy'}
    assert set(detail['value']) == {'headline_eur', 'basis', 'label', 'claim_eur'}
    assert 'recovery' not in detail and 'evidence' not in detail


def test_public_crew_drops_anything_outside_the_vocabulary():
    crew_data = {'trace': [{'agent': 'Reconciler', 'action': 'Read suppliers/x/notice.pdf', 'outcome': 'done', 'autonomy': 'auto'},
                           {'agent': 'Hacker', 'action': 'x', 'outcome': 'done', 'autonomy': 'auto'},
                           {'agent': 'Reconciler', 'action': 'Recomputed the shortage from the records', 'outcome': 'done', 'autonomy': 'auto'}],
                 'options': [{'title': 'See report.pdf', 'detail': 'ok text', 'feasible': 'maybe', 'price_eur': float('nan')}]}
    shown = public.public_crew({'crew': crew_data})
    assert [t['agent'] for t in shown['trace']] == ['Reconciler'] and shown['options'][0]['title'] == ''
    assert shown['options'][0]['feasible'] == 'unknown' and shown['options'][0]['price_eur'] is None
    assert public.public_crew(None)['options'] == [] and public.public_crew({'crew': 'junk'})['brief'] is None


def test_draft_route_uses_the_crew_option_but_stays_supplier_safe(workflow, tmp_path):
    seed_world(workflow, tmp_path)
    main.refresh_crew('game-card-shortage')
    body = action(workflow, 'draft').json()['case']['draft']['body']
    assert '600 units by air freight' in body and '600 remaining' in body
    for token in ('CPO', 'EUR', 'Collector', 'priority', 'approver', 'memo'):
        assert token not in body
