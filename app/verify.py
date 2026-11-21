"""Number self-check. Every number in a draft or model text must come from the records.

`extract_numbers` finds quantities, euro amounts, hours and dates in text. `check` compares them to an
allowed set built from the blackboard. Text whose numbers do not all match is rejected by the caller
and replaced by a sentence composed from a template with numbers injected by code (`compose`).
"""
from __future__ import annotations

import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

BERLIN = ZoneInfo('Europe/Berlin')
DAYS = ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')
MONTHS = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')

ISO_DATE = re.compile(r'(?<!\d)(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?!\d)')
DAY_TIME = re.compile(r'\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?,?\s+(\d{1,2}):(\d{2})\b', re.I)
_MONTH = r'(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
DAY_MONTH = re.compile(rf'(?<![\w.])(\d{{1,2}})\s+({_MONTH})(?![a-z])|(?<![\w])({_MONTH})\.?\s+(\d{{1,2}})(?![\d:])', re.I)
CLOCK = re.compile(r'(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])')
AMOUNT = re.compile(r'(?:(?:EUR|USD|€|\$)\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|million|thousand)\b)?|(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|million|thousand)\b)?\s?(?:EUR|USD|€))', re.I)
HOURS = re.compile(r'(?<![\w.])(\d+(?:\.\d+)?)\s?(?:h|hrs?|hours?)\b', re.I)
NUMBER = re.compile(r'(?<![\w.,])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\w,]|\.\d)|(?<![\w.,])\d+(?:\.\d+)?(?![\w,]|\.\d)')
IDENTIFIER = re.compile(r'\b[A-Za-z]{2,}(?:-[A-Za-z0-9]+)+\b|\b\d{7,}\b|\b\d+-\d{3,}\b|\b[A-Za-z]+\d+[A-Za-z0-9]*\b')
LIST_MARKER = re.compile(r'(?m)^\s*\d{1,2}[.)]\s')
SUFFIX = {'k': 1e3, 'thousand': 1e3, 'm': 1e6, 'million': 1e6}


def _mask(text, span):
    return text[:span[0]] + ' ' * (span[1] - span[0]) + text[span[1]:]


def _float(raw):
    return float(raw.replace(',', ''))


def label_of(moment):
    """Short label such as 'Sun 02:00' for a datetime, or 'Tue 24 Nov' for a date."""
    if isinstance(moment, datetime):
        moment = moment.astimezone(BERLIN) if moment.tzinfo else moment
        return f'{DAYS[moment.weekday()]} {moment:%H:%M}'
    if isinstance(moment, date):
        return f'{DAYS[moment.weekday()]} {moment.day} {MONTHS[moment.month - 1]}'
    return None


def eta_label(value):
    """Short plain label for an ISO date or datetime string, else None."""
    if not value:
        return None
    text = str(value).strip()
    try:
        if len(text) == 10:
            return label_of(date.fromisoformat(text))
        parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
        return label_of(parsed if parsed.tzinfo else parsed.replace(tzinfo=BERLIN))
    except ValueError:
        return None


def date_keys(value):
    """Comparable keys for a date-like value: ('md', month, day) and, with a time, ('dow', 'Sun 02:00')."""
    keys = set()
    if isinstance(value, datetime):
        value = value.astimezone(BERLIN) if value.tzinfo else value
        return {('md', value.month, value.day), ('dow', f'{DAYS[value.weekday()]} {value:%H:%M}'), ('clock', f'{value:%H:%M}')}
    if isinstance(value, date):
        return {('md', value.month, value.day)}
    text = str(value or '')
    for match in ISO_DATE.finditer(text):
        keys.add(('md', int(match[2]), int(match[3])))
        if match[4] is not None:
            try:
                moment = datetime(int(match[1]), int(match[2]), int(match[3]), int(match[4]), int(match[5]), tzinfo=BERLIN)
            except ValueError:
                continue
            keys.add(('dow', f'{DAYS[moment.weekday()]} {int(match[4]):02d}:{match[5]}'))
            keys.add(('clock', f'{int(match[4]):02d}:{match[5]}'))
    for match in DAY_TIME.finditer(text):
        keys.add(('dow', f'{match[1][:3].title()} {int(match[2]):02d}:{match[3]}'))
        keys.add(('clock', f'{int(match[2]):02d}:{match[3]}'))
    for match in DAY_MONTH.finditer(text):
        day, month = (match[1], match[2]) if match[1] else (match[4], match[3])
        keys.add(('md', MONTHS.index(month[:3].title()) + 1, int(day)))
    for match in CLOCK.finditer(text):
        keys.add(('clock', f'{int(match[1]):02d}:{match[2]}'))
    return keys


