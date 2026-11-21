"""Where the sources disagree. Read-only, defensive, sources named by category only.

Each check reads real files under the data folder when present. A file that cannot be read, or a
scan with no text, becomes a 'needs human review' item: this module never guesses.
"""
import csv
import re
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

REVIEW = 'needs human review'
LEVELS = ('low', 'medium', 'high')
FILE_WORDS = re.compile(r'\.(?:pdf|csv|xlsx?|xlsm|docx?|pptx?|png|jpe?g|md|txt|eml|json|xml|ya?ml|msg|zip)\b', re.I)
WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']


# ------------------------------------------------------------------ pure helpers

def _clean(text):
    text = FILE_WORDS.sub('', str(text)).replace('/', ' and ').replace('\\', ' ').replace('@', ' at ')
    return re.sub(r'\s{2,}', ' ', text).strip()


def _show(value):
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return f'{value:,}' if isinstance(value, int) and not isinstance(value, bool) else str(value)


def _same(a, b):
    return str(a).strip().casefold() == str(b).strip().casefold()


def _item(field, why, chosen, confidence, sources):
    return {'field': _clean(field), 'why': _clean(why), 'chosen': _clean(chosen),
            'confidence': confidence if confidence in LEVELS else 'low', 'sources': [_clean(s) for s in sources]}


def _review(field, why, sources):
    return _item(field, why, REVIEW, 'low', sources)


def compare(field, values_by_source, prefer=None):
    """Compare one field across sources.

    values_by_source: {source category: value}; None or '' means that source says nothing.
    prefer: source categories ordered most trusted first. Returns None when sources agree (or fewer
    than two speak), else {field, why, chosen, confidence, sources}. Without a preference there is
    no guess: chosen is 'needs human review' and confidence is low.
    """
    present = {s: v for s, v in (values_by_source or {}).items() if v is not None and v != ''}
    if len(present) < 2:
        return None
    first = next(iter(present.values()))
    if all(_same(first, v) for v in present.values()):
        return None
    why = '; '.join(f'{s} says {_show(v)}' for s, v in present.items()) + '.'
    pick = next((s for s in (prefer or []) if s in present), None)
    if pick is None:
        return _item(field, why, REVIEW, 'low', list(present))
    return _item(field, why, f'{_show(present[pick])} ({pick})', 'medium', list(present))


def _number(text):
    """Parse '554.000' (thousands dots), '1,000' and plain digits. None when not a number."""
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return float(text)
    s = str(text).strip().replace(' ', '').replace(' ', '')
    if re.fullmatch(r'\d{1,3}([.,]\d{3})+', s):
        return float(re.sub(r'[.,]', '', s))
    try:
        return float(s.replace(',', '.'))
    except ValueError:
        return None


# ------------------------------------------------------------------ file readers

def _root(data_dir):
    base = Path(data_dir)
    return base / 'soony' if (base / 'soony').is_dir() else base


def _csv(path):
    try:
        with open(path, encoding='utf-8-sig', newline='') as stream:
            return list(csv.DictReader(stream))
    except (OSError, csv.Error, UnicodeDecodeError):
        return None


def _sheets(path):
    """{sheet title: [row tuples]} or None when the workbook cannot be read."""
    try:
        import openpyxl
        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
        out = {ws.title: [tuple(r) for r in ws.iter_rows(values_only=True)] for ws in wb}
        wb.close()
        return out
    except Exception:
        return None


def _table(rows, first_header):
    """Rows below the header row whose first cell equals first_header, as dicts."""
    for i, row in enumerate(rows or []):
        if row and row[0] is not None and str(row[0]).strip().casefold() == first_header.casefold():
            head = [str(c).strip() if c is not None else '' for c in row]
            return [dict(zip(head, r)) for r in rows[i + 1:] if any(c is not None for c in r)]
    return []


def _docx_text(path):
    try:
        with zipfile.ZipFile(path) as z:
            xml = z.read('word/document.xml').decode('utf-8', 'ignore')
        return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', xml.replace('</w:p>', '\n')))
    except Exception:
        return None


def _pdf_text(path):
    try:
        import pymupdf
        with pymupdf.open(path) as doc:
            return ' '.join(page.get_text() for page in doc).strip()
    except Exception:
        return None


def _title(sheets):
    for rows in (sheets or {}).values():
        if rows and rows[0] and rows[0][0]:
            return str(rows[0][0])
    return ''


# ------------------------------------------------------------------ checks

