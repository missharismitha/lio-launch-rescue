"""The only layer that shapes API output for the browser.

Everything here is an allowlist. Raw snapshots, evidence, document excerpts, tool traces and
model transcripts stay on the server; the browser receives short plain-language fields only.
"""
import re
import unicodedata

from app import labels

FILE_TOKEN = re.compile(r'[\w./\-]+\.(?:pdf|csv|xlsx?|xlsm|docx?|pptx?|png|jpe?g|md|txt|eml|json|xml|ya?ml|msg|zip|rtf|gif|tiff?|bmp|svg|log|tsv|dat|html?)\b', re.I)
EMAIL_TOKEN = re.compile(r'[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}')
URL_TOKEN = re.compile(r'(?:https?://|www\.)\S+|\[[^\]\n]*\]\([^)\n]*\)', re.I)
PATH_TOKEN = re.compile(r'(?<![\w])(?:suppliers?|soony|erp|contracts?|notices?|context|master|data|order_confirmations)[/\\][\w./\\-]*', re.I)
QUOTED = re.compile(r'"[^"\n]*"|“[^”\n]*”|„[^“”\n]*[“”]|«[^»\n]*»|(?<!\w)\'[^\'\n]*\'(?!\w)|‘[^’\n]*’(?!\w)')
SENTENCE_END = re.compile(r'(?<=[.!?])\s+')

EVENT_TEXT = {
    'drafted': 'Request drafted', 'approved': 'Approved', 'sent': 'Sent',
    'investigated': 'Agent finished',
    'delivery_unknown': 'Delivery not confirmed. Check sent mail.',
    'offer_reviewed': 'Offer reviewed', 'escalation_approved': 'Escalation approved',
}
TOOL_NAMES = re.compile(r'^(?:read|grep|glob|read_document|search_documents|get_current_issue|opened|searched)\b', re.I)


def truncate(text, limit):
    text = text.strip()
    if limit is None or len(text) <= limit:
        return text
    cut = text[:max(1, limit - 1)]
    if ' ' in cut and text[len(cut)] != ' ':
        cut = cut.rsplit(' ', 1)[0]
    return cut.rstrip(' ,;:-') + '…'


def _clean_quotes(match):
    return '' if len(match.group(0).split()) >= 4 else match.group(0)


def scrub(text, limit=None):
    if not isinstance(text, str):
        return ''
    text = unicodedata.normalize('NFKC', text)
    text = re.sub(r'`[^`\n]*`', _clean_quotes, text).replace('`', '')
    text = QUOTED.sub(_clean_quotes, text)
    lines = []
    for line in text.splitlines():
        kept = [s for s in SENTENCE_END.split(line) if s and not (FILE_TOKEN.search(s) or PATH_TOKEN.search(s) or EMAIL_TOKEN.search(s) or URL_TOKEN.search(s))]
        joined = re.sub(r'[ \t]{2,}', ' ', ' '.join(kept))
        lines.append(re.sub(r'\s+([.,;:!?])', r'\1', joined).strip())
    text = re.sub(r'\n{3,}', '\n\n', '\n'.join(lines)).strip()
    return truncate(text, limit)


DRIVE_TOKEN = re.compile(r'(?<![A-Za-z])[A-Za-z]:[/\\]')


def safe_text(text, limit=None):
    """scrub, then refuse the whole string if anything file-, path- or address-like is left."""
    cleaned = scrub(text, limit)
    if not cleaned:
        return ''
    if (FILE_TOKEN.search(cleaned) or PATH_TOKEN.search(cleaned) or EMAIL_TOKEN.search(cleaned) or URL_TOKEN.search(cleaned)
            or DRIVE_TOKEN.search(cleaned) or '@' in cleaned or re.search(r'(?:suppliers?|soony)[/\\]', cleaned, re.I)):
        return ''
    return cleaned


def _number(value, places=2):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value or abs(value) == float('inf'):
        return None
    return round(value, places) if isinstance(value, float) else value


