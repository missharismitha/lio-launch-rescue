"""Value at stake and contract claim lever.

Copies at risk come from the allocation in the issue. A unit value comes from the
user's settings (selling price or refund, giving revenue at risk) or else from the
product's standard cost in the master data, which is a cost and never a price.
The contract claim is parsed from the supplier's late-delivery clause.
"""
from __future__ import annotations

import math
import re
from datetime import date
from pathlib import Path

import pymupdf

from app.pricing import _setting, fx_rate, latest_po_line, read_rows, to_number

COST_LABEL = 'product cost, not price'
REVENUE_LABEL = 'revenue at risk, from your settings'
CLAIM_LABEL = 'from contract, subject to Legal'


def _cost_by_product(data_dir) -> dict:
    return {row.get('product_id'): to_number(row.get('std_cost_eur')) for row in read_rows(data_dir, 'soony/master/products.csv')}


def value_at_stake(issue: dict, products: list, data_dir, assumptions: dict) -> dict:
    """Copies short on launch day times a unit value. Unknown unit value gives headline None."""
    names = {p.get('id'): p.get('name') for p in products or []}
    shorts = [l for l in ((issue or {}).get('allocation') or {}).get('lines', []) if (l.get('short') or 0) > 0]
    notes = []
    result = {'headline_eur': None, 'basis': 'cost', 'lines': [], 'assumptions': notes, 'label': COST_LABEL}
    if not shorts:
        if not ((issue or {}).get('allocation') or {}).get('lines'):
            notes.append('No split of the shortage by edition is available, so the copies at risk cannot be valued.')
            return result
        result['headline_eur'] = 0.0
        notes.append('No edition is short after allocation.')
        return result
    costs = _cost_by_product(data_dir)
    lines, any_missing, all_revenue = [], False, True
    for line in shorts:
        pid = line.get('product_id')
        unit, basis = None, None
        for setting in ('selling_price_eur', 'refund_eur'):
            candidate = to_number(_setting(assumptions, setting, pid))
            if candidate is not None and candidate > 0:
                unit, basis = candidate, 'revenue'
                break
        if unit is None:
            candidate = costs.get(pid)
            if candidate:
                unit, basis = candidate, 'cost'
        if unit is None:
            any_missing = True
        if basis != 'revenue':
            all_revenue = False
        copies = int(line.get('short') or 0)
        lines.append({'product': line.get('name') or names.get(pid) or pid, 'product_id': pid, 'copies_short': copies,
                      'unit_value_eur': unit, 'basis': basis, 'eur': round(copies * unit, 2) if unit is not None else None})
    result['lines'] = lines
    if any_missing:
        notes.append('A unit value is missing for at least one edition, so the total is unknown.')
        return result
    result['headline_eur'] = round(sum(l['eur'] for l in lines), 2)
    if all_revenue:
        result['basis'], result['label'] = 'revenue', REVENUE_LABEL
        notes.append('Valued at the selling price or refund entered in your settings; confirm with the business.')
    else:
        notes.append('No selling price or refund figure has been entered, so copies are valued at standard product cost. '
                     'This is a cost, not the price customers pay.')
    return result


# ---------------------------------------------------------------- contract claim

_CLAUSE = re.compile(
    r'(?:For each commenced week of delay[^.]*?(?:pay )?liquidated damages\s+of\s+(?P<a>\d+(?:\.\d+)?)\s*%\s+of the value of the delayed quantity'
    r'|Late delivery:\s*(?P<b>\d+(?:\.\d+)?)\s*%\s+of the delayed (?:order|quantity) value per commenced week)'
    r'[^.]*?,?\s*capped at\s+(?P<cap>\d+(?:\.\d+)?)\s*%', re.S | re.I)


def _contract_text(data_dir, supplier_id) -> str:
    texts = []
    for pdf in sorted(Path(data_dir).glob(f'suppliers/{supplier_id}_*/contracts/*.pdf')):
        try:
            with pymupdf.open(pdf) as doc:
                texts.append('\n'.join(page.get_text() for page in doc))
        except Exception:
            continue
    return re.sub(r'\s+', ' ', ' '.join(texts))


def _launch_date(issue, data_dir):
    dates = []
    for row in read_rows(data_dir, 'soony/master/products.csv'):
        if row.get('product_id') in (issue.get('affected_products') or []) and row.get('launch_date'):
            dates.append(row['launch_date'])
    return date.fromisoformat(min(dates)) if dates else None


def contract_claim(issue: dict, data_dir, assumptions: dict | None = None) -> dict | None:
    """Potential late-delivery damages from the supplier contract, or None when not parseable."""
    shipments = [s for s in (issue or {}).get('shipments') or [] if (s.get('balance') or 0) > 0 and s.get('balance_eta')]
    if not shipments:
        return None
    launch = _launch_date(issue, data_dir)
    by_po, pct, cap_pct, currency, weeks_max = {}, None, None, None, 0
    for shipment in shipments:
        line = None
        for row in read_rows(data_dir, 'soony/erp/purchase_orders_2025H2-2026.csv'):
            if row.get('po_number') == shipment.get('po_number') and row.get('material_id') == shipment.get('material_id'):
                line = row
                break
        price, ordered = (to_number(line.get('unit_price')), to_number(line.get('quantity'))) if line else (None, None)
        if not line or not price or not ordered or not line.get('currency'):
            return None
        text = _contract_text(data_dir, line['supplier_id'])
        clause = _CLAUSE.search(text)
        if not clause:
            return None
        this_pct = float(clause['a'] or clause['b'])
        this_cap = float(clause['cap'])
        confirmed = None
        for field in ('promised_date', 'requested_date'):
            try:
                confirmed = date.fromisoformat(line.get(field) or '')
                break
            except ValueError:
                continue
        confirmed = confirmed or launch
        try:
            arrival = date.fromisoformat(shipment['balance_eta'])
        except ValueError:
            return None
        if confirmed is None:
            return None
        weeks = max(0, math.ceil((arrival - confirmed).days / 7))
        delayed_value = shipment['balance'] * price
        entry = by_po.setdefault(shipment['po_number'], {'claim': 0.0, 'po_value': ordered * price, 'cap_pct': this_cap})
        entry['claim'] += weeks * this_pct / 100 * delayed_value
        pct, cap_pct, currency, weeks_max = this_pct, this_cap, line['currency'].upper(), max(weeks_max, weeks)
    native = sum(min(e['claim'], e['po_value'] * e['cap_pct'] / 100) for e in by_po.values())
    cap_native = sum(e['po_value'] * e['cap_pct'] / 100 for e in by_po.values())
    rate = fx_rate(assumptions, currency)
    delayed_units = sum(s['balance'] for s in shipments)
    basis = (f'{pct:g}% of the value of the delayed quantity per commenced week of delay, capped at {cap_pct:g}% of the purchase order. '
             f'{delayed_units:,} units are expected {weeks_max} commenced week(s) after the confirmed date. '
             'From contract, subject to Legal.')
    if rate is None:
        basis += f' Amount shown in {currency}; the exchange rate to EUR is not set.'
    return {'potential_eur': round(native * rate, 2) if rate else None, 'basis_text': basis, 'weeks': weeks_max,
            'cap_eur': round(cap_native * rate, 2) if rate else None, 'currency': currency,
            'potential_native': round(native, 2), 'cap_native': round(cap_native, 2), 'label': CLAIM_LABEL}