def _check_receipts(root):
    path = root / 'erp' / 'goods_receipts.csv'
    if not path.exists():
        return []
    rows = _csv(path)
    if rows is None:
        return [_review('Goods receipt quantity', 'The receipt list could not be read.', ['Goods receipt'])]
    names = {r.get('component_id'): r.get('description') for r in (_csv(root / 'master' / 'components.csv') or [])}
    stock = {r.get('batch'): _number(r.get('quantity')) for r in (_csv(root / 'erp' / 'stock_snapshot.csv') or [])}
    found = []
    for r in rows:
        ordered, received = _number(r.get('qty_ordered')), _number(r.get('qty_received'))
        if not ordered or received is None or received < 2 * ordered:
            continue  # small over- and under-deliveries are normal; this is an order-of-magnitude gap
        part = re.sub(r'\s*\(.*', '', names.get(r.get('material_id')) or 'a part')
        sources = ['Purchase order', 'Goods receipt']
        if stock.get(r.get('gr_number')) is not None:
            sources.append('ERP stock')
        sources.append('Delivery note')
        note = (r.get('delivery_note') or '').strip()
        scans = sorted((root / 'receiving').glob(f'*/*{note}*')) if note and (root / 'receiving').is_dir() else []
        if not scans:
            scan_note = 'No delivery note scan is on file, so the quantity cannot be checked.'
        else:
            text = _pdf_text(scans[0]) if scans[0].suffix.lower() == '.pdf' else None
            scan_note = 'The delivery note is a scan with no readable text.' if not text else 'The delivery note text must be read by a person.'
        why = (f'{part}: the order was {_show(ordered)} but receiving booked {_show(received)}, more than double. '
               f'{scan_note} A person should compare it with the paper note.')
        found.append(_item(f'{part} receipt quantity', why,
                           f'{REVIEW}; until checked, count on the ordered {_show(ordered)}', 'low', sources))
    return found


def _status_time(title, plan_dt):
    m = re.search(r'(' + '|'.join(WEEKDAYS) + r')\s+(\d{1,2}):(\d{2})', title, re.I)
    if not m or plan_dt is None:
        return None
    target, day = WEEKDAYS.index(m.group(1).lower()), plan_dt.date()
    for _ in range(8):
        cand = datetime(day.year, day.month, day.day, int(m.group(2)), int(m.group(3)))
        if day.weekday() == target and cand > plan_dt:
            return cand
        day += timedelta(days=1)
    return None


def _check_plan_vs_status(root):
    plan_path, status_path = root / 'context' / 'launch_plan_GH6.xlsx', root / 'context' / 'launch_status.xlsx'
    if not plan_path.exists() or not status_path.exists():
        return []
    plan, status = _sheets(plan_path), _sheets(status_path)
    if plan is None or status is None:
        return [_review('Packed copies', 'A launch workbook could not be read.', ['Launch plan', 'Launch status'])]
    plan_rows = _table(plan.get('Editions'), 'Edition')
    status_rows = _table(next(iter(status.values()), []), 'Name')
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})', _title(plan))
    plan_dt = datetime(*map(int, m.groups())) if m else None
    newer = _status_time(_title(status), plan_dt)
    by_product = {str(r.get('Product')): r for r in status_rows}
    found = []
    for row in plan_rows:
        other = by_product.get(str(row.get('Product')))
        a, b = _number(row.get('Packed')), _number((other or {}).get('Packed'))
        if a is None or b is None or a == b:
            continue
        name = str(row.get('Edition') or row.get('Product'))
        item = compare(f'{name} packed copies', {'Launch plan': int(a), 'Launch status': int(b)},
                       ['Launch status', 'Launch plan'] if newer else None)
        if item:
            item['why'] += ' The status sheet is the newer one.' if newer else ' Which one is newer cannot be told.'
            found.append(item)
    return found


def _norm(text, date_only=False):
    s = re.sub(r'[\s_]+', ' ', str(text or '')).strip().lower()
    return s[:10] if date_only else s


def _check_shipments(root):
    logistics = root / 'logistics'
    tracker_path = next(iter(sorted(logistics.glob('*.xlsx'))), None) if logistics.is_dir() else None
    erp_path = root / 'erp' / 'open_shipments.csv'
    if tracker_path is None or not erp_path.exists():
        return []
    erp_rows, tracker = _csv(erp_path), _sheets(tracker_path)
    if erp_rows is None or tracker is None:
        return [_review('Shipment status', 'A shipment list could not be read.', ['Shipment tracker', 'Carrier feed'])]
    trows = _table(next(iter(tracker.values()), []), 'Shipment')
    plan_path = root / 'context' / 'launch_plan_GH6.xlsx'
    plan = _sheets(plan_path) if plan_path.exists() else {}
    inbound = {str(r.get('Reference')): r for r in _table((plan or {}).get('Inbound'), 'Supplier')}
    erp = {r.get('reference'): r for r in erp_rows}
    found = []
    for t in trows:
        ref = str(t.get('Container/AWB') or '')
        e, p = erp.get(ref), inbound.get(ref)
        if not e:
            continue
        label = str(t.get('Supplier') or 'Shipment')
        for field, kt, ke, kp, date_only in (('arrival date', 'ETA', 'eta', 'ETA', True), ('status', 'Status', 'status', 'Status', False)):
            values = {'Shipment tracker': _norm(t.get(kt), date_only), 'Carrier feed': _norm(e.get(ke), date_only)}
            if p:
                values['Launch plan'] = _norm(p.get(kp), date_only)
            item = compare(f'{label} shipment {field}', values, ['Carrier feed', 'Launch plan', 'Shipment tracker'])
            if item:
                item['why'] += ' The tracker is a hand-kept sheet; the carrier feed carries a timestamp.'
                found.append(item)
    return found


