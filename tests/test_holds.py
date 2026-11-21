"""Supplier-hold detector on synthetic text and files. No private data, no network."""
import re

from app import holds, public

PO_HEADER = 'po_number,po_line,supplier_id,material_id,plant,quantity,unit_price,currency,order_date,requested_date,promised_date,actual_delivery_date,status,buyer,incoterm,note\n'
HOLD_TEXT = ("Synthetic Supplier Ltd.\nOrder Acknowledgement OA1\nCustomer: Synthetic Buyer GmbH - Your order 4500000001 of 2026-10-20\n"
             "Item\nMaterial\nDescription\nQty\nUnit price\nCur.\nConfirmed\n00010\nCMP-1\nCard\n1,000\n10.00\nUSD\n2026-11-23\n"
             "Terms of delivery: EXW Plant per Sales Agreement. DDP is not agreed.\n"
             "Your order states 'DDP Hamburg'. We do not accept this term. The shipment is packed and on hold at our dock. "
             "We release it to the carrier once Buyer confirms EXW in writing, or nominates its own forwarder.\nSECRET-SENTENCE-XYZ\n")
ROUTINE_TEXT = HOLD_TEXT.split('Your order states')[0]
GERMAN_TEXT = ("Synthetic Lieferant GmbH\nAuftragsbestaetigung\nIhre Bestellung 4500000001\nCMP-1\n1,000\n10.00\nUSD\n"
               "Wir akzeptieren die Lieferbedingung DDP nicht. Die Sendung ist angehalten. Freigabe erfolgt, sobald Sie EXW bestaetigen.\n")
CTX_ROWS = [{'po_number': '4500000001', 'material_id': 'CMP-1', 'quantity': '1000', 'incoterm': 'DDP Hamburg', 'status': 'open',
             'actual_delivery_date': ''}]


def ctx(**extra):
    return {'po_rows': CTX_ROWS, 'components': ['CMP-1', 'CMP-2'], 'supplier_id': 'SUP-1', 'supplier': 'Synthetic Supplier Ltd.',
            'evidence_ref': 'x/y.txt', **extra}


def test_incoterm_hold_is_composed_and_carries_no_document_sentence():
    found = holds.parse_hold_text(HOLD_TEXT, ['CMP-1'], ctx(contract_basis_fn=lambda code: code))
    assert len(found) == 1
    hold = found[0]
    assert hold['blocker_type'] == 'incoterm_hold' and hold['incoterm_required'] == 'EXW' and hold['incoterm_ordered'] == 'DDP'
    assert hold['quantity'] == 1000 and hold['quantity_source'] == 'po' and hold['needs_review'] is False
    assert hold['contract_basis'] == 'EXW' and hold['unlock_kind'] == 'freight_commitment'
    for key in ('required_action', 'consequence'):
        assert 'SECRET' not in hold[key] and 'carrier' not in hold[key]
    assert 'EXW' in hold['required_action'] and 'forwarder' in hold['required_action']
    assert 'pays freight' in hold['consequence']


def test_routine_confirmation_is_not_a_hold():
    assert holds.parse_hold_text(ROUTINE_TEXT, ['CMP-1'], ctx()) == []


def test_german_phrasing_is_detected():
    found = holds.parse_hold_text(GERMAN_TEXT, ['CMP-1'], ctx())
    assert len(found) == 1 and found[0]['blocker_type'] == 'incoterm_hold' and found[0]['incoterm_required'] == 'EXW'


def test_quantity_mismatch_or_unknown_po_needs_review():
    rows = [dict(CTX_ROWS[0], quantity='500')]
    mismatch = holds.parse_hold_text(HOLD_TEXT, ['CMP-1'], ctx(po_rows=rows))
    assert mismatch[0]['needs_review'] is True and mismatch[0]['blocker_type'] == 'other'
    unknown = holds.parse_hold_text(HOLD_TEXT, ['CMP-1'], ctx(po_rows=[]))
    assert unknown[0]['needs_review'] is True


def test_delivered_order_is_not_a_hold():
    rows = [dict(CTX_ROWS[0], status='delivered', actual_delivery_date='2026-11-01')]
    assert holds.parse_hold_text(HOLD_TEXT, ['CMP-1'], ctx(po_rows=rows)) == []


def test_other_blockers_use_templates():
    text = "Your order 4500000001\nCMP-1\n1,000\n10.00\nUSD\nThe shipment is on hold until your prepayment arrives.\n"
    found = holds.parse_hold_text(text, ['CMP-1'], ctx())
    assert found[0]['blocker_type'] == 'payment_hold' and found[0]['unlock_kind'] == 'payment'


def make_files(tmp_path, text=HOLD_TEXT, name='oa_4500000001.txt'):
    (tmp_path / 'soony/erp').mkdir(parents=True)
    (tmp_path / 'soony/erp/purchase_orders_2025H2-2026.csv').write_text(
        PO_HEADER + '4500000001,1,SUP-1,CMP-1,DC,1000,10.0,USD,2026-09-01,2026-11-21,2026-11-21,,open,B,DDP Hamburg,\n', encoding='utf-8')
    (tmp_path / 'soony/master').mkdir(parents=True)
    (tmp_path / 'soony/master/components.csv').write_text('component_id,description,category\nCMP-1,Card,Game Media\n', encoding='utf-8')
    folder = tmp_path / 'suppliers/SUP-1_Synthetic_Supplier'
    (folder / 'order_confirmations').mkdir(parents=True)
    (folder / 'contracts').mkdir()
    (folder / 'contracts/agreement.txt').write_text('Delivery terms: EXW Plant. Freight is for Buyer.\n', encoding='utf-8')
    if text is not None:
        (folder / 'order_confirmations' / name).write_text(text, encoding='utf-8')
    return tmp_path


def test_find_holds_reads_files_and_contract_basis(tmp_path):
    found = holds.find_holds(make_files(tmp_path), ['CMP-1'])
    assert len(found) == 1 and found[0]['supplier'] == 'Synthetic Supplier Ltd.' and found[0]['contract_basis'] == 'EXW'
    assert holds.find_holds(tmp_path, ['CMP-9']) == []


def test_scanned_confirmation_needs_a_person_and_is_not_a_hold(tmp_path):
    root = make_files(tmp_path, text=None)
    (root / 'suppliers/SUP-1_Synthetic_Supplier/order_confirmations/OA_4500000001.pdf').write_bytes(b'%PDF-1.4 not text')
    found = holds.find_holds(root, ['CMP-1'], reader=lambda path: '')
    assert len(found) == 1 and found[0]['needs_review'] is True and found[0]['blocker_type'] == 'other'
    assert found[0]['required_action'] == 'A person must read a scanned supplier confirmation'


def test_public_projection_has_no_file_path_email_phone_or_order_number(tmp_path):
    found = holds.find_holds(make_files(tmp_path), ['CMP-1'])
    found[0]['who_can_unlock'] = {'role': 'Category Lead', 'name': 'Gus', 'vacancy': False}
    shown = public.public_holds(found)
    text = ' '.join(str(v) for v in shown[0].values()) + str(shown[0]['who_can_unlock'])
    assert not public.FILE_TOKEN.search(text) and '@' not in text and not re.search(r'\+\d', text) and '4500000001' not in text
    assert set(shown[0]) == {'supplier', 'blocker_type', 'required_action', 'consequence', 'quantity', 'who_can_unlock', 'needs_review'}
