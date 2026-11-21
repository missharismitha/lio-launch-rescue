"""Transport comparison: synthetic data only (tmp_path), no network, no model."""
import json
import re
from datetime import datetime, timedelta

import pytest

from app import crew, freight, labels, pricing, public, tools
from app.recovery import BERLIN
from tests.test_policy import make_policy

NOW = datetime(2026, 11, 21, 13, 0, tzinfo=BERLIN)
ISSUE = {'material_id': 'CMP-1', 'shortage': 1000}
FILE_RE = re.compile(r'\.(pdf|csv|xlsx|docx|png|jpe?g|md|txt|eml|json)\b', re.I)

ROUTES = ('route_id,origin,destination,mode,carrier_id,transit_days,via\n'
          'R1,KRPUS,DEHAM,sea,L1,36,SGSIN\nR2,ICN,FRA,air,L2,2,\nR3,ORD,FRA,air,L2,2,\nR4,FRA,DC-HAM,road,L2,1,\n'
          'R5,PLPOZ,DC-HAM,road,L4,1,\nR6,DEHAM,DC-HAM,road,L1,1,\n')
PORTS = ('locode,name,country,lat,lon,mode\nKRPUS,Busan,KR,0,0,sea\nDEHAM,Hamburg,DE,0,0,sea\nICN,Incheon,KR,0,0,air\n'
         'ORD,Chicago Ohare,US,0,0,air\nFRA,Frankfurt,DE,0,0,air\nPLPOZ,Poznan,PL,0,0,road\n')
SHIPMENTS = ('shipment_id,carrier_id,mode,reference,supplier_id,po_numbers,material_ids,route_id,origin,destination,via,dest_site,etd,eta,status\n'
             'S1,L1,sea,X,SUP-0001,1,CMP-1,R1,KRPUS,DEHAM,SGSIN,DC-HAM,2026-10-01,2026-11-30,in_transit\n'
             'S2,L2,air,Y,SUP-0001,1,CMP-1,R2,ICN,FRA,,DC-HAM,2026-11-20,2026-11-23,booked\n'
             'S3,L4,road,Z,SUP-0002,2,CMP-1,R5,PLPOZ,DC-HAM,,DC-HAM,2026-11-20,2026-11-22,booked\n')
PO_HEAD = ('po_number,po_line,supplier_id,material_id,plant,quantity,unit_price,currency,order_date,requested_date,promised_date,'
           'actual_delivery_date,status,buyer,incoterm,note\n')


def po(number, supplier, price, currency, term, material='CMP-1'):
    return f'{number},1,{supplier},{material},DC-HAM,100,{price},{currency},2026-01-01,2026-02-01,2026-02-01,,open,B,{term},\n'


DEFAULT_POS = [po('1', 'SUP-0001', 9.8, 'USD', 'FOB Busan'), po('2', 'SUP-0003', 10.93, 'USD', 'DDP Hamburg')]


def build_dir(tmp_path, description='Game Card 128 GB', pos=None, legacy=''):
    root = tmp_path / 'data'
    files = {
        'soony/master/routes.csv': ROUTES, 'soony/master/ports.csv': PORTS, 'soony/erp/open_shipments.csv': SHIPMENTS,
        'soony/master/sites.csv': 'site_id,name,operator,type,country,city,lat,lon\nDC-HAM,Soony DC,Soony,dc,DE,Hamburg,0,0\n',
        'soony/master/components.csv': f'component_id,description,category,uom\nCMP-1,{description},Game Media,PC\n',
        'soony/master/products.csv': 'product_id,name,product_line,lifecycle,launch_date\nFG,Game,G,launch,2026-11-22\n',
        'soony/erp/purchase_orders_2025H2-2026.csv': PO_HEAD + ''.join(DEFAULT_POS if pos is None else pos),
        'soony/erp/purchase_orders_legacy_2024-2025H1.csv':
            'EBELN;EBELP;LIFNR;MATNR;WERKS;MENGE;NETPR;BEDAT;EINDT;ZZCONF;WEDAT;ZZSTAT;ERNAM\n' + legacy,
        'suppliers/SUP-0001_A/profile.csv': 'supplier_id,name,country,currency,incoterm,contact_email\nSUP-0001,Alpha Memory,KR,USD,FOB Busan,secret@example.invalid\n',
        'suppliers/SUP-0001_A/components.csv': 'component_id,description,share\nCMP-1,x,0.7\n',
        'suppliers/SUP-0002_B/profile.csv': 'supplier_id,name,country,currency,incoterm\nSUP-0002,Beta Karton,PL,EUR,DAP Hamburg\n',
        'suppliers/SUP-0002_B/components.csv': 'component_id,description,share\nCMP-1,x,0.3\n',
        'suppliers/SUP-0003_C/profile.csv': 'supplier_id,name,country,currency,incoterm\nSUP-0003,Gamma Semi,US,USD,DDP Hamburg\n',
        'suppliers/SUP-0003_C/components.csv': 'component_id,description,share\nCMP-1,x,0.3\n',
    }
    for relative, text in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')
    return root


