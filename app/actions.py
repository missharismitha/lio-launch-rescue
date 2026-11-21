"""Drafts and open questions. Nothing here sends anything.

The supplier draft carries supplier-facing facts only. The escalation draft is an INTERNAL message to the
approver named by the approval policy; it is built from a template with every number injected by code and
is never sent by the application: a named person approves it and forwards it themselves.
"""
from __future__ import annotations

from app import verify

SUPPLIER_ASK = ('Could you confirm:\n'
                '1. How many units are actually available now and can ship immediately?\n'
                '2. The fastest transport option, with the earliest delivery time at our Hamburg site.\n'
                '3. Cost and currency for that option, and any constraints.\n\n'
                'Please separate arrival at an airport from delivery to our packing site.\n\n'
                'This is an availability inquiry only, not an order, booking or spending commitment.\n\n'
                'Thank you,\nSoony launch team')
APPROVER_UNKNOWN = 'Approver to be confirmed by a person'
INCOTERM_IMPLICATION = ("Accepting {code} means Soony pays and arranges freight, insurance and duties and carries transport risk "
                        "from the supplier's dock; the sales agreement may already say {code}, subject to Legal; our own order named another term.")
MODE_WORDS = {'air': 'air freight', 'sea': 'sea freight', 'road': 'road freight'}


