"""Price and rank recovery options. Code computes; nothing is guessed.

Goods cost comes from the latest purchase order price in the customer data.
Exchange rates, freight rates and the air freight already booked this month are
editable assumptions in the local state folder. Anything missing is reported as
unknown and makes the total unknown: no invented figures.
"""
from __future__ import annotations

import csv
import json
from datetime import date, datetime, timedelta
from pathlib import Path

from app import policy as policy_mod
from app.recovery import BERLIN, packing_hours

ASSUMPTIONS_FILE = 'assumptions.json'
KIND_RANK = {'release': 0, 'recovery': 1, 'verify': 2, 'allocation': 3}

TEMPLATE = {
    '_comment': 'Editable assumptions. Leave a value null if unknown: the app then shows the figure as unknown instead of guessing. '
                'Nothing here is a fact from the customer data.',
    'fx_to_eur': {'_comment': 'EUR per one unit of the foreign currency, for example "USD": <rate>. Assumption, to be confirmed.',
                  'USD': None},
    'freight_eur_per_unit_by_mode': {'_comment': 'Freight cost in EUR per unit moved, by transport mode. Assumption, to be confirmed.',
                                     'air': None, 'sea': None, 'road': None},
    'air_freight_month_to_date_eur': {'_comment': 'Unplanned air freight already approved this calendar month, in EUR.',
                                      'value': None},
    'selling_price_eur': {'_comment': 'Selling price per copy by product id. Leave empty to value copies at product cost.'},
    'refund_eur': {'_comment': 'Refund per copy by product id, if different from the selling price.'},
}


# ---------------------------------------------------------------- data access

def read_rows(data_dir, relative: str) -> list:
    path = Path(data_dir) / relative
    if not path.exists():
        return []
    try:
        with path.open(encoding='utf-8-sig', newline='') as stream:
            return list(csv.DictReader(stream))
    except (OSError, csv.Error):
        return []


def to_number(value):
    try:
        text = str(value).replace(',', '').strip()
        return float(text) if text else None
    except (TypeError, ValueError):
        return None


def latest_po_line(data_dir, material_id, supplier_id=None) -> dict | None:
    """Most recent purchase order line with a usable price for the material."""
    best = None
    for row in read_rows(data_dir, 'soony/erp/purchase_orders_2025H2-2026.csv'):
        if row.get('material_id') != material_id:
            continue
        if supplier_id and row.get('supplier_id') != supplier_id:
            continue
        price = to_number(row.get('unit_price'))
        if not price or price <= 0 or not row.get('currency'):
            continue
        key = (row.get('order_date') or '', row.get('po_number') or '', row.get('po_line') or '')
        if best is None or key > best[0]:
            best = (key, row)
    return best[1] if best else None


def component_category(data_dir, material_id) -> str | None:
    for row in read_rows(data_dir, 'soony/master/components.csv'):
        if row.get('component_id') == material_id:
            return row.get('category') or None
    return None


# ---------------------------------------------------------------- assumptions

def load_assumptions(state_dir) -> dict:
    """Read <state_dir>/assumptions.json. Create a null template only when absent."""
    path = Path(state_dir) / ASSUMPTIONS_FILE
    if not path.exists():
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(TEMPLATE, indent=2), encoding='utf-8')
        except OSError:
            pass
        return json.loads(json.dumps(TEMPLATE))
    try:
        loaded = json.loads(path.read_text(encoding='utf-8'))
        return loaded if isinstance(loaded, dict) else json.loads(json.dumps(TEMPLATE))
    except (OSError, ValueError):
        return json.loads(json.dumps(TEMPLATE))


def _setting(assumptions, *path):
    node = assumptions or {}
    for part in path:
        if not isinstance(node, dict):
            return None
        node = node.get(part)
    return node


def fx_rate(assumptions, currency):
    if not currency or currency.upper() == 'EUR':
        return 1.0
    rate = to_number(_setting(assumptions, 'fx_to_eur', currency.upper()))
    return rate if rate and rate > 0 else None


def month_to_date_air(assumptions) -> float | None:
    node = _setting(assumptions, 'air_freight_month_to_date_eur')
    value = node.get('value') if isinstance(node, dict) else node
    return to_number(value)


# ---------------------------------------------------------------- pricing

