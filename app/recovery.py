"""Bounded recovery scenarios. Offers never overwrite recorded warehouse stock."""
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

BERLIN = ZoneInfo('Europe/Berlin')


def aware(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('Use an arrival timestamp with an explicit timezone offset')
    return result.astimezone(BERLIN)


def packing_hours(start, deadline):
    """Scenario assumption from the brief: Saturday 06–22, Sunday 06–20."""
    total = 0.0
    day = start.date()
    while day <= deadline.date():
        if day.weekday() in (5, 6):
            begin = datetime.combine(day, time(6), BERLIN)
            end = datetime.combine(day, time(22 if day.weekday() == 5 else 20), BERLIN)
            lo, hi = max(start, begin), min(deadline, end)
            total += max(0, (hi-lo).total_seconds()/3600)
        day += timedelta(days=1)
    return round(total, 3)


APPROVER_UNKNOWN = 'Approver to be confirmed by a person'


def approval(policy, cost_eur, as_of=None, category=None, mode=None):
    """The stricter of the order-value approver and the air-freight approver, from the approval policy. Never guessed.

    Returns {role, name, vacancy, provisional} or None when the policy cannot be read. A mode other than air or sea/road
    is treated as potential air-freight spend (provisional: the real route is not known yet).
    """
    from app import policy as policy_mod
    when = as_of.date() if hasattr(as_of, 'date') else as_of
    try:
        by_value = policy_mod.required_approver(policy, cost_eur, 'po', category, as_of=when)
        by_freight = policy_mod.required_approver(policy, cost_eur, 'air_freight', category, 0.0, when)
    except policy_mod.PolicyParseError:
        return None
    order = [t.get('role') for t in getattr(policy, 'tiers', []) or []]
    rank = lambda a: order.index(a['role']) if a.get('role') in order else -1
    chosen = by_freight if rank(by_freight) > rank(by_value) else by_value
    if not chosen.get('role'):
        return None
    return {'role': chosen['role'], 'name': chosen.get('name'), 'vacancy': bool(chosen.get('vacancy')),
            'provisional': mode not in ('air', 'sea', 'road')}


def approval_role(policy, cost_eur, as_of=None, category=None, mode=None):
    answer = approval(policy, cost_eur, as_of, category, mode)
    return answer['role'] if answer else APPROVER_UNKNOWN


def scenario(issue, products, launch_date, quantity, arrival_at, cost_eur, as_of=None, policy=None, category=None, mode=None):
    arrival = aware(arrival_at)
    as_of = as_of or datetime.now(BERLIN)
    deadline = datetime.combine(datetime.fromisoformat(launch_date).date(), time(20), BERLIN)
    hours = packing_hours(max(arrival, as_of), deadline)
    uncovered = max(0, issue['shortage'])
    supplied = min(quantity, uncovered)
    options = []
    for product in products:
        if product['id'] not in issue.get('affected_products', []):
            continue
        rate = product.get('rate_per_hour') or 0
        # A per-edition scenario, not simultaneous allocation or a whole-launch forecast.
        bound = min(supplied, product['remaining'], int(hours * rate))
        options.append({'product_id': product['id'], 'name': product['name'], 'packing_hours_after_arrival': hours,
                        'rate_per_hour': rate, 'maximum_additional_units': bound,
                        'assumption': 'Allocate this offer to this edition only; all other components and capacity available.'})
    chosen = approval(policy, cost_eur, as_of, category, mode)
    approval_text = chosen['role'] if chosen else APPROVER_UNKNOWN
    return {'offer_quantity': quantity, 'arrival_at': arrival.isoformat(), 'deadline': deadline.isoformat(), 'scenario_as_of': as_of.isoformat(),
            'cost_eur': cost_eur, 'component_gap_after_offer': max(0, uncovered-quantity) if arrival < deadline else uncovered,
            'arrives_before_deadline': arrival < deadline, 'value_approver': approval_text, 'approver': chosen,
            'packing_scenarios': options, 'status': 'reviewed supplier offer — not ordered or received',
            'constraints': ['Do not sum the per-edition scenarios: they compete for the same offer.',
                            'Confirm current packing progress, other components and dock slot.',
                            'The receiving-site approval and the air-freight limits in the approval policy also apply.',
                            'Rate and shift assumptions come from the initial launch scenario; confirm with the customer.']}