def _approver_ref(approver, with_name=False):
    if not isinstance(approver, dict) or not approver.get('role'):
        return None
    shown = {'role': safe_text(approver.get('role'), 60) or None}
    if with_name:
        shown['name'] = safe_text(approver.get('name') or '', 60) or None
    shown['vacancy'] = bool(approver.get('vacancy'))
    if 'provisional' in approver:
        shown['provisional'] = bool(approver.get('provisional'))
    if approver.get('note'):
        shown['note'] = safe_text(approver['note'], 120) or None
    for key in ('freight_approver', 'terms_approver'):
        ref = approver.get(key)
        if isinstance(ref, dict) and ref.get('role'):
            shown[key] = {'role': safe_text(ref['role'], 60) or None, 'name': safe_text(ref.get('name') or '', 60) or None,
                          'vacancy': bool(ref.get('vacancy'))}
    return shown if shown['role'] else None


def public_trace(trace):
    """Timeline rows restricted to fixed vocabularies. Old rows {agent, action, outcome, autonomy} and tool rows
    {step, tool, outcome, autonomy, summary, by, turn} both pass; free text never does (summaries are re-scrubbed)."""
    shown = []
    tool_labels = ({v[0] for v in labels.TOOL_LABELS.values()} | set(labels.NEVER_LABELS.values()) | {labels.UNKNOWN_TOOL_LABEL}
                   | {v[0] for v in labels.RULE_LABELS.values()})
    for entry in trace or []:
        if not isinstance(entry, dict):
            continue
        if entry.get('outcome') not in labels.TRACE_OUTCOMES or entry.get('autonomy') not in labels.TRACE_AUTONOMY:
            continue
        if 'tool' in entry:
            if entry.get('tool') in tool_labels and entry.get('by') in labels.TRACE_BY:
                turn = entry.get('turn')
                shown.append({'step': len(shown) + 1, 'tool': entry['tool'], 'outcome': entry['outcome'], 'autonomy': entry['autonomy'],
                              'summary': safe_text(entry.get('summary') or '', 100), 'by': entry['by'],
                              'turn': turn if isinstance(turn, int) and not isinstance(turn, bool) and 0 <= turn < 100 else 0})
            continue
        agent, action = entry.get('agent'), entry.get('action')
        if agent in labels.TRACE_AGENTS and action in labels.TRACE_ACTIONS.get(agent, ()):
            shown.append({'agent': agent, 'action': action, 'outcome': entry['outcome'], 'autonomy': entry['autonomy']})
    return shown


def public_agent_run(crew):
    """How the last crew run was decided: mode and honest counts. Nothing else."""
    crew = crew or {}
    stats = crew.get('agent') if isinstance(crew.get('agent'), dict) else {}
    mode = crew.get('run_mode') if crew.get('run_mode') in labels.RUN_MODES else 'rule_based'
    count = lambda k: stats.get(k) if isinstance(stats.get(k), int) and not isinstance(stats.get(k), bool) else 0
    seconds = stats.get('seconds')
    return {'mode': mode, 'tool_calls': count('tool_calls'), 'rejected': count('rejected'),
            'seconds': round(float(seconds), 1) if isinstance(seconds, (int, float)) and not isinstance(seconds, bool) else 0.0}


def public_approvals(crew, case, current, escalation_approved):
    """The approvals queue: what, who decides, and a status derived from the stored approvals (never from the model)."""
    shown = []
    approved_send = (case.get('state') == 'approved' and bool(case.get('approved_fingerprint')) and case.get('approved_fingerprint') == current)
    for entry in (crew or {}).get('approvals') or []:
        if not isinstance(entry, dict) or entry.get('item') not in labels.APPROVAL_ITEMS:
            continue
        done = escalation_approved if entry['item'] == 'escalation' else approved_send
        shown.append({'what': labels.APPROVAL_WHAT[entry['item']], 'to_role': safe_text(entry.get('to_role') or '', 60),
                      'status': 'approved' if done else 'waiting'})
    return shown[:6]