def lanes_by_name(lanes):
    return {lane['supplier']: lane for lane in lanes}


def mode_of(lane, mode):
    return next(m for m in lane['modes'] if m['mode'] == mode)


def test_one_lane_per_supplier_and_modes_come_from_routes(tmp_path):
    lanes = lanes_by_name(freight.compare(build_dir(tmp_path), ISSUE, NOW, NOW + timedelta(days=10), {}))
    assert set(lanes) == {'Alpha Memory', 'Beta Karton', 'Gamma Semi'}
    assert {m['mode'] for m in lanes['Alpha Memory']['modes']} == {'air', 'sea'}
    assert {m['mode'] for m in lanes['Beta Karton']['modes']} == {'road'}
    assert {m['mode'] for m in lanes['Gamma Semi']['modes']} == {'air'}  # no US sea port or road route
    assert lanes['Alpha Memory']['quantity'] == 1000 and lanes['Alpha Memory']['country'] == 'KR'


def test_sea_is_infeasible_and_air_margin_math(tmp_path):
    deadline = NOW + timedelta(days=10)
    lane = lanes_by_name(freight.compare(build_dir(tmp_path), ISSUE, NOW, deadline, {}))['Alpha Memory']
    sea, air = mode_of(lane, 'sea'), mode_of(lane, 'air')
    assert sea['feasible'] is False and sea['transit_days'] == 40 and sea['rank'] is None  # 36 + 1 truck + 3 port and customs
    assert sea['hours_margin'] == -720.0 and sea['verdict'] == 'Too late by 30 days'
    assert air['transit_days'] == 5  # 1 first mile + 1 customs + 2 flight + 1 truck
    assert air['arrives_at'] == '2026-11-26T13:00+01:00' and air['hours_margin'] == 120.0
    assert air['feasible'] is True and air['rank'] == 1 and air['verdict'] == 'Makes it with 5 days to spare'
    assert lane['fastest'] == 'air' and lane['cheapest_feasible'] == 'air'
    assert air['route'] == 'Incheon > Frankfurt > Hamburg DC'


def test_air_too_late_when_deadline_is_tomorrow(tmp_path):
    lane = lanes_by_name(freight.compare(build_dir(tmp_path), ISSUE, NOW, NOW + timedelta(hours=30), {}))['Alpha Memory']
    air = mode_of(lane, 'air')
    assert air['feasible'] is False and air['hours_margin'] == -90.0 and air['verdict'] == 'Too late by 3.8 days'
    assert lane['cheapest_feasible'] is None and lane['fastest'] == 'air'  # no feasible mode is a finding, not an error


def test_road_lane_feasible_with_hours_to_spare(tmp_path):
    lane = lanes_by_name(freight.compare(build_dir(tmp_path), ISSUE, NOW, NOW + timedelta(hours=38), {}))['Beta Karton']
    road = mode_of(lane, 'road')
    assert road['transit_days'] == 1 and road['route'] == 'Poznan > Hamburg DC'
    assert road['hours_margin'] == 14.0 and road['verdict'] == 'Makes it with 14 h to spare' and road['rank'] == 1
    assert lane['fastest'] == 'road' and lane['cheapest_feasible'] == 'road'


def test_deadline_passed_makes_everything_infeasible(tmp_path):
    lanes = freight.compare(build_dir(tmp_path), ISSUE, NOW, NOW - timedelta(hours=1), {})
    assert lanes and all(not m['feasible'] and m['rank'] is None and m['verdict'] == 'The deadline has already passed'
                         for lane in lanes for m in lane['modes'])


def test_cost_model_numbers_and_unknown_weight(tmp_path):
    lane = lanes_by_name(freight.compare(build_dir(tmp_path), ISSUE, NOW, NOW + timedelta(days=10), {}))['Alpha Memory']
    air = mode_of(lane, 'air')
    kg = 1000 * 0.02 * 1.3
    assert air['cost_eur']['base'] == pytest.approx(kg * (3.45 * 0.91 + 0.05), abs=0.01)
    assert air['cost_eur']['low'] < air['cost_eur']['base'] < air['cost_eur']['high']
    assert air['cost_per_unit_eur'] == pytest.approx(air['cost_eur']['base'] / 1000, abs=1e-3)
    assert 'WorldACD' in air['basis'] and 'global average' in air['basis']
    other = lanes_by_name(freight.compare(build_dir(tmp_path / 'u', description='Mystery gizmo'), ISSUE, NOW, NOW + timedelta(days=10), {}))['Alpha Memory']
    entry = mode_of(other, 'air')
    assert entry['cost_eur'] is None and entry['cost_per_unit_eur'] is None and 'not known' in entry['basis']
    assert entry['feasible'] is True and other['cheapest_feasible'] is None