def extract_numbers(text):
    """Numbers found in text: [{kind: date|amount|hours|number, value, raw}]. Identifiers are ignored."""
    text = text if isinstance(text, str) else ''
    found = []
    work = text
    for match in ISO_DATE.finditer(text):
        found.append({'kind': 'date', 'value': date_keys(match[0]), 'raw': match[0]})
        work = _mask(work, match.span())
    for pattern in (DAY_TIME, DAY_MONTH):
        for match in pattern.finditer(work):
            found.append({'kind': 'date', 'value': date_keys(match[0]), 'raw': match[0]})
            work = _mask(work, match.span())
    for match in CLOCK.finditer(work):
        found.append({'kind': 'date', 'value': date_keys(match[0]), 'raw': match[0]})
        work = _mask(work, match.span())
    for match in LIST_MARKER.finditer(work):
        work = _mask(work, (match.start(), match.end()))
    for match in IDENTIFIER.finditer(work):
        work = _mask(work, match.span())
    for match in AMOUNT.finditer(work):
        raw_number, suffix = (match[1], match[2]) if match[1] else (match[3], match[4])
        value = _float(raw_number) * SUFFIX.get((suffix or '').lower(), 1)
        found.append({'kind': 'amount', 'value': value, 'raw': match[0].strip(), 'decimal': '.' in raw_number})
        work = _mask(work, match.span())
    for match in HOURS.finditer(work):
        found.append({'kind': 'hours', 'value': _float(match[1]), 'raw': match[0], 'decimal': '.' in match[1]})
        work = _mask(work, match.span())
    for match in NUMBER.finditer(work):
        found.append({'kind': 'number', 'value': _float(match[0]), 'raw': match[0], 'decimal': '.' in match[0]})
    return found


def numbers_in_text(text):
    """Plain float values in a code-produced string (used to allow numbers that code itself wrote)."""
    return [f['value'] for f in extract_numbers(text) if f['kind'] != 'date']


def _close(a, b, decimal):
    return abs(a - b) <= (0.051 if decimal else 0.51)


def allowed_from(*objects, extra_numbers=(), extra_dates=()):
    """Allowed set from plain structures: every int/float and every ISO date string, recursively."""
    numbers, dates = {float(n) for n in extra_numbers}, set()
    for value in extra_dates:
        dates |= date_keys(value)

    def walk(node):
        if isinstance(node, bool) or node is None:
            return
        if isinstance(node, (int, float)):
            if node == node and abs(node) != float('inf'):
                numbers.add(float(node))
        elif isinstance(node, str):
            if ISO_DATE.search(node):
                dates.update(date_keys(node))
        elif isinstance(node, dict):
            for key, item in node.items():
                if key in ('evidence', 'excerpt', 'path'):
                    continue
                walk(item)
        elif isinstance(node, (list, tuple, set)):
            for item in node:
                walk(item)

    for obj in objects:
        walk(obj)
    return {'numbers': numbers, 'dates': dates}


def check(text, allowed):
    """{ok, unmatched[]}: every number, amount, hour count and date in text must be in `allowed`."""
    allowed = allowed or {}
    pool = [float(n) for n in allowed.get('numbers', ())]
    dates = set()
    for value in allowed.get('dates', ()):
        dates |= date_keys(value) if not (isinstance(value, tuple) and value and value[0] in ('md', 'dow', 'clock')) else {value}
    unmatched = []
    for item in extract_numbers(text):
        if item['kind'] == 'date':
            keys = item['value']
            if any(k[0] in ('md', 'dow') for k in keys):
                keys = {k for k in keys if k[0] in ('md', 'dow')}      # a stated day must match, not just the clock time
            if not (keys & dates):
                unmatched.append(item['raw'])
        elif not any(_close(item['value'], n, item.get('decimal')) for n in pool):
            unmatched.append(item['raw'])
    return {'ok': not unmatched, 'unmatched': unmatched}