def public_holds(holds):
    """Supplier holds in plain words. No order number, file name or document sentence."""
    shown = []
    for hold in holds or []:
        if not isinstance(hold, dict):
            continue
        who = hold.get('who_can_unlock') if isinstance(hold.get('who_can_unlock'), dict) else {}
        blocker = hold.get('blocker_type') if hold.get('blocker_type') in labels.BLOCKER_TYPES else 'other'
        shown.append({'supplier': safe_text(hold.get('supplier') or '', 60), 'blocker_type': blocker,
                      'required_action': safe_text(hold.get('required_action') or '', 200),
                      'consequence': safe_text(hold.get('consequence') or '', 400),
                      'quantity': _number(hold.get('quantity')),
                      'who_can_unlock': {'role': safe_text(who.get('role') or '', 60) or None,
                                         'name': safe_text(who.get('name') or '', 60) or None,
                                         'vacancy': bool(who.get('vacancy'))},
                      'needs_review': bool(hold.get('needs_review'))})
    return shown[:6]


def public_supplier_drafts(drafts):
    return [{'supplier': safe_text(d.get('supplier') or '', 60), 'subject': safe_text(d.get('subject') or '', 160),
             'body': (d.get('body') or '')[:3000]} for d in (drafts or [])[:3] if isinstance(d, dict)]


def public_crew(case, source_fingerprint=None):
    """The decision-room fields: options, brief, value, trace, escalation, numbers_verified, conflicts."""
    case = case or {}
    crew = case.get('crew') if isinstance(case.get('crew'), dict) else None
    result = {'options': [], 'brief': None, 'value': None, 'trace': [], 'escalation': None, 'numbers_verified': False, 'conflicts': [],
              'holds': [], 'supplier_drafts': [], 'run_mode': 'rule_based', 'agent': public_agent_run(None), 'approvals': [],
              'last_good_at': None}
    if not crew:
        return result
    for option in crew.get('options') or []:
        if not isinstance(option, dict):
            continue
        feasible = option.get('feasible') if option.get('feasible') in ('yes', 'late', 'unknown', 'na') else 'unknown'
        kind = option.get('kind') if option.get('kind') in labels.OPTION_KINDS else 'recovery'
        source = option.get('copies_gained_source') if option.get('copies_gained_source') in ('whatif', 'arrival_unknown', 'not_applicable') else 'not_applicable'
        result['options'].append({
            'recommended': bool(option.get('recommended')), 'kind': kind, 'arrival_known': bool(option.get('arrival_known')), 'copies_gained_source': source,
            'potential_units': _number(option.get('potential_units')),
            'title': safe_text(option.get('title') or '', 100), 'detail': safe_text(option.get('detail') or '', 200),
            'price_eur': _number(option.get('price_eur')), 'eta': safe_text(option.get('eta_label') or '', 20) or None,
            'copies_gained': _number(option.get('copies_gained')), 'approver': _approver_ref(option.get('approver')),
            'feasible': feasible})
    brief = crew.get('brief') if isinstance(crew.get('brief'), dict) else None
    if brief:
        confidence = brief.get('confidence') if brief.get('confidence') in ('low', 'medium', 'high') else 'low'
        result['brief'] = {'recommendation': safe_text(brief.get('recommendation') or '', 200),
                           'headline': safe_text(brief.get('headline') or '', 100),
                           'price_eur': _number(brief.get('price_eur')), 'approver': _approver_ref(brief.get('approver'), True),
                           'copies_gained': _number(brief.get('copies_gained')),
                           'deadline': safe_text(brief.get('deadline_label') or brief.get('deadline') or '', 60), 'confidence': confidence,
                           'risks': [t for t in (safe_text(x, 200) for x in (brief.get('risks') or [])[:6]) if t],
                           'verify_next': [t for t in (safe_text(x, 200) for x in (brief.get('verify_next') or [])[:8]) if t]}
    value = crew.get('value') if isinstance(crew.get('value'), dict) else None
    if value:
        claim = crew.get('claim') if isinstance(crew.get('claim'), dict) else {}
        result['value'] = {'headline_eur': _number(value.get('headline_eur')),
                           'basis': value.get('basis') if value.get('basis') in ('cost', 'revenue') else 'cost',
                           'label': safe_text(value.get('label') or '', 80), 'claim_eur': _number(claim.get('potential_eur'))}
    result['trace'] = public_trace(crew.get('trace'))
    escalation = crew.get('escalation') if isinstance(crew.get('escalation'), dict) else None
    if escalation:
        approval = case.get('escalation_approval') if isinstance(case.get('escalation_approval'), dict) else {}
        current = source_fingerprint or case.get('source_fingerprint')
        approved = bool(approval.get('approver')) and approval.get('source_fingerprint') == current             and approval.get('escalation_hash') == escalation_hash(escalation)
        result['escalation'] = {'to_role': safe_text(escalation.get('to_role') or '', 60), 'subject': safe_text(escalation.get('subject') or '', 120),
                                'body': safe_text(escalation.get('body') or '', 2400), 'approved': approved}
    result['run_mode'] = public_agent_run(crew)['mode']
    result['agent'] = public_agent_run(crew)
    result['approvals'] = public_approvals(crew, case, source_fingerprint or case.get('source_fingerprint'),
                                           bool((result['escalation'] or {}).get('approved')))
    last = case.get('crew_last_good') if isinstance(case.get('crew_last_good'), dict) else None
    result['last_good_at'] = safe_text(str((last or {}).get('at') or ''), 40) or None
    result['holds'] = public_holds(crew.get('holds'))
    result['supplier_drafts'] = public_supplier_drafts(crew.get('supplier_drafts'))
    result['numbers_verified'] = bool(crew.get('numbers_verified'))
    result['conflicts'] = [{'field': safe_text(c.get('field') or '', 60), 'why': safe_text(c.get('why') or '', 200),
                            'confidence': safe_text(str(c.get('confidence') or ''), 20)}
                           for c in (crew.get('conflicts') or [])[:8] if isinstance(c, dict)]
    return result


