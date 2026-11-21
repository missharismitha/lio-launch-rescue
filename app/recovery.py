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


def scenario(issue, products, launch_date, quantity, arrival_at, cost_eur, as_of=None):
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
    if cost_eur < 50000:
        approval = 'Buyer'
    elif cost_eur < 500000:
        approval = 'Category Lead'
    elif cost_eur < 2000000:
        approval = 'Head of Procurement'
    elif cost_eur < 5000000:
        approval = 'Chief Procurement Officer'
    else:
        approval = 'CPO and CFO jointly'
    return {'offer_quantity': quantity, 'arrival_at': arrival.isoformat(), 'deadline': deadline.isoformat(), 'scenario_as_of': as_of.isoformat(),
            'cost_eur': cost_eur, 'component_gap_after_offer': max(0, uncovered-quantity) if arrival < deadline else uncovered,
            'arrives_before_deadline': arrival < deadline, 'value_approver': approval,
            'packing_scenarios': options, 'status': 'reviewed supplier offer — not ordered or received',
            'constraints': ['Do not sum the per-edition scenarios: they compete for the same offer.',
                            'Confirm current packing progress, other components and dock slot.',
                            'PP-07 receiving-site approval and air-freight category/month limits also apply.',
                            'Rate and shift assumptions come from the initial launch scenario; confirm with the customer.']}
