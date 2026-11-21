"""Synthetic regressions for incremental recovery versus already allocated stock."""
from datetime import datetime

import pytest

from app import brief, crew
from app.recovery import BERLIN
from tests.test_crew import NOW, make_issue, model_text, run


@pytest.mark.parametrize('eta', [None, '2026-11-21T14:00+01:00'])
def test_model_allocation_cannot_create_supply_or_confirm_arrival(tmp_path, eta):
    issue = make_issue()
    assert issue['allocation']['lines'][0]['short'] == 0  # Priority edition is covered already.
    result = run(tmp_path, issue=issue, investigation={'text': model_text([
        {'title': 'Allocate to Collector first', 'mode': 'stock', 'quantity': issue['shortage'],
         'eta': eta, 'copies_gained': issue['shortage'], 'feasible': True}])})
    allocation = [o for o in result['options'] if o['kind'] == 'allocation']
    assert len(allocation) == 1 and allocation[0]['copies_gained'] is None and allocation[0]['feasible'] == 'na'
    assert not any(o['copies_gained'] == issue['shortage'] for o in result['options'])
    assert result['brief']['recommendation'] == brief.NONE_FEASIBLE
    assert result['brief']['copies_gained'] is None


def test_unconfirmed_free_stock_does_not_outrank_arriving_units(tmp_path):
    result = run(tmp_path, investigation={'text': model_text([
        {'title': 'Allocate existing stock', 'mode': 'stock', 'quantity': 600},
        {'title': 'Deliver balance', 'mode': 'road', 'quantity': 600,
         'eta': '2026-11-21T14:00+01:00'}])})
    first, stock = result['options']
    assert first['mode'] == 'road' and first['feasible'] == 'yes' and first['copies_gained'] > 0
    assert first['rank'] == 1 and stock['rank'] == 2
    assert result['brief']['copies_gained'] == first['copies_gained']


def test_unknown_transport_arrival_never_uses_quantity_as_copies(tmp_path):
    result = run(tmp_path, investigation={'text': model_text([
        {'title': 'Ask for balance', 'mode': 'air', 'quantity': 600, 'copies_gained': 600}])})
    option = result['options'][0]
    assert option['copies_gained'] is None and option['feasible'] == 'unknown'
    assert result['brief']['copies_gained'] is None


def test_gain_respects_shared_priority_component_ratio_and_remaining_packing_time():
    products = [{'id': 'CE', 'remaining': 6, 'rate_per_hour': 2},
                {'id': 'STD', 'remaining': 12, 'rate_per_hour': 1}]
    issue = {'usable_stock': 16, 'incoming': 0, 'allocation': {'lines': [
        {'product_id': 'CE', 'needed': 12, 'covered': 12, 'short': 0},
        {'product_id': 'STD', 'needed': 24, 'covered': 4, 'short': 20}]}}
    board = {'issue': issue, 'products': products, 'hours_left': 10, 'now': NOW,
             'short_context': crew.short_context(issue, products), 'shapes': [
                 {'mode': 'road', 'quantity': 20, 'eta': '2026-11-21T14:00+01:00'}]}
    assert crew.packing_hours(NOW, datetime(2026, 11, 21, 14, tzinfo=BERLIN)) == 6
    crew.planner(board)
    # Six CE copies reserve twelve parts; four parts cover two STD copies.
    # Six hours later only four more STD copies fit into the packing window.
    assert board['baseline_ships'] == 2
    assert board['shapes'][0]['copies_gained'] == 4


def test_brief_does_not_replace_uncomputed_copies_with_component_units():
    result = brief.build_brief({}, [{'title': 'Confirm delivery', 'feasible': True,
                                    'quantity': 80, 'copies_gained': None}], None, None, [])
    assert result['copies_gained'] is None


def test_failed_brief_builder_cannot_recommend_an_unconfirmed_stock_option(tmp_path, monkeypatch):
    def failed(*args, **kwargs):
        raise RuntimeError('Synthetic brief failure')
    monkeypatch.setattr(crew.brief_mod, 'build_brief', failed)
    result = run(tmp_path, investigation={'text': model_text([
        {'title': 'Allocate to Collector first', 'mode': 'stock', 'quantity': 600}])})
    assert result['brief']['recommendation'] == brief.NONE_FEASIBLE
    assert result['brief']['copies_gained'] is None and result['brief']['price_eur'] is None


def test_pricing_failure_keeps_stock_gain_zero_and_feasibility_unknown(tmp_path, monkeypatch):
    def failed(*args, **kwargs):
        raise RuntimeError('Synthetic pricing failure')
    monkeypatch.setattr(crew.pricing, 'price_option', failed)
    result = run(tmp_path, investigation={'text': model_text([
        {'title': 'Allocate to Collector first', 'mode': 'stock', 'quantity': 600}])})
    assert result['options'][-1]['kind'] == 'allocation' and result['options'][-1]['copies_gained'] is None
    assert all(o['feasible'] != 'yes' for o in result['options'])
    assert result['brief']['recommendation'] == brief.NONE_FEASIBLE


def test_unconfirmed_transport_retains_supplier_ask_but_escalates_allocation(tmp_path):
    result = run(tmp_path, investigation={'text': model_text([
        {'title': 'Ask for balance', 'mode': 'air', 'quantity': 600,
         'supplier': 'Synthetic Supplier', 'eta': None}])})
    assert result['options'][0]['mode'] == 'air'
    assert result['options'][0]['approver']['role'] == 'Category Lead'
    assert result['brief']['approver']['role'] == 'Category Lead'
    assert result['options'][-1]['approver']['role'] == 'CPO'
    assert 'quote 600 units by air freight' in result['supplier_draft']['body']
    assert 'Dear Pat,' in result['supplier_draft']['body']
