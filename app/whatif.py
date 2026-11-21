"""Pure what-if model: how many copies of a short edition still ship if parts arrive later.

No I/O, no business constants. Every figure comes from the arguments.
"""
from datetime import datetime, timedelta


def _num(value, default=0.0):
    try:
        return float(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def _packable(rate, hours):
    return max(0, int(rate * max(hours, 0.0) + 1e-9))


def scenario_label(hours_from_now, now_iso=None, shift_end_hour=None):
    """Short human label such as 'in 6 h'. A clock time is added only when now_iso is given."""
    hours = _num(hours_from_now)
    if hours <= 0:
        return 'now'
    shown = int(hours) if abs(hours - round(hours)) < 1e-9 else round(hours, 1)
    label = f'in {shown} h'
    if now_iso:
        try:
            when = datetime.fromisoformat(str(now_iso).replace('Z', '+00:00')) + timedelta(hours=hours)
        except ValueError:
            return label
        label += f' (about {when:%H:%M})'
        if shift_end_hour is not None and (when.hour + when.minute / 60) >= _num(shift_end_hour):
            label += ', after packing stops'
    return label


def ships(products, short_product_id, component_need_per_copy=1, usable_units_now=0,
          arrival_units=0, arrive_in_hours=0, hours_left=0, priority_order=None):
    """Copies of the short edition that still ship, and how many stay short.

    Editions share one scarce part. Parts usable now cover packing until they run out; an arrival
    of `arrival_units` at `arrive_in_hours` lets packing continue, but only while hours remain.
    Packing stops at `hours_left` (no night shift). Shared parts are reserved for editions in
    `priority_order` first, each up to what it could pack in the hours left.
    """
    need = _num(component_need_per_copy, 1) or 1
    horizon = max(_num(hours_left), 0.0)
    arrive = _num(arrive_in_hours)
    usable_now = max(_num(usable_units_now), 0.0)
    arriving = max(_num(arrival_units), 0.0)
    items = {p.get('id'): p for p in (products or []) if isinstance(p, dict)}
    result = {'copies_ship': 0, 'copies_short': 0, 'arrive_label_hours': arrive,
              'hours_left': horizon, 'feasible': False}
    if short_product_id not in items:
        return result

    order = [i for i in (priority_order or []) if i in items]
    order += [i for i in items if i not in order]
    remaining = {i: max(int(_num(items[i].get('remaining'))), 0) for i in order}
    rate = {i: _num(items[i].get('rate_per_hour')) for i in order}
    short_total = remaining[short_product_id]

    # Parts that arrive too late add nothing: at exactly hours_left there is zero time left to pack.
    arrives_in_time = arriving > 0 and arrive < horizon
    pool = usable_now
    first_phase = horizon
    if arrives_in_time:
        if arrive <= 0:
            pool += arriving
            arriving = 0.0
        else:
            first_phase = arrive
    supply = pool + (arriving if arrives_in_time else 0.0)

    # Reserve total supply by priority, each edition up to what its lines could pack in the hours left.
    allowance, left = {}, supply
    for i in order:
        want = need * min(remaining[i], _packable(rate[i], horizon))
        allowance[i] = min(want, left)
        left -= allowance[i]

    packed = {i: 0 for i in order}

    def run_phase(hours, available):
        for i in order:
            copies = min(remaining[i] - packed[i], _packable(rate[i], hours),
                         int(allowance[i] // need) - packed[i], int(available // need))
            copies = max(copies, 0)
            packed[i] += copies
            available -= copies * need
        return available

    pool = run_phase(first_phase, pool)
    if arrives_in_time and arrive > 0:
        # A line idles while it waits for parts, so phase two can only use the hours after arrival.
        run_phase(horizon - first_phase, pool + arriving)

    ship = packed[short_product_id]
    result.update(copies_ship=ship, copies_short=max(short_total - ship, 0), feasible=ship >= short_total)
    return result

