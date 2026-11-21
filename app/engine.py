"""Evidence-preserving local reconciliation. No outbound effects or model claims.

Amounts come from customer records; document parsers fail closed when a supported
layout is absent. Supplier text is data, not instructions. Dates are snapshot dates,
not a claim about current warehouse availability.
"""
from __future__ import annotations

import csv
import re
from collections import defaultdict
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import pymupdf
from openpyxl import load_workbook


def _number(value):
    return float(str(value or 0).replace(',', '').strip())


def _rows(root, path):
    file = root / path
    if not file.exists():
        return []
    with file.open(encoding='utf-8-sig', newline='') as stream:
        return list(csv.DictReader(stream))


@lru_cache(maxsize=512)
def _pdf_cached(path, mtime, size):
    with pymupdf.open(path) as document:
        return '\n'.join(page.get_text() for page in document)


def _text(path):
    stat = path.stat()
    return _pdf_cached(str(path.resolve()), stat.st_mtime_ns, stat.st_size)


def _evidence(root, path, label, excerpt):
    return {'path': str(Path(path).relative_to(root)).replace('\\', '/'),
            'label': label, 'excerpt': excerpt}


def _action(title, description):
    return {'title': title, 'description': description}


def _profile(root, supplier_id):
    for file in sorted(root.glob('suppliers/*/profile.csv')):
        for row in _rows(root, str(file.relative_to(root))):
            if row.get('supplier_id') == supplier_id:
                return row
    return {}


def _plan(root):
    """Read the customer's named launch workbook; preserve its row values."""
    file = root / 'soony/context/launch_plan_GH6.xlsx'
    if not file.exists():
        return [], [], None
    book = load_workbook(file, read_only=True, data_only=True)
    products, inbound = [], []
    try:
        for sheet in book:
            for values in sheet.iter_rows(values_only=True):
                values = list(values)
                if len(values) >= 9 and str(values[1] or '').startswith('FG-'):
                    products.append({'id': values[1], 'name': str(values[0]),
                                     'target': int(_number(values[2])),
                                     'packed': int(_number(values[4])),
                                     'remaining': max(0, int(_number(values[2]) - _number(values[4]))),
                                     'rate_per_hour': _number(values[6]),
                                     'hours_available': _number(values[8])})
                if len(values) >= 8 and str(values[1] or '').startswith('CMP-') and str(values[3] or '') in {'air', 'road', 'sea'}:
                    inbound.append({'supplier': str(values[0]), 'material_id': values[1],
                                    'quantity': int(_number(values[2])), 'mode': values[3],
                                    'reference': str(values[4]), 'eta': str(values[6])[:10],
                                    'status': str(values[7])})
    finally:
        book.close()
    return products, inbound, file


WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


def _de_number(value):
    """German exports write 554.000 for 554,000; a plain float() would read 554."""
    text = str(value if value is not None else '').strip()
    if re.fullmatch(r'\d{1,3}(\.\d{3})+', text):
        return int(text.replace('.', ''))
    return int(_number(text))


def _status(root):
    """Newer pack-out counts than the planning workbook, if the customer supplied them."""
    file = root / 'soony/context/launch_status.xlsx'
    if not file.exists():
        return None
    book = load_workbook(file, read_only=True, data_only=True)
    packed, as_of, notes = {}, None, []
    try:
        for sheet in book:
            for values in sheet.iter_rows(values_only=True):
                values = list(values)
                for cell in values:
                    match = re.search(r'(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{2})', str(cell or ''))
                    if match and not as_of:
                        as_of = {'day': match[1], 'hour': int(match[2]) + int(match[3]) / 60, 'label': f'{match[1]} {match[2]}:{match[3]}'}
                if len(values) >= 5 and str(values[1] or '').startswith('FG-'):
                    packed[values[1]] = _de_number(values[3])
                elif sheet.title == 'Notes' and values and values[0] and values[0] != 'Note':
                    notes.append(str(values[0]))
    finally:
        book.close()
    return {'file': file, 'packed': packed, 'as_of': as_of, 'notes': notes} if packed else None


