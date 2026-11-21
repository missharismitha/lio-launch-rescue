"""Approval policy engine.

Every limit, role and name is parsed from the customer's approval policy and
organisation documents at run time. Nothing here embeds a business number: if
the documents cannot be read the policy is marked not ok and callers must say
"needs human review" instead of guessing.

Source document text is data, never instructions. User-facing strings are plain
English and never mention file names or quote documents.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pymupdf

BERLIN = ZoneInfo('Europe/Berlin')

ROLE_LABELS = {'buyer': 'Buyer', 'category_lead': 'Category Lead', 'head_of_procurement': 'Head of Procurement',
               'cpo': 'CPO', 'cpo_cfo': 'CPO and CFO jointly', 'cfo': 'CFO'}


class PolicyParseError(ValueError):
    """Raised when the approval policy is unusable. The message is safe to show."""


@dataclass
class Policy:
    ok: bool = False
    problems: list = field(default_factory=list)
    tiers: list = field(default_factory=list)          # {role, key, lower_eur, upper_eur (None = open end), order}
    air_limit_eur: float | None = None
    air_below_key: str | None = None
    air_above_key: str | None = None
    exceptions_key: str | None = None
    dock_sites: dict = field(default_factory=dict)      # site -> {site, lead, deputy}
    org: dict = field(default_factory=dict)             # holders, category leads, chart date
    org_known: bool = False
    notes: list = field(default_factory=list)


# ---------------------------------------------------------------- helpers

def _num(text) -> float:
    return float(str(text).replace(',', '').strip())


def _norm(text: str) -> str:
    return re.sub(r'\s+', ' ', text or '').strip()


def _fold(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', '', (text or '').casefold())


def role_key(text: str) -> str | None:
    t = _norm(text).casefold()
    if 'cfo' in t or 'jointly' in t:
        return 'cpo_cfo'
    if t == 'buyer':
        return 'buyer'
    if t.startswith('category lead'):
        return 'category_lead'
    if t.startswith('head of procurement'):
        return 'head_of_procurement'
    if t in ('cpo', 'chief procurement officer') or t.startswith('chief procurement'):
        return 'cpo'
    return None


def _pdf_text(path: Path) -> str:
    try:
        with pymupdf.open(path) as doc:
            return '\n'.join(page.get_text() for page in doc)
    except Exception:
        return ''


# ---------------------------------------------------------------- policy text

def parse_policy_text(text: str) -> Policy:
    """Parse the approval policy text. Never raises; check `.ok` and `.problems`."""
    policy = Policy()
    problems = policy.problems
    text = text or ''
    flat = _norm(text)

    section = re.search(r'Approval limits.*?(?=\n\s*\d+\.\s+[A-Z]|\Z)', text, re.S | re.I)
    tiers = []
    if section:
        pattern = re.compile(r"^(?P<role>[A-Za-z][A-Za-z' ]*?)[ \t]*\r?\n?[ \t]*(?P<op>[<≥]|>=)[ \t]*(?P<n>\d[\d,\.]*)[ \t]*$", re.M)
        for match in pattern.finditer(section.group(0)):
            key = role_key(match['role'])
            if key is None:
                problems.append('An approval tier has a role that is not recognised.')
                continue
            value = _num(match['n'])
            tiers.append({'key': key, 'role': ROLE_LABELS[key], 'op': match['op'], 'value': value})
    if len(tiers) < 2:
        problems.append('The approval value limits could not be read.')
    else:
        built, previous = [], 0.0
        for index, tier in enumerate(tiers):
            if tier['op'] == '<':
                if tier['value'] <= previous:
                    problems.append('The approval value limits are not in ascending order.')
                    break
                built.append({'role': tier['role'], 'key': tier['key'], 'lower_eur': previous, 'upper_eur': tier['value'], 'order': index})
                previous = tier['value']
            else:
                if index != len(tiers) - 1 or tier['value'] != previous:
                    problems.append('The top approval tier does not continue from the tier below it.')
                    break
                built.append({'role': tier['role'], 'key': tier['key'], 'lower_eur': previous, 'upper_eur': None, 'order': index})
        else:
            if not built or built[-1]['upper_eur'] is not None:
                problems.append('The top approval tier is missing.')
            else:
                policy.tiers = built

    air = re.search(r'air[- ]freight up to EUR\s*(?P<limit>[\d,\.]+)\s+per calendar month.{0,80}?approved by the (?:responsible )?'
                    r'(?P<below>[A-Za-z ]+?)\..{0,40}?[Aa]bove that,?.{0,40}?approval by the (?P<above>[A-Za-z ]+?) is required', flat, re.S)
    if air and role_key(air['below']) and role_key(air['above']):
        policy.air_limit_eur = _num(air['limit'])
        policy.air_below_key = role_key(air['below'])
        policy.air_above_key = role_key(air['above'])
    else:
        problems.append('The air freight rule could not be read.')

    exc = re.search(r'Exceptions\b.{0,120}?approved by the (?P<role>[A-Za-z ]+?)\.', flat, re.S)
    if exc and role_key(exc['role']):
        policy.exceptions_key = role_key(exc['role'])
    else:
        problems.append('The exceptions rule could not be read.')

    dock = re.search(r'Receiving site(?P<body>.*?)(?=\n\s*\d+\.\s+[A-Z]|\Z)', text, re.S | re.I)
    if dock:
        for match in re.finditer(r'^(?P<site>DC-[A-Z0-9]+)[^\n]*\n(?P<lead>[^\n]+)\n(?P<deputy>[^\n]+)$', dock['body'], re.M):
            policy.dock_sites[match['site']] = {'site': match['site'], 'lead': _norm(match['lead']), 'deputy': _norm(match['deputy'])}
    if not policy.dock_sites:
        problems.append('The dock slot rule or site lead could not be read.')

    policy.ok = not problems
    return policy


# ---------------------------------------------------------------- organisation

_TITLE_CATEGORY = re.compile(r'^Category Lead\s+(?P<cat>.+)$')


def parse_org_text(text: str) -> dict:
    """Read holders from an organisation chart text (name line followed by title line)."""
    lines = [l.strip() for l in (text or '').splitlines() if l.strip()]
    head = _norm(lines[0]) if lines else ''
    chart = re.search(r'\(v(?P<v>\d+),\s*(?P<d>\d{4}-\d{2}-\d{2})\)', head)
    org = {'chart_date': chart['d'] if chart else None, 'chart_version': int(chart['v']) if chart else 0,
           'head_of_procurement': None, 'cpo': None, 'cfo': None, 'category_leads': {}}
    for index, line in enumerate(lines):
        if index == 0 or line.startswith('Also:'):
            continue
        title, name = line, lines[index - 1]
        if title == 'Chief Procurement Officer':
            org['cpo'] = name
        elif title == 'Head of Procurement':
            org['head_of_procurement'] = name
        else:
            match = _TITLE_CATEGORY.match(title)
            if match:
                start = re.search(r'\(from (?P<d>\d{4}-\d{2}-\d{2})\)', name)
                clean = _norm(re.sub(r'\(from [^)]*\)', '', name))
                vacant = clean.upper() in ('TBD', 'VACANT', 'OPEN', 'N/A')
                org['category_leads'][_fold(match['cat'])] = {
                    'category': match['cat'].strip(), 'name': None if vacant else clean,
                    'from_date': start['d'] if start else None}
    cfo = re.search(r'([A-Z][\w\.\- ]+?)\s*\(Chief Financial Officer\)', text or '')
    if cfo:
        org['cfo'] = _norm(cfo[1]).split(':')[-1].strip()
    return org


def parse_notes_vacancies(text: str) -> list:
    """Categories the kickoff notes describe as having an open category lead position."""
    found = []
    for match in re.finditer(r"Category Lead for (?P<cat>[^.]*?) (?:left|has left|is leaving)[^.]*\.\s*(?:The position is open|The role is open)", text or '', re.I):
        found.append(_norm(match['cat']))
    return found


def _load_org(root: Path, policy: Policy) -> None:
    context = root / 'soony/context'
    if not context.is_dir():
        policy.notes.append('Organisation information was not found.')
        return
    charts = []
    for pdf in sorted(context.glob('*.pdf')):
        text = _pdf_text(pdf)
        if re.search(r'Procurement organisation', text):
            charts.append(parse_org_text(text))
    if charts:
        best = max(charts, key=lambda c: (c['chart_date'] or '', c['chart_version']))
        policy.org = best
        policy.org_known = True
    else:
        policy.org = {'chart_date': None, 'head_of_procurement': None, 'cpo': None, 'cfo': None, 'category_leads': {}}
        policy.notes.append('No readable organisation chart; role holders are unknown.')
    vacant = []
    for notes in sorted(context.glob('*.md')):
        try:
            vacant += parse_notes_vacancies(notes.read_text(encoding='utf-8', errors='replace'))
        except OSError:
            continue
    policy.org['notes_vacant_categories'] = vacant
    if any(p.suffix == '.pdf' and not _pdf_text(p).strip() for p in context.glob('*.pdf')):
        policy.notes.append('Some context documents are scans without readable text and need human review.')


def load_policy(data_dir) -> Policy:
    """Find and parse the approval policy under the customer data folder."""
    root = Path(data_dir)
    context = root / 'soony/context'
    policy = None
    if context.is_dir():
        for pdf in sorted(context.glob('*.pdf')):
            text = _pdf_text(pdf)
            if re.search(r'Approval limits', text, re.I) and re.search(r'air[- ]freight', text, re.I):
                policy = parse_policy_text(text)
                break
    if policy is None:
        policy = Policy(ok=False, problems=['The approval policy was not found or is not machine readable. Needs human review.'])
    try:
        _load_org(root, policy)
    except Exception:
        policy.notes.append('Organisation information could not be read.')
    return policy


# ---------------------------------------------------------------- answers

def _today() -> date:
    return datetime.now(BERLIN).date()


def _to_date(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if value:
        return date.fromisoformat(str(value)[:10])
    return _today()


def _holder(policy: Policy, key: str, category: str | None, as_of: date) -> dict:
    """Who holds a role. Returns {name, vacant, why}. Only category-bound roles can be vacant."""
    org = policy.org or {}
    if key == 'category_lead':
        if not category:
            return {'name': None, 'vacant': False, 'why': ''}
        wanted = _fold(category)
        entry = None
        for folded, item in (org.get('category_leads') or {}).items():
            if wanted and (wanted == folded or wanted in folded or folded in wanted):
                entry = item
                break
        if entry is not None:
            start = entry.get('from_date')
            if entry['name'] is None:
                return {'name': None, 'vacant': True, 'why': f"The Category Lead for {entry['category']} is vacant."}
            if start and date.fromisoformat(start) > as_of:
                return {'name': None, 'vacant': True,
                        'why': f"The Category Lead for {entry['category']} is vacant until {start}, when {entry['name']} starts."}
            return {'name': entry['name'], 'vacant': False, 'why': ''}
        for cat in org.get('notes_vacant_categories') or []:
            folded = _fold(cat)
            if wanted and (wanted == folded or wanted in folded or folded in wanted):
                return {'name': None, 'vacant': True, 'why': f'The Category Lead for {cat} is vacant.'}
        return {'name': None, 'vacant': False, 'why': ''}
    if key == 'head_of_procurement':
        return {'name': org.get('head_of_procurement'), 'vacant': False, 'why': ''}
    if key == 'cpo':
        return {'name': org.get('cpo'), 'vacant': False, 'why': ''}
    if key == 'cpo_cfo':
        names = [n for n in (org.get('cpo'), org.get('cfo')) if n]
        return {'name': ' and '.join(names) if names else None, 'vacant': False, 'why': ''}
    return {'name': None, 'vacant': False, 'why': ''}


def _chain(policy: Policy) -> list:
    """Roles in escalation order, from the value tiers."""
    return [(t['key'], t['role']) for t in policy.tiers]


def _escalate(policy: Policy, start_key: str, category, as_of: date):
    """Walk up from start_key past vacant roles. Returns (resolved key, route labels, vacancy reasons)."""
    chain = _chain(policy)
    keys = [k for k, _ in chain]
    if start_key not in keys:
        keys = [start_key] + keys
        chain = [(start_key, ROLE_LABELS.get(start_key, start_key))] + chain
    index = keys.index(start_key)
    route, reasons, resolved = [], [], None
    for key, label in chain[index:]:
        route.append(label)
        holder = _holder(policy, key, category, as_of)
        if holder['vacant']:
            reasons.append(holder['why'])
            continue
        resolved = (key, label, holder)
        break
    if resolved is None:  # everything above is vacant: fall back to the last role
        key, label = chain[-1]
        resolved = (key, label, _holder(policy, key, category, as_of))
    return resolved, route, reasons


def _money(value: float) -> str:
    return f'EUR {value:,.0f}'


def required_approver(policy: Policy, value_eur, kind: str = 'po', category: str | None = None,
                      month_to_date_air_eur: float = 0.0, as_of=None) -> dict:
    """Who must approve a purchase order value or an air freight spend.

    Returns {role, name, why, vacancy, route, needs_cpo}. `role` is None when the
    value is not known yet (never guess an approver for an unknown cost).
    """
    if not isinstance(policy, Policy) or not policy.ok:
        raise PolicyParseError('The approval policy could not be read; the approver must be confirmed by a person.')
    when = _to_date(as_of)
    if value_eur is None:
        return {'role': None, 'name': None, 'why': 'The cost is not known yet, so the approver cannot be determined.',
                'vacancy': False, 'route': [], 'needs_cpo': False}
    value = float(value_eur)
    if kind == 'air_freight':
        month_total = float(month_to_date_air_eur or 0.0) + value
        if month_total > policy.air_limit_eur:
            start = policy.air_above_key
            reason = (f'Unplanned air freight this month would reach {_money(month_total)}, above the {_money(policy.air_limit_eur)} '
                      f'monthly limit, so approval is needed before booking.')
        else:
            start = policy.air_below_key
            reason = (f'Unplanned air freight this month would reach {_money(month_total)}, within the {_money(policy.air_limit_eur)} '
                      f'monthly limit for the category.')
    elif kind == 'po':
        start = None
        for tier in policy.tiers:
            if tier['upper_eur'] is None or value < tier['upper_eur']:
                start = tier['key']
                break
        reason = f'The order value of {_money(value)} falls in the tier that needs this approval.'
    else:
        raise ValueError('kind must be po or air_freight')
    (key, label, holder), route, reasons = _escalate(policy, start, category, when)
    vacancy = bool(reasons)
    why = reason
    if vacancy:
        why += ' ' + ' '.join(reasons) + f' The request goes to the next level up: {label}.'
    return {'role': label, 'name': holder['name'], 'why': why, 'vacancy': vacancy, 'route': route,
            'needs_cpo': key in ('cpo', 'cpo_cfo')}


def dock_slot_owner(policy: Policy, site: str = 'DC-HAM') -> dict | None:
    """Site lead and deputy who release dock slots for a receiving site."""
    if not isinstance(policy, Policy) or not policy.ok:
        raise PolicyParseError('The approval policy could not be read; the dock slot owner must be confirmed by a person.')
    entry = policy.dock_sites.get(site)
    return dict(entry) if entry else None