def public_whatif(result):
    """Numbers and one short label only."""
    result = result or {}
    return {'copies_ship': _number(result.get('copies_ship')), 'copies_short': _number(result.get('copies_short')),
            'hours_left': _number(result.get('hours_left'), 1), 'label': safe_text(result.get('label') or '', 60)}


def draft_hash(draft):
    import hashlib
    draft = draft or {}
    return hashlib.sha256(f"{draft.get('subject')}|{draft.get('body')}".encode()).hexdigest()[:24]


def escalation_hash(escalation):
    import hashlib
    return hashlib.sha256(f"{escalation.get('to_role')}|{escalation.get('subject')}|{escalation.get('body')}".encode()).hexdigest()[:24]


def _plain(text):
    text = re.sub(r'\*\*|__|^#+\s*', '', text or '', flags=re.M)
    return re.sub(r'\s+', ' ', text).strip()


def _sections(text):
    found, current = {}, None
    for line in (text or '').splitlines():
        heading = re.match(r'^\s*#{1,4}\s*(.+?)\s*$', line)
        if heading:
            # Models often echo the prompt's hint in the heading: "Verdict (one sentence)".
            current = re.sub(r'\s*\(.*\)\s*:?$', '', heading.group(1)).strip(' *:').casefold()
            found.setdefault(current, [])
        elif current is not None:
            found[current].append(line)
    return {k: '\n'.join(v).strip() for k, v in found.items()}


def _first_sentence(text):
    text = _plain(text)
    return SENTENCE_END.split(text)[0] if text else ''


