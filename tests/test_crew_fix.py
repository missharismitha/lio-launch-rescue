"""Option kinds, honest copies gained and the supplier-hold option, on synthetic data."""
import re
from datetime import datetime

from app import actions, brief, crew, pricing, public, verify
from app.recovery import BERLIN
from tests.test_crew import FULL, NOW, make_data, make_issue, make_products, model_text, run
from tests.test_holds import HOLD_TEXT, PO_HEADER
from tests.test_policy import make_policy


def hold_world(tmp_path, text=HOLD_TEXT, shipment=True):
    data = make_data(tmp_path)
    (data / 'soony/erp/purchase_orders_2025H2-2026.csv').write_text(
        PO_HEADER + '4500000001,1,SUP-1,CMP-1,DC,1000,10.0,USD,2026-09-01,2026-11-21,2026-11-21,,open,B,DDP Hamburg,\n', encoding='utf-8')
    folder = data / 'suppliers/SUP-1_Synthetic_Supplier'
    (folder / 'order_confirmations').mkdir(parents=True)
    (folder / 'contracts').mkdir()
    (folder / 'contracts/agreement.txt').write_text('Delivery terms: EXW Plant.\n', encoding='utf-8')
    (folder / 'order_confirmations/oa_4500000001.txt').write_text(text, encoding='utf-8')
    if shipment:
        (data / 'soony/erp/open_shipments.csv').write_text(
            'shipment_id,carrier_id,mode,reference,supplier_id,po_numbers,material_ids,route_id,origin,destination,via,dest_site,etd,eta,status\n'
            'S1,C,air,R1,SUP-1,4500000001,CMP-1,R,A,B,,DC,2026-11-21,2026-11-23,booked\n', encoding='utf-8')
    return data


def stock_world(tmp_path, quantity=500):
    data = make_data(tmp_path)
    (data / 'soony/erp/stock_snapshot.csv').write_text(
        'snapshot_date,site,material_id,batch,quantity,uom,safety_stock,weeks_of_cover,last_count\n'
        f'2026-11-20,DC,CMP-1,B1,9000,PC,0,1,2026-11-10\n2026-11-20,WH-X,CMP-1,B2,{quantity},PC,0,1,2026-11-10\n', encoding='utf-8')
    return data


STOCK = {'title': 'Use stock at the warehouse', 'mode': 'stock', 'quantity': 100, 'eta': '2026-11-21T20:00+01:00'}


def test_mocked_allocate_stock_option_never_recommended(tmp_path):
    shortage = make_issue()['shortage']
    result = run(tmp_path, investigation={'text': model_text([{'title': 'Allocate to Collector first', 'mode': 'stock', 'quantity': shortage}])})
    kinds = {o['title']: o['kind'] for o in result['options']}
    assert set(kinds.values()) <= {'allocation', 'verify'} and 'allocation' in kinds.values()
    assert all(o['feasible'] != 'yes' for o in result['options'])
    assert all(o['copies_gained'] is None for o in result['options']) and result['brief']['copies_gained'] is None
    assert result['brief']['recommendation'] == brief.NONE_FEASIBLE
    assert 'EUR 0 for' not in result['escalation']['body'] and 'EUR 0 for' not in result['supplier_draft']['body']


def test_stock_option_counts_only_with_snapshot_evidence(tmp_path):
    with_snapshot = run(tmp_path / 'a', data=stock_world(tmp_path / 'a'), investigation={'text': model_text([STOCK])})
    option = with_snapshot['options'][0]
    base = crew.ships(make_issue(), make_products(), 20, 0.0, 0)
    arrive = crew.packing_hours(NOW, datetime(2026, 11, 21, 20, 0, tzinfo=BERLIN))
    after = crew.ships(make_issue(), make_products(), 20, arrive, 100)
    assert option['kind'] == 'recovery' and option['copies_gained'] == after['copies_ship'] - base['copies_ship']
    assert option['copies_gained_source'] == 'whatif' and option['price_eur'] == 0.0
    without = run(tmp_path / 'b', data=make_data(tmp_path / 'b'), investigation={'text': model_text([STOCK])})
    shown = without['options'][0]
    assert shown['kind'] == 'verify' and shown['copies_gained'] is None and shown['feasible'] == 'na'
    assert shown['title'] == 'Confirm where this stock is held' and shown['price_eur'] is None