def _shifts(root):
    file = root / 'soony/context/launch_plan_GH6.xlsx'
    shifts = {}
    if not file.exists():
        return shifts
    book = load_workbook(file, read_only=True, data_only=True)
    try:
        for sheet in book:
            for values in sheet.iter_rows(values_only=True):
                if values and values[0] in WEEKDAYS and len(values) > 1:
                    match = re.search(r'(\d{1,2}):(\d{2})\D+(\d{1,2}):(\d{2})', str(values[1] or ''))
                    if match:
                        shifts[values[0]] = (int(match[1]) + int(match[2]) / 60, int(match[3]) + int(match[4]) / 60)
    finally:
        book.close()
    return shifts


def _hours_left(shifts, as_of):
    if not shifts or not as_of or as_of['day'] not in WEEKDAYS:
        return None
    total = 0.0
    for day, (start, end) in shifts.items():
        if WEEKDAYS.index(day) < WEEKDAYS.index(as_of['day']):
            continue
        total += max(0.0, end - max(start, as_of['hour'])) if day == as_of['day'] else end - start
    return round(total, 1)


def _docx_text(path):
    import zipfile
    with zipfile.ZipFile(path) as archive:
        xml = archive.read('word/document.xml').decode('utf-8', 'replace')
    return ' '.join(re.sub(r'<[^>]+>', ' ', xml.replace('</w:p>', '\n')).split())


def _short_shipment(text):
    """Parse explicit ordered / shipped / balance rows, never infer from prose alone."""
    if not re.search(r'short shipment', text, re.I):
        return None
    po = re.search(r'Your order\s+(\d+)', text, re.I)
    material = re.search(r'\bCMP-[A-Z]+-\d+\b', text)
    quantities = [int(x.replace(',', '')) for x in re.findall(r'^\s*(\d[\d,]*)\s*$', text, re.M)]
    if not po or not material or len(quantities) < 3:
        return None
    ordered, shipped, balance = quantities[:3]
    if ordered <= 0 or min(shipped, balance) < 0 or shipped + balance != ordered:
        return None
    awb = re.search(r'AWB\s+([\d-]+)', text)
    eta = re.search(r'delivery to Hamburg\s+(\d{4}-\d{2}-\d{2})', text, re.I)
    return {'po_number': po[1], 'material_id': material[0], 'ordered': ordered,
            'shipped': shipped, 'balance': balance, 'reference': awb[1] if awb else None,
            'balance_eta': eta[1] if eta else None}