def test_fx_and_rate_overrides_are_honoured(tmp_path):
    root, deadline = build_dir(tmp_path), NOW + timedelta(days=10)
    base = mode_of(lanes_by_name(freight.compare(root, ISSUE, NOW, deadline, {}))['Gamma Semi'], 'air')['cost_eur']['base']
    kg = 26
    assert base == pytest.approx(kg * (1.15 * 0.91 + 0.05), abs=0.01)  # North America corridor rate
    override = mode_of(lanes_by_name(freight.compare(root, ISSUE, NOW, deadline, {'fx_to_eur': {'USD': 0.5}}))['Gamma Semi'], 'air')['cost_eur']['base']
    assert override == pytest.approx(kg * (1.15 * 0.5 + 0.05), abs=0.01)
    custom = {'freight_estimate': {'usd_to_eur': 1.0, 'packing_factor': 2.0, 'weights_kg_by_material': {'CMP-1': 1.0}}}
    third = mode_of(lanes_by_name(freight.compare(root, ISSUE, NOW, deadline, custom))['Gamma Semi'], 'air')['cost_eur']['base']
    assert third == pytest.approx(1000 * 1.0 * 2.0 * (1.15 + 0.05), abs=0.01)


def test_cross_check_is_computed_from_purchase_orders(tmp_path):
    legacy = '10;00010;1;CMP-1;DC-HAM;100;9,8000;08/12/2024;10/30/2024;11/06/2024;11/06/2024;GL;X\n'
    root = build_dir(tmp_path, pos=[po('1', 'SUP-0001', 10.0, 'USD', 'FOB Busan'), po('2', 'SUP-0003', 11.0, 'USD', 'DDP Hamburg'),
                                    po('3', 'SUP-0003', 11.4, 'USD', 'DAP Hamburg')], legacy=legacy)
    bundle = freight.build(root, ISSUE, NOW, NOW + timedelta(days=10), {})
    check = bundle['cross_check']
    # FOB 10.0 and legacy 9.8 (term from the supplier profile) -> median 9.9; delivered median 11.2
    assert check['delivered_premium_pct'] == pytest.approx((11.2 / 9.9 - 1) * 100, abs=0.1)
    assert check['per_unit_premium_eur'] == pytest.approx((11.2 - 9.9) * 0.91, abs=0.001)
    assert check['estimate_within_premium'] is True and 'not a freight rate' in check['note']
    only_fob = build_dir(tmp_path / 'n', pos=[po('1', 'SUP-0001', 10.0, 'USD', 'FOB Busan')])
    none = freight.build(only_fob, ISSUE, NOW, NOW + timedelta(days=10), {})
    assert none['cross_check']['delivered_premium_pct'] is None and none['cross_check']['estimate_within_premium'] is None


def test_nothing_to_compare_returns_empty(tmp_path):
    root = build_dir(tmp_path)
    assert freight.compare(root, {'material_id': 'CMP-1', 'shortage': 0}, NOW, NOW, {}) == []
    assert freight.compare(root, {'material_id': 'CMP-9', 'shortage': 5}, NOW, NOW, {}) == []
    assert freight.build(tmp_path / 'missing', ISSUE, NOW, NOW, {}) is None


def test_public_projection_has_the_contract_shape_and_no_forbidden_text(tmp_path):
    bundle = freight.build(build_dir(tmp_path), ISSUE, NOW, NOW + timedelta(days=10), {})
    shown = public.public_transport(bundle)
    assert set(shown) == {'estimate', 'as_of', 'deadline', 'lanes', 'cross_check', 'assumptions'} and shown['estimate'] is True
    assert set(shown['lanes'][0]) == {'supplier', 'country', 'material', 'quantity', 'fastest', 'cheapest_feasible', 'modes'}
    assert set(shown['lanes'][0]['modes'][0]) == {'mode', 'route', 'feasible', 'transit_days', 'arrives_at', 'hours_margin', 'cost_eur',
                                                  'cost_per_unit_eur', 'basis', 'rank', 'verdict'}
    assert set(shown['cross_check']) == {'delivered_premium_pct', 'estimate_within_premium', 'note'}
    assert shown['assumptions'] and {a['kind'] for a in shown['assumptions']} == {'market', 'assumption'}
    assert shown['as_of'] and shown['deadline']
    blob = json.dumps(shown)
    assert not FILE_RE.search(blob) and 'http' not in blob and '@' not in blob and 'secret' not in blob
    for token in ('suppliers/', 'soony/', 'SUP-', 'C:\\', 'supplier_id', 'folder'):
        assert token not in blob
    assert public.public_transport(None) is None and public.public_transport({'lanes': []}) is None
    dirty = json.loads(blob)
    dirty['lanes'][0]['modes'][0]['basis'] = 'See suppliers/x/notice.pdf or https://x.example for details'
    dirty['lanes'][0]['supplier_id'] = 'SUP-0001'
    cleaned = json.dumps(public.public_transport(dirty))
    assert 'notice.pdf' not in cleaned and 'https' not in cleaned and 'SUP-0001' not in cleaned