def test_copies_gained_never_defaults_to_quantity():
    options = [{'title': 'x', 'total_eur': 10.0, 'eta': '2026-11-21T10:00+01:00', 'quantity': 500, 'mode': 'air'}]
    ranked = pricing.rank_options(options, 8.0, NOW)
    assert ranked[0]['copies_gained'] is None and ranked[0]['copies_per_eur'] is None and ranked[0]['feasible'] is False


def test_recovery_gain_matches_whatif_and_a_late_eta_gains_nothing(tmp_path):
    late = {'title': 'Fly it in', 'mode': 'air', 'quantity': 600, 'eta': '2026-11-23T08:00+01:00', 'supplier': 'Synthetic Supplier'}
    result = run(tmp_path, investigation={'text': model_text([late])})
    option = result['options'][0]
    assert option['kind'] == 'recovery' and option['copies_gained'] == 0 and option['feasible'] == 'late' and option['arrival_known'] is True
    assert result['brief']['recommendation'] == brief.NONE_FEASIBLE


def test_hold_becomes_a_release_option_ranked_first(tmp_path):
    result = run(tmp_path, data=hold_world(tmp_path))
    first = result['options'][0]
    assert first['kind'] == 'release' and first['quantity'] == 1000 and first['eta'] is None
    assert first['copies_gained'] is None and first['copies_gained_source'] == 'arrival_unknown' and first['feasible'] == 'unknown'
    assert first['potential_units'] == 600 and 'EXW' in first['title'] and 'forwarder' in first['title']
    assert any('not new spend' in a for a in first['assumptions']) and first['price_eur'] == 2000.0
    assert any('predates the hold' in u for u in first['unknown'])
    assert result['options'][-1]['kind'] == 'allocation'
    assert result['brief']['recommendation'].startswith('First action') and result['brief']['confidence'] == 'low'
    assert result['holds'] and result['holds'][0]['who_can_unlock']['role'] == 'Head of Procurement'
    assert result['trace'][1]['action'] == 'Checked supplier confirmations for holds'


def freight_option(**extra):
    return {'title': 'Release', 'kind': 'release', 'quantity': 1000, 'mode': 'air', 'eta': None, 'commitment': 'freight',
            'incoterm_required': 'EXW', **extra}


def price(tmp_path, assumptions, **extra):
    root = make_data(tmp_path)
    return pricing.price_option(freight_option(**extra), {'material_id': 'CMP-1'}, root, assumptions, policy=make_policy(), as_of='2026-11-21')


def test_exw_freight_commitment_routes_by_freight_not_goods(tmp_path):
    result = price(tmp_path / 'a', FULL)
    assert result['goods_eur'] == 0.0 and result['total_eur'] == 2000.0 and result['goods_ordered_eur'] == 5000.0
    assert result['approver']['role'] == 'Category Lead' and 'value_approver' not in result['approver']
    over = price(tmp_path / 'b', {**FULL, 'air_freight_month_to_date_eur': {'value': 199000}})
    assert over['approver']['role'] == 'CPO'
    unknown = price(tmp_path / 'c', {'fx_to_eur': {'USD': 0.5}, 'freight_eur_per_unit_by_mode': {'air': None}})
    assert unknown['total_eur'] is None and unknown['approver']['provisional'] is True and unknown['approver']['needs_amount'] is True
    assert unknown['approver']['role'] not in (None, 'Buyer') and 'Cost not yet known' in unknown['approver']['why']


