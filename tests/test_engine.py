"""Synthetic customer-shaped fixtures; no challenge documents are copied here."""
import csv
from pathlib import Path

import pymupdf
from openpyxl import Workbook, load_workbook

from app.engine import analyze


def write_csv(root, name, rows):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def pdf(root, name, text):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((40, 40), text, fontsize=10)
    document.save(path)
    document.close()


def dataset(root: Path, material='CMP-GAM-001', target=120, stock=50):
    write_csv(root, 'soony/erp/stock_snapshot.csv', [dict(snapshot_date='2026-11-20', site='DC-HAM', material_id=material, batch='receipt-1', quantity=stock)])
    write_csv(root, 'soony/erp/purchase_orders_2025H2-2026.csv', [dict(po_number='123', po_line='2', supplier_id='SUP-TEST', material_id=material, quantity=100, unit_price=2, currency='EUR')])
    write_csv(root, 'soony/master/bom.csv', [dict(parent_id='FG-TEST', child_id=material, qty_per=1, valid_from='2024-01-01', valid_to='9999-12-31')])
    write_csv(root, 'soony/master/components.csv', [dict(component_id=material, description='Game Card' if material=='CMP-GAM-001' else 'Art Book', category='Game Media' if material=='CMP-GAM-001' else 'Print')])
    write_csv(root, 'soony/master/products.csv', [dict(product_id='FG-TEST', launch_date='2026-11-22')])
    book = Workbook()
    sheet = book.active
    sheet.append(['Standard', 'FG-TEST', target, 0, 0, target, 10, target/10, 30])
    sheet = book.create_sheet('Inbound')
    sheet.append(['Test supplier', material, 100, 'air', '111-222', '2026-11-20', '2026-11-21', 'booked'])
    path = root/'soony/context/launch_plan_GH6.xlsx'
    path.parent.mkdir(parents=True, exist_ok=True)
    book.save(path)
    book.close()


def notice(root, shipped=60, ordered=100, material='CMP-GAM-001', po='123'):
    pdf(root, 'suppliers/SUP-TEST/order_confirmations/Shipping_advice_test.pdf',
        f'Shipping advice (short shipment)\nYour order {po}\n{material}\nGame Card\n{ordered}\n{shipped}\n{ordered-shipped}\nAWB 111-222\nBalance delivery to Hamburg 2026-11-24')


def test_quantities_come_from_files_and_refresh(tmp_path):
    dataset(tmp_path)
    notice(tmp_path)
    first = analyze(tmp_path)['issues'][0]
    assert first['id'] == 'game-card-shortage'
    assert first['required'] == 120
    assert first['incoming'] == 60
    assert first['shortage'] == 10
    assert first['shipment']['balance_eta'] == '2026-11-24'
    assert first['recovery']['confirmed'] is False
    # Replacing a source changes results; cached text must not preserve stale values.
    (tmp_path/'suppliers/SUP-TEST/order_confirmations/Shipping_advice_test.pdf').unlink()
    notice(tmp_path, shipped=80)
    refreshed = analyze(tmp_path)['issues'][0]
    assert refreshed['incoming'] == 80
    assert refreshed['shortage'] == 0


def test_unmatched_po_never_changes_supply(tmp_path):
    dataset(tmp_path)
    notice(tmp_path, po='999')
    result = analyze(tmp_path)
    assert not result['issues']
    assert any('no matching PO/material' in text for text in result['warnings'])


def test_snapshot_does_not_double_count_old_rows(tmp_path):
    dataset(tmp_path)
    with (tmp_path/'soony/erp/stock_snapshot.csv').open('a') as stream:
        stream.write('2026-11-19,DC-HAM,CMP-GAM-001,old,900\n')
    notice(tmp_path)
    issue = analyze(tmp_path)['issues'][0]
    assert issue['recorded_stock'] == 50
    assert issue['shortage'] == 10


