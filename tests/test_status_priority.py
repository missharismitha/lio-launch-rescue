"""Newer pack-out status, German number formats and remaining shift hours."""
from app.engine import _de_number, _hours_left

SHIFTS = {'Saturday': (6.0, 22.0), 'Sunday': (6.0, 20.0)}


def test_german_thousands_are_not_read_as_decimals():
    assert _de_number('554.000') == 554000
    assert _de_number('86.000') == 86000
    assert _de_number(53100) == 53100
    assert _de_number('6000') == 6000
    assert _de_number(None) == 0


def test_hours_left_from_saturday_afternoon():
    assert _hours_left(SHIFTS, {'day': 'Saturday', 'hour': 13.0, 'label': 'Saturday 13:00'}) == 23.0


def test_hours_left_before_first_shift_and_after_last():
    assert _hours_left(SHIFTS, {'day': 'Saturday', 'hour': 5.0, 'label': ''}) == 30.0
    assert _hours_left(SHIFTS, {'day': 'Sunday', 'hour': 21.0, 'label': ''}) == 0.0
    assert _hours_left(SHIFTS, {'day': 'Sunday', 'hour': 12.0, 'label': ''}) == 8.0


def test_hours_left_unknown_inputs_return_none():
    assert _hours_left({}, {'day': 'Saturday', 'hour': 13.0}) is None
    assert _hours_left(SHIFTS, None) is None
