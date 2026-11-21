"""Supplier-hold detector: finds goods a supplier has packed but is holding until the buyer acts.

Pure and policy-free. It reads supplier order confirmations and notices that are text-extractable, matches
phrases from a data table (HOLD_PATTERNS), cross-checks the order against the purchase order file and returns
records whose wording is COMPOSED from templates and a whitelisted incoterm code. A sentence of the document
never reaches a record, so a document cannot inject text into the application. Anything unreadable, scanned or
ambiguous becomes a `needs_review` record: this module never guesses.
"""
from __future__ import annotations

import hashlib
import re
import zipfile
from pathlib import Path

from app.pricing import read_rows, to_number

INCOTERMS = ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP')
INCOTERM_PLAIN = {
    'EXW': "EXW means the buyer arranges and pays freight and insurance and carries transport risk from the supplier's dock; DDP means the seller does.",
    'FCA': 'FCA means the seller hands the goods to the buyer\'s carrier; the buyer pays the main freight and carries the risk from there.',
    'FOB': 'FOB means the buyer pays the sea freight and carries the risk once the goods are on board.',
    'DAP': 'DAP means the seller delivers to the named place; the buyer clears imports and pays duties.',
    'DDP': 'DDP means the seller delivers to the named place and pays freight, insurance and duties.',
}
CODE = '(?:' + '|'.join(INCOTERMS) + ')'
WINDOW = 300
MIN_TEXT = 20
SCAN_SUFFIXES = ('.txt', '.md', '.pdf', '.docx', '.png', '.jpg', '.jpeg', '.tif', '.tiff')
REVIEW_ACTION = 'A person must read a scanned supplier confirmation'
UNCLEAR_ACTION = 'A person must read this supplier confirmation to confirm the hold'

# (blocker_type, lang, part, regex). A blocker type is found when every part it needs matches within WINDOW characters
# of its 'hold' part. A miss yields nothing; scanned documents go to a person.
REQUIRED_PARTS = {'incoterm_hold': ('reject', 'hold'), 'payment_hold': ('subject', 'hold'),
                  'document_hold': ('subject', 'pending'), 'other': ('hold',)}
PRIORITY = ('incoterm_hold', 'payment_hold', 'document_hold', 'other')
HOLD_PATTERNS = (
    ('incoterm_hold', 'en', 'reject', r"\b(?:do(?:es)?\s+not|don't|cannot|can't|will\s+not)\s+accept\b"),
    ('incoterm_hold', 'de', 'reject', r"\bnicht\s+akzeptier\w*|\bakzeptier\w*\s+(?:\w+\s+){0,4}nicht\b"),
    ('incoterm_hold', 'pl', 'reject', r"\bnie\s+akceptuj\w*"),
    ('incoterm_hold', 'en', 'hold', r"\bon\s+hold\b|\bheld\b|\brelease\w*\b[^.]{0,80}\b(?:once|until|when|after)\b[^.]{0,60}\bconfirm\w*"),
    ('incoterm_hold', 'de', 'hold', r"\bangehalten\b|\bzur[uü]ckgehalten\b|\bVersandsperre\b|\bFreigabe\b[^.]{0,80}\b(?:sobald|bis|nach)\b[^.]{0,60}\bbest(?:[aä]|ae)tig\w*"),
    ('incoterm_hold', 'pl', 'hold', r"\bwstrzyman\w*|\bzatrzyman\w*|\bzwolni\w*[^.]{0,80}\b(?:po|gdy|do\s+czasu)\b[^.]{0,60}\bpotwierdz\w*"),
    ('payment_hold', 'en', 'subject', r"\b(?:payment|prepayment|credit)\b"),
    ('payment_hold', 'de', 'subject', r"\bVorkasse\b|\bZahlung\w*|\bKredit\w*"),
    ('payment_hold', 'pl', 'subject', r"\bp[lł]atno[sś]\w*|\bprzedp[lł]at\w*"),
    ('payment_hold', 'en', 'hold', r"\bon\s+hold\b|\bheld\b"),
    ('payment_hold', 'de', 'hold', r"\bangehalten\b|\bzur[uü]ckgehalten\b|\bgesperrt\b"),
    ('payment_hold', 'pl', 'hold', r"\bwstrzyman\w*|\bzatrzyman\w*"),
    ('document_hold', 'en', 'subject', r"\b(?:export|customs|licen[cs]e|certificate|signed)\b"),
    ('document_hold', 'de', 'subject', r"\b(?:Export|Zoll|Lizenz|Zertifikat|unterschrieben)\w*"),
    ('document_hold', 'pl', 'subject', r"\b(?:eksport|c[lł]o|licencj|certyfikat|podpisan)\w*"),
    ('document_hold', 'en', 'pending', r"\b(?:pending|awaiting|required\s+before)\b"),
    ('document_hold', 'de', 'pending', r"\b(?:ausstehend|erwarten|erforderlich\s+vor)\w*"),
    ('document_hold', 'pl', 'pending', r"\b(?:oczekuj|brakuj)\w*"),
    ('other', 'en', 'hold', r"\bon\s+hold\b|\bawaiting\s+your\b|\bpending\s+your\s+(?:confirmation|approval)\b"),
    ('other', 'de', 'hold', r"\bwartet\s+auf\s+(?:Ihre|Ihr)\w*|\bausstehende\s+Best[aä]tigung\b"),
    ('other', 'pl', 'hold', r"\bczekamy\s+na\s+(?:Pa[nń]stw|potwierdz)\w*"),
)
_COMPILED = tuple((b, l, p, re.compile(r, re.I)) for b, l, p, r in HOLD_PATTERNS)
ORDER_REF = re.compile(r"\b(?:your\s+order|Ihre\s+Bestellung(?:\s+Nr\.?)?|Pa[nń]stwa\s+zam[oó]wienie(?:\s+nr)?)\s+(\d{6,})", re.I)
CONFIRM_CODE = re.compile(r"(?i:confirm\w*|best(?:[aä]|ae)tig\w*|potwierdz\w*)\s+(?:(?:the|die|den|term|terms)\s+)?(" + CODE + r")\b")
CONFIRM_CODE_REV = re.compile(r"\b(" + CODE + r")\b[^.]{0,30}?(?i:best(?:[a\u00e4]|ae)tig|potwierdz)\w*")
TERMS_CODE = re.compile(r"(?:terms\s+of\s+delivery|delivery\s+terms|incoterms?|lieferbedingung\w*)\W{1,6}(" + CODE + r")\b", re.I)
LINE_QTY = re.compile(r"(\d{1,3}(?:,\d{3})+|\d+)\s+(\d+\.\d{2,})\s+[A-Z]{3}\b")