def analyze(data_dir: Path) -> dict:
    root = Path(data_dir).resolve()
    result = {'snapshot_at': None, 'analyzed_at': datetime.now(timezone.utc).isoformat(),
              'products': [], 'issues': [], 'warnings': [], 'engine': 'evidence rules',
              'data_dir_available': root.is_dir()}
    if not (root / 'soony/erp/stock_snapshot.csv').exists():
        result['warnings'].append('Customer dataset missing. Extract the portal archive under data/soony-data.')
        return result
    stocks = _rows(root, 'soony/erp/stock_snapshot.csv')
    pos = _rows(root, 'soony/erp/purchase_orders_2025H2-2026.csv')
    receipts = _rows(root, 'soony/erp/goods_receipts.csv')
    bom = _rows(root, 'soony/master/bom.csv')
    components = {r['component_id']: r for r in _rows(root, 'soony/master/components.csv')}
    product_master = _rows(root, 'soony/master/products.csv')
    products, inbound, plan_file = _plan(root)
    result['products'] = products
    if not products:
        result['warnings'].append('Launch workbook missing or unsupported; remaining launch requirements cannot be calculated.')
        return result
    if not stocks:
        result['warnings'].append('Stock snapshot is empty; no inventory calculations were applied.')
        return result
    snapshot = max(r['snapshot_date'] for r in stocks)
    result['snapshot_at'] = snapshot
    stock = defaultdict(float)
    batches = {}
    for row in stocks:
        if row['snapshot_date'] == snapshot and row.get('site') == 'DC-HAM':
            stock[row['material_id']] += _number(row['quantity'])
            if row.get('batch'):
                batches[row['batch']] = row
    # The newest pack-out counts win over the planning workbook. Parts used by the
    # copies packed since the plan are removed from the ERP stock estimate too,
    # otherwise requirement and stock would describe different moments.
    raw_stock = dict(stock)
    status = _status(root)
    packed_since = {}
    result['pack_status'] = {'source': 'launch_plan_GH6.xlsx', 'as_of': 'plan status 2026-11-20 18:00', 'stock_basis': 'ERP snapshot'}
    if status:
        hours_left = _hours_left(_shifts(root), status['as_of'])
        for product in products:
            newer = status['packed'].get(product['id'])
            if newer is None:
                continue
            if product['packed'] <= newer <= product['target']:
                packed_since[product['id']] = newer - product['packed']
                product.update(plan_packed=product['packed'], packed=newer, remaining=product['target'] - newer)
            else:
                result['warnings'].append(f"Status file pack count for {product['id']} ({newer:,}) contradicts the plan; plan count kept. Verify with the line lead.")
            if hours_left is not None:
                product['hours_available'] = hours_left
        if packed_since:
            label = status['as_of']['label'] if status['as_of'] else 'latest status'
            result['pack_status'] = {'source': 'launch_status.xlsx', 'as_of': label, 'notes': status['notes'], 'hours_left': hours_left,
                                     'stock_basis': 'ERP snapshot minus parts used by copies packed since the plan (estimate, no physical count)'}
            result['warnings'].append(f'Pack-out uses {label} counts (newer than the launch plan). Stock is an estimate: ERP snapshot less parts consumed since; no physical count exists.')
    for product in products:
        product['hours_needed'] = round(product['remaining'] / product['rate_per_hour'], 1) if product.get('rate_per_hour') else None
    required = defaultdict(float)
    affected = defaultdict(list)
    need_by_product = defaultdict(dict)
    for product in products:
        for row in bom:
            if row['parent_id'] == product['id'] and row.get('valid_from', '') <= snapshot <= row.get('valid_to', '9999-12-31'):
                required[row['child_id']] += product['remaining'] * _number(row['qty_per'])
                affected[row['child_id']].append(product['id'])
                need_by_product[row['child_id']][product['id']] = product['remaining'] * _number(row['qty_per'])
                if packed_since.get(product['id']):
                    stock[row['child_id']] = max(0.0, stock[row['child_id']] - packed_since[product['id']] * _number(row['qty_per']))
    launch_dates = [r['launch_date'] for r in product_master if r.get('product_id') in {p['id'] for p in products}]
    launch = max(launch_dates) if launch_dates else None
    if launch is None:
        result['warnings'].append('Launch date missing: inbound cannot be classified as before launch.')
    result['launch_date'] = launch
    result['warnings'].append('Stock and pack-out are snapshot data. Confirm current counts, remaining shifts, and usable arrival at DC-HAM; an airport ETA is not warehouse receipt.')

    def evidence(path, label, excerpt):
        return _evidence(root, root / path, label, excerpt)

    def issue(identifier, material, title, severity='critical'):
        return {'id': identifier, 'title': title, 'material_id': material,
                'material_name': components.get(material, {}).get('description', material),
                'severity': severity, 'status': 'investigation_required',
                'required': int(required[material]), 'recorded_stock': int(raw_stock.get(material, 0)),
                'usable_stock': int(stock[material]), 'incoming': 0,
                'shortage': 0, 'affected_products': affected[material],
                'confidence': 'documented', 'evidence': [], 'actions': [],
                'recovery': {'status': 'unconfirmed', 'confirmed': False}}

    priority = None
    memo = root / 'soony/context/memo_launch_priorities.docx'
    if memo.exists():
        memo_text = _docx_text(memo)
        if re.search(r"Collector.s Edition first", memo_text, re.I):
            priority = {'name': 'Collector', 'path': memo, 'text': memo_text, 'rule': "Collector's Edition first (CPO memo, binding until launch)"}

    def allocate(item, material):
        needs = need_by_product.get(material, {})
        if len(needs) < 2 or not priority:
            return
        available = max(0, item['usable_stock'] + item['incoming'])
        lines = []
        for product in sorted(products, key=lambda p: priority['name'].lower() not in p['name'].lower()):
            need = int(needs.get(product['id'], 0))
            if not need:
                continue
            covered = min(need, available)
            available -= covered
            lines.append({'product_id': product['id'], 'name': product['name'], 'needed': need, 'covered': covered, 'short': need - covered,
                          'hours_needed': product.get('hours_needed'), 'hours_available': product.get('hours_available')})
        item['allocation'] = {'rule': priority['rule'], 'lines': lines,
                              'caveat': 'Incoming units count only if they reach DC-HAM and are released before the line needs them.'}
        item['evidence'].append(_evidence(root, priority['path'], 'CPO launch priorities', priority['text'][:1500]))

    # Discover by content: filenames and folder labels are not evidence of type.
    by_material = defaultdict(list)
    candidates = sorted(set(root.glob('suppliers/*/order_confirmations/*.pdf')) |
                        set(root.glob('suppliers/*/notices/*.pdf')))
    for path in candidates:
        text = _text(path)
        if not re.search(r'short shipment', text, re.I):
            continue
        advice = _short_shipment(text)
        if not advice:
            result['warnings'].append(f'Could not parse shipment advice: {path.name}; human review needed.')
            continue
        material = advice['material_id']
        if not required[material]:
            continue
        matching_pos = [r for r in pos if r['po_number'] == advice['po_number'] and r['material_id'] == material]
        if not matching_pos:
            result['warnings'].append(f"Shipping advice {path.name} has no matching PO/material; quantity not applied.")
            continue
        by_material[material].append((advice, path, text, matching_pos[0]))
    for material, records in by_material.items():
        identifier = 'game-card-shortage' if material == 'CMP-GAM-001' else f'shipment-{material.lower()}'
        item = issue(identifier, material, 'Game cards: short shipment threatens launch')
        per_reference = defaultdict(list)
        for record in records:
            per_reference[record[0]['reference']].append(record)
        conflicting = False
        effective = {}
        for reference, versions in per_reference.items():
            # No reliable document-version timestamp exists in this layout. Never
            # let lexical filename order silently choose among contradictory facts.
            quantities = {(v[0]['ordered'], v[0]['shipped'], v[0]['balance'], v[0]['balance_eta']) for v in versions}
            if len(quantities) > 1:
                conflicting = True
                result['warnings'].append(f'Conflicting shipment advices for {reference or material}; no authoritative version established. Using the lowest shipped quantity as a provisional planning bound; verify with supplier.')
            effective[reference] = min(v[0]['shipped'] for v in versions)
        incoming = 0
        matched_references = set()
        for shipment in inbound:
            if shipment['material_id'] != material or not launch or shipment['eta'] > launch:
                continue
            reference = shipment['reference']
            if reference in effective:
                if reference in matched_references:
                    result['warnings'].append(f'Duplicate launch-plan inbound reference {reference}; adjusted quantity counted once.')
                    continue
                incoming += effective[reference]
                matched_references.add(reference)
            else:
                incoming += shipment['quantity']
        for reference in effective:
            if reference not in matched_references:
                result['warnings'].append(f"Advice for {reference or material} did not match a pre-launch shipment reference. Arrival needs verification.")
        item['incoming'] = incoming
        item['shortage'] = max(0, item['required'] - item['usable_stock'] - incoming)
        item['shipments'] = [r[0] for r in records]
        # Backward-compatible detail for the primary advice; the plural collection
        # is authoritative when multiple references or versions are present.
        item['shipment'] = records[0][0] if len(records) == 1 else None
        supplier_ids = sorted({r[3]['supplier_id'] for r in records})
        item['suppliers'] = [_profile(root, supplier_id) for supplier_id in supplier_ids]
        item['supplier'] = item['suppliers'][0] if len(supplier_ids) == 1 else {}
        changes = '; '.join(f"{r[0]['reference'] or r[0]['po_number']}: {r[0]['ordered']:,} ordered, {r[0]['shipped']:,} shipped" for r in records)
        item['summary'] = (f"Supplier advice: {changes}. "
                           f"Recorded stock plus documented pre-launch inbound leaves a {item['shortage']:,}-unit gap. "
                           'Warehouse arrival, allocation, and any recovery remain unconfirmed.')
        if conflicting:
            item['confidence'] = 'provisional — conflicting supplier advice'
            item['status'] = 'verification_required'
        item['evidence'] = [_evidence(root, r[1], 'Short-shipment advice', r[2][:2600]) for r in records]
        item['evidence'].extend([
            evidence('soony/erp/stock_snapshot.csv', 'Stock snapshot', f"{material}: {int(raw_stock.get(material, 0)):,} recorded at {snapshot}; estimated {int(stock[material]):,} after parts used since."),
            _evidence(root, plan_file, 'Launch requirements and inbound assumptions', f"{item['required']:,} units required; scheduled inbound must be reconciled with all supplier advices.")])
        item['actions'] = [_action('Confirm warehouse arrival', 'Ask the supplier and forwarder for flight status, handling time, final-mile delivery and dock slot.'),
                           _action('Investigate recovery', 'Request confirmed spare stock or earlier transport with quantities, prices, and DC-HAM delivery times.'),
                           _action('Escalate allocation', 'If no recovery is feasible, have the authorized customer decide allocation between editions. Do not sum overlapping shortages.')]
        item['recovery'].update({'description': 'No feasible recovery has been confirmed in the supplied data.',
                                 'options': ['Expedite confirmed available stock', 'Check alternative supplier availability', 'Approve allocation if recovery is infeasible'],
                                 'cost_eur': None, 'arrival_at': None})
        allocate(item, material)
        result['issues'].append(item)

    # Receipt anomalies are estimates from ordered quantities, not an OCR claim.
    for receipt in receipts:
        batch = batches.get(receipt['gr_number'])
        if not batch or not required[receipt['material_id']]:
            continue
        ordered, received = _number(receipt['qty_ordered']), _number(receipt['qty_received'])
        if ordered <= 0 or received <= ordered * 2:
            continue
        material = receipt['material_id']
        item = issue('art-book-stock' if 'Art Book' in components.get(material, {}).get('description', '') else f'receipt-{receipt["gr_number"]}', material, 'Art books: receipt quantity requires verification')
        item['usable_stock'] = int(max(0, stock[material] - min(_number(batch['quantity']), received - ordered)))
        item['shortage'] = max(0, item['required'] - item['usable_stock'])
        item['confidence'] = 'provisional'
        item['status'] = 'verification_required'
        item['supplier'] = _profile(root, receipt['supplier_id'])
        item['summary'] = (f"Receipt {receipt['gr_number']} records {int(received):,} against {int(ordered):,} ordered. "
                           f"Using the ordered quantity as a conservative estimate gives {item['usable_stock']:,} available and a {item['shortage']:,} gap. "
                           'The scanned handwritten correction has not been machine-read; verify it and obtain a physical count.')
        item['evidence'] = [evidence('soony/erp/goods_receipts.csv', 'Receipt versus order discrepancy', str(receipt)),
                            evidence('soony/erp/stock_snapshot.csv', 'Batch stock', str(batch))]
        scans = list(root.glob(f"soony/receiving/**/*{receipt['delivery_note']}*"))
        for scan in scans:
            item['evidence'].append(_evidence(root, scan, 'Original delivery scan — human review required', 'Review the printed amount, handwritten correction and receiving signature. No OCR correction has been applied.'))
        offers = list(root.glob('suppliers/*/notices/*.pdf'))
        for offer in offers:
            text = _text(offer)
            if material not in text or not re.search('overrun from', text, re.I):
                continue
            quantity_match = re.search(r'/\s*([\d,]+)\s*pcs', text[text.index(material):])
            qty = int(quantity_match[1].replace(',', '')) if quantity_match else None
            po_prices = [_number(r['unit_price']) for r in pos if r['material_id'] == material and r['supplier_id'] == receipt['supplier_id'] and r['currency'] == 'EUR']
            price = po_prices[-1] if po_prices else None
            load_match = re.search(r'loaded\s+within\s+(\d+)\s*h', text, re.I)
            drive_match = re.search(r'about\s+(\d+)\s*h driving', text, re.I)
            item['recovery'].update({'description': 'Finished-stock offer; availability, validity, approval, transport and receiving slot require confirmation.',
                                     'offered_quantity': qty, 'unit_price_eur': price,
                                     'cost_eur': round(qty * price, 2) if qty and price else None,
                                     'loading_hours': int(load_match[1]) if load_match else None,
                                     'driving_hours': int(drive_match[1]) if drive_match else None,
                                     'price_basis': 'Historical EUR PO price; supplier offer references Annex A. Confirm quote before ordering.'})
            item['evidence'].append(_evidence(root, offer, 'Potential finished-stock recovery', text[:3000]))
        item['actions'] = [_action('Verify physical stock', 'Review the handwritten correction and ask receiving to count usable art books.'),
                           _action('Confirm offered stock and delivery', 'Confirm the offer is still valid and that loading, transport, dock receiving and remaining packing time fit the launch deadline.')]
        result['issues'].append(item)

    for path in sorted(root.glob('soony/receiving/**/inspection_report_*.pdf')):
        text = _text(path)
        if 'Lot does not meet AQL' not in text:
            continue
        match = re.search(r'Goods receipt\s+(\d+)', text)
        batch = batches.get(match[1]) if match else None
        if not batch or not required[batch['material_id']]:
            continue
        material = batch['material_id']
        item = issue('statue-quality', material, 'Statues: failed inspection in unrestricted stock')
        item['usable_stock'] = int(max(0, stock[material] - _number(batch['quantity'])))
        item['shortage'] = max(0, item['required'] - item['usable_stock'])
        item['summary'] = f"Exclude {int(_number(batch['quantity'])):,} units from planning pending authorized concession. This leaves a {item['shortage']:,}-unit gap. ERP unrestricted status is not quality approval."
        item['evidence'] = [_evidence(root, path, 'Failed incoming inspection', text)]
        item['actions'] = [_action('Escalate quality decision', 'Request disposition from Supplier Quality and the responsible Category Lead; do not auto-release rejected stock.')]
        result['issues'].append(item)

    for path in sorted(root.glob('suppliers/*/contracts/*.pdf')):
        text = _text(path)
        if 'CMP-MAG-' not in text or 'fitted by' not in text:
            continue
        material_match = re.search(r'CMP-MAG-\d+', text)
        material = material_match[0]
        if not required[material]:
            continue
        item = issue('magnet-bom', material, 'Magnets: verify assembly-level BOM before buying', 'info')
        item['status'] = 'bom_review'
        item['confidence'] = 'documented — assembly verification required'
        item['summary'] = 'The flat BOM requests loose magnets, but the supplier contract says magnets are fitted into collector boxes and included in their price. Do not treat zero loose stock as a confirmed shortage.'
        item['evidence'] = [_evidence(root, path, 'Supplier-fitted components', text[-2500:])]
        item['actions'] = [_action('Verify supplied assembly', 'Confirm box batches include fitted magnets and correct BOM consumption to avoid double counting.')]
        result['issues'].append(item)
        break
    result['issues'].sort(key=lambda r: (r['id'] != 'game-card-shortage', {'critical': 0, 'warning': 1, 'info': 2}.get(r['severity'], 1), r['id']))
    result['file_count'] = sum(1 for p in root.rglob('*') if p.is_file())
    return result
