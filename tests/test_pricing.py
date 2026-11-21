"""Pricing and ranking on synthetic data: unknowns stay unknown, never a guess."""
import json
from datetime import datetime

from app import policy as pol
from app import pricing
from app.recovery import BERLIN
from tests.test_policy import make_policy

PO_HEADER = 'po_number,po_line,supplier_id,material_id,plant,quantity,unit_price,currency,order_date,requested_date,promised_date,actual_delivery_date,status,buyer,incoterm,note\n'


def data_dir(tmp_path, lines=()):
    erp = tmp_path / 'soony/erp'
    erp.mkdir(parents=True)
    (erp / 'purchase_orders_2025H2-2026.csv').write_text(PO_HEADER + ''.join(lines), encoding='utf-8')
    master = tmp_path / 'soony/master'
    master.mkdir(parents=True)
    (master / 'components.csv').write_text('component_id,description,category\nCMP-1,Card,Game Media\n', encoding='utf-8')
    return tmp_path


def po(number, price, currency, order_date, supplier='SUP-1'):
    return f'{number},1,{supplier},CMP-1,DC,100,{price},{currency},{order_date},2026-12-01,2026-12-01,,open,B,FOB,\n'


ISSUE = {'material_id': 'CMP-1'}
FULL = {'fx_to_eur': {'USD': 0.5}, 'freight_eur_per_unit_by_mode': {'air': 2.0, 'sea': 0.1, 'road': 0.5}}
POLICY = make_policy()


def price(option, root, assumptions=FULL):
    return pricing.price_option(option, ISSUE, root, assumptions, policy=POLICY, as_of='2026-11-21')


def test_latest_po_price_used_and_total_computed(tmp_path):
    root = data_dir(tmp_path, [po('1', 4.0, 'USD', '2026-01-01'), po('2', 10.0, 'USD', '2026-06-01')])
    result = price({'title': 'x', 'quantity': 1000, 'mode': 'air', 'eta': None}, root)
    assert result['unit_price'] == 10.0 and result['currency'] == 'USD' and result['fx_rate'] == 0.5
    assert result['goods_eur'] == 5000.0 and result['freight_eur'] == 2000.0 and result['total_eur'] == 7000.0
    assert result['unknown'] == []
    assert any('assumption' in a for a in result['assumptions'])


def test_no_po_price_is_unknown(tmp_path):
    root = data_dir(tmp_path, [])
    result = price({'quantity': 10, 'mode': 'sea', 'eta': None}, root)
    assert result['goods_eur'] is None and result['total_eur'] is None and result['unknown']
    assert result['approver']['role'] is None


def test_no_fx_is_unknown_not_guessed(tmp_path):
    root = data_dir(tmp_path, [po('1', 4.0, 'USD', '2026-01-01')])
    result = price({'quantity': 10, 'mode': 'sea', 'eta': None}, root, {'freight_eur_per_unit_by_mode': {'sea': 1.0}})
    assert result['goods_eur'] is None and result['total_eur'] is None
    assert any('Exchange rate' in u for u in result['unknown'])


def test_eur_needs_no_fx_and_no_freight_is_unknown(tmp_path):
    root = data_dir(tmp_path, [po('1', 4.0, 'EUR', '2026-01-01')])
    result = price({'quantity': 10, 'mode': 'road', 'eta': None}, root, {})
    assert result['goods_eur'] == 40.0 and result['freight_eur'] is None and result['total_eur'] is None
    assert any('Freight rate' in u for u in result['unknown'])


def test_null_template_values_are_unknown(tmp_path):
    root = data_dir(tmp_path, [po('1', 4.0, 'USD', '2026-01-01')])
    template = pricing.load_assumptions(tmp_path / 'state')
    assert price({'quantity': 5, 'mode': 'air', 'eta': None}, root, template)['total_eur'] is None


def test_stock_option_has_no_cost(tmp_path):
    root = data_dir(tmp_path, [])
    result = price({'quantity': 50, 'mode': 'stock', 'eta': None, 'stock_established': True}, root, {})
    assert result['total_eur'] == 0.0 and result['unknown'] == []
    unproven = price({'quantity': 50, 'mode': 'stock', 'eta': None}, root, {})
    assert unproven['total_eur'] is None and unproven['unknown'] == ['Stock location not established.']


