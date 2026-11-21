"""Decision brief: one recommendation, its price, who approves, what to verify next.

Pure function over plain dicts produced by the pricing, policy and value modules. Nothing is
invented: an unknown price or arrival stays None and becomes a question to verify.
"""

NONE_FEASIBLE = 'No option is confirmed in time. Allocate by the CPO priority and escalate.'


def _is_feasible(option):
    state = option.get('feasible')
    if isinstance(state, str):
        return state.strip().lower() in ('yes', 'feasible', 'true')
    if state is True:
        return True
    return option.get('feasibility') == 'feasible' if state is None else False


def _rank(option, position):
    rank = option.get('rank')
    return (rank if isinstance(rank, (int, float)) else 10 ** 6, position)


def _supplier(option):
    for key in ('supplier', 'supplier_name'):
        if option.get(key):
            return str(option[key]).strip()
    return None


def _action(option):
    title = (option.get('title') or '').strip()
    supplier = _supplier(option)
    quantity, mode = option.get('quantity'), (option.get('mode') or '').strip()
    if supplier:
        what = f'{quantity:,} units' if isinstance(quantity, (int, float)) and quantity else 'the parts'
        by = f' by {mode}' if mode and mode != 'stock' else ''
        return f'Ask {supplier} for {what}{by}'
    return title or 'Take the top-ranked option'


def _approver(approver, top):
    source = approver if isinstance(approver, dict) and (approver.get('role') or approver.get('name')) else (top or {}).get('approver')
    if not isinstance(source, dict) or not (source.get('role') or source.get('name')):
        return None
    return {'role': source.get('role'), 'name': source.get('name'), 'vacancy': bool(source.get('vacancy') or source.get('vacant'))}


def _deadline(issue):
    issue = issue or {}
    for key in ('deadline', 'deadline_label'):
        if issue.get(key):
            return str(issue[key])
    hours = issue.get('hours_left')
    if isinstance(hours, (int, float)):
        shown = int(hours) if float(hours).is_integer() else round(hours, 1)
        return f'{shown} packing hours left'
    return 'Deadline not stated'


REVIEW_NOTE = 'A person must read a scanned supplier confirmation'
LEVELS = ['low', 'medium', 'high']


def _kind(option):
    return option.get('kind') or 'recovery'


def _arrival_unknown(option):
    known = option.get('arrival_known')
    return (not option.get('eta')) if known is None else not known


def _label(option):
    return (option.get('title') or '').strip() or _action(option)


def build_brief(issue_public, priced_options, approver, value, products, numbers_verified=False, holds=None, stock_estimate=False):
    options = [o for o in (priced_options or []) if isinstance(o, dict)]
    ordered = [o for _, o in sorted(((_rank(o, i), o) for i, o in enumerate(options)), key=lambda pair: pair[0])]
    feasible = [o for o in ordered if _is_feasible(o) and _kind(o) in ('recovery', 'release')]
    top = feasible[0] if feasible else None
    risks, verify = [], []
    review = any(isinstance(h, dict) and h.get('needs_review') for h in holds or [])
    candidates = [o for o in ordered if _kind(o) in ('recovery', 'release') and o.get('feasible') not in ('late', 'too_late')]
    pending = next((o for o in candidates if _arrival_unknown(o)), None)
    shown = top
    price = gained = None

    if top is not None:
        recommendation = _label(top) if _kind(top) == 'release' else _action(top)
        price = top.get('total_eur')
        price = float(price) if isinstance(price, (int, float)) else None
        gained = top.get('copies_gained')
        gained = gained if isinstance(gained, (int, float)) else None
        place = (top.get('destination') or top.get('site') or 'the receiving site')
        if price is None:
            kind = {'air': 'air-freight ', 'sea': 'sea-freight ', 'road': 'road-freight '}.get(top.get('mode'), '')
            verify.append(f'Confirm the {kind}price')
            risks.append('The cost of this option is not known yet.')
        if not top.get('eta'):
            verify.append(f'Confirm the earliest delivery time at {place}')
            risks.append('The arrival time is not confirmed.')
        for note in top.get('unknown') or []:
            if isinstance(note, str) and 'xchange' in note:
                verify.append('Confirm the exchange rate used for the price')
        if top.get('mode') == 'air':
            verify.append('Confirm the air-freight limit for this month is not exceeded')
        confidence = 'medium'
        if numbers_verified and price is not None and top.get('eta') and not stock_estimate:
            confidence = 'high'
    elif pending is not None:
        shown = pending
        recommendation = (f"First action: {_label(pending).rstrip('.')}. Arrival is not confirmed, so no copies are counted yet. "
                          'Meanwhile allocate by the CPO priority.')
        confidence = 'low'
        price = pending.get('total_eur')
        price = float(price) if isinstance(price, (int, float)) else None
        if _kind(pending) == 'release' or pending.get('commitment') == 'freight':
            verify.append('Have a named person confirm the delivery terms with the supplier in writing, or nominate a forwarder')
        verify.append('Ask the supplier or forwarder for the earliest realistic arrival at the receiving site')
        risks.append('The arrival time is not confirmed.')
        if price is None:
            verify.append('Confirm the freight cost assumption')
            risks.append('The cost of this option is not known yet.')
    else:
        recommendation = NONE_FEASIBLE
        confidence = 'low'
        if any(_kind(o) in ('recovery', 'release') for o in options):
            risks.append('The earliest known arrival is after the last packing hour.')
            verify.append('Confirm the earliest delivery time for each open supplier request')
        elif options:
            risks.append('No option arrives before the last packing hour, or arrival is unknown.')
            verify.append('Confirm the earliest delivery time for each open supplier request')
        else:
            risks.append('No recovery option has been proposed yet.')
            verify.append('Ask suppliers for part quantities and arrival times')

    if review:
        verify.insert(0, REVIEW_NOTE)
        confidence = 'low'
    chosen = _approver(approver, shown)
    if chosen is None:
        risks.append('The approver is not identified.')
        verify.append('Confirm who must approve this spend')
        confidence = 'low' if top is None else min(confidence, 'medium', key=LEVELS.index)
    elif chosen['vacancy']:
        risks.append('The usual approver role is vacant, so the request goes up one level.')
    if not numbers_verified or stock_estimate:
        verify.append('Count the cards used since the last stock snapshot')
    if not isinstance(value, dict) or value.get('headline_eur') is None:
        risks.append('The value at stake could not be worked out.')
    if not issue_public:
        confidence = 'low'
        risks.append('The issue summary is missing.')

    unique = lambda items: list(dict.fromkeys(items))
    return {'recommendation': recommendation, 'price_eur': price, 'approver': chosen, 'copies_gained': gained,
            'deadline_label': _deadline(issue_public), 'confidence': confidence,
            'risks': unique(risks), 'verify_next': unique(verify)}