def _options(block):
    options = []
    for line in (block or '').splitlines():
        bullet = re.match(r'^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$', line)
        if not bullet:
            continue
        body = bullet.group(1)
        bold = re.match(r'^\*\*(.+?)\*\*\s*[—–:.-]*\s*(.*)$', body)
        if bold:
            title, detail = bold.group(1), bold.group(2)
        else:
            parts = re.split(r'\s[—–-]\s|:\s', body, maxsplit=1)
            title, detail = parts[0], parts[1] if len(parts) > 1 else ''
        title = scrub(_plain(title), 40)
        detail = scrub(_plain(detail), 90)
        if title:
            options.append({'title': title, 'detail': detail})
        if len(options) == 3:
            break
    return options


def public_investigation(inv):
    if not isinstance(inv, dict):
        return None
    text = inv.get('text') if isinstance(inv.get('text'), str) else ''
    sections = _sections(text)
    verdict = _first_sentence(sections.get('verdict', ''))
    action = _first_sentence(sections.get('recommended action', ''))
    if not action:
        legacy = re.search(r'Recommended next action:\s*(.+)', text or '', re.I)
        action = _first_sentence(legacy.group(1)) if legacy else ''
    return {'verdict': scrub(verdict, 160), 'action': scrub(action, 200),
            'options': _options(sections.get('plan b options', '')), 'at': inv.get('at')}


def public_step(message):
    message = str(message or '').strip()
    bare = message[6:].strip() if message.startswith('Agent:') else message
    if bare in labels.GENERIC or bare in labels.AGENT_PHASES:
        return bare
    if message.startswith('Agent:') or TOOL_NAMES.match(bare):
        return 'Checked a record'
    return scrub(message, 160) or 'Checked a record'


def public_events(events):
    result = []
    for event in events or []:
        kind = event.get('kind')
        if kind == 'agent_tool':
            message = public_step(event.get('message'))
        elif kind in EVENT_TEXT:
            message = EVENT_TEXT[kind]
        else:
            continue
        result.append({'at': event.get('at'), 'kind': kind, 'message': message})
    return result


def _bools(integrations, *keys):
    integrations = integrations or {}
    return {k: bool(integrations.get(k)) for k in keys}


def public_agent(agent):
    agent = agent or {}
    return {'running': bool(agent.get('running')), 'state': agent.get('state'),
            'steps': [{'at': s.get('at'), 'message': public_step(s.get('message'))} for s in agent.get('steps', []) or []],
            'error': scrub(agent.get('error') or '', 200) or None, 'last_run': agent.get('last_run')}


def public_overview(raw):
    raw = raw or {}
    products = [{k: p.get(k) for k in ('id', 'name', 'target', 'packed', 'remaining', 'hours_needed', 'hours_available')}
                for p in raw.get('products', []) or []]
    pack = raw.get('pack_status') or {}
    agent = raw.get('agent') or {}
    sync = raw.get('sync') or {}
    return {
        'launch_date': raw.get('launch_date'),
        'analyzed_at': raw.get('analyzed_at'),
        'products': products,
        'pack_status': {'hours_left': pack.get('hours_left'), 'as_of': pack.get('as_of')},
        'issues': [{'id': i.get('id'), 'title': i.get('title'), 'shortage': i.get('shortage')} for i in raw.get('issues', []) or []],
        'agent': public_agent(agent),
        'integrations': _bools(raw.get('integrations'), 'portal_enabled', 'ai_enabled', 'email_enabled'),
        'sync': {'last_success': sync.get('last_success'), 'error': bool(sync.get('error'))},
        'case_versions': dict(raw.get('case_versions') or {}),
    }


def public_case(case, source_fingerprint=None):
    case = case or {}
    draft = case.get('draft') if isinstance(case.get('draft'), dict) else None
    fingerprint = case.get('source_fingerprint')
    approved_fp = case.get('approved_fingerprint')
    return {
        'state': case.get('state'), 'approver': case.get('approver'), 'sent_at': case.get('sent_at'),
        'delivery_status': case.get('delivery_status'),
        'approved': (case.get('state') == 'approved' and bool(approved_fp) and approved_fp == fingerprint
                     and (not draft or case.get('approved_draft_hash') == draft_hash(draft))),
        'draft': ({'subject': draft.get('subject'), 'body': draft.get('body'), 'has_recipient': bool(draft.get('to')),
                   'manual_send': bool(draft.get('manual_send'))}
                  if draft else None),
        'investigation': public_investigation(case.get('investigation')),
        'source_fingerprint': fingerprint, 'approved_fingerprint': approved_fp,
    }


