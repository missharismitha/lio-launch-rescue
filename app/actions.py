"""Drafts and open questions. Nothing here sends anything.

The supplier draft carries supplier-facing facts only. The escalation draft is an INTERNAL message to the
approver named by the approval policy; it is built from a template with every number injected by code and
is never sent by the application: a named person approves it and forwards it themselves.

Drafts are deliberately short: an approver reads them in seconds.
"""
from __future__ import annotations

from app import verify

SUPPLIER_ASK = ('Please reply with the units available to ship now, the fastest route with the earliest delivery at our Hamburg site '
                '(airport arrival and delivery to the packing site separately), and the cost with currency.\n\n'
                'This is an availability inquiry only, not an order, booking or spending commitment.\n\n'
                'Thank you,\nSoony launch team')
APPROVER_UNKNOWN = 'Approver to be confirmed by a person'
INCOTERM_IMPLICATION = ("Accepting {code} means Soony pays freight, insurance and duties and carries transport risk "
                        "from the supplier's dock.")
MODE_WORDS = {'air': 'air freight', 'sea': 'sea freight', 'road': 'road freight'}
MAX_OPEN_POINTS = 3


def supplier_draft(issue, option=None, launch=None, recipient='', issue_id=None):
    """{to, subject, body}: only facts from the supplier's own advice plus the ask. No internal figures."""
    issue_id = issue_id or issue.get('id')
    contact = (issue.get('supplier') or {}).get('contact_name')
    facts = ' '.join(
        f"Your order {s['po_number']}, air waybill {s['reference'] or 'n/a'}: {s['ordered']:,} ordered, {s['shipped']:,} shipped, "
        f"{s['balance']:,} remaining" + (f" (advised delivery to Hamburg {s['balance_eta']})" if s.get('balance_eta') else '') + '.'
        for s in issue.get('shipments', []))
    launch = launch or 'our launch date'
    short = issue.get('shortage')
    need = f"We need about {short:,} more units usable before launch. " if isinstance(short, int) and short > 0 else ''
    extra = ''
    if isinstance(option, dict) and option.get('mode') in MODE_WORDS and isinstance(option.get('quantity'), int) and option['quantity'] > 0:
        extra = f"If you can, please quote {option['quantity']:,} units by {MODE_WORDS[option['mode']]}."
    intro = (f"We are checking supply of {issue['material_id']} for Soony's Hamburg distribution center ahead of launch on {launch}. "
             + need + (facts + ' ' if facts else '') + extra).rstrip()
    body = f"Dear {contact or 'colleague'},\n\n{intro}\n\n{SUPPLIER_ASK}"
    return {'to': recipient or '', 'subject': f"[Lio {issue_id}] Launch supply verification — {issue['material_id']}", 'body': body}


def hold_supplier_draft(issue, hold, recipient='', issue_id=None):
    """Inquiry to a supplier that is holding goods. Facts from its own confirmation plus questions; nothing is agreed.

    It never states the shortage, the launch date or a price, never confirms a delivery term, never instructs a release.
    """
    issue_id = issue_id or (issue or {}).get('id')
    material = (hold or {}).get('material_id') or (issue or {}).get('material_id')
    quantity = (hold or {}).get('quantity')
    contact = ((issue or {}).get('supplier') or {}).get('contact_name') if (issue or {}).get('supplier') else None
    units = f'{quantity:,} units' if isinstance(quantity, int) and quantity > 0 else 'the goods'
    greeting = contact if (hold or {}).get('supplier_id') == ((issue or {}).get('supplier') or {}).get('id') and contact else 'colleague'
    body = (f"Dear {greeting},\n\n"
            f"Regarding your confirmation for {units} of {material}: you advised that the shipment is packed and on hold "
            "pending Buyer's written confirmation of delivery terms or a nominated forwarder.\n\n"
            "Please tell us whether it is ready and where, the dispatch options with cut-off times and the earliest arrival at Hamburg, "
            "the wording you need for a written confirmation, and any freight you would invoice.\n\n"
            "Our confirmation needs internal approval, which is in progress. This message does not confirm any delivery term, "
            "change our order, or instruct you to release.\n\nThank you,\nSoony launch team")
    return {'to': recipient or '', 'subject': f"Held shipment: dispatch options for {material} [Lio {issue_id}]", 'body': body}


def minimal_hold_supplier(issue, hold, issue_id=None):
    """No-number fallback for a hold inquiry that failed its check."""
    issue_id = issue_id or (issue or {}).get('id')
    material = (hold or {}).get('material_id') or (issue or {}).get('material_id')
    body = ("Dear colleague,\n\nRegarding your confirmation for " + str(material) + ": could you tell us whether the shipment is ready, "
            "the dispatch options with cut-off times, and the earliest realistic arrival at Hamburg?\n\n"
            "Soony's confirmation needs internal approval, which is in progress. This message does not confirm any delivery term, "
            "change our order, or instruct you to release.\n\nThank you,\nSoony launch team")
    return {'to': '', 'subject': f"Held shipment: dispatch options for {material} [Lio {issue_id}]", 'body': body}


def flag_unknown(open_questions, question, owner_role):
    """Record an open question with the role that owns the answer. Returns the entry."""
    entry = {'question': str(question).strip(), 'owner_role': owner_role or APPROVER_UNKNOWN}
    if entry['question'] and entry not in open_questions:
        open_questions.append(entry)
    return entry