def price_option(option: dict, issue: dict, data_dir, assumptions: dict, policy=None, as_of=None) -> dict:
    """Price one recovery option. Unknown parts make the total None and are listed."""
    quantity = int(option.get('quantity') or 0)
    mode = (option.get('mode') or '').lower() or None
    material = option.get('material_id') or (issue or {}).get('material_id')
    notes, unknown = [], []
    goods = freight = unit_price = goods_ordered = None
    currency = rate = None

    commitment = option.get('commitment')
    if mode == 'stock':
        if option.get('stock_established'):
            goods = freight = 0.0
            notes.append('Stock already owned: no purchase or freight cost.')
        else:
            unknown.append('Stock location not established.')
    elif commitment == 'freight':
        goods = 0.0
        notes.append('Goods are already ordered on the existing purchase order; not new spend.')
        line = latest_po_line(data_dir, material, option.get('supplier_id')) if material else None
        if line:
            unit_price, currency = to_number(line['unit_price']), line['currency'].upper()
            rate = fx_rate(assumptions, currency)
            if rate is None:
                unknown.append(f'Value of the goods already ordered is not shown: exchange rate from {currency} to EUR is not set.')
            else:
                goods_ordered = round(quantity * unit_price * rate, 2)
        code = option.get('incoterm_required')
        per_unit = to_number(_setting(assumptions, 'freight_eur_per_unit_by_mode', mode)) if mode else None
        if per_unit is None:
            unknown.append(f'Freight rate for {mode or "this transport mode"} is not set.')
        else:
            freight = round(quantity * per_unit, 2)
            notes.append(f'Freight of {per_unit:g} EUR per unit by {mode} is an assumption, to be confirmed.')
        notes.append((f'Under {code} the buyer pays freight; ' if code else 'The buyer pays freight under the confirmed term; ')
                     + 'the confirmation also says freight is invoiced; the amount is not known.')
    else:
        quoted = to_number(option.get('unit_price'))
        if quoted and quoted > 0 and option.get('currency'):
            unit_price, currency = quoted, str(option['currency']).upper()
            notes.append('Unit price is the supplier quote given for this option.')
        else:
            line = latest_po_line(data_dir, material, option.get('supplier_id')) if material else None
            if line:
                unit_price, currency = to_number(line['unit_price']), line['currency'].upper()
                notes.append(f'Unit price is the latest purchase order price ({currency} {unit_price:,.2f} per unit); confirm the current quote.')
        if unit_price is None:
            unknown.append('Unit price: no purchase order price found for this part.')
        else:
            rate = fx_rate(assumptions, currency)
            if rate is None:
                unknown.append(f'Exchange rate from {currency} to EUR is not set.')
            else:
                if currency != 'EUR':
                    notes.append(f'Exchange rate of {rate:g} EUR per {currency} is an assumption, to be confirmed.')
                goods = round(quantity * unit_price * rate, 2)

        per_unit = to_number(_setting(assumptions, 'freight_eur_per_unit_by_mode', mode)) if mode else None
        if per_unit is None:
            unknown.append(f'Freight rate for {mode or "this transport mode"} is not set.')
        else:
            freight = round(quantity * per_unit, 2)
            notes.append(f'Freight of {per_unit:g} EUR per unit by {mode} is an assumption, to be confirmed.')

    total = round(goods + freight, 2) if goods is not None and freight is not None else None
    result = {'title': option.get('title'), 'material_id': material, 'quantity': quantity, 'mode': mode, 'eta': option.get('eta'),
              'goods_eur': goods, 'freight_eur': freight, 'total_eur': total, 'unit_price': unit_price, 'currency': currency,
              'fx_rate': rate, 'assumptions': notes, 'unknown': unknown, 'commitment': commitment}
    if commitment == 'freight':
        result['goods_ordered_eur'] = goods_ordered
    for passthrough in ('copies_gained', 'supplier_id', 'id', 'kind'):
        if passthrough in option:
            result[passthrough] = option[passthrough]
    result['approver'] = _approver_for(result, issue, data_dir, assumptions, policy, as_of)
    return result


def _approver_for(priced, issue, data_dir, assumptions, policy, as_of):
    try:
        policy = policy or policy_mod.load_policy(data_dir)
        category = component_category(data_dir, priced.get('material_id')) if priced.get('material_id') else None
        if priced.get('commitment') == 'freight':
            freight, mtd = priced['freight_eur'], month_to_date_air(assumptions)
            answer = policy_mod.required_approver(policy, freight if freight is not None else 0.0, 'air_freight', category, mtd or 0.0, as_of)
            if freight is None:
                answer.update(provisional=True, needs_amount=True,
                              why='Cost not yet known; routed to the lowest approver for air freight in this category; goes up if the monthly limit is exceeded.')
            elif mtd is None:
                priced['assumptions'].append('Air freight already approved this month is taken as zero; confirm with procurement.')
            return answer
        if priced['mode'] == 'air':
            freight = priced['freight_eur']
            mtd = month_to_date_air(assumptions)
            answer = policy_mod.required_approver(policy, freight, 'air_freight', category, mtd or 0.0, as_of)
            if freight is not None and mtd is None:
                priced['assumptions'].append('Air freight already approved this month is taken as zero; confirm with procurement.')
            if priced['total_eur'] is not None:
                value = policy_mod.required_approver(policy, priced['total_eur'], 'po', category, as_of=as_of)
                answer['value_approver'] = {'role': value['role'], 'name': value['name']}
            return answer
        return policy_mod.required_approver(policy, priced['total_eur'], 'po', category, as_of=as_of)
    except policy_mod.PolicyParseError as error:
        return {'role': None, 'name': None, 'why': str(error), 'vacancy': False, 'route': [], 'needs_cpo': False}


