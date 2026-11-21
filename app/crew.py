"""Agent crew: deterministic roles around one shared blackboard, each leaving a trace entry.

Roles run in a fixed order: Reconciler, Investigator, Allocation Planner, Pricer, Policy Officer,
Approver-Router, Checker, Drafter, Checker. A role that fails is traced as 'fell back' and the next
role still runs. The crew works with NO model: the Investigator then builds options from the records
and says so in the trace. Every number is computed in code; text from a model is only kept when each
number in it matches the blackboard (app/verify.py). Nothing here sends, books or pays.
"""
from __future__ import annotations

import re
import threading
import time
from datetime import datetime
from pathlib import Path

from app import actions, freight, holds as holds_mod, investigator, labels, pricing, public, verify
from app import policy as policy_mod
from app import value as value_mod
from app.recovery import BERLIN, packing_hours
from app.store import fingerprint
from app.sync import now as stamp

try:  # pure modules built alongside; the crew degrades when they are absent
    from app import whatif
except ImportError:  # pragma: no cover
    whatif = None
try:
    from app import brief as brief_mod
except ImportError:  # pragma: no cover
    brief_mod = None
try:
    from app import conflicts as conflicts_mod
except ImportError:  # pragma: no cover
    conflicts_mod = None

# What the application may do alone. Reading, computing and drafting are automatic; sending and
# spending need a named approval; booking and paying are never done by the application.
AUTONOMY_LADDER = {'read': 'auto', 'compute': 'auto', 'draft': 'draft', 'send': 'approval', 'spend': 'approval',
                   'book': 'never', 'pay': 'never'}
ALLOWED_MODES = ('air', 'sea', 'road', 'stock')
ALLOCATE_TITLE = 'Allocate by priority and escalate'
ALLOCATION_WORDS = re.compile(r'allocat|prioriti[sz]e|\bsplit\b|collector.*first', re.I)
VERIFY_WORDS = re.compile(r'^\s*(?:confirm|verify|check|track)\b', re.I)
VERIFY_STOCK_TITLE = 'Confirm where this stock is held'
SAFE_NAME = re.compile(r"^[\w][\w .,&()'-]{1,59}$")

_policy_cache = {}
_policy_lock = threading.Lock()


def cached_policy(data_dir, ttl=60):
    """Parse the approval policy at most once per `ttl` seconds per data folder."""
    key = str(data_dir)
    with _policy_lock:
        hit = _policy_cache.get(key)
        if hit and time.monotonic() - hit[0] < ttl:
            return hit[1]
    loaded = policy_mod.load_policy(data_dir)
    with _policy_lock:
        _policy_cache[key] = (time.monotonic(), loaded)
    return loaded


# ------------------------------------------------------------------ trace

def add_trace(board, agent, action, outcome, autonomy):
    """Append one timeline entry. Words outside the fixed vocabulary are coerced, never passed on."""
    if agent not in labels.TRACE_AGENTS:
        agent = 'Checker'
    if action not in labels.TRACE_ACTIONS.get(agent, ()):
        action = labels.TRACE_ACTIONS[agent][0]
    if outcome not in labels.TRACE_OUTCOMES:
        outcome = 'needs human review'
    if autonomy not in labels.TRACE_AUTONOMY:
        autonomy = 'auto'
    board['trace'].append({'agent': agent, 'action': action, 'outcome': outcome, 'autonomy': autonomy, 'at': stamp()})


def guard(board, agent, action, autonomy, fn, fallback=None):
    """Run one role. An exception becomes 'fell back' and never stops the crew."""
    try:
        outcome = fn() or 'done'
    except Exception:
        outcome = 'fell back'
        if fallback:
            try:
                fallback()
            except Exception:
                pass
    add_trace(board, agent, action, outcome, autonomy)
    return outcome


# ------------------------------------------------------------------ helpers

WEEKDAYS = ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')


def reference_now(as_of_label, launch, fallback):
    """The moment the packing hours were counted from (the status time), placed on the last such weekday up to launch.

    Hours left in the records are counted from the status time, not from the wall clock, so the crew uses the same
    reference. Falls back to `fallback` (the wall clock) when no status time or launch date is available.
    """
    match = re.search(r'(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{2})', str(as_of_label or ''), re.I)
    try:
        launch_day = datetime.fromisoformat(str(launch)[:10]).date()
    except ValueError:
        return fallback
    if not match:
        return fallback
    weekday = WEEKDAYS.index(match[1].title())
    day = launch_day
    for _ in range(7):
        if day.weekday() == weekday:
            break
        day = day.fromordinal(day.toordinal() - 1)
    return datetime(day.year, day.month, day.day, int(match[2]), int(match[3]), tzinfo=BERLIN)


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_eta(value):
    return pricing._parse_eta(value)


def eta_text(option):
    return verify.eta_label(option.get('eta')) or 'to be confirmed'


def short_context(issue, products):
    """The edition that is short, its need per copy, and the packing priority, all from the records."""
    lines = (issue.get('allocation') or {}).get('lines') or []
    short = next((l for l in lines if (l.get('short') or 0) > 0), None)
    if short is None:
        return None
    product = next((p for p in products or [] if p.get('id') == short.get('product_id')), None)
    remaining = (product or {}).get('remaining') or 0
    need = (short.get('needed') / remaining) if remaining and short.get('needed') else 1
    return {'product_id': short['product_id'], 'name': short.get('name'), 'need_per_copy': need,
            'priority_order': [l.get('product_id') for l in lines]}