def test_air_approver_uses_freight_and_month_to_date(tmp_path):
    root = data_dir(tmp_path, [po('1', 1.0, 'EUR', '2026-01-01')])
    big = {'fx_to_eur': {}, 'freight_eur_per_unit_by_mode': {'air': 300.0}}
    result = price({'quantity': 1000, 'mode': 'air', 'eta': None}, root, big)  # freight 300,000 > limit
    assert result['approver']['role'] == 'CPO' and result['approver']['needs_cpo'] is True
    cumulative = dict(big, air_freight_month_to_date_eur={'value': 190000}, freight_eur_per_unit_by_mode={'air': 20.0})
    result = price({'quantity': 1000, 'mode': 'air', 'eta': None}, root, cumulative)  # 20,000 + 190,000
    assert result['approver']['role'] == 'CPO'
    small = price({'quantity': 1000, 'mode': 'air', 'eta': None}, root, {'freight_eur_per_unit_by_mode': {'air': 2.0}})
    assert small['approver']['role'] == 'Category Lead' and small['approver']['name'] == 'Gus Games'


def test_assumptions_template_created_once_and_never_overwritten(tmp_path):
    state = tmp_path / 'state'
    first = pricing.load_assumptions(state)
    path = state / 'assumptions.json'
    assert path.exists() and first['fx_to_eur']['USD'] is None
    path.write_text(json.dumps({'fx_to_eur': {'USD': 0.9}}), encoding='utf-8')
    assert pricing.load_assumptions(state)['fx_to_eur']['USD'] == 0.9
    assert json.loads(path.read_text(encoding='utf-8')) == {'fx_to_eur': {'USD': 0.9}}


NOW = datetime(2026, 11, 21, 14, 0, tzinfo=BERLIN)


def opt(title, total, eta, qty=100, **extra):
    return dict({'title': title, 'total_eur': total, 'eta': eta, 'quantity': qty, 'mode': 'air', 'copies_gained': 100}, **extra)


def test_ranking_feasibility_then_value_then_earliest():
    # 8 hours left on Saturday afternoon: the last packing hour is Saturday 22:00
    options = [opt('cheap but late', 10.0, '2026-11-22T09:00:00+01:00'),
               opt('dear', 1000.0, '2026-11-21T16:00:00+01:00'),
               opt('good value', 100.0, '2026-11-21T20:00:00+01:00'),
               opt('good value earlier', 100.0, '2026-11-21T18:00:00+01:00'),
               opt('no eta', 1.0, None),
               opt('unknown cost', None, '2026-11-21T15:00:00+01:00')]
    ranked = pricing.rank_options(options, 8.0, NOW)
    assert [o['title'] for o in ranked] == ['good value earlier', 'good value', 'dear', 'unknown cost', 'no eta', 'cheap but late']
    assert [o['rank'] for o in ranked] == [1, 2, 3, 4, 5, 6]
    states = {o['title']: o['feasibility'] for o in ranked}
    assert states['cheap but late'] == 'too_late' and states['no eta'] == 'unknown' and states['dear'] == 'feasible'
    assert not ranked[-1]['feasible'] and ranked[-1]['flag'] and ranked[0]['flag'] is None


def test_arrival_after_last_packing_hour_is_infeasible_even_if_cheapest():
    ranked = pricing.rank_options([opt('late', 1.0, '2026-11-23T08:00:00+01:00'), opt('ok', 500.0, '2026-11-21T20:00:00+01:00')], 8.0, NOW)
    assert ranked[0]['title'] == 'ok' and ranked[1]['feasible'] is False


def test_copies_gained_overrides_quantity_and_free_option_ranks_first():
    ranked = pricing.rank_options([opt('paid', 100.0, '2026-11-21T20:00:00+01:00', qty=1, copies_gained=1000),
                                   dict(opt('owned', 0.0, None, qty=5, copies_gained=None), mode='stock')], 8.0, NOW)
    assert ranked[0]['title'] == 'paid' and ranked[0]['copies_per_eur'] == 10.0     # an option with no gain is never feasible
    assert ranked[1]['title'] == 'owned' and ranked[1]['copies_per_eur'] is None and not ranked[1]['feasible']
    json.dumps(ranked)  # no infinities or non-serialisable values


def test_last_packing_moment_counts_only_shift_windows():
    # Saturday 14:00 plus 8 shift hours ends at Saturday 22:00
    end = pricing.last_packing_moment(NOW, 8.0)
    assert (end.day, end.hour, end.minute) == (21, 22, 0)
    # 9 hours spills over to Sunday 07:00
    moment = pricing.last_packing_moment(NOW, 9.0)
    assert moment.day == 22 and moment.hour == 7 and moment.minute == 0