def make_board(root, assumptions=None):
    return {'data_dir': root, 'issue': ISSUE, 'now': NOW, 'deadline': NOW + timedelta(days=10), 'assumptions': assumptions or {},
            'trace': [], 'agent': {'tool_calls': 0, 'rejected': 0, 'seconds': 0.0}}


def snapshot(root):
    return sorted((p.relative_to(root).as_posix(), p.stat().st_mtime_ns, p.stat().st_size) for p in root.rglob('*') if p.is_file())


def test_compare_transport_tool_is_read_only_auto_and_takes_no_arguments(tmp_path):
    root = build_dir(tmp_path)
    before = snapshot(root)
    spec = next(s for s in tools.schemas() if s['name'] == 'compare_transport')
    assert spec['parameters']['properties'] == {} and spec['strict'] is True and spec['parameters']['additionalProperties'] is False
    assert tools.REGISTRY['compare_transport'].autonomy == 'auto' == labels.TOOL_LABELS['compare_transport'][1]
    board = make_board(root)
    result = tools.dispatch(board, 'compare_transport', {})
    assert result['ok'] and result['estimate'] is True and result['lanes']
    assert 'SUP-' not in json.dumps(result) and '@' not in json.dumps(result)
    assert not board.get('shapes') and not board.get('ranked') and not board.get('approvals') and not board.get('supplier_drafts')
    assert tools.dispatch(board, 'compare_transport', {'free_text': 'x'})['ok'] is False
    assert before == snapshot(root)


def test_estimates_price_options_only_through_the_explicit_flag(tmp_path):
    root = build_dir(tmp_path)
    option = {'title': 'x', 'quantity': 1000, 'mode': 'air', 'eta': None, 'supplier_id': 'SUP-0001',
              'estimate_per_unit_eur': 0.0829, 'estimate_basis': 'WorldACD week 45'}
    policy = make_policy()
    fx = {'fx_to_eur': {'USD': 0.9}}
    off = pricing.price_option(option, ISSUE, root, fx, policy=policy, as_of='2026-11-21')
    assert off['freight_eur'] is None and off['total_eur'] is None and 'price_basis' not in off
    on = pricing.price_option(option, ISSUE, root, {**fx, 'use_freight_estimates': True}, policy=policy, as_of='2026-11-21')
    assert on['freight_eur'] == 82.9 and on['price_basis'] == 'estimate' and on['total_eur'] is not None
    assert any('Estimated from market rate' in a and 'to be confirmed' in a for a in on['assumptions'])
    assert on['approver']['provisional'] is True
    manual = pricing.price_option(option, ISSUE, root, {**fx, 'use_freight_estimates': True, 'freight_eur_per_unit_by_mode': {'air': 2.0}},
                                  policy=policy, as_of='2026-11-21')
    assert manual['freight_eur'] == 2000.0 and 'price_basis' not in manual  # a hand-set rate always wins


def test_crew_result_carries_transport_and_rule_options_follow_the_lane(tmp_path):
    root = build_dir(tmp_path, pos=[po('2', 'SUP-0002', 1.0, 'EUR', 'DAP Hamburg')])
    issue = {'id': 'i', 'material_id': 'CMP-1', 'shortage': 1000, 'required': 1000, 'usable_stock': 0, 'incoming': 0,
             'supplier': {'name': 'Beta Karton'},
             'shipments': [{'po_number': '2', 'ordered': 1000, 'shipped': 0, 'balance': 1000, 'balance_eta': None}], 'allocation': {'lines': []}}
    result = crew.run('i', issue, [], 38.0, root, tmp_path / 'state', policy=make_policy(), assumptions={'use_freight_estimates': True},
                      now=NOW, launch='2026-11-22')
    assert result['transport'] and result['transport']['estimate'] is True
    first = result['options'][0]
    assert first['mode'] == 'road' and first['title'] == 'Truck the remaining balance' and first['price_basis'] == 'estimate'
    assert first['price_eur'] is not None
    shown = public.public_crew({'crew': result, 'source_fingerprint': result['source_fingerprint']})
    assert shown['transport']['lanes'] and shown['options'][0]['price_basis'] == 'estimate'