def _ships_fallback(ctx, issue, products, quantity, arrive_in_hours, hours_left):
    """Guarded stand-in when app/whatif.py is missing: only counts what the arrival itself can pack."""
    product = next((p for p in products or [] if p.get('id') == ctx['product_id']), {})
    rate, remaining = product.get('rate_per_hour') or 0, product.get('remaining') or 0
    on_hand = int(((issue.get('usable_stock') or 0) + (issue.get('incoming') or 0)) // ctx['need_per_copy'])
    usable_hours = max(0.0, hours_left - arrive_in_hours) if quantity else 0.0
    from_arrival = min(int(quantity // ctx['need_per_copy']), int(rate * usable_hours)) if arrive_in_hours < hours_left else 0
    ship = min(remaining, int(rate * hours_left), on_hand + from_arrival)
    return {'copies_ship': ship, 'copies_short': max(remaining - ship, 0), 'hours_left': hours_left}


def ships(issue, products, hours_left, arrive_in_hours, quantity):
    """Copies of the short edition that ship if `quantity` units arrive in `arrive_in_hours` packing hours."""
    ctx = short_context(issue, products)
    if ctx is None or hours_left is None:
        return None
    now_units = (issue.get('usable_stock') or 0) + (issue.get('incoming') or 0)
    if whatif is not None:
        return whatif.ships(products, ctx['product_id'], component_need_per_copy=ctx['need_per_copy'], usable_units_now=now_units,
                            arrival_units=quantity, arrive_in_hours=arrive_in_hours, hours_left=hours_left,
                            priority_order=ctx['priority_order'])
    return _ships_fallback(ctx, issue, products, quantity, arrive_in_hours, hours_left)


def whatif_for(issue, products, hours_left, arrive_in_hours):
    """Public what-if: the missing parts arrive after `arrive_in_hours`. Numbers and a short label only."""
    quantity = max(_int(issue.get('shortage')) or 0, 0)
    result = ships(issue, products, hours_left, float(arrive_in_hours), quantity)
    if result is None:
        return None
    label = whatif.scenario_label(arrive_in_hours) if whatif is not None else f'in {arrive_in_hours:g} h'
    return {'copies_ship': int(result['copies_ship']), 'copies_short': int(result['copies_short']),
            'hours_left': float(hours_left), 'label': label}


def _po_rows(data_dir):
    return pricing.read_rows(data_dir, 'soony/erp/purchase_orders_2025H2-2026.csv')


def _primary_supplier_ids(issue, data_dir):
    numbers = {str(s.get('po_number')) for s in issue.get('shipments') or []}
    return {r.get('supplier_id') for r in _po_rows(data_dir)
            if r.get('po_number') in numbers and r.get('material_id') == issue.get('material_id')}


def _alt_supplier_ids(issue, data_dir):
    """Other suppliers with an open inbound shipment of the same material."""
    primary = _primary_supplier_ids(issue, data_dir)
    found = []
    for row in pricing.read_rows(data_dir, 'soony/erp/open_shipments.csv'):
        if issue.get('material_id') not in (row.get('material_ids') or '').split('|'):
            continue
        supplier = row.get('supplier_id')
        if supplier and supplier not in primary and (row.get('status') or '') != 'delivered' and supplier not in found:
            found.append(supplier)
    return found


def _hold_supplier_ids(board):
    return {h.get('supplier_id') for h in board.get('holds') or [] if h.get('supplier_id')}


def transport_for(board):
    """The transport comparison for this issue (memoised on the board). None when the records cannot support one. Never raises."""
    if 'transport' in board:
        return board['transport']
    try:
        board['transport'] = freight.build(board['data_dir'], board['issue'], board['now'], board.get('deadline'), board.get('assumptions') or {})
    except Exception:
        board['transport'] = None
    return board['transport']


def lane_mode(board, supplier_id, default='air'):
    """Fastest mode of the supplier's lane that makes the deadline, else the fastest overall, else `default`."""
    chosen, _feasible = freight.best_mode(freight.lane_for(transport_for(board), supplier_id))
    return chosen['mode'] if chosen else default


MODE_TITLE = {'air': 'Air freight the remaining balance', 'sea': 'Sea freight the remaining balance', 'road': 'Truck the remaining balance'}


def attach_estimate(board, shape):
    """Copy the lane's per-unit base estimate onto an option (explicit, labelled). Only priced if the assumptions allow it."""
    lane = freight.lane_for(transport_for(board), shape.get('supplier_id'))
    entry = next((m for m in (lane or {}).get('modes') or [] if m['mode'] == shape.get('mode')), None)
    if entry and entry.get('cost_per_unit_eur') is not None and shape.get('estimate_per_unit_eur') is None:
        shape = dict(shape, estimate_per_unit_eur=entry['cost_per_unit_eur'], estimate_basis=entry['basis'][:140])
    return shape


def rule_options(board):
    """Options from the records alone: expedite the balance, another supplier's stock if any is inbound."""
    issue, data_dir = board['issue'], board['data_dir']
    shortage = _int(issue.get('shortage')) or 0
    options = []
    balance = sum(_int(s.get('balance')) or 0 for s in issue.get('shipments') or [])
    primary = sorted(_primary_supplier_ids(issue, data_dir))
    if balance > 0 and shortage > 0:
        mode = lane_mode(board, primary[0] if primary else None)
        options.append({'title': MODE_TITLE.get(mode, MODE_TITLE['air']), 'quantity': min(balance, shortage), 'mode': mode, 'eta': None,
                        'supplier': (issue.get('supplier') or {}).get('name'), 'supplier_id': primary[0] if primary else None,
                        'kind': 'recovery'})
    held = _hold_supplier_ids(board)
    alt = [a for a in _alt_supplier_ids(issue, data_dir) if a not in held]
    if alt and shortage > 0:
        options.append({'title': 'Ask another supplier for stock', 'quantity': shortage, 'mode': lane_mode(board, alt[0]), 'eta': None,
                        'supplier': None, 'supplier_id': alt[0], 'kind': 'recovery'})
    return options


def stock_established(board, quantity):
    """True only when a stock snapshot shows the material at a site that is not a purchase-order receiving plant."""
    data_dir, material = board['data_dir'], board['issue'].get('material_id')
    plants = {r.get('plant') for r in _po_rows(data_dir)}
    rows = [r for r in pricing.read_rows(data_dir, 'soony/erp/stock_snapshot.csv') if r.get('material_id') == material]
    if not rows:
        return False
    latest = max(r.get('snapshot_date') or '' for r in rows)
    per_site = {}
    for row in rows:
        if (row.get('snapshot_date') or '') == latest and row.get('site') not in plants:
            per_site[row.get('site')] = per_site.get(row.get('site'), 0) + (pricing.to_number(row.get('quantity')) or 0)
    return any(total >= quantity for total in per_site.values())


def classify_option(item, board):
    """(kind, stock_ok). The kind is always decided by code, never taken from the model."""
    title = item.get('title') or ''
    if ALLOCATION_WORDS.search(title):
        return 'allocation', False
    if VERIFY_WORDS.search(title):
        return 'verify', False
    quantity = item.get('quantity') or 0
    if item.get('mode') in ('air', 'sea', 'road') and quantity > 0:
        return 'recovery', False
    if item.get('mode') == 'stock':
        return ('recovery', True) if stock_established(board, quantity) else ('verify', False)
    return 'verify', False


def _shipment_row(board, hold):
    issue = board['issue']
    for row in pricing.read_rows(board['data_dir'], 'soony/erp/open_shipments.csv'):
        if hold.get('po_number') in (row.get('po_numbers') or '').split('|') and hold.get('material_id') in (row.get('material_ids') or '').split('|'):
            return row
    return None


def hold_options(board):
    """One 'release' option per readable hold on goods that would cover part of the gap."""
    shortage = _int(board['issue'].get('shortage')) or 0
    options = []
    for hold in board.get('holds') or []:
        quantity = hold.get('quantity')
        if hold.get('needs_review') or not isinstance(quantity, int) or quantity <= 0 or shortage <= 0:
            continue
        supplier = hold.get('supplier') if isinstance(hold.get('supplier'), str) and SAFE_NAME.match(hold['supplier']) else 'supplier'
        row = _shipment_row(board, hold)
        mode = str((row or {}).get('mode') or '').lower()
        mode = mode if mode in ('air', 'sea', 'road') else None
        extra = []
        if row:
            planned = _parse_eta(row.get('eta'))
            if planned and board.get('deadline') and planned >= board['deadline']:
                extra.append('The booking predates the hold; its planned arrival is after launch, so only a faster courier helps.')
            else:
                extra.append('The booking predates the hold, so its planned arrival cannot be relied on.')
        extra.append('Whether the goods reach the receiving site before the last packing hour is not known.')
        options.append({'title': hold_title({'kind': 'release', 'supplier': supplier, 'blocker_type': hold.get('blocker_type'),
                                              'incoterm_required': hold.get('incoterm_required')}),
                        'kind': 'release', 'quantity': quantity, 'potential_units': min(quantity, shortage), 'mode': mode, 'eta': None,
                        'supplier': supplier, 'supplier_id': hold.get('supplier_id'), 'hold_id': hold.get('hold_id'),
                        'po_number': hold.get('po_number'), 'blocker_type': hold.get('blocker_type'),
                        'incoterm_required': hold.get('incoterm_required'), 'incoterm_ordered': hold.get('incoterm_ordered'),
                        'terms_change': bool(hold.get('incoterm_ordered') and hold.get('incoterm_required')
                                             and hold['incoterm_ordered'] != hold['incoterm_required']), 'detail': None,
                        'commitment': 'freight' if hold.get('unlock_kind') == 'freight_commitment' else None,
                        'extra_unknown': extra})
    return options


def hold_title(option):
    supplier = option.get('supplier') or 'supplier'
    code = option.get('incoterm_required')
    blocker = option.get('blocker_type')
    if blocker == 'incoterm_hold' and code:
        return f'Release the {supplier} hold: confirm {code} in writing or nominate a forwarder'
    word = {'payment_hold': 'payment ', 'document_hold': 'document '}.get(blocker, '')
    return f'Clear the {supplier} {word}hold'


def validate_options(raw, board):
    """Keep only well-formed model options: quantity>0 within need, allowed mode, parseable or null eta."""
    issue = board['issue']
    cap = max(_int(issue.get('required')) or 0, _int(issue.get('shortage')) or 0)
    good = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        quantity = item.get('quantity')
        mode = str(item.get('mode') or '').lower()
        title = item.get('title')
        if isinstance(quantity, bool) or not isinstance(quantity, (int, float)) or quantity != int(quantity):
            continue
        quantity = int(quantity)
        if quantity <= 0 or quantity > cap or mode not in ALLOWED_MODES:
            continue
        if not isinstance(title, str) or not title.strip():
            continue
        eta = item.get('eta')
        if eta in ('', None):
            eta = None
        elif not isinstance(eta, str) or _parse_eta(eta) is None:
            continue
        supplier = item.get('supplier')
        supplier = supplier.strip() if isinstance(supplier, str) and SAFE_NAME.match(supplier.strip()) else None
        detail = item.get('detail') if isinstance(item.get('detail'), str) else None
        kind, stock_ok = classify_option({'title': title.strip(), 'mode': mode, 'quantity': quantity}, board)
        title = title.strip()
        if kind == 'verify' and mode == 'stock':
            title = VERIFY_STOCK_TITLE
        if kind in ('allocation', 'verify'):
            detail = None  # composed by code: the model cannot describe supply it has not established
        good.append({'title': title, 'quantity': quantity, 'mode': mode, 'eta': eta, 'supplier': supplier,
                     'detail': detail, 'supplier_id': None, 'kind': kind, 'stock_established': stock_ok})
        if len(good) == 3:
            break
    return good


def compose_title(option):
    kind = option.get('kind')
    if kind == 'allocation' or option.get('mode') == 'allocate':
        return ALLOCATE_TITLE
    if kind == 'release':
        return hold_title(option)
    if kind == 'verify':
        return VERIFY_STOCK_TITLE if option.get('mode') == 'stock' else 'Confirm the supply before counting on it'
    if option.get('mode') == 'stock':
        return verify.compose('Use {quantity} units from stock', option)
    word = {'air': 'air', 'sea': 'sea', 'road': 'road'}.get(option.get('mode'), 'the fastest route')
    return verify.compose('Ship {quantity} units by ' + word, option)


def compose_detail(option):
    """Plain sentence built by code from the option's own fields."""
    kind = option.get('kind')
    if kind == 'allocation' or option.get('mode') == 'allocate':
        return 'No option is confirmed in time. Split the parts by the agreed launch priority and ask the approver to decide.'
    if kind == 'verify':
        return 'Check this with the supplier or the site before counting on it. No copies are counted until it is confirmed.'
    arrival = eta_text(option)
    where = 'arrival at the Hamburg site ' + ('is expected ' + arrival if option.get('eta') else 'is not confirmed')
    if kind == 'release':
        values = {'who': option.get('supplier') or 'the supplier', 'quantity': option.get('quantity')}
        return verify.compose('Release {quantity} units now held by {who}; ', values) + where + '.'
    if option.get('mode') == 'stock':
        return verify.compose('Use {quantity} units already held outside the receiving site; ', option) + where + '.'
    values = {'who': option.get('supplier') or 'another supplier', 'quantity': option.get('quantity'),
              'word': {'air': 'air', 'sea': 'sea', 'road': 'road'}.get(option.get('mode'), 'the fastest route')}
    return verify.compose('Ask {who} for {quantity} units by {word}; ', values) + where + '.'


# ------------------------------------------------------------------ roles

def reconciler(board):
    issue = board['issue']
    shortage = issue.get('shortage')
    hours = board.get('hours_left')
    if not isinstance(shortage, (int, float)):
        return 'needs human review'
    board['facts'] = {'shortage': int(shortage), 'required': issue.get('required'), 'usable_stock': issue.get('usable_stock'),
                      'incoming': issue.get('incoming'), 'hours_left': hours}
    board['short_context'] = short_context(issue, board['products'])
    if isinstance(hours, (int, float)):
        board['deadline'] = pricing.last_packing_moment(board['now'], float(hours))
        board['deadline_label'] = verify.label_of(board['deadline'])
    else:
        board['deadline'], board['deadline_label'] = None, None
        actions.flag_unknown(board['open_questions'], 'Confirm how many packing hours are left', actions.APPROVER_UNKNOWN)
        return 'needs human review'
    return 'done'


def _tier_rank(policy, role):
    order = [t['role'] for t in getattr(policy, 'tiers', []) or []]
    return order.index(role) if role in order else -1


def terms_approver(policy, category, as_of):
    """Who approves an exception to the purchase terms (policy exceptions rule), walking past vacant roles. Names come from the policy."""
    key = getattr(policy, 'exceptions_key', None)
    if not getattr(policy, 'ok', False) or not key:
        return None
    (resolved, label, holder), route, reasons = policy_mod._escalate(policy, key, category, policy_mod._to_date(as_of))
    return {'role': label, 'name': holder.get('name'), 'vacancy': bool(reasons), 'route': route, 'needs_cpo': resolved in ('cpo', 'cpo_cfo')}


def combine_terms_and_freight(freight, terms, policy):
    """The stricter of the exceptions approver and the air-freight approver is the chip; both roles are kept."""
    if not terms or not (freight or {}).get('role'):
        return freight
    brief = lambda a: {'role': a.get('role'), 'name': a.get('name'), 'vacancy': bool(a.get('vacancy'))}
    terms_first = _tier_rank(policy, terms['role']) >= _tier_rank(policy, freight['role'])
    chosen = terms if terms_first else freight
    if terms_first:
        note = f"Terms change; freight within {freight['role']} limit"
        why = (f"The delivery terms change, which needs the exceptions approval from {terms['role']}; "
               f"air freight is approved by {freight['role']}.")
    else:
        note = f"Terms change goes to {terms['role']}; freight needs {freight['role']}"
        why = (f"The delivery terms change, which needs the exceptions approval from {terms['role']}; "
               f"the air freight needs the higher approval of {freight['role']}.")
    return {'role': chosen['role'], 'name': chosen.get('name'), 'vacancy': bool(chosen.get('vacancy')), 'route': chosen.get('route') or [],
            'needs_cpo': bool(chosen.get('needs_cpo')), 'why': why, 'note': note,
            'provisional': False if terms_first else bool(freight.get('provisional')),
            'needs_amount': bool(freight.get('needs_amount')), 'freight_approver': brief(freight), 'terms_approver': brief(terms)}


def holds_role(board):
    """Look for goods a supplier is holding. Reads supplier confirmations only; nothing is sent."""
    found = holds_mod.find_holds(board['data_dir'], [board['issue'].get('material_id')])
    policy = board.get('policy')
    category = pricing.component_category(board['data_dir'], board['issue'].get('material_id'))
    mtd = pricing.month_to_date_air(board.get('assumptions'))
    for hold in found:
        who = None
        if hold.get('unlock_kind') == 'freight_commitment' and getattr(policy, 'ok', False) and not hold.get('needs_review'):
            try:
                as_of = board['now'].date().isoformat()
                answer = policy_mod.required_approver(policy, 0.0, 'air_freight', category, mtd or 0.0, as_of)
                if hold.get('incoterm_ordered') and hold.get('incoterm_required') and hold['incoterm_ordered'] != hold['incoterm_required']:
                    answer = combine_terms_and_freight(answer, terms_approver(policy, category, as_of), policy)
                who = {'role': answer.get('role'), 'name': answer.get('name'), 'vacancy': bool(answer.get('vacancy'))}
            except Exception:
                who = None
        hold['who_can_unlock'] = who
        if who is None and not hold.get('needs_review'):
            actions.flag_unknown(board['open_questions'], 'Confirm who can clear the supplier hold', actions.APPROVER_UNKNOWN)
    board['holds'] = found
    return 'needs human review' if any(h.get('needs_review') for h in found) else 'done'


def investigator_role(board):
    inv = board.get('investigation')
    failed = False
    if inv is None and callable(board.get('investigate')):
        try:
            inv = board['investigate']()
        except Exception:
            inv, failed = None, True
    raw = investigator.parse_options(inv.get('text')) if isinstance(inv, dict) else []
    valid = validate_options(raw, board)
    releases = hold_options(board)
    if valid:
        board['shapes'], board['mode'] = releases + valid, 'model'
        return 'done'
    board['shapes'], board['mode'] = releases + rule_options(board), 'deterministic'
    return 'fell back' if (failed or isinstance(inv, dict)) else 'done'


def _gain_for(board, option, base):
    """Fill one option's arrival and copies-gained fields from the what-if. Returns 'needs human review' when no baseline exists."""
    hours, issue, products = board.get('hours_left'), board['issue'], board['products']
    kind = option.get('kind') or classify_option(option, board)[0]
    option['kind'] = kind
    option['copies_gained'] = None
    option['arrival_known'] = False
    if kind not in ('recovery', 'release'):
        option['copies_gained_source'] = 'not_applicable'
        return 'done'
    eta = _parse_eta(option.get('eta'))
    option['arrival_known'] = eta is not None
    if eta is None:
        option['copies_gained_source'] = 'arrival_unknown'
        return 'done'
    option['copies_gained_source'] = 'whatif'
    if base is None:
        option['copies_gained_source'] = 'not_applicable'
        return 'needs human review'
    arrive = packing_hours(board['now'], eta) if eta > board['now'] else 0.0
    result = ships(issue, products, hours, float(arrive), option['quantity'])
    option['copies_gained'] = max(0, int(result['copies_ship']) - int(base['copies_ship']))
    return 'done'


def planner(board):
    hours = board.get('hours_left')
    issue, products = board['issue'], board['products']
    base = None
    if board.get('short_context') and isinstance(hours, (int, float)):
        base = ships(issue, products, hours, 0.0, 0)
    board['baseline_ships'] = base['copies_ship'] if base else None
    outcome = 'done'
    for option in board['shapes']:
        if _gain_for(board, option, base) == 'needs human review':
            outcome = 'needs human review'
    return outcome


def _unpriced(option, index):
    item = dict(option)
    item.update({'id': index, 'sid': index, 'goods_eur': None, 'freight_eur': None, 'total_eur': None, 'assumptions': [], 'unknown': ['The price could not be worked out.'],
                 'approver': {'role': None, 'name': None, 'why': 'The approver must be confirmed by a person.', 'vacancy': False, 'route': [], 'needs_cpo': False},
                 'feasible': False, 'feasibility': 'unknown' if item.get('kind') in (None, 'recovery', 'release') else 'na',
                 'flag': 'Arrival time is unknown, so this option cannot be counted on.',
                 'rank': index + 1, 'copies_per_eur': None})
    item['copies_gained'] = None
    return item


def pricer(board):
    issue = board['issue']
    priced = []
    for index, shape in enumerate(board['shapes']):
        if shape.get('kind') in ('verify', 'allocation'):
            item = dict(shape, id=index, sid=index, goods_eur=None, freight_eur=None, total_eur=None, assumptions=[], unknown=[],
                        approver={'role': None, 'name': None, 'why': None, 'vacancy': False, 'route': [], 'needs_cpo': False})
            priced.append(item)
            continue
        option = attach_estimate(board, dict(shape, id=index))
        item = {**shape, 'sid': index, **pricing.price_option(option, issue, board['data_dir'], board['assumptions'], policy=board['policy'],
                                                as_of=board['now'].date().isoformat())}
        item['unknown'] = list(item.get('unknown') or []) + list(shape.get('extra_unknown') or [])
        item['copies_gained'] = shape.get('copies_gained')
        priced.append(item)
    ranked = pricing.rank_options(priced, board.get('hours_left'), now=board['now'], deadline=board.get('deadline'))
    board['ranked'] = ranked
    return 'done'


def pricer_fallback(board):
    board['ranked'] = [_unpriced(s, i) for i, s in enumerate(board['shapes'])]


def value_role(board):
    board['value'] = value_mod.value_at_stake(board['issue'], board['products'], board['data_dir'], board['assumptions'])
    try:
        board['claim'] = value_mod.contract_claim(board['issue'], board['data_dir'], board['assumptions'])
    except Exception:
        board['claim'] = None
    return 'done'


def value_fallback(board):
    board['value'] = {'headline_eur': None, 'basis': 'cost', 'lines': [], 'assumptions': ['The value at stake could not be worked out.'],
                      'label': 'value could not be worked out'}
    board['claim'] = None


def policy_officer(board):
    policy = board['policy']
    if getattr(policy, 'ok', False):
        return 'done'
    actions.flag_unknown(board['open_questions'], 'Confirm who must approve this spend', actions.APPROVER_UNKNOWN)
    return 'needs human review'


def _escalation_target(policy):
    """The role that decides allocation and escalations: the chief procurement tier named in the policy."""
    if not getattr(policy, 'ok', False):
        return None
    tier = next((t for t in policy.tiers if t.get('key') == 'cpo'), None)
    if tier is None:
        return None
    return {'role': tier['role'], 'name': (policy.org or {}).get('cpo'), 'vacancy': False,
            'why': 'No option is confirmed in time, so the allocation decision goes to the chief procurement level.',
            'route': [tier['role']], 'needs_cpo': True}


def router(board):
    ranked = board['ranked']
    policy = board['policy']
    lowest = policy.tiers[0]['role'] if getattr(policy, 'ok', False) and policy.tiers else actions.APPROVER_UNKNOWN
    for item in ranked:
        if item.get('kind') in ('allocation', 'verify'):
            continue
        approver = item.get('approver') or {}
        if not approver.get('role'):
            actions.flag_unknown(board['open_questions'], f"Confirm the price of the option: {item.get('title')}", lowest)
        elif approver.get('needs_amount'):
            actions.flag_unknown(board['open_questions'], f"Confirm the freight cost: {item.get('title')}", approver.get('role'))
    category = pricing.component_category(board['data_dir'], board['issue'].get('material_id'))
    for item in ranked:
        if item.get('kind') == 'release' and item.get('terms_change') and (item.get('approver') or {}).get('role'):
            try:
                item['approver'] = combine_terms_and_freight(item['approver'], terms_approver(policy, category, board['now'].date().isoformat()), policy)
            except Exception:
                pass
    target = _escalation_target(policy)
    allocate = {'title': ALLOCATE_TITLE, 'kind': 'allocation', 'mode': 'allocate', 'quantity': 0, 'eta': None, 'supplier': None,
                'goods_eur': None, 'freight_eur': None, 'total_eur': None, 'copies_gained': None, 'copies_gained_source': 'not_applicable',
                'arrival_known': False, 'assumptions': [], 'unknown': [],
                'approver': target or {'role': None, 'name': None, 'why': 'The approver must be confirmed by a person.',
                                       'vacancy': False, 'route': [], 'needs_cpo': False},
                'feasible': False, 'feasibility': 'na', 'flag': None}
    ranked[:] = [i for i in ranked if i.get('kind') != 'allocation'] + [allocate]
    for position, item in enumerate(ranked, start=1):
        item['rank'] = position
        item['id'] = position - 1
    top = (next((i for i in ranked if i.get('feasible')), None)
           or next((i for i in ranked if i.get('kind') in ('release', 'recovery')), None)
           or next((i for i in ranked if i.get('kind') == 'verify'), None) or allocate)
    board['top'] = top
    board['approver'] = actions.pick_approver(top, policy)
    if not board['approver'].get('role') and (allocate.get('approver') or {}).get('role'):
        board['approver'] = actions.pick_approver(allocate, policy)  # nothing is priced: the allocation decision goes up
    return 'done'


def router_fallback(board):
    board['top'] = (board.get('ranked') or [None])[0]
    board['approver'] = {'role': None, 'name': None, 'vacancy': False, 'why': 'The approver must be confirmed by a person.', 'route': [], 'needs_cpo': False}


FEASIBLE_WORD = {'feasible': 'yes', 'too_late': 'late', 'unknown': 'unknown', 'na': 'na'}


def finalize_options(board):
    """Server-side option records for the case: wording is filled in here, then checked."""
    final = []
    for item in board['ranked']:
        approver = item.get('approver') or {}
        title = item.get('title') if isinstance(item.get('title'), str) else compose_title(item)
        detail = item.get('detail') if isinstance(item.get('detail'), str) and item.get('kind') not in ('allocation', 'verify') else None
        kind = item.get('kind') or 'recovery'
        final.append({
            'recommended': item is board.get('top'),
            'title': title, 'detail': detail or compose_detail(item), 'mode': item.get('mode'), 'quantity': item.get('quantity'),
            'price_eur': item.get('total_eur'), 'total_eur': item.get('total_eur'), 'eta': item.get('eta'),
            'eta_label': verify.eta_label(item.get('eta')), 'copies_gained': item.get('copies_gained'),
            'approver': ({'role': approver.get('role'), 'name': approver.get('name'), 'vacancy': bool(approver.get('vacancy')),
                          'why': approver.get('why'), 'route': approver.get('route') or [], 'needs_cpo': bool(approver.get('needs_cpo')),
                          'provisional': bool(approver.get('provisional')), 'needs_amount': bool(approver.get('needs_amount')),
                          'note': approver.get('note'), 'freight_approver': approver.get('freight_approver'),
                          'terms_approver': approver.get('terms_approver')}
                         if approver.get('role') else None),
            'feasible': FEASIBLE_WORD.get(item.get('feasibility'), 'unknown'), 'rank': item.get('rank'),
            'assumptions': list(item.get('assumptions') or []), 'unknown': list(item.get('unknown') or []),
            'supplier': item.get('supplier'), 'kind': kind, 'arrival_known': bool(item.get('arrival_known')),
            'copies_gained_source': item.get('copies_gained_source') or ('not_applicable' if kind not in ('recovery', 'release') else 'arrival_unknown'),
            'potential_units': item.get('potential_units'), 'stock_established': bool(item.get('stock_established')),
            'hold_id': item.get('hold_id'), 'po_number': item.get('po_number'), 'commitment': item.get('commitment'),
            'incoterm_required': item.get('incoterm_required'), 'blocker_type': item.get('blocker_type'),
            'goods_ordered_eur': item.get('goods_ordered_eur'), 'price_basis': item.get('price_basis')})
    board['options'] = final


def allowed_numbers(board, *extra):
    """Everything code computed: the issue facts, options, prices, value, hours, dates and code-written notes."""
    texts = []
    for item in board.get('ranked') or []:
        texts += list(item.get('assumptions') or []) + list(item.get('unknown') or [])
        texts.append((item.get('approver') or {}).get('why') or '')
    approver = board.get('approver') or {}
    texts.append(approver.get('why') or '')
    value = board.get('value') or {}
    texts += list(value.get('assumptions') or [])
    claim = board.get('claim') or {}
    texts.append(claim.get('basis_text') or '')
    code_numbers = [n for t in texts if t for n in verify.numbers_in_text(t)]
    facts = {k: board['issue'].get(k) for k in ('shortage', 'required', 'usable_stock', 'incoming', 'shipments', 'allocation',
                                              'launch_date', 'affected_products')}
    structures = [facts, board.get('products'), board.get('ranked'), board.get('options'), value, claim, board.get('brief'),
                  board.get('hours_left'), board.get('facts'), board.get('baseline_ships'), board.get('holds')]
    result = verify.allowed_from(*structures, *extra, extra_numbers=code_numbers + [len(board.get('options') or []), len(board.get('ranked') or [])],
                                 extra_dates=[board.get('deadline_label') or '', board.get('launch') or ''])
    return result


def claim_inputs(board):
    gains = [o.get('copies_gained') for o in board.get('options') or [] if isinstance(o.get('copies_gained'), (int, float))]
    brief = board.get('brief') or {}
    if isinstance(brief.get('copies_gained'), (int, float)):
        gains.append(brief['copies_gained'])
    etas = [o.get('eta') for o in board.get('options') or [] if o.get('eta')] + [board.get('deadline_label') or '', board.get('launch') or '']
    etas += [s.get('balance_eta') for s in board['issue'].get('shipments') or [] if s.get('balance_eta')]
    any_feasible = any(o.get('feasible') == 'yes' for o in board.get('options') or [])
    return gains, etas, any_feasible


def checker_options(board):
    """Reject model-written wording whose numbers or claims are not in the records; use code-composed sentences."""
    allowed = allowed_numbers(board)
    gains, etas, any_feasible = claim_inputs(board)
    for option in board['options']:
        for key, compose in (('title', compose_title), ('detail', compose_detail)):
            fallback = compose(option_for_compose(option))
            text, replaced = verify.vet_text(option[key], allowed, fallback)
            if not replaced and not verify.check_claims(text, gains, etas, any_feasible)['ok']:
                text, replaced = fallback, True
                board['claims_bad'] = True
            safe = public.safe_text(text, 160)
            if not safe:
                text, replaced = fallback, True
            elif safe != text.strip():
                text, replaced = fallback, True
            option[key] = text
            if replaced:
                board['replaced'] += 1
    return 'done' if not board['replaced'] else 'needs human review'


def option_for_compose(option):
    return {'mode': option.get('mode'), 'quantity': option.get('quantity'), 'eta': option.get('eta'), 'supplier': option.get('supplier'),
            'kind': option.get('kind'), 'blocker_type': option.get('blocker_type'), 'incoterm_required': option.get('incoterm_required')}


def fallback_brief(board):
    top = board.get('top') or {}
    confirmed = bool(top.get('feasible')) and top.get('kind') in (None, 'recovery', 'release')
    approver = board.get('approver') or {}
    return {'recommendation': (top.get('title') or ALLOCATE_TITLE) if confirmed else brief_mod.NONE_FEASIBLE,
            'price_eur': top.get('total_eur') if confirmed else None,
            'approver': ({'role': approver['role'], 'name': approver.get('name'), 'vacancy': bool(approver.get('vacancy'))}
                         if approver.get('role') else None),
            'copies_gained': top.get('copies_gained') if confirmed else None, 'deadline_label': board.get('deadline_label') or 'Deadline not stated',
            'confidence': 'low', 'risks': ['The brief could not be built from the records.'],
            'verify_next': ['Confirm the price, the arrival time and the approver']}


def headline_for(board):
    """A short title for the decision card, composed from the top option. At most 12 words, no identifiers."""
    top = board.get('top') or {}
    kind = top.get('kind')
    if kind == 'allocation' or top.get('mode') == 'allocate' or not top:
        text = 'Allocate by CPO priority and escalate'
    elif kind == 'release':
        text = (f"Release the {top.get('supplier') or 'supplier'} hold" if top.get('blocker_type') == 'incoterm_hold'
                else hold_title({'supplier': top.get('supplier'), 'blocker_type': top.get('blocker_type')}))
    elif kind == 'verify':
        text = compose_title(option_for_compose(top))
    else:
        title = (top.get('title') or '').strip()
        text = title if title and len(title.split()) <= 12 else compose_title(option_for_compose(top))
    return public.safe_text(' '.join(text.split()[:12]), 100) or 'Allocate by CPO priority and escalate'


def issue_public(board):
    shown = public.public_detail(board['issue'])
    shown['hours_left'] = board.get('hours_left')
    if board.get('deadline_label'):
        shown['deadline_label'] = board['deadline_label']
    return shown


def make_brief(board):
    if brief_mod is None:
        return fallback_brief(board)
    try:
        built = brief_mod.build_brief(issue_public(board), board['ranked'], board.get('approver'), board.get('value'),
                                      board['products'], numbers_verified=board['numbers_verified'], holds=board.get('holds'))
        if not isinstance(built, dict):
            return fallback_brief(board)
        if board.get('claims_bad'):
            built['confidence'] = 'low'
        return built
    except Exception:
        return fallback_brief(board)


def minimal_supplier(issue, issue_id):
    """No-number fallback for a supplier draft that failed its check."""
    body = (f"Dear {(issue.get('supplier') or {}).get('contact_name') or 'colleague'},\n\n"
            f"We are checking supply of {issue.get('material_id')} for Soony's Hamburg distribution center ahead of launch.\n\n"
            "Could you confirm what is available now, the fastest transport option with the earliest delivery time at our Hamburg site, "
            "and the cost?\n\nThis is an availability inquiry only, not an order, booking or spending commitment.\n\nThank you,\nSoony launch team")
    return {'to': '', 'subject': f"[Lio {issue_id}] Launch supply verification — {issue.get('material_id')}", 'body': body}


def drafter(board):
    board['brief'] = make_brief(board)
    return 'done'


def drafter_supplier(board):
    top = board.get('top') or {}
    issue, drafts = board['issue'], []
    best = next((i for i in board.get('ranked') or [] if i.get('kind') in (None, 'recovery') and i.get('mode') in ('air', 'sea', 'road')), None)
    option = top if top.get('kind') in (None, 'recovery') and top.get('mode') in ('air', 'sea', 'road') else best
    if top.get('kind') == 'release':
        hold = next((h for h in board.get('holds') or [] if h.get('hold_id') == top.get('hold_id')), None)
        if hold is not None:
            draft_ = actions.hold_supplier_draft(issue, hold, '', board['issue_id'])
            draft_['supplier'] = hold.get('supplier')
            drafts.append(draft_)
    inquiry = actions.supplier_draft(issue, option, board.get('launch'), '', board['issue_id'])
    inquiry['supplier'] = (issue.get('supplier') or {}).get('name')
    drafts.append(inquiry)
    board['supplier_drafts'] = drafts
    board['supplier_draft'] = drafts[0]
    return 'done'


def drafter_escalation(board, chosen=None):
    top = chosen or board.get('top') or {}
    if top.get('kind') not in (None, 'recovery', 'release'):
        top = next((i for i in board.get('ranked') or [] if i.get('kind') == 'allocation'), top)
    option = {k: top.get(k) for k in ('title', 'mode', 'quantity', 'total_eur', 'freight_eur', 'price_basis', 'copies_gained', 'assumptions',
                                      'unknown', 'kind', 'incoterm_required')}
    approver = board.get('approver')
    if chosen is not None and (chosen.get('approver') or {}).get('role'):
        approver = actions.pick_approver(chosen, board['policy'])
    if board.get('brief') is None:
        board['brief'] = make_brief(board)
    board['escalation'] = actions.escalation_draft(board['issue'], board['brief'], option, approver, board.get('value'),
                                                   board['policy'], board.get('claim'), board.get('hours_left'), board['open_questions'])
    return 'done'


def checker_final(board):
    """Check the brief and both drafts. Anything with a number that is not in the records is replaced."""
    extra = []
    escalation = board.get('escalation') or {}
    extra += [n.get('value') for n in escalation.get('numbers', []) if isinstance(n.get('value'), (int, float))]
    allowed = allowed_numbers(board, extra)
    bad = False
    brief = board.get('brief') or {}
    texts = [brief.get('recommendation') or '', brief.get('deadline_label') or ''] + list(brief.get('risks') or []) + list(brief.get('verify_next') or [])
    if any(not verify.check(t, allowed)['ok'] for t in texts):
        board['brief'] = fallback_brief(board)
        bad = True
    gains, etas, any_feasible = claim_inputs(board)
    claims_ok = lambda text: verify.check_claims(text, gains, etas, any_feasible)['ok']
    if any(not claims_ok(t) for t in texts) and board['brief'] is not None and board['brief'] is brief:
        board['brief'] = fallback_brief(board)
        bad = True
    drafts = board.get('supplier_drafts') or ([board['supplier_draft']] if board.get('supplier_draft') else [])
    for index, supplier in enumerate(drafts):
        if not verify.check(supplier['body'], allowed)['ok'] or not claims_ok(supplier['body']):
            hold = next((h for h in board.get('holds') or [] if supplier.get('subject', '').startswith('Held shipment')), None)
            replacement = (actions.minimal_hold_supplier(board['issue'], (board.get('holds') or [None])[0] or {}, board['issue_id'])
                           if hold is not None else minimal_supplier(board['issue'], board['issue_id']))
            replacement['supplier'] = supplier.get('supplier')
            drafts[index] = replacement
            bad = True
    if drafts:
        board['supplier_drafts'], board['supplier_draft'] = drafts, drafts[0]
    if escalation and not (verify.check(escalation['body'], allowed)['ok'] and claims_ok(escalation['body'])):
        approver = board.get('approver') or {}
        board['escalation'] = {'to_role': escalation.get('to_role') or actions.APPROVER_UNKNOWN, 'to_name': escalation.get('to_name'),
                               'subject': escalation.get('subject'),
                               'body': 'The figures in this draft could not be verified against the records, so none are shown. '
                                       'This needs human review before anyone decides. This is an internal draft and is not sent by the application.',
                               'numbers': [], 'approver_known': bool(approver.get('role'))}
        bad = True
    if bad:
        board['replaced'] += 1
        board['numbers_verified'] = False
        board['claims_bad'] = board.get('claims_bad') or not claims_ok(' '.join(texts))
        if board['brief'] is not None and board['brief'].get('confidence') != 'low' and brief_mod is not None:
            board['brief'] = make_brief(board)
    return 'needs human review' if bad else 'done'


def conflicts_role(board):
    if conflicts_mod is None:
        return 'skipped'
    found = conflicts_mod.find_conflicts(board['data_dir'], issue_public(board))
    board['conflicts'] = [c for c in (found or []) if isinstance(c, dict)]
    return 'done'


# ------------------------------------------------------------------ tool-calling agent support

def apply_recommendation(board):
    """The agent's recommended option becomes the top option and decides the approver. Validated before it is stored."""
    rec = board.get('recommendation')
    if not rec:
        return
    item = next((i for i in board.get('ranked') or [] if i.get('sid') == rec.get('sid')), None)
    if item is None:
        return
    board['top'] = item
    board['approver'] = actions.pick_approver(item, board['policy'])


def board_refresh(board):
    """Planner, pricer, router and option records over board['shapes']. Pure and idempotent; every step degrades on its own."""
    try:
        planner(board)
    except Exception:
        pass
    try:
        pricer(board)
    except Exception:
        pricer_fallback(board)
    if board.get('value') is None:
        try:
            value_role(board)
        except Exception:
            value_fallback(board)
    try:
        router(board)
    except Exception:
        router_fallback(board)
    apply_recommendation(board)
    finalize_options(board)


def trace_tool(board, tool, outcome, autonomy, summary, by='agent', turn=0):
    """One public timeline row for a tool call (or a rule step that filled a gap). Vocabulary is fixed; the summary is code-composed."""
    board['trace'].append({'step': len(board['trace']) + 1, 'tool': tool, 'outcome': outcome, 'autonomy': autonomy,
                           'summary': public.safe_text(summary, 100) or '', 'by': by, 'turn': int(turn), 'at': stamp()})


def agent_commit(board):
    """After the model loop: fill gaps with the rule policy, replay drafting intents on the final options, run the unchanged checkers."""
    from app import tools
    if not board.get('holds_done'):
        try:
            tools.ensure_holds(board)
        except Exception:
            board['holds'] = board.get('holds') or []
        trace_tool(board, labels.RULE_LABELS['holds'][0], 'done', 'auto', 'The agent did not check holds, so the rule check ran', by='rule')
    if not any(s.get('kind') in ('recovery', 'release') for s in board['shapes']):
        board['shapes'] += rule_options(board)
        trace_tool(board, labels.RULE_LABELS['options'][0], 'done', 'auto', 'No recovery option was proposed, so options came from the records', by='rule')
    board_refresh(board)
    guard(board, 'Policy Officer', 'Read the approval policy', 'auto', lambda: policy_officer(board))
    add_trace(board, 'Approver-Router', 'Spend and sending wait for a named approval', 'needs human review', 'approval')
    add_trace(board, 'Policy Officer', 'Booking and payment are not done by the app', 'skipped', 'never')
    guard(board, 'Checker', 'Checked the option wording against the records', 'auto', lambda: checker_options(board))
    if board['replaced']:
        board['numbers_verified'] = False
    guard(board, 'Drafter', 'Wrote the decision brief', 'draft', lambda: drafter(board), lambda: board.update(brief=fallback_brief(board)))
    tools.replay_intents(board)
    if not board.get('supplier_drafts'):
        guard(board, 'Drafter', 'Drafted the supplier request', 'draft', lambda: drafter_supplier(board),
              lambda: board.update(supplier_draft=minimal_supplier(board['issue'], board['issue_id'])))
        trace_tool(board, labels.RULE_LABELS['supplier'][0], 'done', 'draft', 'No supplier message was drafted, so the rule draft was used', by='rule')
    if not board.get('escalation'):
        guard(board, 'Drafter', 'Drafted the internal escalation', 'draft', lambda: drafter_escalation(board))
        trace_tool(board, labels.RULE_LABELS['escalation'][0], 'done', 'draft', 'No escalation was drafted, so the rule draft was used', by='rule')
    tools.prune_approvals(board)
    guard(board, 'Checker', 'Checked every number against the records', 'auto', lambda: checker_final(board), lambda: board.update(numbers_verified=False))
    if board.get('conflicts_done'):
        add_trace(board, 'Checker', 'Looked for conflicting records', 'done', 'auto')
    else:
        guard(board, 'Checker', 'Looked for conflicting records', 'auto', lambda: conflicts_role(board))


def rule_path(board):
    """The fixed role order: the same code and the same trace as before the tool-calling agent existed."""
    issue, issue_id = board['issue'], board['issue_id']
    guard(board, 'Investigator', 'Checked supplier confirmations for holds', 'auto', lambda: holds_role(board),
          lambda: board.update(holds=[]))
    outcome = guard(board, 'Investigator', 'Looked for recovery options with the model', 'auto', lambda: investigator_role(board),
                    lambda: board.update(shapes=rule_options(board), mode='deterministic'))
    if board['mode'] == 'deterministic':  # state truthfully that no model produced the options
        board['trace'][-1]['action'] = ('Used rule-based options instead of the model' if outcome == 'fell back'
                                        else 'Built recovery options from the records (no model)')
    guard(board, 'Allocation Planner', 'Worked out copies gained for each option', 'auto', lambda: planner(board))
    guard(board, 'Pricer', 'Priced and ranked the options', 'auto', lambda: pricer(board), lambda: pricer_fallback(board))
    guard(board, 'Pricer', 'Worked out the value at stake', 'auto', lambda: value_role(board), lambda: value_fallback(board))
    guard(board, 'Policy Officer', 'Read the approval policy', 'auto', lambda: policy_officer(board))
    guard(board, 'Approver-Router', 'Routed each option to its approver', 'auto', lambda: router(board), lambda: router_fallback(board))
    add_trace(board, 'Approver-Router', 'Spend and sending wait for a named approval', 'needs human review', 'approval')
    add_trace(board, 'Policy Officer', 'Booking and payment are not done by the app', 'skipped', 'never')
    finalize_options(board)
    guard(board, 'Checker', 'Checked the option wording against the records', 'auto', lambda: checker_options(board))
    if board['replaced']:
        board['numbers_verified'] = False
    guard(board, 'Drafter', 'Wrote the decision brief', 'draft', lambda: drafter(board),
          lambda: board.update(brief=fallback_brief(board)))
    guard(board, 'Drafter', 'Drafted the supplier request', 'draft', lambda: drafter_supplier(board),
          lambda: board.update(supplier_draft=minimal_supplier(issue, issue_id)))
    guard(board, 'Drafter', 'Drafted the internal escalation', 'draft', lambda: drafter_escalation(board))
    guard(board, 'Checker', 'Checked every number against the records', 'auto', lambda: checker_final(board),
          lambda: board.update(numbers_verified=False))
    guard(board, 'Checker', 'Looked for conflicting records', 'auto', lambda: conflicts_role(board))


def _reset_work(board, questions):
    """Throw away everything a failed agent run put on the blackboard, so the rule path starts clean."""
    board.update(shapes=[], ranked=[], options=[], supplier_draft=None, supplier_drafts=[], escalation=None, brief=None, top=None,
                 approver=None, holds=[], value=None, claim=None, conflicts=[], approvals=[], intents=[], recommendation=None,
                 holds_done=False, conflicts_done=False, mode='deterministic', replaced=0, numbers_verified=True, claims_bad=False,
                 agent={'tool_calls': 0, 'rejected': 0, 'seconds': 0.0})
    board['open_questions'][:] = list(questions)
    board['trace'][:] = [e for e in board['trace'] if e.get('agent') == 'Reconciler']


# ------------------------------------------------------------------ run

def run(issue_id, issue, products, hours_left, data_dir, state_dir, *, investigation=None, investigate=None, policy=None,
        assumptions=None, now=None, launch=None, source_fingerprint=None, as_of_label=None, operator=None):
    """Run every role on one blackboard and return the result to store in the case. Never raises."""
    data_dir = Path(data_dir)
    now = (now or reference_now(as_of_label, launch, datetime.now(BERLIN))).astimezone(BERLIN)
    board = {'issue_id': issue_id, 'issue': issue, 'products': products or [], 'hours_left': hours_left, 'data_dir': data_dir,
             'now': now, 'launch': launch, 'trace': [], 'open_questions': [], 'replaced': 0, 'numbers_verified': True,
             'investigation': investigation, 'investigate': investigate, 'shapes': [], 'ranked': [], 'options': [],
             'mode': 'deterministic', 'conflicts': [], 'value': None, 'claim': None, 'brief': None, 'escalation': None,
             'supplier_draft': None, 'supplier_drafts': [], 'top': None, 'approver': None, 'holds': [], 'claims_bad': False,
             'run_mode': 'rule_based', 'approvals': [], 'intents': [], 'recommendation': None, 'holds_done': False,
             'conflicts_done': False, 'agent': {'tool_calls': 0, 'rejected': 0, 'seconds': 0.0}}
    try:
        board['policy'] = policy if policy is not None else cached_policy(data_dir)
    except Exception:
        board['policy'] = policy_mod.Policy(ok=False, problems=['The approval policy could not be read.'])
    try:
        board['assumptions'] = assumptions if assumptions is not None else pricing.load_assumptions(state_dir)
    except Exception:
        board['assumptions'] = {}

    guard(board, 'Reconciler', 'Recomputed the shortage from the records', 'auto', lambda: reconciler(board))
    status = 'fell back'
    if operator is not None:
        saved = list(board['open_questions'])
        try:
            status = operator(board)
        except Exception:
            status = 'fell back'
        if status != 'fell back':
            board['mode'] = 'model'
            agent_commit(board)
        else:
            _reset_work(board, saved)
            trace_tool(board, labels.RULE_LABELS['fallback'][0], 'fell back', 'auto', 'The model could not complete, so the fixed rule order ran', by='rule')
    if status == 'fell back':
        board['run_mode'] = 'rule_based'
        rule_path(board)
    if isinstance(board.get('brief'), dict):
        board['brief']['headline'] = headline_for(board)
    return {'transport': transport_for(board), 'options': board['options'], 'brief': board['brief'], 'value': board['value'], 'claim': board['claim'],
            'trace': board['trace'], 'escalation': board['escalation'], 'supplier_draft': board['supplier_draft'],
            'supplier_drafts': board['supplier_drafts'], 'holds': board['holds'], 'top_kind': (board.get('top') or {}).get('kind'),
            'numbers_verified': bool(board['numbers_verified']), 'conflicts': board['conflicts'],
            'open_questions': board['open_questions'], 'mode': board['mode'], 'hours_left': hours_left,
            'run_mode': board['run_mode'], 'agent': board['agent'], 'approvals': board['approvals'],
            'at': stamp(), 'source_fingerprint': source_fingerprint or fingerprint(issue)}