_cache = {}


# ------------------------------------------------------------------ reading

def _read_docx(path):
    with zipfile.ZipFile(path) as archive:
        xml = archive.read('word/document.xml').decode('utf-8', 'replace')
    return re.sub(r'<[^>]+>', ' ', xml)


def default_reader(path):
    """Text of a .txt/.md/.pdf/.docx file, '' when there is none (a scan). Never raises."""
    path = Path(path)
    suffix = path.suffix.lower()
    try:
        if suffix in ('.txt', '.md'):
            return path.read_text(encoding='utf-8', errors='replace')
        if suffix == '.pdf':
            try:
                import pymupdf
            except ImportError:  # pragma: no cover
                import fitz as pymupdf
            with pymupdf.open(str(path)) as document:
                return ''.join(page.get_text() for page in document)
        if suffix == '.docx':
            return _read_docx(path)
    except Exception:
        return ''
    return ''


def _cached_read(path, reader):
    if reader is not None:
        return reader(path) or ''
    try:
        key = (str(path), path.stat().st_mtime_ns)
    except OSError:
        return ''
    if key not in _cache:
        _cache[key] = default_reader(path)
    return _cache[key]


def _flat(text):
    return re.sub(r'\s+', ' ', (text or '').replace('�', ' ')).strip()


# ------------------------------------------------------------------ parsing

def _detect(text):
    """Highest-priority blocker type whose parts all match near its hold part, with the hold match position."""
    found = {}
    for blocker, _lang, part, regex in _COMPILED:
        found.setdefault(blocker, {}).setdefault(part, []).extend(m.start() for m in regex.finditer(text))
    for blocker in PRIORITY:
        parts = found.get(blocker, {})
        needs = REQUIRED_PARTS[blocker]
        if not all(parts.get(p) for p in needs):
            continue
        anchor_part = needs[-1] if blocker == 'document_hold' else 'hold'
        for start in parts[anchor_part]:
            if all(any(abs(start - s) <= WINDOW for s in parts[p]) for p in needs):
                return blocker, start
    return None, None


def _code_in(text, which):
    match = which.search(text)
    return match.group(1).upper() if match else None


def _materials_in(text, known):
    return [m for m in known if re.search(r'(?<![\w-])' + re.escape(m) + r'(?![\w-])', text)]


def _text_quantity(text, material):
    index = text.find(material)
    if index < 0:
        return None
    match = LINE_QTY.search(text, index, index + 260)
    return int(match.group(1).replace(',', '')) if match else None


