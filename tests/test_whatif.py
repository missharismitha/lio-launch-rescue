from app.whatif import scenario_label, ships

PRODUCTS = [
    {'id': 'STD', 'name': 'Standard', 'remaining': 1000, 'rate_per_hour': 100},
    {'id': 'CE', 'name': "Collector's", 'remaining': 300, 'rate_per_hour': 30},
]


def run(**kw):
    base = dict(products=PRODUCTS, short_product_id='STD', usable_units_now=0, arrival_units=0,
                arrive_in_hours=0, hours_left=10)
    base.update(kw)
    return ships(**base)


def test_arrival_immediately_uses_full_hours():
    r = run(arrival_units=5000, arrive_in_hours=0, priority_order=['STD', 'CE'])
    assert r['copies_ship'] == 1000 and r['copies_short'] == 0 and r['feasible']
    assert run(arrival_units=5000, arrive_in_hours=-3)['copies_ship'] == 1000


def test_arrival_within_hours_left_loses_waiting_time():
    r = run(arrival_units=5000, arrive_in_hours=6, priority_order=['STD', 'CE'])
    assert r['copies_ship'] == 400  # 4 productive hours at 100/h
    assert r['copies_short'] == 600 and not r['feasible']
    assert r['arrive_label_hours'] == 6 and r['hours_left'] == 10


def test_arrival_exactly_at_hours_left_adds_nothing():
    assert run(arrival_units=5000, arrive_in_hours=10)['copies_ship'] == 0


def test_arrival_after_hours_left_adds_nothing_but_stock_still_packs():
    assert run(arrival_units=5000, arrive_in_hours=12)['copies_ship'] == 0
    r = run(usable_units_now=250, arrival_units=5000, arrive_in_hours=12)
    assert r['copies_ship'] == 250 + 0 and r['copies_short'] == 750


def test_stock_runs_out_then_arrival_continues():
    r = run(usable_units_now=200, arrival_units=5000, arrive_in_hours=5, priority_order=['STD', 'CE'])
    assert r['copies_ship'] == 200 + 500


def test_zero_arrival_units_and_zero_hours():
    assert run(arrival_units=0, arrive_in_hours=1)['copies_ship'] == 0
    r = run(arrival_units=5000, arrive_in_hours=0, hours_left=0)
    assert r['copies_ship'] == 0 and r['copies_short'] == 1000 and r['hours_left'] == 0


def test_arrival_more_than_needed_is_capped():
    r = run(products=[{'id': 'STD', 'remaining': 50, 'rate_per_hour': 100}], arrival_units=10 ** 6)
    assert r['copies_ship'] == 50 and r['copies_short'] == 0 and r['feasible']


def test_priority_gives_shared_parts_to_first_edition():
    first_ce = run(usable_units_now=500, priority_order=['CE', 'STD'])
    first_std = run(usable_units_now=500, priority_order=['STD', 'CE'])
    # Collector's can pack 300 in 10 h, so Standard only gets 200 when Collector's is first.
    assert first_ce['copies_ship'] == 200
    assert first_std['copies_ship'] == 500


def test_component_need_per_copy_and_unknown_product():
    assert run(usable_units_now=500, component_need_per_copy=2, priority_order=['STD', 'CE'])['copies_ship'] == 250
    r = run(short_product_id='NOPE')
    assert r['copies_ship'] == 0 and not r['feasible']


def test_scenario_label():
    assert scenario_label(6) == 'in 6 h'
    assert scenario_label(1.5) == 'in 1.5 h'
    assert scenario_label(0) == 'now' and scenario_label(-2) == 'now'
    assert scenario_label(6, '2026-11-21T13:00:00') == 'in 6 h (about 19:00)'
    assert scenario_label(8, '2026-11-21T13:00:00', 20).endswith('after packing stops')
    assert scenario_label(2, 'not a date') == 'in 2 h'
