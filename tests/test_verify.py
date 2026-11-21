"""Number self-check: extraction, matching within rounding, and the reject-and-compose policy."""
from datetime import date, datetime

import pytest

from app import verify
from app.recovery import BERLIN


def kinds(text):
    return [(f['kind'], f['raw']) for f in verify.extract_numbers(text)]


def test_extracts_quantities_amounts_hours_and_dates():
    found = verify.extract_numbers('Ship 6,800 units for EUR 12,345.50 within 4.5 h, arriving Sun 02:00 or 2026-11-24 (24 Nov).')
    by_kind = {k: [f['raw'] for f in found if f['kind'] == k] for k in ('number', 'amount', 'hours', 'date')}
    assert by_kind['number'] == ['6,800'] and by_kind['amount'] == ['EUR 12,345.50'] and by_kind['hours'] == ['4.5 h']
    assert by_kind['date'] == ['2026-11-24', 'Sun 02:00', '24 Nov']
    amount = next(f for f in found if f['kind'] == 'amount')
    assert amount['value'] == 12345.5


@pytest.mark.parametrize('text,value', [('about 20k EUR', 20000.0), ('USD 1.5 million', 1500000.0), ('€ 900', 900.0), ('$1,000', 1000.0)])
def test_amount_forms(text, value):
    assert [f['value'] for f in verify.extract_numbers(text) if f['kind'] == 'amount'] == [value]


def test_identifiers_and_list_markers_are_not_numbers():
    assert kinds('Order 4500318735, waybill 020-48113256 for CMP-GAM-001 and SKU AB123.') == []
    assert kinds('1. First\n2) Second') == []


def test_check_matches_within_rounding_only():
    allowed = verify.allowed_from({'q': 6800, 'cost': 1234.56, 'hours': 22.5}, extra_dates=['2026-11-22T02:00:00+01:00'])
    assert verify.check('6,800 units cost EUR 1,235 within 22.5 h, by Sun 02:00', allowed) == {'ok': True, 'unmatched': []}
    bad = verify.check('6,801 units cost EUR 1,300', allowed)
    assert bad['ok'] is False and bad['unmatched'] == ['EUR 1,300', '6,801'] or set(bad['unmatched']) == {'6,801', 'EUR 1,300'}
    assert verify.check('about 22.6 h', allowed)['ok'] is False                  # decimals match to one decimal only
    assert verify.check('Mon 02:00', allowed)['ok'] is False                    # right time, wrong day
    assert verify.check('no numbers here at all', allowed)['ok'] is True


def test_check_dates_by_day_month_and_iso():
    allowed = verify.allowed_from({'eta': '2026-11-24'}, extra_dates=[date(2026, 11, 22)])
    assert verify.check('by 24 Nov and 2026-11-22', allowed)['ok'] is True
    assert verify.check('by 25 Nov', allowed)['ok'] is False
    assert verify.check('at 14:30', allowed)['ok'] is False


def test_allowed_from_walks_nested_values_and_skips_evidence_and_bools():
    allowed = verify.allowed_from({'a': [1, {'b': 2.5}], 'evidence': [{'excerpt': 999}], 'flag': True, 'none': None, 'nan': float('nan')})
    assert allowed['numbers'] == {1.0, 2.5}


def test_labels():
    assert verify.label_of(datetime(2026, 11, 22, 2, 0, tzinfo=BERLIN)) == 'Sun 02:00'
    assert verify.eta_label('2026-11-24') == 'Tue 24 Nov'
    assert verify.eta_label('2026-11-22T02:00:00+01:00') == 'Sun 02:00'
    assert verify.eta_label('nonsense') is None and verify.eta_label(None) is None


def test_compose_injects_code_values_and_never_guesses():
    assert verify.compose('Ship {q} units for {price}', {'q': 6800, 'price': None}) == 'Ship 6,800 units for unknown'
    assert verify.compose('x {missing}', {}) == 'x unknown'
    assert verify.compose('{v}', {'v': 12.5}) == '12.5' and verify.compose('{v}', {'v': 12.0}) == '12'
    assert verify.money(None) == 'price unknown, assumption needed'
    assert verify.money(1234.0) == 'EUR 1,234' and verify.money(1234.5) == 'EUR 1,234.50'


def test_vet_text_keeps_clean_text_and_replaces_mismatches():
    allowed = verify.allowed_from({'q': 600})
    assert verify.vet_text('Ship 600 units.', allowed, 'fallback') == ('Ship 600 units.', False)
    assert verify.vet_text('Ship 601 units.', allowed, 'fallback') == ('fallback', True)
    assert verify.vet_text('', allowed, 'fallback') == ('fallback', True)
    assert verify.vet_text(None, allowed, 'fallback') == ('fallback', True)