def _supplier_name(text, folder):
    first = next((l.strip() for l in (text or '').splitlines() if l.strip()), '')
    if re.match(r"^[A-Za-z][\w .,&()'-]{2,59}$", first) and '@' not in first:
        return first
    parts = folder.split('_', 1)
    return (parts[1] if len(parts) > 1 else folder).replace('_', ' ')


def _contract_basis(supplier_dir, code, reader):
    """The incoterm code only when the supplier's contract text names it as the delivery term."""
    if not code:
        return None
    folder = Path(supplier_dir) / 'contracts'
    if not folder.is_dir():
        return None
    for path in sorted(folder.iterdir()):
        text = _flat(_cached_read(path, reader))
        if re.search(r"(?:delivery\s+terms|terms\s+of\s+delivery|incoterms?|prices[^.]{0,40}\bare)\W{0,6}[^.]{0,30}\b" + re.escape(code) + r"\b", text, re.I):
            return code
    return None


def _lead_code(value):
    first = (value or '').strip().split(' ')[0].upper()
    return first if first in INCOTERMS else None


def _compose(blocker, code, quantity, ordered):
    if blocker == 'incoterm_hold' and code:
        action = f'Confirm {code} in writing, or nominate a forwarder'
        plain = INCOTERM_PLAIN.get(code, f'{code} sets who arranges and pays transport for these goods.')
        consequence = (f'The supplier is holding {quantity:,} units until the buyer confirms {code} or nominates a forwarder. ' if quantity
                       else f'The supplier is holding the goods until the buyer confirms {code} or nominates a forwarder. ') + plain
        return action, consequence, 'freight_commitment'
    if blocker == 'payment_hold':
        return ('Clear the payment hold with the supplier',
                'The supplier is holding the goods until a payment or credit matter is cleared.', 'payment')
    if blocker == 'document_hold':
        return ('Provide the missing document to the supplier',
                'The supplier is holding the goods until a required export or customs document is provided.', 'document')
    return ("Answer the supplier's open request so the goods can be released",
            'The supplier has put the goods on hold pending a reply from the buyer.', 'other')


def parse_hold_text(text, material_ids, ctx=None):
    """Hold records found in one document's text. [] for a routine confirmation.

    ctx: {po_rows: [...], components: [ids], supplier_id, supplier, folder, contract_basis_fn, evidence_ref}.
    """
    ctx = ctx or {}
    flat = _flat(text)
    blocker, anchor = _detect(flat)
    if blocker is None:
        return []
    wanted = list(material_ids or [])
    known = list(dict.fromkeys(list(ctx.get('components') or []) + wanted))
    in_doc = _materials_in(flat, known)
    if not in_doc or not any(m in wanted for m in in_doc):
        return []
    review = False
    near = _materials_in(flat[max(0, anchor - WINDOW):anchor + WINDOW], in_doc)
    if len(in_doc) == 1:
        material = in_doc[0]
    elif len(near) == 1:
        material = near[0]
    else:
        material, review = next(m for m in in_doc if m in wanted), True
    if material not in wanted:
        return []
    order = ORDER_REF.search(flat)
    po_number = order.group(1) if order else None
    row = next((r for r in ctx.get('po_rows') or [] if r.get('po_number') == po_number and r.get('material_id') == material), None)
    if row is None:
        review = True
    elif (row.get('actual_delivery_date') or '').strip() or (row.get('status') or '').lower() == 'delivered':
        return []
    text_qty = _text_quantity(flat, material)
    po_qty = to_number(row.get('quantity')) if row else None
    quantity, source = None, None
    if po_qty and (text_qty is None or int(po_qty) == text_qty):
        quantity, source = int(po_qty), 'po'
    elif text_qty and row is None:
        quantity, source = text_qty, 'text'
    else:
        review = True
    code = (_code_in(flat, CONFIRM_CODE) or _code_in(flat, CONFIRM_CODE_REV) or _code_in(flat, TERMS_CODE)) if blocker == 'incoterm_hold' else None
    if blocker == 'incoterm_hold' and not code:
        review = True
    ordered = _lead_code(row.get('incoterm')) if row else None
    basis_fn = ctx.get('contract_basis_fn')
    basis = basis_fn(code) if basis_fn and code else None
    if review:
        action, consequence, unlock = UNCLEAR_ACTION, 'The supplier may be holding goods; a person must confirm what is needed.', 'other'
        blocker_out = 'other'
    else:
        action, consequence, unlock = _compose(blocker, code, quantity, ordered)
        blocker_out = blocker
    ref = ctx.get('evidence_ref') or ''
    hold_id = hashlib.sha1(f"{ctx.get('supplier_id')}|{material}|{po_number}|{blocker_out}|{ref}".encode()).hexdigest()[:12]
    return [{'hold_id': hold_id, 'supplier_id': ctx.get('supplier_id'), 'supplier': ctx.get('supplier'), 'material_id': material,
             'quantity': quantity, 'quantity_source': source, 'po_number': po_number, 'blocker_type': blocker_out,
             'incoterm_required': code if not review else None, 'incoterm_ordered': ordered, 'contract_basis': basis,
             'required_action': action, 'consequence': consequence, 'unlock_kind': unlock, 'needs_review': review,
             'source_category': 'supplier order confirmation', 'evidence_ref': ref}]


