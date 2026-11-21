"""Value at stake and contract claim on synthetic data."""
import pymupdf

from app import value

PRODUCTS = [{'id': 'P-STD', 'name': 'Standard'}, {'id': 'P-CE', 'name': 'Special'}]
PRODUCT_CSV = ('product_id,name,product_line,lifecycle,launch_date,weekly_plan_qty,day_one_qty,plants,std_cost_eur,valid_from\n'
               'P-STD,Standard,L,launch,2026-11-22,1,1,DC,10.0,2026-01-01\n'
               'P-CE,Special,L,launch,2026-11-22,1,1,DC,30.0,2026-01-01\n')
PO_HEADER = 'po_number,po_line,supplier_id,material_id,plant,quantity,unit_price,currency,order_date,requested_date,promised_date,actual_delivery_date,status,buyer,incoterm,note\n'
CLAUSE = ('Late delivery\n'
          'For each commenced week of delay beyond the confirmed delivery date, Supplier shall pay liquidated damages\n'
          'of 3 % of the value of the delayed quantity, capped at 5 % of the affected purchase order. Soony may set off\n'
          'such amounts against open invoices.\n')


def issue(short_std=100, short_ce=0):
    return {'allocation': {'lines': [{'product_id': 'P-CE', 'name': 'Special', 'needed': 10, 'covered': 10, 'short': short_ce},
                                     {'product_id': 'P-STD', 'name': 'Standard', 'needed': 500, 'covered': 400, 'short': short_std}]},
            'affected_products': ['P-STD', 'P-CE']}


def build(tmp_path, pdf_text=CLAUSE, po_line=None):
    (tmp_path / 'soony/master').mkdir(parents=True)
    (tmp_path / 'soony/master/products.csv').write_text(PRODUCT_CSV, encoding='utf-8')
    (tmp_path / 'soony/erp').mkdir(parents=True)
    line = po_line or '7001,2,SUP-9,CMP-1,DC,1000,2.0,USD,2026-09-01,2026-11-21,2026-11-21,,open,B,FOB,\n'
    (tmp_path / 'soony/erp/purchase_orders_2025H2-2026.csv').write_text(PO_HEADER + line, encoding='utf-8')
    folder = tmp_path / 'suppliers/SUP-9_Test/contracts'
    folder.mkdir(parents=True)
    if pdf_text is not None:
        document = pymupdf.open()
        page = document.new_page()
        page.insert_text((40, 40), pdf_text, fontsize=9)
        document.save(folder / 'agreement.pdf')
        document.close()
    return tmp_path


def test_cost_basis_by_default(tmp_path):
    root = build(tmp_path)
    result = value.value_at_stake(issue(), PRODUCTS, root, {})
    assert result['basis'] == 'cost' and result['label'] == 'product cost, not price'
    assert result['headline_eur'] == 1000.0
    assert result['lines'] == [{'product': 'Standard', 'product_id': 'P-STD', 'copies_short': 100, 'unit_value_eur': 10.0, 'basis': 'cost', 'eur': 1000.0}]


def test_only_short_lines_count(tmp_path):
    root = build(tmp_path)
    result = value.value_at_stake(issue(short_std=100, short_ce=20), PRODUCTS, root, {})
    assert result['headline_eur'] == 100 * 10.0 + 20 * 30.0 and len(result['lines']) == 2


def test_revenue_basis_when_settings_given(tmp_path):
    root = build(tmp_path)
    result = value.value_at_stake(issue(), PRODUCTS, root, {'selling_price_eur': {'P-STD': 60.0}})
    assert result['basis'] == 'revenue' and result['headline_eur'] == 6000.0
    refund = value.value_at_stake(issue(), PRODUCTS, root, {'refund_eur': {'P-STD': 55.0}})
    assert refund['basis'] == 'revenue' and refund['headline_eur'] == 5500.0


def test_mixed_basis_falls_back_to_cost_label(tmp_path):
    root = build(tmp_path)
    result = value.value_at_stake(issue(short_ce=2), PRODUCTS, root, {'selling_price_eur': {'P-STD': 60.0}})
    assert result['basis'] == 'cost' and result['headline_eur'] == 100 * 60.0 + 2 * 30.0


def test_missing_values_give_unknown_headline(tmp_path):
    root = build(tmp_path)
    (root / 'soony/master/products.csv').write_text(PRODUCT_CSV.replace('10.0', ''), encoding='utf-8')
    result = value.value_at_stake(issue(), PRODUCTS, root, {})
    assert result['headline_eur'] is None and result['assumptions']
    assert value.value_at_stake({}, PRODUCTS, root, {})['headline_eur'] is None


def test_no_shortage_is_zero_not_unknown(tmp_path):
    root = build(tmp_path)
    assert value.value_at_stake(issue(short_std=0), PRODUCTS, root, {})['headline_eur'] == 0.0


def shipments(balance=100, eta='2026-11-24', po='7001'):
    return {'shipments': [{'po_number': po, 'material_id': 'CMP-1', 'ordered': 1000, 'shipped': 1000 - balance, 'balance': balance,
                           'balance_eta': eta}], 'affected_products': ['P-STD']}


def test_contract_claim_weeks_percent_and_currency(tmp_path):
    root = build(tmp_path)
    # 3 days late = 1 commenced week; delayed value 100 x 2.0 = 200; 3% = 6.0; cap 5% of 2000 = 100
    claim = value.contract_claim(shipments(), root, {'fx_to_eur': {'USD': 0.5}})
    assert claim['weeks'] == 1 and claim['potential_native'] == 6.0 and claim['cap_native'] == 100.0
    assert claim['potential_eur'] == 3.0 and claim['cap_eur'] == 50.0
    assert claim['label'] == 'from contract, subject to Legal' and 'subject to Legal' in claim['basis_text']


def test_contract_claim_commenced_week_rounds_up_and_cap_applies(tmp_path):
    root = build(tmp_path)
    claim = value.contract_claim(shipments(balance=1000, eta='2026-12-10'), root, {'fx_to_eur': {'USD': 1.0}})
    assert claim['weeks'] == 3  # 19 days -> 3 commenced weeks
    assert claim['potential_native'] == 100.0 == claim['cap_native']  # 3 x 3% x 2000 = 180, capped at 5% of 2000


def test_contract_claim_without_fx_is_native_only(tmp_path):
    claim = value.contract_claim(shipments(), build(tmp_path), {})
    assert claim['potential_eur'] is None and claim['potential_native'] == 6.0 and claim['currency'] == 'USD'


def test_contract_claim_none_when_not_parseable(tmp_path):
    assert value.contract_claim(shipments(), build(tmp_path, pdf_text='Nothing about delays here.'), {}) is None
    assert value.contract_claim(shipments(), build(tmp_path / 'b', pdf_text=None), {}) is None
    assert value.contract_claim({'shipments': []}, build(tmp_path / 'c'), {}) is None
    assert value.contract_claim(shipments(po='9999'), build(tmp_path / 'd'), {}) is None


def test_no_claim_when_not_late(tmp_path):
    claim = value.contract_claim(shipments(eta='2026-11-20'), build(tmp_path), {'fx_to_eur': {'USD': 1.0}})
    assert claim['weeks'] == 0 and claim['potential_native'] == 0.0