def pick_approver(option, policy=None):
    """The stricter of the option's air-freight approver and its value approver, by policy tier order."""
    approver = dict((option or {}).get('approver') or {})
    candidates = [approver]
    value = approver.get('value_approver')
    if isinstance(value, dict) and value.get('role'):
        candidates.append({'role': value['role'], 'name': value.get('name'), 'vacancy': approver.get('vacancy', False),
                           'why': approver.get('why'), 'route': approver.get('route', []), 'needs_cpo': approver.get('needs_cpo', False)})
    order = [t.get('role') for t in getattr(policy, 'tiers', []) or []]

    def rank(item):
        return order.index(item['role']) if item.get('role') in order else -1
    best = max(candidates, key=rank)
    return {'role': best.get('role'), 'name': best.get('name'), 'vacancy': bool(best.get('vacancy')),
            'why': approver.get('why') if best is approver else (approver.get('why') or ''),
            'route': best.get('route') or [], 'needs_cpo': bool(best.get('needs_cpo')),
            'freight_approver': approver.get('freight_approver'), 'terms_approver': approver.get('terms_approver'), 'note': approver.get('note'),
            'provisional': bool(best.get('provisional')) if best is approver else False,
            'needs_amount': bool(best.get('needs_amount')) if best is approver else False}


def _short_title(issue):
    title = str((issue or {}).get('title') or 'Launch shortage').strip()
    return title if len(title) <= 60 else title[:59].rsplit(' ', 1)[0] + '…'


def _who(person):
    return f"{person.get('role')}" + (f" ({person['name']})" if person.get('name') else '')


def escalation_draft(issue, brief, option, approver, value, policy=None, claim=None, hours_left=None,
                     open_questions=None):
    """Short internal message to the approver: {to_role, to_name, subject, body, numbers[], approver_known}."""
    option = option or {}
    approver = approver or {}
    role, name = approver.get('role'), approver.get('name')
    known = bool(role)
    gained = option.get('copies_gained')
    total = option.get('total_eur')
    freight = option.get('freight_eur')
    per_copy = round(total / gained, 2) if isinstance(total, (int, float)) and isinstance(gained, (int, float)) and gained > 0 else None
    headline = (value or {}).get('headline_eur') if isinstance(value, dict) else None
    deadline = (brief or {}).get('deadline_label') or 'Deadline not stated'
    estimate = ' (estimate, to be confirmed)' if option.get('price_basis') == 'estimate' else ''
    numbers = [
        {'label': 'copies gained', 'value': gained},
        {'label': 'cost in EUR', 'value': total},
        {'label': 'freight in EUR', 'value': freight},
        {'label': 'cost per copy gained in EUR', 'value': per_copy},
        {'label': 'value at stake in EUR', 'value': headline},
        {'label': 'packing hours left', 'value': hours_left},
    ]
    values = {n['label']: n['value'] for n in numbers}
    mode = MODE_WORDS.get(option.get('mode'), 'the proposed route')
    kind = option.get('kind')
    lines = [f"To: {role or APPROVER_UNKNOWN}" + (f" ({name})" if name else '') + '.',
             f"Recommended: {str((brief or {}).get('recommendation') or option.get('title') or 'allocate by priority and escalate').rstrip('.')}."]
    if kind in ('allocation', 'verify'):
        lines.append('Copies gained: not applicable.')
    else:
        lines.append(f"Copies gained: {verify.fmt(gained) if isinstance(gained, (int, float)) else 'unknown, to be confirmed'}.")
    if isinstance(freight, (int, float)) and option.get('mode') in MODE_WORDS:
        lines.append(f"Freight: {verify.money(freight)} by {mode}{estimate}.")
    if isinstance(total, (int, float)):
        lines.append(f"Total cost: {verify.money(total)}{estimate}" + (f", about {verify.money(per_copy)} per copy gained" if per_copy is not None else '') + '.')
    elif isinstance(freight, (int, float)):
        lines.append('Goods cost: not known yet.')
    else:
        lines.append('Cost: price unknown, assumption needed.')
    if option.get('assumptions') and option.get('price_basis') != 'estimate':
        lines.append('Cost rests on assumptions (rates), to be confirmed.')
    if headline is not None:
        lines.append(f"Value at stake: about {verify.money(headline)} ({(value or {}).get('label') or 'basis not stated'}).")
    lines.append(f"Deadline: {deadline}" + (f", {verify.fmt(hours_left)} h of packing left." if hours_left is not None else '.'))
    if approver.get('terms_approver') and approver.get('freight_approver'):
        lines.append(f"Approvals: terms change by {_who(approver['terms_approver'])}; air freight by {_who(approver['freight_approver'])}.")
    if kind == 'release':
        code = option.get('incoterm_required')
        lines.append((INCOTERM_IMPLICATION.format(code=code) if code else 'The supplier holds the goods until a named person clears the hold.')
                     + ' A named person must confirm the terms in writing.')
    reason = approver.get('why')
    if not known:
        reason = ('The approver is unknown, so this needs human review. ' + (reason or '')).strip()
    if reason:
        lines.append(f"Why you: {reason}")
    if approver.get('vacancy') and approver.get('route'):
        lines.append('Route: ' + ' then '.join(approver['route']) + '.')
    open_points = list((brief or {}).get('verify_next') or [])
    for question in open_questions or []:
        open_points.append(f"{question['question']} (owner: {question['owner_role']})")
    if not open_points:
        open_points = list(option.get('unknown') or [])
    open_points = list(dict.fromkeys(open_points))
    if open_points:
        lines.append('Open before spending:\n' + '\n'.join(f'- {c}' for c in open_points[:MAX_OPEN_POINTS]))
    lines.append('Internal draft, not sent by the application. Nothing is ordered, booked or paid until you approve it.')
    return {'to_role': role or APPROVER_UNKNOWN, 'to_name': name,
            'subject': f"Decision needed within the hour: {_short_title(issue)}",
            'body': '\n'.join(lines), 'numbers': numbers, 'approver_known': known, 'values': values}