def supplier_draft(issue, option=None, launch=None, recipient='', issue_id=None):
    """{to, subject, body}: only facts from the supplier's own advice plus the ask. No internal figures."""
    issue_id = issue_id or issue.get('id')
    contact = (issue.get('supplier') or {}).get('contact_name')
    facts = ''.join(
        f"- Your order {s['po_number']}, air waybill {s['reference'] or 'n/a'}: {s['ordered']:,} ordered, {s['shipped']:,} shipped, "
        f"{s['balance']:,} remaining" + (f" (advised delivery to Hamburg {s['balance_eta']})" if s.get('balance_eta') else '') + '.\n'
        for s in issue.get('shipments', []))
    launch = launch or 'our launch date'
    short = issue.get('shortage')
    extra = ''
    if isinstance(option, dict) and option.get('mode') in MODE_WORDS and isinstance(option.get('quantity'), int) and option['quantity'] > 0:
        extra = f"If you can, please quote {option['quantity']:,} units by {MODE_WORDS[option['mode']]}.\n\n"
    body = (f"Dear {contact or 'colleague'},\n\n"
            f"We are checking supply of {issue['material_id']} for Soony's Hamburg distribution center ahead of launch on {launch}.\n\n"
            + (f"What we see in your advice:\n{facts}\n" if facts else '')
            + (f"We need about {short:,} more units to reach Hamburg and be usable before launch. " if isinstance(short, int) and short > 0 else '')
            + extra + SUPPLIER_ASK)
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
    body = (f"Dear {contact if (hold or {}).get('supplier_id') == ((issue or {}).get('supplier') or {}).get('id') and contact else 'colleague'},\n\n"
            f"Regarding your confirmation for {units} of {material}: you advised that the shipment is packed and on hold "
            "pending Buyer's written confirmation of delivery terms or a nominated forwarder.\n\n"
            "So that we can prepare, could you tell us:\n"
            "1. Is the shipment physically ready, and where is it?\n"
            "2. Which dispatch options exist and what are the cut-off times?\n"
            "3. What is the earliest realistic arrival at Hamburg for each option?\n"
            "4. The exact wording you need for a written confirmation.\n"
            "5. Any freight you would invoice.\n\n"
            "Soony's confirmation needs internal approval, which is in progress. This message does not confirm any delivery term, "
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


def escalation_draft(issue, brief, option, approver, value, policy=None, claim=None, hours_left=None,
                     open_questions=None):
    """Internal message to the approver: {to_role, to_name, subject, body, numbers[], approver_known}."""
    option = option or {}
    approver = approver or {}
    role, name = approver.get('role'), approver.get('name')
    known = bool(role)
    gained = option.get('copies_gained')
    total = option.get('total_eur')
    per_copy = round(total / gained, 2) if isinstance(total, (int, float)) and isinstance(gained, (int, float)) and gained > 0 else None
    headline = (value or {}).get('headline_eur') if isinstance(value, dict) else None
    deadline = (brief or {}).get('deadline_label') or 'Deadline not stated'
    numbers = [
        {'label': 'copies gained', 'value': gained},
        {'label': 'cost in EUR', 'value': total},
        {'label': 'cost per copy gained in EUR', 'value': per_copy},
        {'label': 'value at stake in EUR', 'value': headline},
        {'label': 'packing hours left', 'value': hours_left},
    ]
    values = {n['label']: n['value'] for n in numbers}
    mode = MODE_WORDS.get(option.get('mode'), 'the proposed route')
    lines = []
    lines.append(f"To: {role or APPROVER_UNKNOWN}" + (f" ({name})" if name else '') + '.')
    lines.append(f"Recommended: {str((brief or {}).get('recommendation') or option.get('title') or 'allocate by priority and escalate').rstrip('.')}.")
    kind = option.get('kind')
    if kind in ('allocation', 'verify'):
        lines.append('Copies gained: not applicable.')
    else:
        lines.append(f"Copies gained: {verify.fmt(gained) if isinstance(gained, (int, float)) else 'unknown, to be confirmed'}.")
    lines.append(f"Cost: {verify.money(total)}" + (f" by {mode}" if option.get('mode') and total is not None else '') + '.')
    if per_copy is not None:
        lines.append(f"Cost against copies gained: {verify.money(total)} for {gained:,} copies, about {verify.money(per_copy)} per copy gained.")
    else:
        lines.append('Cost against copies gained: cannot be worked out yet; price unknown, assumption needed.' if total is None
                     else 'Cost against copies gained: copies gained are not known yet.')
    if headline is not None:
        lines.append(f"Value at stake: about {verify.money(headline)} ({(value or {}).get('label') or 'basis not stated'}).")
    lines.append(f"Deadline: {deadline}.")
    if hours_left is not None:
        lines.append(f"Packing hours left: {verify.fmt(hours_left)} h.")
    if claim and claim.get('potential_eur') is not None:
        lines.append(f"Possible claim against the supplier: about {verify.money(claim['potential_eur'])} ({claim.get('label')}).")
    if approver.get('terms_approver') and approver.get('freight_approver'):
        for label, key in (('Terms change approval', 'terms_approver'), ('Air freight approval', 'freight_approver')):
            who = approver[key]
            lines.append(f"{label}: {who.get('role')}" + (f" ({who['name']})" if who.get('name') else '') + '.')
    if kind == 'release':
        code = option.get('incoterm_required')
        lines.append("What this means: " + (INCOTERM_IMPLICATION.format(code=code) if code else
                     'The supplier is holding the goods until a named person clears the hold.'))
        lines.append('A named person must confirm the terms in writing; the application never confirms or sends.')
    reason = approver.get('why')
    if not known:
        reason = ('The approver is unknown, so this needs human review. ' + (reason or '')).strip()
    if reason:
        lines.append(f"Why you: {reason}")
    if approver.get('vacancy') and approver.get('route'):
        lines.append('Route: ' + ' then '.join(approver['route']) + '.')
    notes = list(option.get('assumptions') or []) + list(option.get('unknown') or [])
    if notes:
        lines.append('Assumptions and gaps:\n' + '\n'.join(f'- {n}' for n in notes))
    confirm = list((brief or {}).get('verify_next') or [])
    for question in open_questions or []:
        confirm.append(f"{question['question']} (owner: {question['owner_role']})")
    if confirm:
        lines.append('To be confirmed before any spend:\n' + '\n'.join(f'- {c}' for c in dict.fromkeys(confirm)))
    lines.append('This is an internal draft. It is not sent by the application. Nothing is ordered, booked or paid until you approve it yourself.')
    return {'to_role': role or APPROVER_UNKNOWN, 'to_name': name,
            'subject': f"Decision needed within the hour: {_short_title(issue)}",
            'body': '\n'.join(lines), 'numbers': numbers, 'approver_known': known, 'values': values}