def money(value):
    """'EUR 12,345' or the fixed phrase for an unknown price. Never a guess."""
    if value is None:
        return 'price unknown, assumption needed'
    return f'EUR {value:,.0f}' if abs(value - round(value)) < 0.005 else f'EUR {value:,.2f}'


def fmt(value):
    if value is None:
        return 'unknown'
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, int):
        return f'{value:,}'
    if isinstance(value, float):
        return f'{value:,.0f}' if abs(value - round(value)) < 0.005 else f'{value:,.2f}'.rstrip('0')
    return str(value)


def compose(template, values):
    """Fill a template with code-computed values. Missing keys become 'unknown', never a guess."""
    class Safe(dict):
        def __missing__(self, key):
            return 'unknown'
    return template.format_map(Safe({k: fmt(v) for k, v in (values or {}).items()}))


def vet_text(text, allowed, fallback):
    """(text, replaced). Text with any unmatched number is dropped for the code-composed fallback."""
    if isinstance(text, str) and text.strip() and check(text, allowed)['ok']:
        return text.strip(), False
    return fallback, True


# ------------------------------------------------------------------ claim check

GAIN_PATTERNS = (
    re.compile(r'\bgain(?:s|ed|ing)?\s*[:\-]?\s*(?:of\s+|about\s+)?(?<![€$])(\d[\d,]*(?:\.\d+)?)(?!\s*(?:EUR|USD|€|h\b))', re.I),
    re.compile(r'(\d[\d,]*)\s+(?:copies|cards|units)\s+(?:gained|saved|recovered|shipped)\b', re.I),
    re.compile(r'\badds?\s+(\d[\d,]*)(?!\s*(?:EUR|USD|€))', re.I),
)
ETA_CLAIM = re.compile(r'\b(?:arrives?|arriving|delivered|by)\s+([^.;\n]{0,24})', re.I)
CERTAIN = re.compile(r'\b(?:confirmed|guaranteed|will\s+ship)\b', re.I)
NEGATION = re.compile(r"\b(?:not|no|never|nothing|none|un|to be|must be|should be|until|once|if|whether)\b|n't", re.I)


def check_claims(text, gains_allowed, etas_allowed, any_feasible):
    """{ok, unmatched[]}: claims of copies gained, arrival times and certainty must match computed values.

    A number that exists elsewhere in the records does not make a gain claim true: the gain must equal a
    non-null copies_gained of an option or the brief.
    """
    text = text if isinstance(text, str) else ''
    gains = [float(g) for g in gains_allowed or [] if isinstance(g, (int, float)) and not isinstance(g, bool)]
    dates = set()
    for value in etas_allowed or ():
        dates |= date_keys(value) if not (isinstance(value, tuple) and value and value[0] in ('md', 'dow', 'clock')) else {value}
    unmatched = []
    for pattern in GAIN_PATTERNS:
        for match in pattern.finditer(text):
            try:
                number = _float(match[1])
            except ValueError:
                continue
            if not any(abs(number - g) <= 0.51 for g in gains):
                unmatched.append(match[0].strip())
    for match in ETA_CLAIM.finditer(text):
        keys = date_keys(match[1])
        if any(k[0] in ('md', 'dow') for k in keys):
            keys = {k for k in keys if k[0] in ('md', 'dow')}
        if keys and not (keys & dates):
            unmatched.append(match[0].strip())
    if not any_feasible:
        for match in CERTAIN.finditer(text):
            if not NEGATION.search(text[max(0, match.start() - 24):match.start()]):
                unmatched.append(match[0])
    return {'ok': not unmatched, 'unmatched': unmatched}