def test_large_receipt_is_provisional_not_fake_ocr(tmp_path):
    material = 'CMP-ART-001'
    dataset(tmp_path, material=material, target=100, stock=130)
    write_csv(tmp_path, 'soony/erp/goods_receipts.csv', [dict(gr_number='receipt-1', po_number='123', po_line='2', material_id=material, supplier_id='SUP-TEST', qty_ordered=10, qty_received=100, delivery_note='DN-TEST')])
    issue = analyze(tmp_path)['issues'][0]
    assert issue['usable_stock'] == 40
    assert issue['shortage'] == 60
    assert issue['confidence'] == 'provisional'
    assert 'has not been machine-read' in issue['summary']


def test_missing_data_returns_actionable_warning(tmp_path):
    result = analyze(tmp_path)
    assert result['issues'] == []
    assert 'dataset missing' in result['warnings'][0]


def test_changed_material_does_not_match_wrong_po_line(tmp_path):
    dataset(tmp_path)
    notice(tmp_path, material='CMP-GAM-999')
    result = analyze(tmp_path)
    assert result['issues'] == []


def test_multiple_references_aggregate_and_notice_discovery_uses_contents(tmp_path):
    dataset(tmp_path, target=200)
    notice(tmp_path)
    original = tmp_path/'suppliers/SUP-TEST/order_confirmations/Shipping_advice_test.pdf'
    destination = tmp_path/'suppliers/SUP-TEST/notices/overnight_update.pdf'
    destination.parent.mkdir(parents=True)
    original.rename(destination)
    pdf(tmp_path, 'suppliers/SUP-TEST/order_confirmations/unhelpful_filename.pdf',
        'Shipping advice (short shipment)\nYour order 123\nCMP-GAM-001\nGame Card\n100\n30\n70\nAWB 333-444\nBalance delivery to Hamburg 2026-11-24')
    pdf(tmp_path, 'suppliers/SUP-TEST/notices/normal.pdf', 'Regular order confirmation\nYour order 123\nNo change')
    path = tmp_path/'soony/context/launch_plan_GH6.xlsx'
    book = load_workbook(path)
    book['Inbound'].append(['Test supplier', 'CMP-GAM-001', 100, 'air', '333-444', '2026-11-20', '2026-11-21', 'booked'])
    book.save(path)
    book.close()
    result = analyze(tmp_path)
    assert len(result['issues']) == 1
    issue = result['issues'][0]
    assert issue['id'] == 'game-card-shortage'
    assert issue['incoming'] == 90  # Both reduced quantities, not 60+100 or 100+30.
    assert issue['shortage'] == 60
    assert len(issue['shipments']) == 2
    assert not any('Could not parse' in warning for warning in result['warnings'])


def test_conflicting_duplicate_advices_are_provisional_and_conservative(tmp_path):
    dataset(tmp_path)
    notice(tmp_path, shipped=60)
    pdf(tmp_path, 'suppliers/SUP-TEST/notices/A_newer_but_no_timestamp.pdf',
        'Shipping advice (short shipment)\nYour order 123\nCMP-GAM-001\nGame Card\n100\n40\n60\nAWB 111-222\nBalance delivery to Hamburg 2026-11-24')
    result = analyze(tmp_path)
    assert len(result['issues']) == 1
    issue = result['issues'][0]
    assert issue['incoming'] == 40
    assert issue['shortage'] == 30
    assert 'provisional' in issue['confidence']
    assert any('Conflicting shipment advices' in warning for warning in result['warnings'])
    assert len(issue['evidence']) == 4  # Keep both contradictory sources.


def test_empty_stock_returns_warning_instead_of_crashing(tmp_path):
    dataset(tmp_path)
    path = tmp_path/'soony/erp/stock_snapshot.csv'
    path.write_text(path.read_text().splitlines()[0]+'\n')
    result = analyze(tmp_path)
    assert result['issues'] == []
    assert any('empty' in warning for warning in result['warnings'])