def test_hold_supplier_draft_is_privacy_safe_and_never_confirms(tmp_path):
    result = run(tmp_path, data=hold_world(tmp_path))
    first = result['supplier_drafts'][0]
    body = first['body']
    assert len(result['supplier_drafts']) == 2 and result['supplier_draft'] == first and first['to'] == ''
    assert 'does not confirm' in body and 'internal approval' in body and '1,000 units' in body
    for token in ('600', '2026-11-22', 'EUR', 'USD', '10.0', 'CPO', 'Category Lead', '@', '.pdf', 'Collector', 'priority', 'shortage'):
        assert token not in body, token
    assert not re.search(r'(?i)we (?:accept|confirm) EXW|confirm EXW', body)


def test_hold_draft_with_a_mismatching_number_falls_back_to_minimal(tmp_path, monkeypatch):
    real = actions.hold_supplier_draft

    def tampered(*args, **kwargs):
        draft = real(*args, **kwargs)
        draft['body'] += '\nWe need 77,777 more.'
        return draft
    monkeypatch.setattr(actions, 'hold_supplier_draft', tampered)
    result = run(tmp_path, data=hold_world(tmp_path))
    body = result['supplier_drafts'][0]['body']
    assert '77,777' not in body and 'does not confirm' in body and result['numbers_verified'] is False


def test_escalation_for_a_hold_explains_the_contract_implication(tmp_path):
    body = run(tmp_path, data=hold_world(tmp_path))['escalation']['body']
    for needed in ('Accepting EXW', 'named person', 'Copies gained: unknown'):
        assert needed in body
    assert 'Cost' in body or 'Freight' in body
    assert 'not sent by the application' in body


def test_check_claims_rejects_an_unrecorded_gain():
    assert verify.check_claims('This adds 6,800 copies.', [], [], True)['ok'] is False
    assert verify.check_claims('This adds 6,800 copies.', [6800], [], True)['ok'] is True
    assert verify.check_claims('It will ship and is guaranteed.', [], [], False)['ok'] is False
    assert verify.check_claims('Arrival is not confirmed.', [], [], False)['ok'] is True
    assert verify.check_claims('Arrives Sun 02:00.', [], ['2026-11-21T20:00+01:00'], True)['ok'] is False


def test_model_wording_with_an_unrecorded_gain_is_replaced_and_confidence_low(tmp_path):
    text = model_text([{'title': 'Fly it in', 'detail': 'Adds 600 copies gained.', 'mode': 'air', 'quantity': 600, 'eta': '2026-11-23T08:00+01:00',
                        'supplier': 'Synthetic Supplier'}])
    result = run(tmp_path, investigation={'text': text})
    assert 'copies gained' not in result['options'][0]['detail'] and result['numbers_verified'] is False
    assert result['brief']['confidence'] == 'low'


def test_deterministic_mode_with_hold_and_unknown_arrivals(tmp_path):
    result = run(tmp_path, data=hold_world(tmp_path))
    assert result['mode'] == 'deterministic' and result['options'][0]['kind'] == 'release'
    assert not any(o['feasible'] == 'yes' for o in result['options']) and result['options'][-1]['kind'] == 'allocation'
    assert result['options'][-1]['feasible'] == 'na' and result['brief']['confidence'] == 'low'
    assert 'allocate by the CPO priority' in result['brief']['recommendation']


def test_public_projection_is_clean_and_additive(tmp_path):
    result = run(tmp_path, data=hold_world(tmp_path))
    shown = public.public_crew({'crew': result, 'source_fingerprint': 'x'})
    assert shown['holds'] and shown['supplier_drafts'] and {o['kind'] for o in shown['options']} >= {'release', 'allocation'}
    assert {o['feasible'] for o in shown['options']} <= {'yes', 'late', 'unknown', 'na'}
    for text in (t for part in (shown['options'], shown['holds'], shown['brief'], shown['escalation']) for t in _strings(part)):
        assert not public.FILE_TOKEN.search(text) and '@' not in text and not re.search(r'\+\d{2}', text) and '4500000001' not in text
        assert 'SECRET-SENTENCE' not in text and 'suppliers/' not in text
    assert 'to' not in shown['supplier_drafts'][0]


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)