def public_offer(detail):
    """The reviewed supplier offer in plain numbers. Never the note, the reply, ids, addresses or document text."""
    from app import verify
    from app.recovery import aware
    detail = detail or {}
    case = detail.get('case') if isinstance(detail.get('case'), dict) else {}
    offer = case.get('recovery_offer')
    if not isinstance(offer, dict) or offer.get('source_fingerprint') != case.get('source_fingerprint'):
        return None
    try:
        label = verify.label_of(aware(offer.get('arrival_at')))
    except (AttributeError, TypeError, ValueError):
        label = None
    short_ids = [l.get('product_id') for l in (detail.get('allocation') or {}).get('lines', []) or [] if (l.get('short') or 0) > 0]
    scenarios = [x for x in offer.get('packing_scenarios') or [] if isinstance(x, dict)]
    match = [x for x in scenarios if x.get('product_id') in short_ids]
    extra = _number(match[0].get('maximum_additional_units')) if len(match) == 1 and len(short_ids) == 1 else None
    hours = _number((match or scenarios or [{}])[0].get('packing_hours_after_arrival'), 1)
    simulated = any(r.get('id') == offer.get('reply_id') and r.get('simulated') for r in detail.get('replies', []) or [])
    approver = offer.get('approver') if isinstance(offer.get('approver'), dict) and offer['approver'].get('role') else None
    return {'quantity': _number(offer.get('offer_quantity')), 'arrival_label': label,
            'arrives_before_deadline': bool(offer.get('arrives_before_deadline')),
            'gap_after_offer': _number(offer.get('component_gap_after_offer')), 'cost_eur': _number(offer.get('cost_eur')),
            'approver': ({'role': safe_text(approver['role'], 60) or None, 'name': safe_text(approver.get('name') or '', 60) or None,
                          'vacancy': bool(approver.get('vacancy')), 'provisional': bool(approver.get('provisional'))} if approver else None),
            'packing_hours_after_arrival': hours, 'extra_units_short_edition': extra, 'simulated': bool(simulated),
            'reviewed_by': safe_text(offer.get('reviewer') or '', 60) or None, 'reviewed_at': safe_text(offer.get('reviewed_at') or '', 40) or None}


def public_detail(detail):
    detail = detail or {}
    supplier = detail.get('supplier') or next(iter(detail.get('suppliers') or []), None) or {}
    allocation = detail.get('allocation') or {}
    return {
        'id': detail.get('id'), 'title': detail.get('title'), 'shortage': detail.get('shortage'),
        'required': detail.get('required'), 'usable_stock': detail.get('usable_stock'),
        'incoming': detail.get('incoming'),
        'supplier': {'name': supplier.get('name')},
        'shipments': [{k: s.get(k) for k in ('ordered', 'shipped', 'balance', 'balance_eta')}
                      for s in detail.get('shipments', []) or []],
        'allocation': {'lines': [{'product_id': l.get('product_id'), 'name': l.get('name'), 'short': l.get('short')}
                                 for l in allocation.get('lines', []) or []]},
        'case': public_case(detail.get('case')),
        'events': public_events(detail.get('events')),
        'integrations': _bools(detail.get('integrations'), 'portal_enabled', 'ai_enabled', 'email_enabled'),
        **public_crew(detail.get('case')),
        'offer': public_offer(detail),
        'replies': [{'id': r.get('id'), 'received_at': r.get('received_at'), 'source_fingerprint': r.get('source_fingerprint'),
                     'simulated': bool(r.get('simulated'))}
                    for r in detail.get('replies', []) or []],
    }