def _check_revisions(root):
    delta_path, update_path = root / 'master' / 'bom_delta_2026-11-21.csv', root / 'master' / 'components_update_2026-11-21.csv'
    if not delta_path.exists() and not update_path.exists():
        return []
    delta, update, master = _csv(delta_path) or [], _csv(update_path) or [], _csv(root / 'master' / 'components.csv') or []
    master = {r.get('component_id'): r for r in master}
    names = {k: re.sub(r'\s*\(.*', '', v.get('description') or k) for k, v in master.items()}
    upd = {r.get('component_id'): r.get('new') for r in update if r.get('field') == 'drawing_rev'}
    found = []
    for r in delta:
        cid = r.get('child_id')
        if str(r.get('action')).lower() != 'revision':
            continue
        name = names.get(cid, 'A component')
        values = {'Component master': (master.get(cid) or {}).get('drawing_rev'), 'Component update': upd.get(cid),
                  'Engineering change': r.get('rev_new')}
        item = compare(f'{name} revision', values, ['Engineering change', 'Component update', 'Component master'])
        if item:
            item['why'] += ' The master list has not been updated yet.'
            found.append(item)
        if str(r.get('use_up_old_rev')).upper() == 'N':
            found.append(_item(f'{name} parts on hand',
                               'The engineering change says parts of the old revision must not be packed, but stock records do not show which revision each batch holds.',
                               'Hold parts of unknown revision until the batch revision is confirmed', 'medium',
                               ['Engineering change', 'ERP stock']))
    return found


def _check_inspections(root):
    folder = root / 'receiving'
    if not folder.is_dir():
        return []
    stock = {r.get('batch') for r in _csv(root / 'erp' / 'stock_snapshot.csv') or []}
    found = []
    for path in sorted(folder.glob('*/inspection_report_*')):
        text = _pdf_text(path) if path.suffix.lower() == '.pdf' else None
        if not text:
            found.append(_review('Incoming inspection result', 'An inspection report has no readable text.', ['Inspection report']))
        elif re.search(r'does not meet|rejected', text, re.I):
            batch = re.search(r'(\d{10})', path.name)
            counted = bool(batch and batch.group(1) in stock)
            found.append(_item('Quality status of a received lot',
                               'Incoming inspection says the lot fails the sampling limit and blocking was requested, while receiving booked it as usable'
                               + (' and it counts in stock.' if counted else '.'),
                               'Treat the lot as blocked until a signed concession exists (Inspection report)', 'medium',
                               ['Inspection report', 'ERP stock']))
    return found


def _check_memo(root):
    memo, plan = root / 'context' / 'memo_launch_priorities.docx', root / 'context' / 'launch_plan_GH6.xlsx'
    if not memo.exists() or not plan.exists():
        return []
    text = _docx_text(memo)
    if not text:
        return [_review('Priority for shared parts', 'The priority memo could not be read.', ['CPO memo', 'Launch plan'])]
    memo_date = re.search(r'Date:\s*(\d{4}-\d{2}-\d{2})', text)
    plan_date = re.search(r'(\d{4}-\d{2}-\d{2})', _title(_sheets(plan)))
    if memo_date and plan_date and re.search(r"collector.{0,3}s?\s+edition first", text, re.I) and memo_date.group(1) > plan_date.group(1):
        return [_item('Priority for shared parts',
                      "The launch plan was written before the CPO memo and does not say which edition gets short parts first; the memo puts the Collector's Edition first.",
                      "Collector's Edition first (CPO memo is newer)", 'medium', ['CPO memo', 'Launch plan'])]
    return []


CHECKS = (_check_receipts, _check_plan_vs_status, _check_shipments, _check_revisions, _check_inspections, _check_memo)


def find_conflicts(data_dir, issue_public=None):
    """All source disagreements found under the data folder; [] when the data is absent."""
    try:
        root = _root(data_dir)
        if not root.is_dir():
            return []
    except (TypeError, OSError):
        return []
    found = []
    for check in CHECKS:
        try:
            found.extend(check(root))
        except Exception:
            found.append(_review('A source check', 'One source could not be compared.', ['ERP stock']))
    return found