# ------------------------------------------------------------------ scanning

def _review_record(supplier_id, supplier, material, ref):
    """A scan a person must read. `material` is None unless the file name links it to an open order line."""
    hold_id = hashlib.sha1(f'{supplier_id}|{material}|review|{ref if material else ""}'.encode()).hexdigest()[:12]
    return {'hold_id': hold_id, 'supplier_id': supplier_id, 'supplier': supplier, 'material_id': material, 'quantity': None,
            'quantity_source': None, 'po_number': None, 'blocker_type': 'other', 'incoterm_required': None, 'incoterm_ordered': None,
            'contract_basis': None, 'required_action': REVIEW_ACTION,
            'consequence': 'A supplier document could not be read by the application, so a hold cannot be ruled out.',
            'unlock_kind': 'other', 'needs_review': True, 'source_category': 'supplier order confirmation', 'evidence_ref': ref}


def _open_po_rows(data_dir, material_ids):
    rows = read_rows(data_dir, 'soony/erp/purchase_orders_2025H2-2026.csv')
    return rows, [r for r in rows if r.get('material_id') in material_ids and not (r.get('actual_delivery_date') or '').strip()
                  and (r.get('status') or '').lower() != 'delivered']


def find_holds(data_dir, material_ids, supplier_ids=None, reader=None):
    """Holds on open purchase orders for the given materials, from the suppliers that matter. Never raises."""
    try:
        return _find(Path(data_dir), list(material_ids or []), supplier_ids, reader)
    except Exception:
        return []


def _find(data_dir, material_ids, supplier_ids, reader):
    suppliers_dir = data_dir / 'suppliers'
    if not suppliers_dir.is_dir() or not material_ids:
        return []
    all_rows, open_rows = _open_po_rows(data_dir, material_ids)
    wanted_suppliers = set(supplier_ids) if supplier_ids else {r.get('supplier_id') for r in open_rows}
    if supplier_ids is None:
        for row in read_rows(data_dir, 'soony/erp/open_shipments.csv'):
            if set(material_ids) & set((row.get('material_ids') or '').split('|')) and (row.get('status') or '') != 'delivered':
                wanted_suppliers.add(row.get('supplier_id'))
    po_numbers = {r.get('po_number') for r in open_rows}
    components = [r.get('component_id') for r in read_rows(data_dir, 'soony/master/components.csv') if r.get('component_id')]
    found = []
    for folder in sorted(p for p in suppliers_dir.iterdir() if p.is_dir()):
        supplier_id = folder.name.split('_', 1)[0]
        if supplier_id not in wanted_suppliers:
            continue
        files = [f for sub in ('order_confirmations', 'notices') if (folder / sub).is_dir()
                 for f in sorted((folder / sub).iterdir()) if f.is_file() and f.suffix.lower() in SCAN_SUFFIXES]
        for path in files:
            ref = f'{folder.name}/{path.parent.name}/{path.name}'
            text = _cached_read(path, reader)
            name = _supplier_name(text, folder.name)
            if len(_flat(text)) < MIN_TEXT:
                linked = next((r for r in open_rows if r.get('po_number') and r['po_number'] in path.name), None)
                found.append(_review_record(supplier_id, name, linked['material_id'] if linked else None, ref))
                continue
            mentions = [n for n in po_numbers if n and n in text] or _materials_in(_flat(text), material_ids)
            if not mentions:
                continue
            ctx = {'po_rows': all_rows, 'components': components, 'supplier_id': supplier_id, 'supplier': name,
                   'evidence_ref': ref, 'contract_basis_fn': lambda code, f=folder: _contract_basis(f, code, reader)}
            found.extend(parse_hold_text(text, material_ids, ctx))
    unique = {h['hold_id']: h for h in found}
    return list(unique.values())