# ---------------------------------------------------------------- ranking

def _parse_eta(value):
    if not value:
        return None
    try:
        text = str(value).strip()
        if len(text) == 10:  # date only: be conservative and assume the end of that day
            return datetime.fromisoformat(text).replace(hour=23, minute=59, tzinfo=BERLIN)
        parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
        return parsed.replace(tzinfo=BERLIN) if parsed.tzinfo is None else parsed.astimezone(BERLIN)
    except ValueError:
        return None


def last_packing_moment(now: datetime, hours_left: float) -> datetime:
    """The moment when the remaining packing hours run out, counting only shift windows."""
    now = now.astimezone(BERLIN)
    day = now.date()
    for offset in range(0, 15):
        start = datetime.combine(day + timedelta(days=offset), datetime.min.time(), BERLIN)
        end = start + timedelta(days=1)
        if packing_hours(now, end) >= hours_left:
            lo, hi = max(now, start), end
            for _ in range(40):
                mid = lo + (hi - lo) / 2
                if packing_hours(now, mid) >= hours_left:
                    hi = mid
                else:
                    lo = mid
            return (hi + timedelta(seconds=30)).replace(second=0, microsecond=0)
    return now + timedelta(days=14)


def rank_options(priced_options: list, hours_left, now: datetime | None = None, deadline: datetime | None = None) -> list:
    """Rank feasible options first, then copies gained per euro, then earliest arrival.

    An option with no arrival time, or arriving after the last packing hour, is not
    feasible. Options with unknown cost rank after costed ones inside their group.
    """
    now = (now or datetime.now(BERLIN)).astimezone(BERLIN)
    cutoff = deadline or (last_packing_moment(now, float(hours_left)) if hours_left is not None else None)
    ranked = []
    for option in priced_options:
        item = dict(option)
        kind = item.get('kind') or 'recovery'
        eta = _parse_eta(item.get('eta'))
        if item.get('mode') == 'stock' and eta is None and item.get('stock_established'):
            eta = now
        gained = item.get('copies_gained')
        item['copies_gained'] = gained
        arrival_known = item.get('arrival_known')
        if arrival_known is None:
            arrival_known = eta is not None
        if kind not in ('recovery', 'release'):
            state, feasible, item['flag'] = 'na', False, None
        elif eta is None or cutoff is None or not arrival_known:
            state, feasible = 'unknown', False
            item['flag'] = 'Arrival time is unknown, so this option cannot be counted on.'
        elif eta >= cutoff:
            state, feasible = 'too_late', False
            item['flag'] = 'Arrives after the last packing hour.'
        elif not gained or gained <= 0:
            state, feasible = 'unknown', False
            item['flag'] = 'No extra copies are counted for this option on the current numbers.'
        else:
            state, feasible = 'feasible', True
            item['flag'] = None
        total = item.get('total_eur')
        if total is None:
            per_euro, cost_class = None, 2
        elif total <= 0:
            per_euro, cost_class = None, 0  # free: no cost to divide by
        else:
            per_euro, cost_class = ((gained / total) if gained is not None else None), 1
        item.update({'feasible': feasible, 'feasibility': state, 'copies_per_eur': per_euro, '_eta': eta, '_cost_class': cost_class,
                     '_kind_rank': KIND_RANK.get(kind, 2)})
        ranked.append(item)

    far = datetime(9999, 12, 31, tzinfo=BERLIN)

    def key(item):
        return (not item['feasible'], item['_kind_rank'], item['_cost_class'], -(item['copies_per_eur'] or 0.0),
                -(item.get('potential_units') or 0), item['_eta'] or far)

    ranked.sort(key=key)
    for position, item in enumerate(ranked, start=1):
        item['rank'] = position
        item.pop('_eta', None)
        item.pop('_cost_class', None)
        item.pop('_kind_rank', None)
    return ranked
