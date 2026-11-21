import csv
import re
from pathlib import Path

import pytest

from app.conflicts import REVIEW, compare, find_conflicts

REAL = Path(__file__).resolve().parents[1] / 'data' / 'soony-data'


def test_compare_agreement_and_single_source():
    assert compare('x', {'ERP stock': 5, 'Delivery note': '5'}) is None
    assert compare('x', {'ERP stock': 5, 'Delivery note': None}) is None
    assert compare('x', {}) is None


def test_compare_with_preference():
    c = compare('Stock', {'ERP stock': 100, 'Delivery note': 80}, prefer=['Delivery note'])
    assert c['chosen'] == '80 (Delivery note)' and c['confidence'] == 'medium'
    assert c['sources'] == ['ERP stock', 'Delivery note']
    assert 'ERP stock says 100' in c['why']


def test_compare_without_preference_never_guesses():
    c = compare('Stock', {'ERP stock': 100, 'Delivery note': 80})
    assert c['chosen'] == REVIEW and c['confidence'] == 'low'


def write_csv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def test_absent_data_returns_empty(tmp_path):
    assert find_conflicts(tmp_path) == []
    assert find_conflicts(tmp_path / 'missing') == []


def test_receipt_gap_and_revision_from_synthetic_files(tmp_path):
    base = tmp_path / 'soony'
    write_csv(base / 'erp' / 'goods_receipts.csv', [
        {'gr_number': '1', 'po_number': '9', 'material_id': 'CMP-1', 'qty_ordered': '8000', 'qty_received': '80000', 'delivery_note': 'DN-1'},
        {'gr_number': '2', 'po_number': '9', 'material_id': 'CMP-1', 'qty_ordered': '8000', 'qty_received': '8300', 'delivery_note': 'DN-2'},
        {'gr_number': '3', 'po_number': '', 'material_id': 'CMP-1', 'qty_ordered': '', 'qty_received': '24000', 'delivery_note': 'DN-3'},
    ])
    write_csv(base / 'master' / 'components.csv', [{'component_id': 'CMP-1', 'description': 'Art Book (96 p)', 'drawing_rev': 'B'}])
    write_csv(base / 'master' / 'components_update_2026-11-21.csv', [{'component_id': 'CMP-1', 'field': 'drawing_rev', 'old': 'B', 'new': 'C'}])
    write_csv(base / 'master' / 'bom_delta_2026-11-21.csv', [{'child_id': 'CMP-1', 'action': 'revision', 'rev_new': 'C', 'use_up_old_rev': 'N'}])
    found = find_conflicts(tmp_path)
    fields = [c['field'] for c in found]
    assert fields.count('Art Book receipt quantity') == 1
    receipt = next(c for c in found if c['field'].endswith('receipt quantity'))
    assert receipt['confidence'] == 'low' and 'needs human review' in receipt['chosen']
    rev = next(c for c in found if c['field'] == 'Art Book revision')
    assert rev['chosen'].startswith('C') and 'Component master' in rev['sources']
    assert any(c['field'] == 'Art Book parts on hand' for c in found)


def test_malformed_workbooks_give_review_items_not_errors(tmp_path):
    ctx = tmp_path / 'soony' / 'context'
    ctx.mkdir(parents=True)
    (ctx / 'launch_plan_GH6.xlsx').write_bytes(b'not a workbook')
    (ctx / 'launch_status.xlsx').write_bytes(b'not a workbook')
    (ctx / 'memo_launch_priorities.docx').write_bytes(b'broken')
    found = find_conflicts(tmp_path)
    assert found and all(c['chosen'] == REVIEW for c in found)


def test_plan_vs_status_newer_wins(tmp_path):
    openpyxl = pytest.importorskip('openpyxl')
    ctx = tmp_path / 'soony' / 'context'
    ctx.mkdir(parents=True)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Editions'
    ws.append(['Plan status 2026-11-20 18:00'])
    ws.append([])
    ws.append(['Edition', 'Product', 'Packed'])
    ws.append(['Standard', 'FG-STD', 512000])
    wb.save(ctx / 'launch_plan_GH6.xlsx')
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Launch status'
    ws.append(['Launch status Saturday 13:00'])
    ws.append([])
    ws.append(['Name', 'Product', 'Packed'])
    ws.append(['Standard', 'FG-STD', '554.000'])
    wb.save(ctx / 'launch_status.xlsx')
    found = find_conflicts(tmp_path)
    assert len(found) == 1
    assert found[0]['chosen'] == '554,000 (Launch status)' and 'newer' in found[0]['why']


@pytest.mark.skipif(not (REAL / 'soony').is_dir(), reason='customer data not present')
def test_real_data_output_is_clean():
    found = find_conflicts(REAL)
    assert isinstance(found, list)
    for c in found:
        assert set(c) == {'field', 'why', 'chosen', 'confidence', 'sources'}
        assert c['confidence'] in ('low', 'medium', 'high')
        for text in [c['field'], c['why'], c['chosen'], *c['sources']]:
            assert '/' not in text and '@' not in text
            assert not re.search(r'\.(pdf|csv|xlsx?|docx?|png|jpe?g|md|txt|json|zip)\b', text, re.I)
